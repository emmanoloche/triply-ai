import { z } from "zod";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";

// Same shape validated in the webhook handler — validated again here since
// this function is the one actually writing to the database, and it should
// never trust its input just because the sender is our own webhook route.
const clerkUserCreatedSchema = z.object({
  id: z.string(),
  email_addresses: z.array(z.object({ email_address: z.string().email() })).min(1),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  image_url: z.string().nullable(),
});

export const syncUserCreation = inngest.createFunction(
  { id: "sync-user-creation", triggers: [{ event: "clerk/user.created" }] },
  async ({ event, step }) => {
    const data = clerkUserCreatedSchema.parse(event.data);

    await step.run("upsert-user-in-neon", async () => {
      const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || null;

      await db
        .insert(users)
        .values({
          id: data.id,
          email: data.email_addresses[0].email_address,
          name,
          imageUrl: data.image_url,
        })
        // user.created should only ever insert once; if Svix redelivers the
        // same event (retry) this keeps the function idempotent.
        .onConflictDoNothing({ target: users.id });
    });
  },
);
