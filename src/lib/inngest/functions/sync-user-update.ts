import { z } from "zod";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";

// Same shape validated in the webhook handler — validated again here since
// this function is the one actually writing to the database (see
// sync-user-creation.ts for why).
const clerkUserUpdatedSchema = z.object({
  id: z.string(),
  email_addresses: z.array(z.object({ email_address: z.string().email() })).min(1),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  image_url: z.string().nullable(),
});

export const syncUserUpdate = inngest.createFunction(
  { id: "sync-user-update", triggers: [{ event: "clerk/user.updated" }] },
  async ({ event, step }) => {
    const data = clerkUserUpdatedSchema.parse(event.data);

    await step.run("upsert-user-in-neon", async () => {
      const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || null;
      const email = data.email_addresses[0].email_address;

      await db
        .insert(users)
        .values({
          id: data.id,
          email,
          name,
          imageUrl: data.image_url,
        })
        // Upsert rather than a plain UPDATE: if `user.updated` somehow
        // arrives before/without a `user.created` (e.g. redelivery
        // ordering), this still leaves a correct row instead of silently
        // updating zero rows.
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email,
            name,
            imageUrl: data.image_url,
            updatedAt: new Date(),
          },
        });
    });
  },
);
