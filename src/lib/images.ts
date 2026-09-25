import ImageKit from "@imagekit/nodejs";

import { env } from "@/lib/env";

const imagekit = new ImageKit({ privateKey: env.IMAGEKIT_PRIVATE_KEY });

type UnsplashSearchResponse = {
  results: { urls: { regular: string }; user: { name: string } }[];
};

export type UnsplashPhoto = {
  imageUrl: string;
  /** Photographer's display name — Unsplash's API guidelines require crediting them. */
  photographerName: string;
};

/**
 * Retries a flaky network call a few times with backoff before giving up.
 * Exists for transient DNS/connection blips — confirmed in practice against
 * both Clerk and ImageKit on a metered mobile hotspot (`getaddrinfo EAI_AGAIN
 * upload.imagekit.io`) — not for permanent failures like "no results" or a
 * real auth error, which callers handle themselves.
 */
async function withRetries<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 600): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

async function unsplashSearch(query: string): Promise<UnsplashPhoto | null> {
  const url = new URL("https://api.unsplash.com/search/photos");
  url.searchParams.set("query", query);
  url.searchParams.set("per_page", "1");
  url.searchParams.set("orientation", "landscape");

  const data = await withRetries(async () => {
    const res = await fetch(url, {
      headers: { Authorization: `Client-ID ${env.UNSPLASH_ACCESS_KEY}` },
    });
    if (!res.ok) {
      throw new Error(`Unsplash search failed (${res.status}): ${await res.text().catch(() => "")}`);
    }
    return (await res.json()) as UnsplashSearchResponse;
  });

  const photo = data.results[0];
  if (!photo) return null;
  return { imageUrl: photo.urls.regular, photographerName: photo.user.name };
}

/**
 * Searches Unsplash for a landscape photo matching the destination, falling
 * back from "City, Country" → city alone → country alone (a real, sparsely-
 * tagged city can 0-result on the combined query — confirmed directly:
 * "Makurdi, Nigeria" → 0 results, "Makurdi" alone → 1, "Nigeria" alone →
 * 2590 — the combined query was too narrow, not that the city has zero
 * coverage).
 *
 * A transient failure at one tier (network blip, rate limit) doesn't abort
 * the whole search — it's swallowed and the next tier is tried — but if
 * every tier comes back empty or failing, this throws rather than returning
 * null. Trip generation requires a cover photo (see getTripCoverImage); a
 * silent null here used to mean "ship the trip without one," which is
 * exactly what we no longer want.
 */
export async function searchUnsplashCoverImage(destination: string): Promise<UnsplashPhoto> {
  const [city, ...rest] = destination.split(",").map((part) => part.trim());
  const country = rest.join(", ");

  const queries = [destination];
  if (city && city !== destination) queries.push(city);
  if (country) queries.push(country);

  let lastError: unknown;
  for (const query of queries) {
    try {
      const hit = await unsplashSearch(query);
      if (hit) return hit;
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`No Unsplash photo found for "${destination}"`);
}

/**
 * Uploads a remote image URL to ImageKit (it fetches the URL server-side —
 * no need to download it ourselves) and returns the served CDN URL. Retries
 * transient failures; throws (doesn't return null) if it still can't upload.
 */
async function uploadImageToImageKit(sourceUrl: string, fileName: string, folder: string): Promise<string> {
  const result = await withRetries(() => imagekit.files.upload({ file: sourceUrl, fileName, folder }));
  if (!result.url) throw new Error("ImageKit upload succeeded but returned no file URL");
  return result.url;
}

/** Throws (doesn't return null) if it still can't upload after retries —
 * see searchUnsplashCoverImage for why a trip's cover image is no longer optional. */
export async function uploadCoverImageToImageKit(sourceUrl: string, tripId: string): Promise<string> {
  return uploadImageToImageKit(sourceUrl, `trip-cover-${tripId}.jpg`, "/triply/trip-covers");
}

/**
 * Uploads a user-picked gallery photo (sent from the client as base64) to
 * ImageKit and returns the served CDN URL, with a `tr=w-1600,q-75` delivery
 * transformation appended so what actually loads in the app is bounded in
 * size regardless of how large the original photo off the user's phone was.
 * Returns null (not a throw) on failure — this is a foreground user action
 * with its own error UI (see the cover+api.ts route), not part of the
 * generation pipeline's "never ship without a cover" guarantee.
 */
export async function uploadCustomCoverImage(
  base64: string,
  mimeType: string,
  tripId: string,
): Promise<string | null> {
  try {
    const result = await withRetries(() =>
      imagekit.files.upload({
        file: `data:${mimeType};base64,${base64}`,
        fileName: `trip-cover-${tripId}-${Date.now()}.jpg`,
        folder: "/triply/trip-covers",
      }),
    );
    if (!result.url) return null;
    return `${result.url}?tr=w-1600,q-75`;
  } catch (err) {
    console.error("ImageKit custom cover upload failed:", err);
    return null;
  }
}

/**
 * Search Unsplash, then re-host via ImageKit. Throws if either step
 * ultimately fails (after in-process retries) — a trip is not considered
 * successfully generated without a real cover photo of the destination.
 * The Inngest step calling this (see generate-trip.ts) lets that propagate,
 * so a persistent failure here fails the whole generation (refunding the
 * user's quota) instead of silently shipping a trip with no cover.
 */
export async function getTripCoverImage(
  destination: string,
  tripId: string,
): Promise<{ coverImageUrl: string; coverImageCredit: string }> {
  const photo = await searchUnsplashCoverImage(destination);
  const coverImageUrl = await uploadCoverImageToImageKit(photo.imageUrl, tripId);
  return { coverImageUrl, coverImageCredit: photo.photographerName };
}

/**
 * Same idea as getTripCoverImage, for the Home screen's "Popular
 * destinations" row instead of a trip — separate ImageKit folder/filename
 * pattern (`slug`, not a trip id). Throws under the same conditions; the
 * caller (the Inngest cron function) skips that one destination rather than
 * failing the whole refresh over one bad photo.
 */
export async function getPopularDestinationImage(
  destinationName: string,
  slug: string,
): Promise<{ imageUrl: string; imageCredit: string }> {
  const photo = await searchUnsplashCoverImage(destinationName);
  const imageUrl = await uploadImageToImageKit(
    photo.imageUrl,
    `destination-${slug}.jpg`,
    "/triply/popular-destinations",
  );
  return { imageUrl, imageCredit: photo.photographerName };
}
