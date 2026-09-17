# Triply — Build Plan & Checklist

> AI trip planner (Android, iOS, Web — Expo SDK 57). This is the living checklist for v1.
> Check items off (`[x]`) as they're completed. Full spec lives at the bottom.
>
> Structure mirrors a tutorial's own build plan, adapted for two real differences: this app targets
> **Android + iOS + Web** (not iOS-only), and uses **Gemini** for all generation (not OpenAI — no
> paid OpenAI plan available). Everything below is unchecked: nothing has been implemented in this
> repo yet (see `git status` — only `plan.md` itself is new).

---

## Legend

- `[ ]` not started · `[~]` in progress · `[x]` done
- Each phase has a **Definition of Done** so we know when to check the header.

---

## Phase 0 — Foundations

- [ ] Read Expo v57 docs for API routes / server output (per `AGENTS.md`)
- [ ] Set `web.output: "server"` in `app.json` (enables API routes)
- [ ] Install Expo-native deps: `@sentry/react-native`, `react-native-maps`, `expo-secure-store`, `expo-web-browser`, `expo-auth-session`, `expo-crypto`, `expo-apple-authentication`
- [ ] Install JS/server deps: `@clerk/expo`, `drizzle-orm`, `@neondatabase/serverless`, `inngest`, `svix`, `@google/genai` (Gemini), `imagekit`, `zod`
- [ ] Install dev deps: `drizzle-kit`, `dotenv`
- [ ] Create `.env` + `.env.example` with all keys (Clerk, Neon, Gemini, ImageKit, Unsplash, Sentry, Inngest, Google Maps)
- [ ] Add Clerk + relevant config plugins to `app.json` (`@clerk/expo`, `expo-secure-store`, `expo-web-browser`, Sentry, `react-native-maps`)
- [ ] Initialize Sentry (client in `_layout.tsx`; API route coverage once routes exist)
- [ ] Set up `src/lib/env.ts` for typed env access
- **DoD:** App boots on Android, iOS, and Web; server API route returns 200 on all three; Sentry receives a test event.

## Phase 1 — Auth & User Sync

- [ ] `ClerkProvider` + `tokenCache` wired into `src/app/_layout.tsx`
- [ ] Route protection: redirect signed-out → auth, signed-in → app (`(auth)/_layout.tsx` + `(home)/_layout.tsx`)
- [ ] Single auth screen (`(auth)/sign-in.tsx`) — **Google** + **Apple** both on one page via `useSSO` (`hooks/useSSOAuth.ts`)
  - [ ] **Google** (`oauth_google`) — Android, iOS, Web
  - [ ] **Apple** (`oauth_apple`) — iOS and Web (Apple's web OAuth flow); confirm Android behavior (Apple doesn't offer a native Android sign-in — falls back to Clerk's hosted browser flow there)
- [ ] Configure redirect URI / scheme (`triply`) for native SSO (`AuthSession.makeRedirectUri()`)
- [ ] Sign-out action (`(home)/index.tsx` via `useClerk().signOut`)
- [ ] Clerk webhook API route (`/api/webhooks/clerk+api.ts`) verifying with `svix`
- [ ] Webhook upserts `user.created` / `user.updated` → Neon `users`
- [ ] Webhook handles `user.deleted` → remove/soft-delete user
- [ ] Lazy-create fallback: first authed request upserts user if missing
- **DoD:** Sign in with Google AND Apple on each platform that supports it; a `users` row appears in Neon via webhook; sign-out works.

## Phase 2 — Schema & Data Layer

- [ ] Drizzle config (`drizzle.config.ts`) pointed at Neon
- [ ] Neon serverless client (`src/db/index.ts`)
- [ ] `users` table (Clerk userId PK, email, name, imageUrl, timestamps)
- [ ] `trips` table (userId FK, destination, startDate, numDays, numTravelers, budgetTier enum, interests, status enum, coverImageUrl, itinerary jsonb, budgetBreakdown jsonb, errorMessage, timestamps)
- [ ] `chat_messages` table (tripId FK cascade, role, content, createdAt)
- [ ] `generation_usage` table/counter (per user per day) for safety cap
- [ ] Zod schemas / TS types for `itinerary` and `budgetBreakdown` jsonb shapes (`src/lib/itinerary.ts`)
- [ ] Generate + run migrations against Neon (`db:push`)
- [ ] Typed DB helpers, all scoped by authenticated `userId` (routes filter by `userId`; `src/lib/usage.ts`)
- **DoD:** Migrations applied on Neon; helper can create/read a trip scoped to a user.

## Phase 3 — Generation Pipeline

- [ ] Generate-trip form screen: destination, travel start date, # days, # travelers, budget tier (Low/Med/Luxury), interests/style tags
- [ ] Client-side validation of the form (button gated on destination + start date; server re-validates via Zod)
- [ ] `POST /api/trips+api.ts`: auth → safety-cap check → create `trip` (status `pending`) → trigger Inngest event
- [ ] Inngest client (`src/inngest/client.ts`) + endpoint route (`/api/inngest+api.ts`, `serve()` from `inngest/edge`)
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
