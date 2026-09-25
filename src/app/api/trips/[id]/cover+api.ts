import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { requireUserId } from "@/lib/auth";
import { db } from "@/lib/db/client";
import { trips } from "@/lib/db/schema";
import { uploadCustomCoverImage } from "@/lib/images";

const coverUploadSchema = z.object({
  base64: z.string().min(1).max(15_000_000), // ~11MB decoded, well above the picker's compressed output
  mimeType: z.string().startsWith("image/"),
});

// Replaces a trip's cover with a user-picked gallery photo. The Unsplash
// attribution no longer applies once the photo is the user's own, so
// coverImageCredit is cleared alongside the new URL.
export async function PATCH(request: Request, { id }: Record<string, string>) {
  const userId = await requireUserId(request);
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.id, id), eq(trips.userId, userId)))
    .limit(1);

  if (!trip) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = coverUploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid image" }, { status: 400 });
  }

  const coverImageUrl = await uploadCustomCoverImage(parsed.data.base64, parsed.data.mimeType, id);
  if (!coverImageUrl) {
    return Response.json({ error: "Upload failed" }, { status: 502 });
  }

  await db.update(trips).set({ coverImageUrl, coverImageCredit: null }).where(eq(trips.id, id));

  return Response.json({ coverImageUrl });
}
