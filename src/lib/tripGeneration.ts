import { GEMINI_ITINERARY_MODEL } from "@/lib/gemini";
import { tripGenerationSchema, type TripGeneration } from "@/lib/itinerary";
import { generateValidatedJson } from "@/lib/llm";

export type GenerateItineraryInput = {
  destination: string;
  startDate: string; // YYYY-MM-DD
  numDays: number;
  numTravelers: number;
  budgetTier: "budget" | "comfort" | "luxury";
  pace: "relaxed" | "balanced" | "fast";
  interests: string[];
};

/** Formats trip constraints and the required JSON shape for the model. */
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
 * Generates a validated itinerary — OpenAI first, Gemini as the fallback (see
 * src/lib/llm.ts). Throws if both fail, so the caller (the Inngest function)
 * can let Inngest's normal retry behavior handle it. Never returns
 * unvalidated data; per AGENTS.md, LLM JSON is never trusted as-is.
 */
export async function generateItinerary(input: GenerateItineraryInput): Promise<TripGeneration> {
  return generateValidatedJson({
    prompt: buildPrompt(input),
    temperature: 0.8,
    schema: tripGenerationSchema,
    geminiModel: GEMINI_ITINERARY_MODEL,
  });
}
