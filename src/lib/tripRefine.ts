import { GEMINI_REFINE_MODEL } from "@/lib/gemini";
import {
  chatRefineSchema,
  type BudgetBreakdown,
  type ChatRefineResult,
  type HotelSuggestion,
  type ItineraryDay,
} from "@/lib/itinerary";
import { generateValidatedJson } from "@/lib/llm";

export type RefineTripInput = {
  destination: string;
  numDays: number;
  numTravelers: number;
  budgetTier: "budget" | "comfort" | "luxury";
  pace: "relaxed" | "balanced" | "fast";
  itinerary: ItineraryDay[];
  budgetBreakdown: BudgetBreakdown;
  hotelSuggestions: HotelSuggestion[];
  /** Recent turns of this trip's refine conversation, oldest first. */
  history: { role: "user" | "assistant"; content: string }[];
  /** The new message the user just sent. */
  message: string;
};

/** Formats the trip's current state, conversation so far, and required JSON shape for the model. */
function buildPrompt(input: RefineTripInput): string {
  const historyLines =
    input.history.length > 0
      ? input.history.map((turn) => `${turn.role === "user" ? "User" : "You"}: ${turn.content}`).join("\n")
      : "(no earlier messages)";

  return `You are Triply's trip-refinement assistant. A trip has already been generated and the user is now asking you to tweak it through chat. You can change ANY part of it the user asks for — not just the day-by-day plan: the destination itself, trip length, traveler count, budget tier, pace, the itinerary, the budget breakdown, and the hotel suggestions.

Current trip (JSON):
${JSON.stringify({
  destination: input.destination,
  numDays: input.numDays,
  numTravelers: input.numTravelers,
  budgetTier: input.budgetTier,
  pace: input.pace,
  itinerary: input.itinerary,
  budgetBreakdown: input.budgetBreakdown,
  hotelSuggestions: input.hotelSuggestions,
})}

Conversation so far:
${historyLines}

User's new message: "${input.message}"

Decide what the user wants:
- If it's a request to change the trip, apply it fully and consistently:
  - Changing the destination (a new city/country) means the itinerary, budget breakdown, and hotel suggestions must all be regenerated for the NEW destination — don't leave old-destination content in place. Format "destination" as "City, Country". Keep the same trip length, traveler count, budget tier, and pace unless the user also asked to change those.
  - Changing trip length, traveler count, budget tier, or pace means the itinerary and budget breakdown must be adjusted to match (day count = numDays, budget scaled to travelers/tier).
  - A narrower request (pace, specific activities, food, dietary needs, swapping a day, budget tweaks) only touches what it needs to — leave everything else exactly as it was.
  - Budget numbers must always be realistic for the (possibly new) destination and tier, and must sum correctly (accommodation + food + transport + activities + misc = total).
- If it's just a question or comment that doesn't require changing the trip, answer it and return every field below completely unchanged from the current trip.

Respond with ONLY a JSON object matching exactly this shape, no markdown fences, no commentary:

{
  "reply": string (a short, friendly chat reply describing what you changed, or answering the question — 1-3 sentences, plain text, no markdown),
  "destination": string ("City, Country"),
  "numDays": number,
  "numTravelers": number,
  "budgetTier": one of "budget" | "comfort" | "luxury",
  "pace": one of "relaxed" | "balanced" | "fast",
  "itinerary": [
    {
      "day": number (1-indexed, exactly 1 to numDays),
      "title": string,
      "activities": [
        {
          "time": string (e.g. "09:00"),
          "title": string,
          "description": string (1-2 sentences),
          "category": one of "food" | "sightseeing" | "activity" | "transport" | "accommodation" | "shopping" | "nightlife" | "other",
          "location": string (optional, place name),
          "lat": number (optional, approximate),
          "lng": number (optional, approximate)
        }
      ]
    }
  ],
  "budgetBreakdown": {
    "currency": string,
    "accommodation": number,
    "food": number,
    "transport": number,
    "activities": number,
    "misc": number,
    "total": number
  },
  "hotelSuggestions": [
    { "name": string, "description": string, "priceRange": string (e.g. "$120-180/night") }
  ]
}`;
}

/**
 * Applies one chat-requested edit to an already-generated trip — OpenAI
 * first, Gemini as the fallback (see src/lib/llm.ts). Always returns the
 * trip's full state back, whether or not anything actually changed,
 * validated the same way trip generation is (LLM JSON is never trusted
 * as-is). Throws if both providers fail.
 */
export async function refineTrip(input: RefineTripInput): Promise<ChatRefineResult> {
  return generateValidatedJson({
    prompt: buildPrompt(input),
    temperature: 0.6,
    schema: chatRefineSchema,
    geminiModel: GEMINI_REFINE_MODEL,
  });
}
