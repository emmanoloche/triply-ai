import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { trips } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";
import { refundGeneration, tryConsumeGeneration } from "@/lib/usage";

// A generation still pending/generating after this long is treated as orphaned.
// Worst case for a healthy run is a few minutes (each AI provider's 60s timeout x
// Inngest's retries, plus cover-image retries), so 10 minutes is a safe margin.
const STALE_IN_FLIGHT_MS = 10 * 60 * 1000;

// Powers (home)/trips.tsx's list. Only `ready` trips — pending/generating
// aren't done yet, and failed ones have nothing useful to show on a card.
export async function GET(request: Request) {
  const userId = await requireUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: trips.id,
      destination: trips.destination,
      numDays: trips.numDays,
      coverImageUrl: trips.coverImageUrl,
      budgetBreakdown: trips.budgetBreakdown,
    })
    .from(trips)
    .where(and(eq(trips.userId, userId), eq(trips.status, "ready")))
    .orderBy(desc(trips.createdAt));

  return Response.json(rows);
}

const createTripSchema = z.object({
  destination: z.string().trim().min(1).max(120),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "startDate must be YYYY-MM-DD"),
  numDays: z.number().int().min(1).max(30),
  numTravelers: z.number().int().min(1).max(10),
  budgetTier: z.enum(["budget", "comfort", "luxury"]),
  pace: z.enum(["relaxed", "balanced", "fast"]),
  interests: z.array(z.string()).default([]),
});

export async function POST(request: Request) {
  const userId = await requireUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createTripSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request", issues: parsed.error.flatten() }, { status: 400 });
  }

  // Don't let a user run more than one generation at a time — cheaper (no
  // wasted AI calls/quota for a trip they've forgotten about) and avoids
  // confusing "which loading screen is this" states. Server-side, not just
  // client-side, since the client can't be trusted to enforce this alone.
  const [inProgress] = await db
    .select({ id: trips.id, updatedAt: trips.updatedAt })
    .from(trips)
    .where(and(eq(trips.userId, userId), inArray(trips.status, ["pending", "generating"])))
    .limit(1);

  if (inProgress) {
    if (Date.now() - inProgress.updatedAt.getTime() < STALE_IN_FLIGHT_MS) {
      return Response.json({ id: inProgress.id, reused: true }, { status: 200 });
    }

    // Orphaned: nothing finished it within any plausible generation time
    // (e.g. submitted while the Inngest server wasn't running). Fail it so it
    // stops blocking the user, and give back the quota it consumed. The status
    // guard makes this a no-op if it actually completed in the meantime.
    const [expired] = await db
      .update(trips)
      .set({ status: "failed", errorMessage: "Generation timed out. Please try again." })
      .where(and(eq(trips.id, inProgress.id), inArray(trips.status, ["pending", "generating"])))
      .returning({ id: trips.id });
    if (!expired) {
      return Response.json({ id: inProgress.id, reused: true }, { status: 200 });
    }
    await refundGeneration(userId);
  }

  const allowed = await tryConsumeGeneration(userId);
  if (!allowed) {
    return Response.json({ error: "Daily generation limit reached. Try again tomorrow." }, { status: 429 });
  }

  const [trip] = await db
    .insert(trips)
    .values({
      userId,
      destination: parsed.data.destination,
      startDate: parsed.data.startDate,
      numDays: parsed.data.numDays,
      numTravelers: parsed.data.numTravelers,
      budgetTier: parsed.data.budgetTier,
      pace: parsed.data.pace,
      interests: parsed.data.interests,
      status: "pending",
    })
    .returning({ id: trips.id });

  await inngest.send({
    name: "trip/generate",
    data: {
      tripId: trip.id,
      userId,
      destination: parsed.data.destination,
      startDate: parsed.data.startDate,
      numDays: parsed.data.numDays,
      numTravelers: parsed.data.numTravelers,
      budgetTier: parsed.data.budgetTier,
      pace: parsed.data.pace,
      interests: parsed.data.interests,
    },
  });

  return Response.json({ id: trip.id, reused: false }, { status: 201 });
}
