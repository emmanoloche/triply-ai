import { z } from "zod";

import { GEMINI_DESTINATIONS_MODEL } from "@/lib/gemini";
import { generateValidatedJson } from "@/lib/llm";

const destinationListSchema = z.object({
  destinations: z.array(z.object({ name: z.string().min(1) })).min(1),
});

export type PopularDestinationName = { name: string };

/**
 * Last resort, used only when neither OpenAI nor Gemini can produce a list
 * (see the Inngest cron function) — a small, globally varied set so the Home
 * screen never ends up with nothing to show. Real photos are still fetched
 * for these the same way as AI-sourced names; only the names are hardcoded.
 */
export const FALLBACK_DESTINATION_NAMES: PopularDestinationName[] = [
  { name: "Tokyo, Japan" },
  { name: "New York City, United States" },
  { name: "Riyadh, Saudi Arabia" },
  { name: "Paris, France" },
  { name: "Cape Town, South Africa" },
  { name: "Sydney, Australia" },
];

/** Requests a varied list of destination names in the expected JSON shape. */
function buildPrompt(count: number): string {
  return `You are a well-traveled travel editor. Name ${count} genuinely popular, well-known international travel destinations that people actually visit right now — a mix of cities, regions, and iconic landmarks, varied across continents. Don't just repeat the same 3-4 most obvious ones.

Respond with ONLY a JSON object matching exactly this shape, no markdown fences, no commentary:

{ "destinations": [ { "name": string } ] }

Each "name" must be in "City, Country" form (e.g. "Kyoto, Japan").`;
}

/**
 * Asks the AI (OpenAI first, Gemini as fallback — see src/lib/llm.ts) to name
 * currently popular destinations from its own training knowledge, not live web
 * search. Google Search grounding would be more genuinely "reviewed from the
 * web", but it needs a billing-enabled Google Cloud project; confirmed
 * unavailable on this key. Throws if both providers fail; the Inngest cron
 * function then uses FALLBACK_DESTINATION_NAMES.
 */
export async function fetchPopularDestinationNames(count = 6): Promise<PopularDestinationName[]> {
  const result = await generateValidatedJson({
    prompt: buildPrompt(count),
    temperature: 1,
    schema: destinationListSchema,
    geminiModel: GEMINI_DESTINATIONS_MODEL,
  });
  return result.destinations;
}
