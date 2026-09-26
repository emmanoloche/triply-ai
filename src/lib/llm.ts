import type { z } from "zod";

import { generateWithGemini, streamChatWithGemini } from "@/lib/gemini";
import { generateWithOpenAI, streamChatWithOpenAI } from "@/lib/openai";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseAndValidate<T>(text: string, schema: z.ZodType<T>): T {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Error(`Response was not valid JSON: ${messageOf(err)}`);
  }
  // Never trust LLM JSON — this is the actual safety net, independent of
  // whatever the model claims to have followed in the prompt.
  return schema.parse(json);
}

/**
 * Generates a JSON object from a prompt and returns it validated against
 * `schema`. OpenAI is tried first; if it fails for any reason (network, rate
 * limit, outage, or output that doesn't match the schema) the same prompt is
 * sent to Gemini. Throws only if both fail.
 *
 * `geminiModel` is passed in so each feature can use its own Gemini model,
 * keeping their free-tier quotas independent.
 */
export async function generateValidatedJson<T>(options: {
  prompt: string;
  temperature: number;
  schema: z.ZodType<T>;
  geminiModel: string;
}): Promise<T> {
  const { prompt, temperature, schema, geminiModel } = options;

  try {
    return parseAndValidate(await generateWithOpenAI(prompt, temperature), schema);
  } catch (openAiError) {
    console.warn("OpenAI failed, falling back to Gemini:", messageOf(openAiError));

    try {
      return parseAndValidate(await generateWithGemini(prompt, temperature, geminiModel), schema);
    } catch (geminiError) {
      console.error("Both AI providers failed.", {
        openai: messageOf(openAiError),
        gemini: messageOf(geminiError),
      });
      // This message can end up on a trip's `errorMessage` shown to the user,
      // so keep it plain; the real causes are in the log above.
      throw new Error("The AI service is temporarily unavailable. Please try again in a moment.", {
        cause: geminiError,
      });
    }
  }
}

/** One message in a chat history, as sent to the model. */
export type ChatTurn = { role: "user" | "assistant"; content: string };

/**
 * Pulls the first piece out of a provider's stream before handing anything
 * back, so a provider that fails to start (bad key, outage, rate limit)
 * throws here — early enough to fall back to the other provider — instead of
 * after the caller has already begun sending a response. Returns a stream that
 * yields that first piece and then the rest.
 */
async function primeStream(source: AsyncGenerator<string>): Promise<AsyncGenerator<string>> {
  const first = await source.next();
  if (first.done) {
    throw new Error("The provider returned an empty response");
  }
  return (async function* () {
    yield first.value;
    yield* source;
  })();
}

/**
 * Streams a reply to a chat conversation as plain text, piece by piece.
 * OpenAI first, Gemini as the fallback, same as generateValidatedJson — but
 * with no schema, since the answer is prose for a person to read. The
 * fallback only applies to a provider that fails before producing any text;
 * once a reply has started streaming it can't be switched to another model
 * mid-sentence, so a later failure surfaces as an error on the stream. Throws
 * only if both providers fail to start.
 */
export async function streamChatReply(options: {
  system: string;
  turns: ChatTurn[];
  temperature?: number;
}): Promise<AsyncGenerator<string>> {
  const { system, turns, temperature = 0.7 } = options;

  try {
    return await primeStream(streamChatWithOpenAI(system, turns, temperature));
  } catch (openAiError) {
    console.warn("OpenAI chat failed, falling back to Gemini:", messageOf(openAiError));

    try {
      return await primeStream(streamChatWithGemini(system, turns, temperature));
    } catch (geminiError) {
      console.error("Both AI providers failed to start a chat reply.", {
        openai: messageOf(openAiError),
        gemini: messageOf(geminiError),
      });
      throw new Error("The AI service is temporarily unavailable. Please try again in a moment.", {
        cause: geminiError,
      });
    }
  }
}
