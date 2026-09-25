import { GoogleGenAI } from "@google/genai";

import { env } from "@/lib/env";
import type { ChatTurn } from "@/lib/llm";

// Gemini is the fallback provider (OpenAI is primary — see src/lib/llm.ts).
//
// Model notes, learned against the live API: "gemini-2.0-flash" (what the
// installed package's own JSDoc examples used) was stale — the API rejected it
// with a 404 naming a successor. Free-tier quota is tracked per model (a real
// 429 named the model in its metric), so different features use different
// models to keep one from eating the other's daily allowance. Newest models
// (e.g. "gemini-3.8-flash") were frequently 503-overloaded; "lite" variants and
// slightly older ones were steadier. Re-check with `client.models.list()` if
// one starts failing.

/** Model for trip itineraries. */
export const GEMINI_ITINERARY_MODEL = "gemini-3.5-flash-lite";
/** Separate model for popular destinations so its quota is independent. */
export const GEMINI_DESTINATIONS_MODEL = "gemini-3.6-flash";

/**
 * Asks Gemini for a JSON object and returns the raw text (parsing and
 * validation happen in src/lib/llm.ts). Throws on any failure.
 */
export async function generateWithGemini(prompt: string, temperature: number, model: string): Promise<string> {
  if (!env.GOOGLE_GENAI_API_KEY) {
    throw new Error(
      "Missing GOOGLE_GENAI_API_KEY — get one from https://aistudio.google.com/apikey and add it to .env",
    );
  }

  const client = new GoogleGenAI({ apiKey: env.GOOGLE_GENAI_API_KEY });

  const response = await client.models.generateContent({
    model,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      temperature,
      // Without this, a genuine network hang (accepts the connection but never
      // responds — different from a fast 503) leaves the Inngest step waiting
      // forever, since nothing throws to trigger a retry. Confirmed real: a run
      // once sat in `generating` for 7+ minutes with no error.
      httpOptions: { timeout: 60_000 },
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }
  return text;
}

/** Separate model for the assistant chat, so its quota is independent too. */
export const GEMINI_CHAT_MODEL = "gemini-flash-lite-latest";

/**
 * Multi-turn plain-text chat reply, yielded piece by piece as Gemini produces
 * it. Gemini wants alternating user/model turns starting with the user, so
 * consecutive turns from the same side (e.g. after a failed send) are merged
 * into one.
 */
export async function* streamChatWithGemini(
  system: string,
  turns: ChatTurn[],
  temperature: number,
): AsyncGenerator<string> {
  if (!env.GOOGLE_GENAI_API_KEY) {
    throw new Error(
      "Missing GOOGLE_GENAI_API_KEY — get one from https://aistudio.google.com/apikey and add it to .env",
    );
  }

  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];
  for (const turn of turns) {
    const role = turn.role === "assistant" ? "model" : "user";
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts[0].text += `\n\n${turn.content}`;
    } else {
      contents.push({ role, parts: [{ text: turn.content }] });
    }
  }

  const client = new GoogleGenAI({ apiKey: env.GOOGLE_GENAI_API_KEY });
  const stream = await client.models.generateContentStream({
    model: GEMINI_CHAT_MODEL,
    contents,
    config: { systemInstruction: system, temperature, httpOptions: { timeout: 30_000 } },
  });

  for await (const chunk of stream) {
    const piece = chunk.text;
    if (piece) yield piece;
  }
}
