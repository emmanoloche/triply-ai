/**
 * Server-only environment access.
 *
 * Import this ONLY from `+api.ts` route handlers and other server-side
 * modules under `src/lib/**` (db client, Inngest client/functions). Never
 * import it from screens/components — these values are not prefixed with
 * `EXPO_PUBLIC_` and must not end up in the client bundle.
 *
 * Values that the rest of the server code cannot function without (e.g. the
 * database) throw eagerly on import so failures show up immediately. Values
 * that legitimately may not be configured yet (e.g. the Clerk webhook
 * signing secret, before the dev tunnel/endpoint exists) are left as
 * `string | undefined` and must be checked at the call site.
 */

// `process.env.X` must be a static property access (not `process.env[name]`)
// so Expo's env tooling can statically find/inline it — see the
// `expo/no-dynamic-env-var` lint rule.
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export const env = {
  DATABASE_URL: required("DATABASE_URL", process.env.DATABASE_URL),
  CLERK_SECRET_KEY: required("CLERK_SECRET_KEY", process.env.CLERK_SECRET_KEY),
  // Not required at import time — the webhook route checks this itself and
  // returns a clear 500 if it's missing, instead of crashing on load.
  CLERK_WEBHOOK_SIGNING_SECRET: process.env.CLERK_WEBHOOK_SIGNING_SECRET,
} as const;
