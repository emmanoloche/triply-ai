# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.
Your training data on Expo, Expo Router and React Native is out of date. When docs and memory disagree, the docs (and the installed package types in `node_modules`) win.

# Triply

AI trip planner for **Android, iOS and Web** (Expo SDK 57). The user enters trip constraints, AI generates a multi-day itinerary, and the user refines it through chat. `plan.md` is the living build checklist: check items off there as they are completed.

## Tech stack

| Concern | Choice |
| --- | --- |
| App | Expo SDK 57, React Native 0.86, React 19.2, TypeScript (strict), React Compiler enabled |
| Routing | Expo Router (file-based, `src/app`), typed routes on |
| Navigation | **Native tabs only** (see below) |
| Styling | NativeWind 4.2 with **Tailwind CSS 3.4** (not Tailwind 4 syntax) |
| Backend | Expo Router API routes (`+api.ts`) |
| Database | **PostgreSQL on Neon** (`@neondatabase/serverless`) |
| ORM | **Drizzle ORM** + `drizzle-kit` for migrations |
| Auth | **Clerk** (`@clerk/expo`), Google and Apple sign-in |
| Background jobs | **Inngest** (durable trip generation with retries) |
| Image optimization | **ImageKit** |
| Error tracking / monitoring | **Sentry** (`@sentry/react-native`) |
| AI | Google Gemini (`@google/genai`). Do not use OpenAI or Anthropic SDKs |
| Maps | `react-native-maps` (native only, omitted on Web) |

Do not add dependencies outside this list without asking.
Install Expo-managed packages with `npx expo install <pkg>` so versions stay compatible with SDK 57.

## Navigation: always native tabs

This project **always uses native tabs**. Never build a JavaScript tab bar and never use `Tabs` from `expo-router` or `@react-navigation/bottom-tabs` for the main tab navigation.

- Import from `expo-router/unstable-native-tabs`: `import { NativeTabs } from 'expo-router/unstable-native-tabs'`.
- Build the tab layout with `<NativeTabs>` and `<NativeTabs.Trigger name="...">`, using `Trigger.Label`, `Trigger.Icon` and `Trigger.Badge` for content.
- Icons: `sf` (SF Symbols) for iOS and `md` (Material) or `drawable` for Android. Icon props can take `{ default, selected }`.
- The API is `unstable`. Check the installed types in `node_modules/expo-router/build/native-tabs/` and the v57 docs before using an option from memory.
- Do not hand-roll a custom tab bar to work around a native-tabs limitation. Ask first.

## UI rules

- The visual source of truth is the images in `design/` (auth, home, trips, trip detail, generate trip, loading, refine/assistant, profile, design system). Match them; do not invent layouts or colors.
- Prefer native and Expo-provided primitives: `expo-image` (not RN `Image`), `expo-symbols`, `expo-glass-effect`, `@expo/ui`.
- Style with NativeWind `className`. The Tailwind config lives in `tailwind.config.js`, and global styles in `src/global.css`.
- Every screen must work on Android, iOS and Web. Gate platform-specific code with `Platform.OS` or `.native.tsx` / `.web.tsx` files. Maps are native only.

## Code conventions

- Path alias: `@/*` maps to `src/*`. Use it instead of deep relative imports.
- React Compiler is on: do not add `useMemo`, `useCallback` or `React.memo` by hand.
- Validate all API input and all Gemini output with Zod. Never trust LLM JSON.
- Every DB query is scoped by the authenticated Clerk `userId`.
- Env access goes through `src/lib/env.ts`. Secrets must never use the `EXPO_PUBLIC_` prefix. Never commit `.env`; keep `.env.example` current.
- Report errors to Sentry on the client and in API routes. Inngest failures end in trip status `failed` with an `errorMessage`.

## Never run the app yourself

**Never start, launch or run the application.** The user already has it running in a separate terminal. This includes `npm run start`, `npm run web`, `npm run android`, `npm run ios`, `expo start`, `expo run:*`, `npx inngest-cli dev`, and any other dev server, emulator, simulator or browser launch. Starting a second instance causes port conflicts and duplicate Metro/Inngest processes.

- To check your work, use static checks only: `npm run lint` and `npx tsc --noEmit`.
- If a change needs to be seen running (UI, native module, config plugin, `app.json` change that needs a rebuild), say so and ask the user to check it in their running instance. Do not launch it to verify.
- Do not use the `run` skill in this project.

## Commands

The commands below are for the user's reference. Do not run the ones that start the app (see above).

- `npm run start`: dev server. `npm run web`: web. `npm run android` / `npm run ios`: dev builds.
- This app **cannot run in Expo Go** (maps, Apple auth, Sentry native). Use a development build (`expo-dev-client`).
- `npx inngest-cli dev`: local Inngest dev server (needed for trip generation).
- `npm run lint` and `npx tsc --noEmit` must pass before work is called done.
- Development is on Windows: iOS builds are not possible locally.

## Skills

Clerk skills are in `.claude/skills` (`clerk`, `clerk-expo`, `clerk-setup`, `clerk-webhooks`). Use them for any auth or webhook work.
