import { and, count, eq } from "drizzle-orm";

import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { trips } from "@/lib/db/schema";

// Full trip detail — used by the (minimal, functional-only) trip detail
// screen once generation finishes. The rich Phase 4 detail UI (map, hotel
// cards, budget charts, etc.) is separate follow-up work; this route just
// returns the data.
export async function GET(request: Request, { id }: Record<string, string>) {
  const userId = await requireUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [trip] = await db
    .select()
    .from(trips)
    .where(and(eq(trips.id, id), eq(trips.userId, userId)))
    .limit(1);

  if (!trip) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(trip);
}

export async function DELETE(request: Request, { id }: Record<string, string>) {
  const userId = await requireUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [deleted] = await db
    .delete(trips)
    .where(and(eq(trips.id, id), eq(trips.userId, userId)))
    .returning({ id: trips.id });

  if (!deleted) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Lets the client decide where to send the user next — straight to Home's
  // "generate a trip" CTA if that was their last trip, otherwise the Trips
  // list as usual.
  const [{ value: remaining }] = await db
    .select({ value: count() })
    .from(trips)
    .where(eq(trips.userId, userId));

  return Response.json({ id: deleted.id, remainingTrips: remaining });
}
