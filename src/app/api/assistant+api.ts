import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { assistantMessages, users } from "@/lib/db/schema";
import { streamChatReply } from "@/lib/llm";

// Caps that keep one request (and its cost) bounded: only the most recent
// messages give the model useful context for a travel chat, and a single
// message can't be arbitrarily long.
const MAX_HISTORY_TURNS = 20;
const MAX_CONTENT_CHARS = 2000;
// How many saved messages the app is sent when it opens the conversation.
const MAX_MESSAGES_LOADED = 200;

const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(MAX_CONTENT_CHARS),
});

// The app (assistant.tsx, ReplyText) draws only a small markdown subset: **bold**,
// "- " bullets and "1." numbering. The model is told to stick to exactly that,
// so nothing else shows up as raw symbols.
const SYSTEM_PROMPT = `You are Triply's friendly travel companion inside a trip-planning app. Help with anything about planning trips: where to go, when to visit, what to pack, budgets, food, getting around, and safety.

Style rules:
- Be concise and practical. Prefer short paragraphs and short lists.
- Use **double asterisks** to bold short section headings (on their own line) and key terms such as place names and important warnings. Don't bold whole sentences.
- For lists, put each item on its own line starting with "- ", and bold its lead-in when it helps, like "- **Barcelona:** great food and weather". Use "1." numbering only for steps or rankings.
- Use no other markdown: no # headings, no backticks, no tables, no italics.
- You don't have live data (prices, weather, opening hours, flight times), so don't present those as current facts; say to check them before booking.
- If a question isn't about travel, say briefly that you can only help with trip planning, and steer back to it.
- End with one short follow-up question only when it would genuinely help.`;

// The signed-in user's saved conversation, oldest first, for the Assistant
// tab to show when it opens. Every query here is scoped to that user.
export async function GET(request: Request) {
  const userId = await requireUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Newest N (so a very long history can't make this huge), then put them back
  // in reading order.
  const rows = await db
    .select({ id: assistantMessages.id, role: assistantMessages.role, content: assistantMessages.content })
    .from(assistantMessages)
    .where(eq(assistantMessages.userId, userId))
    .orderBy(desc(assistantMessages.createdAt))
    .limit(MAX_MESSAGES_LOADED);

  return Response.json(rows.reverse());
}

// Both the clear below and the save at the end of POST take this same
// per-user lock, inside one transaction each (db.batch runs its statements as
// a single transaction on this driver, which has no interactive transactions).
// That makes them strictly one-after-the-other for a given user instead of able
// to interleave.
const lockUser = (userId: string) => db.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}))`);

// "Clear conversation": deletes every saved message for the signed-in user, and
// records when. A reply that began before that moment is refused at save time
// (see saveExchange), so it can't reappear after this returns — including a
// reply being written for the same account on another device.
export async function DELETE(request: Request) {
  const userId = await requireUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  await db.batch([
    lockUser(userId),
    db.update(users).set({ assistantClearedAt: new Date() }).where(eq(users.id, userId)),
    db.delete(assistantMessages).where(eq(assistantMessages.userId, userId)),
  ]);
  return Response.json({ ok: true });
}

/**
 * Saves a question and its answer together — unless the conversation was
 * cleared after the question was asked. The check and the insert are one
 * statement, and they run under the same per-user lock as the clear, so either
 * the save lands first (and the clear then deletes it) or the clear lands first
 * (and this saves nothing). Returns whether anything was saved.
 */
async function saveExchange(userId: string, question: string, askedAt: Date, answer: string) {
  const asked = askedAt.toISOString();
  const answered = new Date().toISOString();
  const [, saved] = await db.batch([
    lockUser(userId),
    db.execute(sql`
      insert into ${assistantMessages} (user_id, role, content, created_at)
      select ${userId}, v.role, v.content, v.created_at
      from (values
        ('user', ${question}, ${asked}::timestamptz),
        ('assistant', ${answer}, ${answered}::timestamptz)
      ) as v(role, content, created_at)
      where not exists (
        select 1 from ${users}
        where ${users.id} = ${userId} and ${users.assistantClearedAt} > ${asked}::timestamptz
      )
    `),
  ]);
  return (saved.rowCount ?? 0) > 0;
}

// General travel chat for the Assistant tab, streamed back as plain text as it
// is written. The app sends only the new message; the conversation so far comes
// from the database (the user's own saved messages), so the client can't
// inject a fake history. The question and its answer are saved together once
// the answer has fully arrived — a failed, interrupted or abandoned reply saves
// nothing.
export async function POST(request: Request) {
  const userId = await requireUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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
  const askedAt = new Date();

  const recent = await db
    .select({ role: assistantMessages.role, content: assistantMessages.content })
    .from(assistantMessages)
    .where(eq(assistantMessages.userId, userId))
    .orderBy(desc(assistantMessages.createdAt))
    .limit(MAX_HISTORY_TURNS);
  const turns = [...recent.reverse(), { role: "user" as const, content: message }];

  // Starting the stream waits for the first piece of the reply, so a provider
  // that can't start (and the fallback to the other one) is settled here,
  // while a normal JSON error response is still possible.
  let pieces: AsyncGenerator<string>;
  try {
    pieces = await streamChatReply({ system: SYSTEM_PROMPT, turns });
  } catch (error) {
    console.error("Assistant chat failed:", error);
    return Response.json(
      { error: "The assistant is temporarily unavailable. Please try again in a moment." },
      { status: 503 },
    );
  }

  const encoder = new TextEncoder();
  let reply = "";
  let cancelled = false;
  const replyStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await pieces.next();
        // Stopped while this read was waiting: the stream is already closed.
        if (cancelled) return;
        if (done) {
          // The whole answer is here: save the question and the answer together
          // (unless the conversation was cleared meanwhile). A failure to save
          // shouldn't cost the user the reply they just got.
          try {
            await saveExchange(userId, message, askedAt, reply);
          } catch (error) {
            console.error("Couldn't save the assistant exchange:", error);
          }
          controller.close();
        } else {
          reply += value;
          controller.enqueue(encoder.encode(value));
        }
      } catch (error) {
        if (cancelled) return;
        // Failed after the reply had started: it can't be switched to the other
        // provider mid-sentence, so end the stream with an error and let the
        // app decide what to show alongside the partial text. Nothing is saved.
        console.error("Assistant reply failed partway through:", error);
        controller.error(error);
      }
    },
    // The app stopped the reply (the stop button) or went away: stop asking the
    // AI for text nobody will read. What was written so far is kept, like
    // ChatGPT keeps a stopped answer — and saveExchange refuses to save it if
    // the conversation was cleared meanwhile, so clearing can't be undone this
    // way. Nothing is saved if no text had been written yet.
    async cancel() {
      cancelled = true;
      await pieces.return(undefined);
      if (!reply.trim()) return;
      try {
        await saveExchange(userId, message, askedAt, reply);
      } catch (error) {
        console.error("Couldn't save the stopped assistant reply:", error);
      }
    },
  },
  // Only pull a piece when the app actually asks for one. By default a stream
  // reads one piece ahead on its own, which would make a reply stopped before
  // any text reached the app look like it had been written.
  { highWaterMark: 0 });

  return new Response(replyStream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // No caching, and no intermediary re-encoding that would buffer the stream.
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
