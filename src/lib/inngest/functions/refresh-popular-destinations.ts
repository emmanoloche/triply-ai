import { db } from "@/lib/db/client";
import { popularDestinations } from "@/lib/db/schema";
import { getPopularDestinationImage } from "@/lib/images";
import { inngest } from "@/lib/inngest/client";
import { FALLBACK_DESTINATION_NAMES, fetchPopularDestinationNames } from "@/lib/popularDestinations";

const DESTINATION_COUNT = 6;

/** Converts a destination name to a URL-safe image filename prefix. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Cosmetic only — there's no real per-destination rating data anywhere in
// this pipeline. See the `rating` column comment in db/schema.ts.
/** Generates a display-only rating between 4.7 and 4.9. */
function randomRating(): number {
  return Math.round((4.7 + Math.random() * 0.2) * 10) / 10;
}

/**
 * Repopulates the Home screen's "Popular destinations" row on a schedule —
 * every 2 days, not per-request. The Home screen just reads whatever this
 * last wrote (see GET /api/popular-destinations+api.ts); this is global
 * data, not scoped to any one user.
 *
 * If a cover photo can't be fetched for one destination even after
 * getPopularDestinationImage's internal retries, that single destination is
 * skipped rather than failing the whole refresh — unlike a trip's cover
 * image (tied to one user's paid-for generation), losing one row out of six
 * here is a minor, low-stakes miss, not worth retrying the entire function
 * (and re-spending five other Gemini/Unsplash/ImageKit calls) over.
 *
 * Uses two separate writes (delete, then insert) rather than a transaction
 * — the neon-http driver this project uses doesn't support interactive
 * transactions. There's a brief window where the table is empty between the
 * two; acceptable for data that only changes every couple of days on a
 * schedule, not in response to user traffic.
 *
 * If Gemini can't produce a list at all, falls back to a small hardcoded
 * set of well-known destinations (FALLBACK_DESTINATION_NAMES) rather than
 * retrying the whole function against an already-struggling model — real
 * photos are still fetched for those names the normal way, so even the
 * worst case still looks like a real, populated row.
 */
export const refreshPopularDestinations = inngest.createFunction(
  { id: "refresh-popular-destinations", triggers: [{ cron: "TZ=UTC 0 3 */2 * *" }], retries: 2 },
  async ({ step }) => {
    const names = await step.run("fetch-destination-names", async () => {
      try {
        return await fetchPopularDestinationNames(DESTINATION_COUNT);
      } catch (err) {
        console.error("Gemini failed to produce popular destinations, using fallback list:", err);
        return FALLBACK_DESTINATION_NAMES;
      }
    });

    const rows = await step.run("fetch-cover-images", async () => {
      const results: { name: string; imageUrl: string; imageCredit: string; rating: number; rank: number }[] = [];
      for (let i = 0; i < names.length; i++) {
        try {
          const slug = `${slugify(names[i].name)}-${Date.now()}`;
          const image = await getPopularDestinationImage(names[i].name, slug);
          results.push({
            name: names[i].name,
            imageUrl: image.imageUrl,
            imageCredit: image.imageCredit,
            rating: randomRating(),
            rank: i,
          });
        } catch (err) {
          console.error(`Skipping "${names[i].name}" — cover image fetch failed:`, err);
        }
      }
      return results;
    });

    if (rows.length === 0) {
      throw new Error("Couldn't fetch a cover image for any popular destination — nothing to persist");
    }

    await step.run("replace-popular-destinations", async () => {
      await db.delete(popularDestinations);
      await db.insert(popularDestinations).values(rows);
    });
  },
);
