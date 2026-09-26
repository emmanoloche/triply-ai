import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { trips } from "@/lib/db/schema";
import { generateItinerary } from "@/lib/tripGeneration";
import { getTripCoverImage } from "@/lib/images";
import { inngest } from "@/lib/inngest/client";
import { refundGeneration } from "@/lib/usage";

// AI SDK errors can carry a raw API error body as `error.message` (Gemini:
// `{"error":{"code":503,"message":"...","status":"UNAVAILABLE"}}`) — not
// something to show a user as-is. Unwrap it to the human-readable message
// when possible, and fall back to the raw string otherwise (a DB or network
// error, or the plain "AI service is temporarily unavailable" message from
// src/lib/llm.ts, won't be JSON shaped at all).
/** Extracts a user-readable message from an AI provider or ordinary error. */
function toUserMessage(error: Error): string {
  try {
    const parsed = JSON.parse(error.message) as { error?: { message?: string } };
    return parsed.error?.message ?? error.message;
  } catch {
    return error.message;
  }
}

const tripGenerateEventSchema = z.object({
  tripId: z.string().uuid(),
  userId: z.string(),
  destination: z.string(),
  startDate: z.string(),
  numDays: z.number().int().positive(),
  numTravelers: z.number().int().positive(),
  budgetTier: z.enum(["budget", "comfort", "luxury"]),
  pace: z.enum(["relaxed", "balanced", "fast"]),
  interests: z.array(z.string()),
});

export const generateTrip = inngest.createFunction(
  {
    id: "generate-trip",
    triggers: [{ event: "trip/generate" }],
    retries: 3,
    // Runs once all retries of the main handler below are exhausted — sets
    // the trip to `failed` with a message and refunds the day's quota, so a
    // AI/Unsplash/DB failure doesn't silently cost the user a generation.
    onFailure: async ({ event, error }) => {
      const original = tripGenerateEventSchema.safeParse(event.data.event.data);
      if (!original.success) {
        console.error("generate-trip onFailure: couldn't parse original event data", original.error);
        return;
      }

      await db
        .update(trips)
        .set({ status: "failed", errorMessage: toUserMessage(error).slice(0, 500) })
        .where(eq(trips.id, original.data.tripId));

      await refundGeneration(original.data.userId);
    },
  },
  async ({ event, step }) => {
    const data = tripGenerateEventSchema.parse(event.data);

    // The itinerary columns are cleared here so a retry starts from a clean
    // slate: the loading screen infers its progress stage from whether the
    // itinerary has been saved yet (see api/trips/[id]/status+api.ts), and a
    // leftover one from a previous attempt would make it look further along
    // than it is.
    await step.run("set-status-generating", async () => {
      await db
        .update(trips)
        .set({ status: "generating", itinerary: null, budgetBreakdown: null, hotelSuggestions: null })
        .where(eq(trips.id, data.tripId));
    });

    // OpenAI first, Gemini as the fallback — handled inside generateItinerary.
    const generated = await step.run("generate-itinerary", async () => {
      return generateItinerary({
        destination: data.destination,
        startDate: data.startDate,
        numDays: data.numDays,
        numTravelers: data.numTravelers,
        budgetTier: data.budgetTier,
        pace: data.pace,
        interests: data.interests,
      });
    });

    // Saved right away (status stays `generating`) instead of at the very end,
    // so the loading screen can show a real "itinerary is ready, now finishing
    // up" stage rather than guessing from a timer.
    await step.run("save-itinerary", async () => {
      await db
        .update(trips)
        .set({
          itinerary: generated.days,
          budgetBreakdown: generated.budgetBreakdown,
          hotelSuggestions: generated.hotelSuggestions,
        })
        .where(eq(trips.id, data.tripId));
    });

    // A trip is not considered successfully generated without a real cover
    // photo — getTripCoverImage retries transient failures internally and
    // throws if it still can't get one. Letting that throw here (rather
    // than swallowing it) means Inngest retries this step as part of the
    // function's own `retries: 3` — the memoized "generate-itinerary" step
    // above won't re-run, so a cover-image retry doesn't cost another AI call.
    // If every retry is exhausted, onFailure marks the trip `failed` and
    // refunds the day's quota instead of shipping a trip with no cover.
    const cover = await step.run("fetch-cover-image", async () => {
      return getTripCoverImage(data.destination, data.tripId);
    });

    await step.run("persist-ready", async () => {
      await db
        .update(trips)
        .set({
          status: "ready",
          coverImageUrl: cover.coverImageUrl,
          coverImageCredit: cover.coverImageCredit,
        })
        .where(eq(trips.id, data.tripId));
    });
  },
);
