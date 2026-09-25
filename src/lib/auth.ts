import { verifyToken } from "@clerk/backend";

import { env } from "@/lib/env";

/**
 * Verifies the `Authorization: Bearer <token>` header on an API route
 * request and returns the Clerk user id, or null if missing/invalid.
 *
 * Clerk has no official Expo Router (`+api.ts`) integration (same situation
 * as the webhook route — see clerk-expo skill's recipes.md, "Calling your
 * backend"): the client sends the session token via `useAuth().getToken()`,
 * and the server verifies it with `@clerk/backend` directly.
 */
export async function requireUserId(request: Request): Promise<string | null> {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!token) return null;

  try {
    const verified = await verifyToken(token, { secretKey: env.CLERK_SECRET_KEY });
    return verified.sub;
  } catch (err) {
    console.error("Clerk token verification failed:", err);
    return null;
  }
}
