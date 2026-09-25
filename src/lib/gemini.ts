import { GoogleGenAI } from "@google/genai";

import { env } from "@/lib/env";
import { tripGenerationSchema, type TripGeneration } from "@/lib/itinerary";

// "gemini-2.0-flash" (what the installed @google/genai package's own bundled
// JSDoc examples used) turned out to be stale — the live API rejected it
// with a 404 naming "gemini-3.6-flash" as the replacement (confirmed
// 2026-09-23). That one then hit its free-tier daily quota (confirmed via a
// real 429: "limit: 20, model: gemini-3.6-flash") and separately its own
// 503 high-demand errors — both real, not guessed. Quota is tracked
// per-model (the 429's metric name includes the model), so switching models
// gets a fresh, unused quota. Checked what's actually available via
// `client.models.list()` and tried several real candidates against the live
// API (2026-09-24): "gemini-3.8-flash" (newest) was 503-overloaded,
// "gemini-2.5-flash"/"gemini-2.5-flash-lite" are fully retired for new
// users, but "gemini-3.5-flash-lite" succeeded. It's a "lite" model — likely
// somewhat less capable than a full "flash" tier model, worth watching
// itinerary quality on. Revisit if this one also starts hitting limits.
const MODEL = "gemini-3.5-flash-lite";

export type GenerateItineraryInput = {
  destination: string;
  startDate: string; // YYYY-MM-DD
  numDays: number;
  numTravelers: number;
  budgetTier: "budget" | "comfort" | "luxury";
  pace: "relaxed" | "balanced" | "fast";
  interests: string[];
};

function buildPrompt(input: GenerateItineraryInput): string {
  const interestsLine = input.interests.length > 0 ? input.interests.join(", ") : "no particular preference";

  return `You are a professional travel planner. Create a detailed ${input.numDays}-day itinerary for a trip to ${input.destination}, starting ${input.startDate}, for ${input.numTravelers} traveler(s).

Budget tier: ${input.budgetTier} (budget = backpacker/cheap, comfort = mid-range, luxury = high-end).
Travel pace: ${input.pace} (relaxed = 2-3 activities/day, balanced = 3-4, fast = 5+).
Interests: ${interestsLine}.

Respond with ONLY a JSON object matching exactly this shape, no markdown fences, no commentary:

{
  "summary": string (2-3 sentence trip overview),
  "days": [
    {
      "day": number (1-indexed),
      "title": string (short theme for the day),
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
    "currency": string (e.g. "USD"),
    "accommodation": number (total for the trip, per person),
    "food": number,
    "transport": number,
    "activities": number,
    "misc": number,
    "total": number
  },
  "hotelSuggestions": [
    { "name": string, "description": string, "priceRange": string (e.g. "$120-180/night") }
  ]
}

Every day from 1 to ${input.numDays} must be present. Budget numbers must be realistic for the destination and tier, and must sum correctly (accommodation + food + transport + activities + misc = total).`;
}

/**
 * Calls Gemini and returns a validated itinerary. Throws on any failure —
 * network error, non-JSON response, or a response that fails
 * `tripGenerationSchema` — so the caller (the Inngest function) can let
 * Inngest's normal retry behavior handle it. Never returns unvalidated data;
 * per AGENTS.md, LLM JSON is never trusted as-is.
 */
export async function generateItinerary(input: GenerateItineraryInput): Promise<TripGeneration> {
  if (!env.GOOGLE_GENAI_API_KEY) {
    throw new Error(
      "Missing GOOGLE_GENAI_API_KEY — get one from https://aistudio.google.com/apikey and add it to .env",
    );
  }

  const client = new GoogleGenAI({ apiKey: env.GOOGLE_GENAI_API_KEY });

  const response = await client.models.generateContent({
    model: MODEL,
    contents: buildPrompt(input),
    config: {
      responseMimeType: "application/json",
      temperature: 0.8,
      // Without this, a genuine network hang (Gemini accepts the connection
      // but never responds — different from a fast 503 rejection) leaves the
      // Inngest step waiting forever, since nothing ever throws to trigger a
      // retry. Confirmed this actually happens, not just theoretical: a real
      // run sat in `generating` for 7+ minutes with no error, far past the
      // ~3 minute pattern every fast-failing 503 has shown so far.
      httpOptions: { timeout: 60_000 },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(text);
  } catch (err) {
    throw new Error(`Gemini response was not valid JSON: ${(err as Error).message}`);
  }

  // Never trust LLM JSON — this is the actual safety net, independent of
  // whatever Gemini claims to have followed in the prompt.
  return tripGenerationSchema.parse(parsedJson);
}
