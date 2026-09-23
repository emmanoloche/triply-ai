# Triply — Build Plan & Checklist

> AI trip planner (Android, iOS, Web — Expo SDK 57). This is the living checklist for v1.
> Check items off (`[x]`) as they're completed. Full spec lives at the bottom.
>
> Structure mirrors a tutorial's own build plan, adapted for two real differences: this app targets
> **Android + iOS + Web** (not iOS-only), and uses **Gemini** for all generation (not OpenAI — no
> paid OpenAI plan available).

---

## Legend

- `[ ]` not started · `[~]` in progress · `[x]` done
- Each phase has a **Definition of Done** so we know when to check the header.

---

## Deferred until the native Android dev build succeeds

`npm run android` / `expo run:android` has repeatedly stalled or been stopped due to limited/unstable mobile data (see feedback memory: limited mobile data). Everything below needs a real dev build (`expo-dev-client`), not Expo Go, and not the web target. None of it is blocking current work — Expo Go + web cover everything else. Revisit this list once a build actually completes.

- [ ] **Native Google/Apple sign-in** (`useSignInWithGoogle`, `useSignInWithApple` from `@clerk/expo`) — currently using `useSSO()` (browser-based) instead, which works everywhere including Expo Go and web. Native sign-in would be layered on top later, additive, not a replacement — `useSSO` still needed as the Web fallback either way. Needs: `expo-crypto` (Google), `expo-apple-authentication` (Apple, iOS only), Google Cloud OAuth client IDs in `.env`, a rebuild.
- [ ] **Sentry native crash reporting** — the JS-side Sentry setup (`Sentry.init`, error boundary, navigation tracking) is done and works in Expo Go/web. Native crash capture and native debug-symbol upload only activate in a real build.
- [ ] **`react-native-maps`** — not installed yet; when it is, it won't run in Expo Go at all (native module). Needed for the trip-detail map (Phase 4) and requires a Google Maps API key on Android.
- [ ] **A real installable app** — for sharing, testing on other phones, or eventually publishing. Expo Go is a dev-only wrapper.

Per `AGENTS.md`, this is a known, accepted limitation of the current setup, not a bug to fix: "This app cannot run in Expo Go (maps, Apple auth, Sentry native). Use a development build."

---

## Phase 0 — Foundations

