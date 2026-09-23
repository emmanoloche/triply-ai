import { sql } from "drizzle-orm";
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
  updated_at: z.number(), // epoch ms, from Clerk
});

export const syncUserUpdate = inngest.createFunction(
  { id: "sync-user-update", triggers: [{ event: "clerk/user.updated" }] },
  async ({ event, step }) => {
    const data = clerkUserUpdatedSchema.parse(event.data);

    await step.run("upsert-user-in-neon", async () => {
      const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || null;
      const email = data.email_addresses[0].email_address;
      const updatedAt = new Date(data.updated_at);

      await db
        .insert(users)
        .values({
          id: data.id,
          email,
          name,
          imageUrl: data.image_url,
          updatedAt,
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
            updatedAt,
          },
          // Only apply the update if the existing row isn't tombstoned and
          // this event is actually newer than what's stored — Svix doesn't
          // guarantee delivery order, so a stale `user.updated` retry could
          // otherwise overwrite newer data or resurrect a deleted user.
          setWhere: sql`${users.deletedAt} is null and ${users.updatedAt} < ${updatedAt}`,
        });
    });
  },
);
