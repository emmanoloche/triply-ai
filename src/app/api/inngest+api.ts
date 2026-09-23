import { serve } from "inngest/edge";

import { inngest } from "@/lib/inngest/client";
import { syncUserCreation } from "@/lib/inngest/functions/sync-user-creation";
import { syncUserDeletion } from "@/lib/inngest/functions/sync-user-deletion";
import { syncUserUpdate } from "@/lib/inngest/functions/sync-user-update";

// `inngest/edge` is the generic Fetch-API (standard Request/Response)
// adapter — Expo Router API routes have no official Inngest integration,
// but `+api.ts` handlers use the same Request/Response Web APIs this
// adapter targets (confirmed against Expo's own API routes docs).
const handler = serve({
  client: inngest,
  functions: [syncUserCreation, syncUserUpdate, syncUserDeletion],
});

export { handler as GET, handler as POST, handler as PUT };
