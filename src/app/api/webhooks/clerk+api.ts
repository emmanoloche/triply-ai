import { Webhook } from "svix";
import { z } from "zod";

import { env } from "@/lib/env";
import { inngest } from "@/lib/inngest/client";

// Clerk has no official Expo Router (`+api.ts`) webhook adapter (its
// `verifyWebhook()` helpers only ship for Next.js/Express/Astro/etc — see
// .claude/skills/clerk-webhooks). This does what those adapters do
// internally: verify the raw body with `svix` directly against
// CLERK_WEBHOOK_SIGNING_SECRET.
const clerkUserSchema = z.object({
  id: z.string(),
  email_addresses: z.array(z.object({ email_address: z.string().email() })).min(1),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  image_url: z.string().nullable(),
});

const clerkUserDeletedSchema = z.object({
  id: z.string(),
});

export async function POST(request: Request) {
  if (!env.CLERK_WEBHOOK_SIGNING_SECRET) {
    console.error("CLERK_WEBHOOK_SIGNING_SECRET is not set — cannot verify Clerk webhooks yet.");
    return new Response("Webhook not configured", { status: 500 });
  }

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response("Missing svix headers", { status: 400 });
  }

  // Signature verification needs the exact raw bytes Clerk sent —
  // must read as text, not request.json(), before any parsing.
  const rawBody = await request.text();

  // Installed svix@2.5.0's `verify()` only checks the signature and returns
  // `undefined` — it does not parse/return the body (unlike older svix
  // versions the skill docs assume). Parse separately after it doesn't throw.
  const wh = new Webhook(env.CLERK_WEBHOOK_SIGNING_SECRET);
  try {
    wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch (err) {
    console.error("Clerk webhook verification failed:", err);
    return new Response("Verification failed", { status: 400 });
  }

  let evt: { type: string; data: unknown };
  try {
    evt = JSON.parse(rawBody);
  } catch (err) {
    console.error("Clerk webhook payload is not valid JSON:", err);
    return new Response("Invalid payload", { status: 400 });
  }

  if (evt.type === "user.created" || evt.type === "user.updated") {
    const parsed = clerkUserSchema.safeParse(evt.data);
    if (!parsed.success) {
      console.error(`Clerk ${evt.type} payload failed validation:`, parsed.error.flatten());
      return new Response("Invalid payload", { status: 400 });
    }

    // Hand off to Inngest rather than writing to the DB inline — gets
    // retries/observability for free and keeps this route fast.
    await inngest.send({
      name: evt.type === "user.created" ? "clerk/user.created" : "clerk/user.updated",
      data: parsed.data,
    });
  } else if (evt.type === "user.deleted") {
    const parsed = clerkUserDeletedSchema.safeParse(evt.data);
    if (!parsed.success) {
      console.error("Clerk user.deleted payload failed validation:", parsed.error.flatten());
      return new Response("Invalid payload", { status: 400 });
    }

    await inngest.send({
      name: "clerk/user.deleted",
      data: parsed.data,
    });
  }

  return new Response("OK", { status: 200 });
}
