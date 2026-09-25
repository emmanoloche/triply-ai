import { and, eq } from "drizzle-orm";

import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { trips } from "@/lib/db/schema";

// Polled by src/app/trip-loading.tsx while a trip is pending/generating.
// Deliberately minimal — just enough for the loading screen to know when to
// move on, plus destination/numDays for its "N days in City" subtitle (cheap
// to include, avoids a second request). Full trip data is GET
// /api/trips/[id]+api.ts.
export async function GET(request: Request, { id }: Record<string, string>) {
  const userId = await requireUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [trip] = await db
    .select({
      status: trips.status,
      errorMessage: trips.errorMessage,
      destination: trips.destination,
      numDays: trips.numDays,
    })
    .from(trips)
    // Scoped by userId, not just id — a trip id alone must never be enough
    // to read another user's data (AGENTS.md: every DB query is scoped by
    // the authenticated userId).
    .where(and(eq(trips.id, id), eq(trips.userId, userId)))
    .limit(1);

  if (!trip) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(trip);
}
