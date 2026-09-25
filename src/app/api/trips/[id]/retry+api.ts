import { and, eq } from "drizzle-orm";

import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { isUniqueViolation } from "@/lib/db/errors";
import { trips } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";
import { tryConsumeGeneration } from "@/lib/usage";

// Re-fires generation for an existing failed trip, reusing the destination/
// dates/etc. already stored on the row — the point is the user shouldn't
// have to retype the whole form just because Gemini was temporarily
// overloaded (503). Only `failed` trips can be retried, and it still goes
// through the same usage cap as a fresh submission (the original attempt's
// quota was already refunded on failure, so this is a new attempt).
export async function POST(request: Request, { id }: Record<string, string>) {
  const userId = await requireUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Atomic failed -> pending transition: only one concurrent retry can win it,
  // and it happens before quota is consumed so losers never spend quota.
  let trip;
  try {
    [trip] = await db
      .update(trips)
      // updatedAt restarts the in-flight clock (see STALE_IN_FLIGHT_MS in trips+api.ts).
      .set({ status: "pending", errorMessage: null, updatedAt: new Date() })
      .where(and(eq(trips.id, id), eq(trips.userId, userId), eq(trips.status, "failed")))
      .returning();
  } catch (error) {
    // trips_one_in_flight_per_user: another trip is already pending/generating.
    if (!isUniqueViolation(error)) throw error;
    return Response.json(
      { error: "Another trip is already being generated. Wait for it to finish, then retry." },
      { status: 409 },
    );
  }

  if (!trip) {
    const [existing] = await db
      .select({ id: trips.id })
      .from(trips)
      .where(and(eq(trips.id, id), eq(trips.userId, userId)))
      .limit(1);
    if (!existing) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json({ error: "Only a failed trip can be retried" }, { status: 400 });
  }

  const allowed = await tryConsumeGeneration(userId);
  if (!allowed) {
    // Quota denied: put the trip back to failed so it can be retried later.
    await db
      .update(trips)
      .set({ status: "failed", errorMessage: "Daily generation limit reached. Try again tomorrow." })
      .where(and(eq(trips.id, id), eq(trips.userId, userId)));
    return Response.json({ error: "Daily generation limit reached. Try again tomorrow." }, { status: 429 });
  }

  await inngest.send({
    name: "trip/generate",
    data: {
      tripId: trip.id,
      userId,
      destination: trip.destination,
      startDate: trip.startDate,
      numDays: trip.numDays,
      numTravelers: trip.numTravelers,
      budgetTier: trip.budgetTier,
      pace: trip.pace,
      interests: trip.interests,
    },
  });

  return Response.json({ id: trip.id }, { status: 200 });
}
