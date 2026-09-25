import OpenAI from "openai";

import { env } from "@/lib/env";
import type { ChatTurn } from "@/lib/llm";

// Picked from the models the API key can actually use (client.models.list(),
// 2026-09-25) and confirmed live with a JSON-mode + temperature call. A "mini"
// tier model: fast and cheap, plenty for itineraries and destination lists.
const MODEL = "gpt-5.4-mini";

/**
 * Asks OpenAI for a JSON object and returns the raw text (parsing and
 * validation happen in src/lib/llm.ts). Throws on any failure — the caller
 * falls back to Gemini.
 *
 * JSON mode requires the prompt itself to mention JSON, which both of our
 * prompts do. `maxRetries: 1` lets the SDK absorb one transient 429/5xx/network
 * blip before we give up and fall back.
 */
export async function generateWithOpenAI(prompt: string, temperature: number): Promise<string> {
  if (!env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY — get one from https://platform.openai.com/api-keys and add it to .env");
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 60_000, maxRetries: 1 });

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature,
  });

  const text = response.choices[0]?.message?.content;
  if (!text) {
    throw new Error("OpenAI returned an empty response");
  }
  return text;
}

/**
 * Multi-turn plain-text chat reply, yielded piece by piece as OpenAI produces
 * it (no JSON mode). Shorter timeout than the JSON helpers because a person is
 * watching the chat bubble fill in.
 */
export async function* streamChatWithOpenAI(
  system: string,
  turns: ChatTurn[],
  temperature: number,
): AsyncGenerator<string> {
  if (!env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY — get one from https://platform.openai.com/api-keys and add it to .env");
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 30_000, maxRetries: 1 });

  const stream = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "system", content: system }, ...turns],
    temperature,
    // Chat answers start streaming much sooner without a "thinking" pause
    // (measured live: ~0.9s to first text vs 1.8-7s by default), and casual
    // travel questions don't need deep reasoning.
    reasoning_effort: "none",
    stream: true,
  });

  for await (const chunk of stream) {
    const piece = chunk.choices[0]?.delta?.content;
    if (piece) yield piece;
  }
}
