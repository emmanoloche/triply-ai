import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { chatMessages, trips } from "@/lib/db/schema";
import { getTripCoverImage } from "@/lib/images";
import { refineTrip } from "@/lib/tripRefine";

/** Loose match so trivial formatting differences ("Paris,France" vs "Paris, France") don't trigger a needless re-fetch. */
function sameDestination(a: string, b: string): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
  return normalize(a) === normalize(b);
}

// Same shape of caps as the general Assistant tab (see api/assistant+api.ts):
// only recent turns give the model useful context, and one message can't be
// arbitrarily long.
const MAX_HISTORY_TURNS = 20;
const MAX_MESSAGE_CHARS = 1000;
const MAX_MESSAGES_LOADED = 200;

const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});

// This trip's saved "Refine with AI" conversation, oldest first, loaded when
// the sheet opens. Scoped by both trip id and the authenticated owner.
export async function GET(request: Request, { id }: Record<string, string>) {
  const userId = await requireUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, id), eq(trips.userId, userId)))
    .limit(1);
  if (!trip) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.tripId, id))
    .orderBy(asc(chatMessages.createdAt))
    .limit(MAX_MESSAGES_LOADED);

  return Response.json(rows);
}

// One chat-requested edit (or just a question) about an already-generated
// trip. A synchronous LLM call (not streamed, unlike the general Assistant
// tab — see src/lib/tripRefine.ts) always returns the trip's full state back
// (destination, itinerary, budget, hotels — everything a generation
// produces), changed or not; this persists that as the trip's new state,
// refreshes the cover photo if the destination actually changed, and saves
// the exchange, then hands the full new state to the client so the detail
// screen can update immediately without refetching.
export async function POST(request: Request, { id }: Record<string, string>) {
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
  if (!trip.itinerary || !trip.budgetBreakdown) {
    return Response.json({ error: "This trip isn't ready to refine yet" }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = chatRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }
  const message = parsed.data.message;

  const recent = await db
    .select({ role: chatMessages.role, content: chatMessages.content })
    .from(chatMessages)
    .where(eq(chatMessages.tripId, id))
    .orderBy(desc(chatMessages.createdAt))
    .limit(MAX_HISTORY_TURNS);

  let result;
  try {
    result = await refineTrip({
      destination: trip.destination,
      numDays: trip.numDays,
      numTravelers: trip.numTravelers,
      budgetTier: trip.budgetTier,
      pace: trip.pace,
      itinerary: trip.itinerary,
      budgetBreakdown: trip.budgetBreakdown,
      hotelSuggestions: trip.hotelSuggestions ?? [],
      history: recent.reverse(),
      message,
    });
  } catch (error) {
    console.error("Trip refine failed:", error);
    return Response.json(
      { error: "The assistant is temporarily unavailable. Please try again in a moment." },
      { status: 503 },
    );
  }

  // The user hit "stop" (see RefineTripSheet's stop button) while this was in
  // flight: the AI call itself already ran (this provider round-trip has no
  // cheap way to cancel mid-flight, unlike the streamed Assistant chat), but
  // nobody's waiting for the result any more, so it's discarded here rather
  // than silently applied to the trip or saved to history behind the user's
  // back.
  if (request.signal.aborted) {
    return new Response(null, { status: 499 });
  }

  // A destination change makes the old cover photo (and its Unsplash credit)
  // wrong, so it's refreshed the same way trip generation gets its first one
  // (search Unsplash, re-host via ImageKit). This is best-effort: a failure
  // here (rate limit, network blip beyond the built-in retries) shouldn't
  // block an otherwise-valid edit — the trip just keeps its old cover until
  // the next successful refine or a manual photo change.
  let cover: { coverImageUrl: string; coverImageCredit: string } | null = null;
  if (!sameDestination(result.destination, trip.destination)) {
    try {
      cover = await getTripCoverImage(result.destination, trip.id);
    } catch (error) {
      console.error("Trip refine: cover photo refresh failed, keeping the old one:", error);
    }
  }

  await db.batch([
    db
      .update(trips)
      .set({
        destination: result.destination,
        numDays: result.numDays,
        numTravelers: result.numTravelers,
        budgetTier: result.budgetTier,
        pace: result.pace,
        itinerary: result.itinerary,
        budgetBreakdown: result.budgetBreakdown,
        hotelSuggestions: result.hotelSuggestions,
        ...(cover ? { coverImageUrl: cover.coverImageUrl, coverImageCredit: cover.coverImageCredit } : {}),
      })
      .where(eq(trips.id, id)),
    db.insert(chatMessages).values([
      { tripId: id, role: "user", content: message },
      { tripId: id, role: "assistant", content: result.reply },
    ]),
  ]);

  return Response.json({
    ...result,
    coverImageUrl: cover?.coverImageUrl ?? trip.coverImageUrl,
    coverImageCredit: cover?.coverImageCredit ?? trip.coverImageCredit,
  });
}
