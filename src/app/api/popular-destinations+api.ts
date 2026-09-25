import { asc } from "drizzle-orm";

import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { popularDestinations } from "@/lib/db/schema";

// Powers (home)/index.tsx's "Popular destinations" row. Still requires a
// valid Clerk session (every other screen in the app does), but the query
// itself is intentionally not scoped by userId — this is global data,
// refreshed on a schedule for everyone (see
// src/lib/inngest/functions/refresh-popular-destinations.ts), not a
// per-user resource.
export async function GET(request: Request) {
  const userId = await requireUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db
    .select({
      id: popularDestinations.id,
      name: popularDestinations.name,
      imageUrl: popularDestinations.imageUrl,
      imageCredit: popularDestinations.imageCredit,
      rating: popularDestinations.rating,
    })
    .from(popularDestinations)
    .orderBy(asc(popularDestinations.rank));

  return Response.json(rows);
}
