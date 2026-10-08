# Triply — Build Plan & Checklist

> AI trip planner (Android, iOS, Web — Expo SDK 57). This is the living checklist for v1.
> Check items off (`[x]`) as they're completed. Full spec lives at the bottom.
>
> Structure mirrors a tutorial's own build plan, adapted for two real differences: this app targets
> **Android + iOS + Web** (not iOS-only), and uses **OpenAI as the primary model with Gemini as the
> automatic fallback** for all generation (started Gemini-only; OpenAI added 2026-09-25 — see the
> "AI providers" item under Phase 3).

---

## Legend

- `[ ]` not started · `[~]` in progress · `[x]` done
- Each phase has a **Definition of Done** so we know when to check the header.

---

## Deferred until the native Android dev build succeeds

**The native Android dev build succeeded for the first time on 2026-09-27** (`expo run:android`, a Redmi 14C over USB). It took an unusually long ordeal to get there — not the normal cost of this step — including a genuine Maven download timeout, Quick Heal AntiVirus silently deleting `gradlew.bat` and the `expo` npm shim mid-build (worked around by pausing its real-time protection), and a real NDK r27 regression on Windows that drops implicit `libc++` linking, which broke six native modules (`react-native-worklets`, `react-native-screens`, `@sentry/react-native`, `react-native-reanimated`, `react-native-gesture-handler`, `expo-modules-core`) plus the app's own aggregate native build — fixed by explicitly adding `c++` to each affected `target_link_libraries()` call (patches land in `node_modules`, so they don't survive a fresh `npm install`; worth revisiting as a `patch-package` entry if this recurs). The APK installed and the dev client now connects to Metro and renders the real sign-in screen. This section is now unblocked; picking off each item below.