- [ ] Read Expo v57 docs for API routes / server output (per `AGENTS.md`)
- [ ] Set `web.output: "server"` in `app.json` (enables API routes)
- [x] Install `expo-dev-client` (required regardless of the Clerk auth-flow choice, since `react-native-maps` and `expo-apple-authentication` already need a custom dev build — Expo Go alone won't run this app)
- [~] Install Expo-native deps: `@sentry/react-native`, `expo-secure-store`, `expo-web-browser`, `expo-auth-session` installed; `react-native-maps`, `expo-crypto`, `expo-apple-authentication` still pending (native-only — see "Deferred until the native Android dev build succeeds")
- [~] Install JS/server deps: `@clerk/expo`, `drizzle-orm`, `@neondatabase/serverless`, `inngest`, `svix`, `zod` installed; `@google/genai` (Gemini), `imagekit` still pending
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
- [ ] `trips` table (userId FK, destination, startDate, numDays, numTravelers, budgetTier enum, interests, status enum, coverImageUrl, itinerary jsonb, budgetBreakdown jsonb, errorMessage, timestamps)
- [ ] `chat_messages` table (tripId FK cascade, role, content, createdAt)
- [ ] `generation_usage` table/counter (per user per day) for safety cap
- [ ] Zod schemas / TS types for `itinerary` and `budgetBreakdown` jsonb shapes (`src/lib/itinerary.ts`)
- [x] Generate + run migrations against Neon (`db:push`) — `npm run db:push` run (2026-09-22); confirmed via `information_schema` that `users` exists on Neon with the expected columns
- [ ] Typed DB helpers, all scoped by authenticated `userId` (routes filter by `userId`; `src/lib/usage.ts`)
- **DoD:** Migrations applied on Neon; helper can create/read a trip scoped to a user. **Partially met** — `users` table is live on Neon; no `trips` table yet, and the insert helper only exists inline in the Inngest function, not as a general typed helper.

## Phase 3 — Generation Pipeline

- [ ] Generate-trip form screen: destination, travel start date, # days, # travelers, budget tier (Low/Med/Luxury), interests/style tags
- [ ] Client-side validation of the form (button gated on destination + start date; server re-validates via Zod)
- [ ] `POST /api/trips+api.ts`: auth → safety-cap check → create `trip` (status `pending`) → trigger Inngest event
- [~] Inngest client (`src/lib/inngest/client.ts`) + endpoint route (`src/app/api/inngest+api.ts`, `serve()` from `inngest/edge`) — infra built in Phase 1 for user sync, and reused here; only `syncUserCreation` is registered so far, the `generate-trip` function below still needs to be added to the same `functions: []` list
- [ ] Inngest `generate-trip` function:
  - [ ] Set status `generating`
  - [ ] Call **Gemini** with a structured itinerary schema (`src/lib/gemini.ts`) — confirm current model id + structured-output mechanism against docs at implementation time
  - [ ] Validate AI output against Zod schema (`tripGenerationSchema.parse`)
  - [ ] Fetch destination cover image (Unsplash) → upload/optimize via ImageKit (`src/lib/images.ts`)
  - [ ] Persist itinerary + budgetBreakdown + coverImageUrl → status `ready`
  - [ ] Retries on failure; terminal failure → status `failed` + errorMessage (quota refunded via `onFailure`)
- [ ] Silent safety cap (20 generations/user/day) enforced in `POST /api/trips` (`src/lib/usage.ts`)
- [ ] Loading screen polls `GET /api/trips/[id]/status+api.ts` (`src/app/trip-loading.tsx`)
- [ ] On `ready` → navigate to trip detail; on `failed` → error + "Try again"
- [ ] Run against **local Inngest dev server** (no EAS Hosting in v1) — `expo start` (all platforms) + `npx inngest-cli dev`
- **DoD:** Submitting the form generates a real trip end-to-end locally on Android, iOS, and Web; status flips pending→generating→ready; forced failure shows graceful error.

## Phase 4 — Trip Detail & Management

- [ ] Home screen: list of user's trips + "Generate trip" entry (functional; styling later)
- [ ] `GET /api/trips+api.ts` (list) and `GET /api/trips/[id]+api.ts` (detail)
- [ ] Trip detail: cover image (ImageKit), day-by-day itinerary
- [ ] Places per day (attractions/restaurants) with descriptions
- [ ] Hotel suggestions section
- [ ] Budget breakdown section
- [ ] Map with place pins (LLM lat/lng) — **native only** (Android/iOS via `react-native-maps`); hidden/omitted on Web
- [ ] Delete trip (`DELETE /api/trips/[id]+api.ts`) → cascade chat + cleanup
- [ ] Empty state for no trips
- **DoD:** A generated trip renders fully (itinerary/places/hotels/budget/cover) on all three platforms, plus the map on Android/iOS; delete removes it everywhere.

## Phase 5 — AI Chat Refine

- [ ] Chat UI on trip detail (message list + input)
- [ ] `POST /api/trips/[id]/chat+api.ts`: synchronous **Gemini** call returning **targeted edits**
- [ ] Apply edits to `itinerary` jsonb in place
- [ ] Persist user + assistant `chat_messages`
- [ ] Load chat history on open; context carries across sessions
- [ ] Detail screen reflects updated itinerary after an edit
- **DoD:** "Make day 2 more relaxed" mutates the stored itinerary in place; history persists across reopen. (This replaces a full "regenerate from scratch" button — chat is the only edit path in v1.)

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
- **R6** Gemini's structured-output JSON may violate schema → rely on Zod validation + Inngest retry/`failed` path.
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
- **A8** Exact Gemini model id/structured-output approach not yet pinned — confirm against current Gemini API docs at implementation time.
- **A9** Web trip-detail view simply omits the map section rather than substituting a different map library — revisit if that's not acceptable.

---

## Spec Summary

**Product:** AI travel-itinerary generator. User inputs constraints → AI produces a structured
multi-day plan → user refines via chat. Single role, consumer travelers, Android + iOS + Web.

**Stack:**

- **Auth:** Clerk (Google + Apple only), webhook syncs users → Neon
- **Backend:** Expo Router API routes (`+api.ts`), local dev + Inngest dev server (no EAS Hosting v1)
- **DB:** Neon Postgres + Drizzle ORM
- **AI:** Google Gemini (text generation + chat-based itinerary edits) — no OpenAI, no Claude
- **Background jobs:** Inngest (durable generation + retries)
- **Images:** ImageKit (profile photos + per-trip cover images); covers sourced from Unsplash
- **Maps:** `react-native-maps` on Android (Google Maps, needs API key) and iOS (Apple Maps, free); omitted on Web
- **Monitoring:** Sentry

**Core journeys:**

1. First run → Clerk sign-in (Google/Apple) → webhook upserts user → home (empty).
2. Generate → form → `POST /trips` (status `pending`) + Inngest → loading polls status → `ready` → detail. Failure → retries → `failed` → "Try again" (quota untouched).
3. Refine → chat → synchronous Gemini targeted edits → trip updated in place + history persisted.
4. Manage → home lists trips → view → delete (cascade).

**Data model:**

- `users` (Clerk userId PK, email, name, imageUrl, timestamps)
- `trips` (userId FK, destination, startDate, numDays, numTravelers, budgetTier, interests, status, coverImageUrl, itinerary jsonb, budgetBreakdown jsonb, errorMessage, timestamps)
- `chat_messages` (tripId FK cascade, role, content, createdAt)
- `generation_usage` (per user/day counter for safety cap)

**Verification (final):**

- Sign in with Google + Apple on each platform that supports it → `users` row in Neon via webhook.
- Submit form → status `pending`→`generating`→`ready` → detail renders itinerary/budget/cover (and map on native).
- Force Gemini failure → retries → `failed` → "Try again", quota untouched.
- Delete removes trip + chat.
- Chat edit ("make day 2 more relaxed") mutates itinerary in place; history persists.
- Exceed per-day cap → soft error; Sentry receives events.
- Runs on Android emulator, iOS simulator, and a web browser via `expo start` + local Inngest dev server.
