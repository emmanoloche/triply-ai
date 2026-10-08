import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { assistantMessages, generationUsage, trips, users } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";

const clerkUserDeletedSchema = z.object({
  id: z.string(),
});

export const syncUserDeletion = inngest.createFunction(
  { id: "sync-user-deletion", triggers: [{ event: "clerk/user.deleted" }] },
  async ({ event, step }) => {
    const data = clerkUserDeletedSchema.parse(event.data);

    await step.run("delete-user-data-in-neon", async () => {
      // One transaction (db.batch), so a user is never left half-deleted.
      // Everything the user owns is deleted for real: trips, Assistant
      // messages and the daily usage counter. Safe to rerun if Inngest retries.
      //
      // The users row itself is kept as a tombstone rather than hard-deleted, so
      // a stale, out-of-order `user.updated` redelivery can't resurrect it (see
      // sync-user-update.ts's setWhere guard) — but its personal details (email,
      // name, photo) are wiped, so nothing identifying stays behind.
      await db.batch([
        db.delete(trips).where(eq(trips.userId, data.id)),
        db.delete(assistantMessages).where(eq(assistantMessages.userId, data.id)),
        db.delete(generationUsage).where(eq(generationUsage.userId, data.id)),
        db
          .update(users)
          .set({
            deletedAt: new Date(),
            email: `deleted-${data.id}@deleted.invalid`,
            name: null,
            imageUrl: null,
          })
          .where(eq(users.id, data.id)),
      ]);
    });
  },
);
