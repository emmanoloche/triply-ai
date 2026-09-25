import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { generationUsage } from "@/lib/db/schema";

const DAILY_GENERATION_CAP = 20;

function todayKey(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

/**
 * Atomically increments today's generation count for a user and reports
 * whether they were under the cap *before* this increment (i.e. whether this
 * generation is allowed to proceed). Always increments — callers that decide
 * not to proceed because the cap was hit should NOT call refundUsage for
 * that same call, since nothing was actually consumed... except the count
 * already went up. To keep this simple and race-safe, we increment first and
 * treat "count > cap" as "over" (so the increment itself doesn't grant one
 * extra generation past the cap).
 */
export async function tryConsumeGeneration(userId: string): Promise<boolean> {
  const day = todayKey();

  const [row] = await db
    .insert(generationUsage)
    .values({ userId, day, count: 1 })
    .onConflictDoUpdate({
      target: [generationUsage.userId, generationUsage.day],
      set: { count: sql`${generationUsage.count} + 1` },
    })
    .returning({ count: generationUsage.count });

  return row.count <= DAILY_GENERATION_CAP;
}

/**
 * Refunds one generation — called when a generation fails terminally, so a
 * failure doesn't cost the user part of their daily quota (per plan.md).
 * Floors at 0; never goes negative.
 */
export async function refundGeneration(userId: string): Promise<void> {
  const day = todayKey();

  await db
    .update(generationUsage)
    .set({ count: sql`greatest(${generationUsage.count} - 1, 0)` })
    .where(and(eq(generationUsage.userId, userId), eq(generationUsage.day, day)));
}
