import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

import { env } from "@/lib/env";

// Deliberately a different model than src/lib/gemini.ts's itinerary
// generation uses ("gemini-3.5-flash-lite") — Gemini's free-tier quota is
// tracked per model (confirmed directly against the live API, see
// gemini.ts's comment), so this feature running on its own schedule can
// never eat into trip generation's daily allowance. "gemini-3.8-flash" (the
// newest) was persistently 503-overloaded when tried live (2026-09-24);
// "gemini-3.6-flash" responded successfully, so that's the pick here.
const MODEL = "gemini-3.6-flash";

const destinationListSchema = z.object({
  destinations: z.array(z.object({ name: z.string().min(1) })).min(1),
});

export type PopularDestinationName = { name: string };

/**
 * Used when Gemini can't produce a list at all (see the Inngest cron
 * function) — a small, globally varied set so the Home screen never ends up
 * with nothing to show. Real photos are still fetched for these the same
 * way as Gemini-sourced names; only the names themselves are hardcoded.
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
 * Asks Gemini to name currently popular destinations from its own training
 * knowledge — not live web search. Google Search grounding would give a
 * more genuinely "reviewed from the web" answer, but it requires a
 * billing-enabled Google Cloud project; confirmed unavailable on this key
 * (a real 429 naming "plan and billing details" specifically when the
 * search tool was attached, even though a plain call on the same model
 * succeeded). Throws on any failure; the caller (the Inngest cron function)
 * handles retries via Inngest's normal step retry behavior.
 */
export async function fetchPopularDestinationNames(count = 6): Promise<PopularDestinationName[]> {
  if (!env.GOOGLE_GENAI_API_KEY) {
    throw new Error("Missing GOOGLE_GENAI_API_KEY");
  }

  const client = new GoogleGenAI({ apiKey: env.GOOGLE_GENAI_API_KEY });

  const response = await client.models.generateContent({
    model: MODEL,
    contents: buildPrompt(count),
    config: {
      responseMimeType: "application/json",
      temperature: 1,
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

  // Never trust LLM JSON — same rule as itinerary generation.
  return destinationListSchema.parse(parsedJson).destinations;
}