- [~] **Native Google sign-in** (`useSignInWithGoogle` from `@clerk/expo/google`) — implemented 2026-09-29 in `(auth)/sign-in.tsx`: the existing "Continue with Google" button now uses the native Credential Manager sheet on Android/iOS, falling back to the unchanged `useSSO()` browser flow on Web (additive, not a replacement — Apple's button is untouched, still SSO-only). Needed **two** Google Cloud OAuth clients, not one — a real gotcha found via source-checking the installed `@clerk/expo` (4.6.8): an Android-type client (package name `com.anonymous.TRIPLY` + debug SHA-1, registers the app with Google/Credential Manager) *and* a separate Web-application-type client, whose ID is what actually goes in `.env` as `EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID` (Clerk verifies the Google ID token server-side with it) — the Android client's ID itself isn't used in code at all. `expo-crypto` installed (nonce generation). `tsc`/lint clean. **Not yet verified end-to-end**: needs the Web client's secret pasted into Clerk Dashboard → SSO connections → Google (custom credentials), Native API confirmed enabled under Native Applications, a rebuild (bundled with the maps/icon rebuild below), and one real sign-in on device. Apple sign-in (`useSignInWithApple`, iOS only) still not started — lower priority since iOS is blocked entirely (no Mac).
- [~] **Sentry native crash reporting** — the JS-side Sentry setup (`Sentry.init`, error boundary, navigation tracking) was already done and worked in Expo Go/web. `app.json`'s `@sentry/react-native/expo` config plugin (org/project) was already in place, so no code changes were needed for native crash capture itself. Added a dev-only "Test native crash" row to the Profile screen's Support section (`Sentry.nativeCrash()`, gated by `__DEV__` and native-only) on 2026-09-29 so this can actually be verified on-device — **not yet triggered/confirmed in the Sentry dashboard**.
- [~] **Trip-detail map** — switched from the originally-planned `react-native-maps` (Google Maps) to **MapLibre (`@maplibre/maplibre-react-native`) + OpenFreeMap**, a deliberate stack deviation decided 2026-09-29: Google requires a billing-account card to create a Maps API key at all — even though actual Android usage is unlimited/free per Google's own docs — and the user doesn't have a card. MapLibre + OpenFreeMap needs no account, no API key, no card, ever. Implemented as `src/components/TripMap.native.tsx` (real map, pins from the LLM's optional per-activity `lat`/`lng`, already in the schema/prompt) and `TripMap.web.tsx` (placeholder — maps stay native-only per `AGENTS.md`), wired into `trip/[id].tsx`. Needed a `tsconfig.json` `moduleSuffixes` addition and an `eslint.config.js` resolver override since neither `tsc` nor ESLint's import resolver understood the project's own `.native.tsx`/`.web.tsx` convention out of the box (first time this codebase used that split). `tsc`/lint clean. **Not yet verified on-device** — needs the rebuild below.
- [ ] **A real installable app** — for sharing, testing on other phones, or eventually publishing. Expo Go is a dev-only wrapper. Closer now that one real device install has succeeded, but still needs a release/production build (EAS Build), not just this debug dev-client build.

Per `AGENTS.md`, this was a known, accepted limitation of the setup while the build hadn't succeeded, not a bug to fix: "This app cannot run in Expo Go (maps, Apple auth, Sentry native). Use a development build." That limitation is now resolved.

---

## Phase 0 — Foundations

- [ ] Read Expo v57 docs for API routes / server output (per `AGENTS.md`)
- [ ] Set `web.output: "server"` in `app.json` (enables API routes)
- [x] Install `expo-dev-client` (required regardless of the Clerk auth-flow choice, since `react-native-maps` and `expo-apple-authentication` already need a custom dev build — Expo Go alone won't run this app)
- [~] Install Expo-native deps: `@sentry/react-native`, `expo-secure-store`, `expo-web-browser`, `expo-auth-session` installed; `react-native-maps`, `expo-crypto`, `expo-apple-authentication` still pending (native-only — see "Deferred until the native Android dev build succeeds")
- [x] Install JS/server deps: `@clerk/expo`, `drizzle-orm`, `@neondatabase/serverless`, `inngest`, `svix`, `zod`, `@google/genai`, `@clerk/backend` installed; `imagekit` installed then swapped for `@imagekit/nodejs` (upstream deprecated `imagekit` in favor of it, per an `npm install` warning)
- [x] Install dev deps: `drizzle-kit`, `dotenv`
- [x] `.env` populated with the current keys (Clerk, Sentry, DB, and the rest as needed); `.env.example` created and kept in sync
- [~] Add Clerk + relevant config plugins to `app.json` — `@clerk/expo`, `expo-secure-store`, `expo-web-browser`, Sentry plugins are in; `react-native-maps` plugin still pending (package not installed yet)
- [~] Initialize Sentry — client-side `Sentry.init`, error boundary wrap, and navigation tracking done in `_layout.tsx`; the new `+api.ts` routes (webhook, Inngest) don't report to Sentry yet; native crash reporting also pending the dev build
- [~] Set up `src/lib/env.ts` for typed env access — created as a **server-only** module (`DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SIGNING_SECRET`), used by the new db/webhook/Inngest code; `_layout.tsx` / `sign-in.tsx` / `index.tsx` still read `process.env` directly for the client-safe `EXPO_PUBLIC_*` vars — a separate client-safe `env.ts` for those is still a gap
- **DoD:** App boots on Android, iOS, and Web; server API route returns 200 on all three; Sentry receives a test event.

## Phase 1 — Auth & User Sync

- [x] `ClerkProvider` + `tokenCache` wired into `src/app/_layout.tsx`
- [~] Route protection: redirect signed-out → auth, signed-in → app — done via `(auth)/_layout.tsx` + root `src/app/index.tsx` (no `(home)` group yet; `index.tsx` shows a temporary placeholder since the real home screen isn't built — see Phase 4)
- [x] Single auth screen (`(auth)/sign-in.tsx`) — **Google** + **Apple** both on one page via `useSSO`, confirmed as the intended design (not two separate screens)
  - [x] **Google** (`oauth_google`) — confirmed working end-to-end on Android via Expo Go (2026-09-22, real sign-in with a Google account). Session persists across a full app restart (token cache confirmed working). iOS and Web not yet tested.
  - [ ] **Apple** (`oauth_apple`) — implemented, not yet tested on any platform
- [x] Redirect URI / scheme (`triply`) for SSO — already set in `app.json`; `useSSO` uses `AuthSession.makeRedirectUri()` automatically, no extra config needed
- [~] Sign-out action — implemented in `src/app/index.tsx` (the temporary placeholder screen, not `(home)/index.tsx` since that group doesn't exist yet) via `useClerk().signOut()`; passes `tsc`, not yet confirmed working in the running app
- [x] Clerk webhook API route (`src/app/api/webhooks/clerk+api.ts`) verifying with `svix` — no official Expo Router adapter exists (per `clerk-webhooks` skill), so this verifies the raw body manually with `svix`'s `Webhook.verify()`, same as the framework adapters do internally
- [x] Webhook syncs `user.created` → Neon `users` — implemented via an Inngest event (`clerk/user.created`) + function (`src/lib/inngest/functions/sync-user-creation.ts`) that inserts the row (`onConflictDoNothing`, so retried deliveries are safe). **Verified end-to-end 2026-09-22**: real Google sign-up → Clerk webhook (via ngrok dev tunnel) → `sync-user-creation` ran in the local Inngest dev server → row confirmed in Neon (`user_3JhFlc9OX8k1mERWs6fqVee7xvn`, correct email/name/image)
- [x] Webhook syncs `user.updated` → Neon `users` — `clerk/user.updated` event + `src/lib/inngest/functions/sync-user-update.ts`, upserts (`onConflictDoUpdate`) rather than a plain update so it's still correct if delivery order is ever out of sequence. Code is live (app reports all 3 functions registered) but **not independently confirmed with an actual `user.updated` event yet** — only `user.created` and `user.deleted` have been proven with real Neon evidence so far
- [x] Webhook handles `user.deleted` → remove user — `clerk/user.deleted` event + `src/lib/inngest/functions/sync-user-deletion.ts`, deletes by Clerk id. **Verified end-to-end 2026-09-22**: deleted a test user from the Clerk Dashboard, confirmed the corresponding row was removed from Neon's `users` table
- [ ] Lazy-create fallback: first authed request upserts user if missing
- **DoD:** Sign in with Google AND Apple on each platform that supports it; a `users` row appears in Neon via webhook; sign-out works. Google + webhook sync **verified working** (Android, 2026-09-22). Apple sign-in and sign-out still unverified.

## Phase 2 — Schema & Data Layer

- [x] Drizzle config (`drizzle.config.ts`) pointed at Neon (loads `DATABASE_URL` via `dotenv`, since `drizzle-kit` runs outside Expo/Metro's own env loading)
- [x] Neon serverless client — at `src/lib/db/client.ts` (plan said `src/db/index.ts`; kept it under `src/lib/` to match `src/lib/env.ts` and `src/lib/inngest/`), `drizzle-orm/neon-http` + `@neondatabase/serverless`
- [x] `users` table (Clerk userId PK, email, name, imageUrl, timestamps) — `src/lib/db/schema.ts`
- [x] `trips` table (userId FK, destination, startDate, numDays, numTravelers, budgetTier enum, pace enum, interests jsonb, status enum, coverImageUrl, itinerary jsonb, budgetBreakdown jsonb, hotelSuggestions jsonb, errorMessage, timestamps) — `src/lib/db/schema.ts`, live on Neon (2026-09-23)
- [ ] `chat_messages` table (tripId FK cascade, role, content, createdAt) — Phase 5, not needed yet
- [x] `generation_usage` table/counter (per user per day) for safety cap — `src/lib/db/schema.ts`, composite PK `(userId, day)`, live on Neon
- [x] Zod schemas / TS types for `itinerary` and `budgetBreakdown` jsonb shapes (`src/lib/itinerary.ts`) — also covers `hotelSuggestions` and the full `tripGenerationSchema` Gemini's response is validated against
- [x] Generate + run migrations against Neon (`db:push`) — run 2026-09-22 (`users`) and 2026-09-23 (`trips`, `generation_usage`); confirmed via `information_schema` each time
- [x] Typed DB helpers, all scoped by authenticated `userId` — `src/lib/usage.ts` (`tryConsumeGeneration`, `refundGeneration`); every trips API route filters by `userId`, not just `id`
- **DoD:** Migrations applied on Neon; helper can create/read a trip scoped to a user. **Met** — all three tables live, exercised by the Phase 3 pipeline below (code-complete, not yet run end-to-end — see Phase 3 DoD).

## Phase 3 — Generation Pipeline

- [x] Generate-trip form screen: destination, travel start date, # days, # travelers, budget tier (Budget/Comfort/Luxury), interests/style tags, plus travel pace (not in the original spec, added since the design included it) — `src/app/generate-trip.tsx`
- [x] Client-side validation of the form (button gated on destination; server re-validates via Zod in `POST /api/trips`)
- [x] `POST /api/trips+api.ts`: auth (`requireUserId`, `@clerk/backend`'s `verifyToken`) → safety-cap check (`tryConsumeGeneration`) → create `trip` (status `pending`) → trigger Inngest event (`trip/generate`)
- [x] Inngest client (`src/lib/inngest/client.ts`) + endpoint route (`src/app/api/inngest+api.ts`, `serve()` from `inngest/edge`) — `generateTrip` now registered alongside the three user-sync functions
- [x] Inngest `generate-trip` function (`src/lib/inngest/functions/generate-trip.ts`):
  - [x] Set status `generating`
  - [x] Call **Gemini** with a structured itinerary prompt (`src/lib/gemini.ts`) — model id `gemini-3.6-flash`. First shipped as `gemini-2.0-flash` (matched the installed `@google/genai` package's own bundled JSDoc examples) but that turned out stale too — a real run against the live API 404'd and named `gemini-3.6-flash` as the replacement directly, which is what's actually in the code now
  - [x] Validate AI output against Zod schema (`tripGenerationSchema.parse`, inside `generateItinerary` itself)
  - [x] Fetch destination cover image (Unsplash search) → upload/optimize via ImageKit (`src/lib/images.ts`, now using `@imagekit/nodejs` — the `imagekit` package the plan originally named is deprecated upstream in favor of this)
  - [x] Persist itinerary + budgetBreakdown + hotelSuggestions + coverImageUrl → status `ready`
  - [x] Retries on failure (`retries: 3`); terminal failure → status `failed` + errorMessage, quota refunded via `onFailure`
- [x] Silent safety cap (20 generations/user/day) enforced in `POST /api/trips` (`src/lib/usage.ts`)
- [x] Loading screen polls `GET /api/trips/[id]/status+api.ts` (`src/app/trip-loading.tsx`)
- [x] On `ready` → navigate to trip detail; on `failed` → error + "Try again" — trip detail screen (`src/app/trip/[id].tsx`) is intentionally minimal/functional only (destination, dates, budget breakdown, hotel suggestions, day-by-day itinerary as plain text/cards) — the polished Phase 4 UI (map, styled hotel cards, budget chart) from `design/trip-detail-screen-design1.png` is separate follow-up work, not done here
- [x] "Try again" retries the *same* trip in place, not a blank form — `POST /api/trips/[id]/retry+api.ts` re-fires generation using the destination/dates/etc. already stored on the row (a real gap found and fixed 2026-09-24, after seeing Gemini's `503` "high demand" error hit twice in production-realistic testing: the original "Try again" sent the user back to an empty form, which is bad UX for a transient failure that had nothing to do with their input)
- [x] Gemini call has a request timeout (`httpOptions.timeout: 60_000` in `src/lib/gemini.ts`) — found and fixed 2026-09-24 after a real run hung 9+ minutes in `generating` with the Inngest dev server confirmed still running: a genuine network hang (connection accepted, no response ever sent) is different from a fast `503` rejection and was never throwing, so nothing triggered retry/failure. The already-stuck row from that incident was cleaned up manually (marked `failed`, quota refunded) since the fix only prevents it going forward.
- [x] Activity `category` validation falls back to `"other"` instead of failing the whole generation (`activityCategorySchema.catch("other")` in `src/lib/itinerary.ts`) — found 2026-09-24 via a real `ZodError` (Gemini returned a category outside the 8-value enum); verified the `.catch()` fallback actually works against this installed Zod version before trusting it.
- [x] Model switched `gemini-2.0-flash` → `gemini-3.6-flash` → **`gemini-3.5-flash-lite`** (`src/lib/gemini.ts`) — `gemini-3.6-flash` hit its free-tier daily quota for real (confirmed 429: `limit: 20, model: gemini-3.6-flash`) after a day of heavy testing/retries, then also started 503'ing. Since the quota metric name includes the model, quota is tracked **per model** — confirmed by listing all available models via `client.models.list()` and testing real candidates live: `gemini-3.8-flash` (newest) was 503-overloaded, `gemini-2.5-flash`/`gemini-2.5-flash-lite` are fully retired for new users, `gemini-3.5-flash-lite` succeeded with fresh quota. Caveat: it's a "lite" model, likely somewhat less capable — watch itinerary quality on the next real run.
- [x] **AI providers: OpenAI primary, Gemini fallback** (2026-09-25). `src/lib/llm.ts` → `generateValidatedJson()` tries OpenAI (`src/lib/openai.ts`, model `gpt-5.4-mini`, JSON mode, 60s timeout, 1 SDK retry) and, if it fails for any reason (network, rate limit, outage, or output failing the Zod schema), sends the same prompt to Gemini (`src/lib/gemini.ts`). Both must fail before the caller sees an error, and the user-facing message is plain ("The AI service is temporarily unavailable…") with the real causes in the server log. Used by itinerary generation (`src/lib/tripGeneration.ts`, previously in `gemini.ts`) and popular destinations (`src/lib/popularDestinations.ts`, whose last resort after both providers is the hardcoded city list). Model id chosen from `client.models.list()` on the actual key and confirmed live (JSON mode + temperature). Verified with a real run: OpenAI returned a schema-valid 2-day itinerary in ~7s; with a deliberately bad key the code fell back to Gemini (which was itself 503 at that moment, so a successful Gemini fallback response has not been observed yet). Needs `OPENAI_API_KEY` in `.env` (documented in `.env.example`); either key may be absent and the other still works. The Inngest step is now `generate-itinerary` (was `call-gemini`).
- [x] At most one generation in flight per user — `POST /api/trips+api.ts` checks for an existing `pending`/`generating` trip before creating a new one; if found, returns that trip's id (`reused: true`) instead of starting a second, and the client shows an explicit "already generating" message rather than silently redirecting to a different trip than the one just submitted. Enforced server-side (not just disabling the button client-side), since the client can't be trusted alone. Deliberately *prevents* duplicates rather than cancelling an in-progress one on navigate-away — cancelling was considered and rejected: "leaving the loading screen" isn't reliably the same as "abandoning the trip" (backgrounding the app, a tab switch, etc. would falsely trigger it), so it risked killing generations the user still wanted.
- [x] Unsplash cover search falls back "City, Country" → city alone → country alone (`src/lib/images.ts`) — found and fixed 2026-09-24 after a real trip (Makurdi, Nigeria) came back `ready` with no cover image. Confirmed directly against the live Unsplash API: `"Makurdi, Nigeria"` → 0 results, `"Nigeria"` alone → 2590 — the combined query was too narrow for a sparsely-tagged smaller city, not a lack of any coverage at all. The one already-affected trip was backfilled manually with the same fallback logic.
- [x] Run against **local Inngest dev server** (no EAS Hosting in v1) — `expo start` (all platforms) + `npx inngest-cli dev`. Exercised for real on 2026-09-23 across three runs: (1) stale model id → `failed`, fixed same day; (2) real Gemini `503 UNAVAILABLE` (Google's servers temporarily overloaded, not our bug) → correctly retried, then `failed` with a clean error message and refunded quota; (3) **succeeded** — a real trip (Lagos, Nigeria, 4 days) reached `ready` with a 4-day itinerary, a budget breakdown that sums correctly (100+60+40+25+15=240=total), and a real ImageKit cover image URL, all confirmed directly in Neon (not just the on-screen result). Android only so far.
- **DoD:** Submitting the form generates a real trip end-to-end locally on Android, iOS, and Web; status flips pending→generating→ready; forced failure shows graceful error. **Met on Android** (verified in Neon, not just the UI); iOS/Web not yet tried (iOS blocked entirely — no Mac, per the project's standing constraint).

## Phase 4 — Trip Detail & Management

- [x] Trips tab: real list of the user's `ready` trips + empty state — `(home)/trips.tsx`, matches `design/trips-screen-ui-design.png`. Built 2026-09-24, originally as a fix for a real gap found while testing: there was no way back to an already-generated trip once you navigated away (only reachable right after generation finished), which surfaced while debugging a dropped-ngrok-tunnel sync issue.
- [x] `GET /api/trips+api.ts` (list, `ready` trips only, scoped by `userId`) and `GET /api/trips/[id]+api.ts` (detail) — both live
- [x] Trip detail: cover image (ImageKit) + credit line, day-by-day itinerary — `trip/[id].tsx`, matches `design/trip-detail-screen-design1.png`. Built 2026-09-24; not yet run through the screenshot-comparison loop against the design (interrupted by Gemini quota/ngrok issues that day) — still needs a visual pass.
- [x] Places per day (attractions/restaurants) with descriptions — expandable day cards on the detail screen
- [x] Hotel suggestions section — plain card list (not styled to a specific design reference, none provided for this section specifically)
- [x] Budget breakdown section — also surfaced as the 3 stat circles (duration/travelers/budget) at the top of the detail screen, matching the design
- [~] Map with place pins (LLM lat/lng) — **native only** (Android/iOS via MapLibre + OpenFreeMap, not `react-native-maps`/Google Maps — see "Deferred until the native Android dev build succeeds" for why); Web keeps a placeholder. Code-complete (`src/components/TripMap.native.tsx` / `.web.tsx`), not yet verified on-device — needs a rebuild.
- [x] Delete trip — `DELETE /api/trips/[id]+api.ts` (scoped to the owner; returns `remainingTrips` so the app goes to Home if it was the last one) behind a trash icon + native confirm dialog on the detail screen. Chat cleanup isn't relevant yet (chat history isn't persisted).
- [x] Change trip cover photo — camera icon on the detail screen → gallery (`expo-image-picker`) → `PATCH /api/trips/[id]/cover+api.ts` → ImageKit with a delivery transform (`w-1600,q-75`); clears the Unsplash credit.
- [x] **Assistant tab** (general travel chat, not tied to a trip) — UI from `design/assistant-screen-ui-design.png` (`src/app/chat.tsx`, colors sampled from the design) + `POST /api/assistant+api.ts` (auth required, Zod-validated, max 20 turns / 2000 chars each, plain text replies via `streamChatReply` — OpenAI primary, Gemini fallback, separate Gemini model for quota). Verified on device: replies come back in ~6s. **Streaming (2026-09-25):** replies now stream in piece by piece — the route returns a plain-text stream (`streamChatReply` in `src/lib/llm.ts`; the Gemini fallback only applies if OpenAI fails *before* its first text, since a reply can't switch models mid-sentence), the app reads it with `expo/fetch` (the global fetch can't read streams and `expo/fetch` needs an absolute URL, built from `location.origin`). Chat runs OpenAI with `reasoning_effort: "none"` (~0.9s to first text vs 1.8-7s). If the app disconnects the AI stream is cancelled. **History is saved (2026-09-25):** new `assistant_messages` table (per user, cascade on user delete). `GET /api/assistant` loads it when the screen opens, `POST` takes only the new message and builds the model context from the user's own last 20 saved messages (the client can't inject a fake history), and saves the question + answer together only once the answer has fully arrived (failed/interrupted/abandoned replies save nothing). The trash button asks for confirmation, then `DELETE /api/assistant` removes all of the user's messages; the screen only clears after the delete succeeds, and the button is disabled while a reply is being written. **Server-side race guard** (from a CodeRabbit review): the app-side check only covers one device, so `users.assistant_cleared_at` records when the user last cleared, and saving an exchange (`saveExchange`) refuses to insert if the question was asked before that moment. The clear and the save both run under the same per-user Postgres advisory lock in a single `db.batch` transaction, so they can't interleave — a reply still streaming when the conversation is cleared (even from another device) can't bring the messages back. Verified with a temporary test account: clear mid-reply → 0 messages, and still 0 after that reply finishes. **Stop button (2026-09-26):** while a reply is being written the send button becomes a stop button (white square). Stopping aborts the request (the dev server cancels the stream, which stops the AI), keeps exactly the words that were on screen, and drops the empty bubble if nothing had appeared; it isn't reported to Sentry as an error (just an info log). Server side, a stopped reply saves what was written so far (like ChatGPT) unless nothing was written or the conversation was cleared meanwhile (same lock/guard as above); the stream now only pulls text when the app asks (`highWaterMark: 0`) so text that never reached the app isn't counted. Verified with the temp account: stop part-way → question + partial answer saved; stop before any text → nothing saved; stop after a clear → nothing comes back. **Not verified on a device yet.** **Not done:** no per-user daily cap on chat messages yet (cost risk), no retention limit on old messages. Lessons from getting it working: (1) after `npm install`, Metro can keep a stale file index and fail to bundle API routes (`ws/index.js` "missing") until restarted with `npx expo start -c`; (2) hiding the native tab bar on a tab screen (`NativeTabs hidden`, whether toggled by the keyboard or by the route) breaks touches on Android — the send/stop buttons only responded while the keyboard was up, and the latest messages stayed under the keyboard — so that approach was dropped. **Current design (2026-09-26):** the chat is a full-screen page outside the tabs (`src/app/chat.tsx`, no tab bar, keyboard opens by itself, back arrow closes it); the Assistant tab (`src/app/(home)/assistant.tsx`) is just a doorway that opens it. Closing the chat pops back onto the Assistant tab, so the chat sets `assistantNav.returning` (`src/lib/assistantNav.ts`) as it closes and the doorway then sends the user Home instead of reopening it. The tab layout is plain `NativeTabs` again. **Not verified on a device yet.**
- [x] Empty state for no trips — Trips tab shows a message pointing back to Home
- **DoD:** A generated trip renders fully (itinerary/places/hotels/budget/cover) on all three platforms, plus the map on Android/iOS; delete removes it everywhere. **Partially met** — renders fully on Android (not yet pixel-compared to the design); iOS untestable (no Mac); Web untested; map is a placeholder; delete not built.

## Phase 5 — AI Chat Refine

- [x] Chat UI on trip detail (message list + input) — `src/components/RefineTripSheet.tsx`, a bottom sheet opened from the sparkle button on `trip/[id].tsx` (UI from `design/refine-ai-ui-design.png`: drag handle, sparkle avatar header, greeting bubble, tappable suggestion chips shown until the first message, pill input + round send button). Not a full-screen page like the general Assistant tab — deliberately a sheet over the trip so the itinerary stays visible/contextual underneath.
- [x] `POST /api/trips/[id]/chat+api.ts`: synchronous LLM call (`src/lib/tripRefine.ts` → `generateValidatedJson` — OpenAI primary, Gemini fallback, own Gemini model `GEMINI_REFINE_MODEL` for independent quota) — returns the trip's **full itinerary + budget breakdown** back (changed or not) rather than a diff/patch, validated with the same `itineraryDaySchema`/`budgetBreakdownSchema` Zod shapes trip generation already uses (`chatRefineSchema` in `src/lib/itinerary.ts`). A request that's just a question (not an edit) gets a reply with the itinerary/budget unchanged.
- [x] Apply edits to `itinerary`/`budgetBreakdown` jsonb in place — done in the route, scoped by `id` + authenticated `userId`; returns the new state so the client applies it immediately via `onTripUpdated` instead of refetching.
- [x] Persist user + assistant `chat_messages` — new table added to `src/lib/db/schema.ts` (tripId FK cascade, role, content, createdAt), pushed live to Neon and confirmed via `information_schema` (2026-09-29). Saved together only once the model's reply has arrived, same "no half-finished turn" pattern as `assistant_messages`.
- [x] Load chat history on open; context carries across sessions — `GET /api/trips/[id]/chat+api.ts`, loaded once when the sheet first opens (not on every open/close); the last 20 turns are sent back to the model as context on each new message.
- [x] Detail screen reflects updated itinerary after an edit — `trip/[id].tsx` holds the trip in state and `RefineTripSheet`'s `onTripUpdated` callback patches it directly.
- **DoD:** "Make it more relaxed" / "we're vegetarian" mutates the stored itinerary in place; history persists across reopen. (This replaces a full "regenerate from scratch" button — chat is the only edit path in v1.) **Not yet verified on-device** — `tsc`/lint clean and the `chat_messages` table is confirmed live on Neon, but no real chat round-trip has been run yet (per `AGENTS.md`, the app isn't started from here — needs a check in the running instance).

## Phase 6 — Hardening & Observability

- [ ] Empty / error / slow-network states across screens
- [ ] Sentry coverage on client + all API routes
- [ ] Safety-cap soft-error behavior verified
- [ ] Profile photo upload/optimization via ImageKit (avatar)
- [ ] Loading/skeleton states polished
- [ ] Final end-to-end verification pass on Android, iOS, and Web
- **DoD:** All verification steps below pass on all three platforms; no unhandled errors; Sentry clean.
- _(EAS Hosting deploy + staging deferred to a post-v1 phase.)_

---

## Deferred / Out of Scope (v1)

- Email/password auth · Payments / paywall / user-facing quota
- Google Places (real venue data/photos) · Push notifications
- Full "regenerate from scratch" (superseded by chat-based editing in Phase 5)
- Favorites/bookmarks · Sharing/social · EAS Hosting deploy

---

## Open Risks (watch these)

- **R1** Inngest runs on local dev server in v1 (no EAS Hosting yet); validate hosting/timeouts only when we deploy.
- **R2** LLM-only place data (no Google Places) → hallucination risk for hotels/attractions (v2 fix).
- **R3** Maps only render on Android/iOS; Web trip-detail view has no map — confirm that gap is acceptable for v1.
- **R4** Android map support needs a **Google Maps API key** (billing-enabled Google Cloud project) — a new external dependency/setup step beyond what iOS needs (Apple Maps is free/keyless).
- **R5** DB polling during loading is chatty; tune interval/backoff if generation is slow.
- **R6** LLM structured-output JSON may violate schema → Zod validation in `src/lib/llm.ts` (a schema failure on OpenAI triggers the Gemini fallback), then Inngest retry/`failed` path.
- **R7** Unsplash attribution/ToS for storing+serving photos via ImageKit must be checked.
- **R8** Soft cap only (20/day) — an abuser within that limit still costs money; rely on Sentry alerts.
- **R9** Apple Sign-In behaves differently per platform (native on iOS, hosted-browser on Web, no native Android equivalent) — needs explicit testing on each platform, not just "it's configured."

## Key Assumptions

- **A1** Map pins use LLM-provided lat/lng (approximate, unverified).
- **A2** Stock covers from Unsplash, one per trip, keyed by destination.
- **A3** Safety cap = 20 generations/user/day, no UI surfaced.
- **A4** Budget tiers = Low / Medium / Luxury; breakdown is AI-estimated.
- **A5** Visual design provided later by user; v1 builds functional screens first.
- **A6** Local dev only for v1 (Expo API routes + Inngest dev server); no prod deploy.
- **A7** Chat edits mutate `itinerary` jsonb in place; no versioning beyond the chat transcript.
- **A8** ~~Exact Gemini model id/structured-output approach not yet pinned~~ Resolved: model ids are pinned in `src/lib/openai.ts` (`gpt-5.4-mini`) and `src/lib/gemini.ts`; both use JSON mode + Zod validation. Model ids go stale — re-check with each SDK's `models.list()` if calls start 404ing.
- **A9** Web trip-detail view simply omits the map section rather than substituting a different map library — revisit if that's not acceptable.

---

## Spec Summary

**Product:** AI travel-itinerary generator. User inputs constraints → AI produces a structured
multi-day plan → user refines via chat. Single role, consumer travelers, Android + iOS + Web.

**Stack:**

- **Auth:** Clerk (Google + Apple only), webhook syncs users → Neon
- **Backend:** Expo Router API routes (`+api.ts`), local dev + Inngest dev server (no EAS Hosting v1)
- **DB:** Neon Postgres + Drizzle ORM
- **AI:** OpenAI primary, Google Gemini automatic fallback (text generation + chat-based itinerary edits) — no Claude
- **Background jobs:** Inngest (durable generation + retries)
- **Images:** ImageKit (profile photos + per-trip cover images); covers sourced from Unsplash
- **Maps:** `react-native-maps` on Android (Google Maps, needs API key) and iOS (Apple Maps, free); omitted on Web
- **Monitoring:** Sentry

**Core journeys:**

1. First run → Clerk sign-in (Google/Apple) → webhook upserts user → home (empty).
2. Generate → form → `POST /trips` (status `pending`) + Inngest → loading polls status → `ready` → detail. Failure → retries → `failed` → "Try again" (quota untouched).
3. Refine → chat → synchronous LLM (OpenAI, Gemini fallback) targeted edits → trip updated in place + history persisted.
4. Manage → home lists trips → view → delete (cascade).

**Data model:**

- `users` (Clerk userId PK, email, name, imageUrl, timestamps)
- `trips` (userId FK, destination, startDate, numDays, numTravelers, budgetTier, interests, status, coverImageUrl, itinerary jsonb, budgetBreakdown jsonb, errorMessage, timestamps)
- `chat_messages` (tripId FK cascade, role, content, createdAt)
- `generation_usage` (per user/day counter for safety cap)

**Verification (final):**

- Sign in with Google + Apple on each platform that supports it → `users` row in Neon via webhook.
- Submit form → status `pending`→`generating`→`ready` → detail renders itinerary/budget/cover (and map on native).
- Force failure of both AI providers → retries → `failed` → "Try again", quota untouched. (One provider failing alone should fall back silently and still succeed.)
- Delete removes trip + chat.
- Chat edit ("make day 2 more relaxed") mutates itinerary in place; history persists.
- Exceed per-day cap → soft error; Sentry receives events.
- Runs on Android emulator, iOS simulator, and a web browser via `expo start` + local Inngest dev server.
