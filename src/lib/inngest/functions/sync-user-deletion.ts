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

    await step.run("delete-user-from-neon", async () => {
      // No error if the row is already gone — deleting a deleted user
      // should be a no-op, not a failure (keeps retries/redeliveries safe).
      await db.delete(users).where(eq(users.id, data.id));
    });
  },
);
