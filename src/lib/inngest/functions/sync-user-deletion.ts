import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { inngest } from "@/lib/inngest/client";

const clerkUserDeletedSchema = z.object({
  id: z.string(),
});

export const syncUserDeletion = inngest.createFunction(
  { id: "sync-user-deletion", triggers: [{ event: "clerk/user.deleted" }] },
  async ({ event, step }) => {
    const data = clerkUserDeletedSchema.parse(event.data);

    await step.run("tombstone-user-in-neon", async () => {
      // Soft delete rather than a hard DELETE: keeps the row so a stale,
      // out-of-order `user.updated` redelivery can't resurrect it (see
      // sync-user-update.ts's setWhere guard). No-op if the row is already
      // gone or already tombstoned.
      await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, data.id));
    });
  },
);
