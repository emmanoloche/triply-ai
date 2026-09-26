import "../global.css";

import { ClerkProvider, useUser } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { isRunningInExpoGo } from "expo";
import { Stack } from "expo-router";
import * as Sentry from "@sentry/react-native";
import { useEffect } from "react";
import { Platform } from "react-native";

Sentry.init({
  dsn: process.env.EXPO_PUBLIC_SENTRY_DSN,
  // Keeps development/testing events out of production data and dashboards.
  environment: __DEV__ ? "development" : "production",
  // Tracing: every transaction while developing, a 20% sample in production
  // to keep event volume and quota under control. Raise it temporarily if
  // you need more data while chasing a specific problem.
  tracesSampleRate: __DEV__ ? 1.0 : 0.2,
  // Structured logs, sent via Sentry.logger.* at key points in the app.
  enableLogs: true,
  // Session Replay: record every session while developing (so it's easy to
  // test), a 10% sample in production. Sessions that hit an error are always
  // recorded. Text, images and inputs are masked by default.
  replaysSessionSampleRate: __DEV__ ? 1.0 : 0.1,
  replaysOnErrorSampleRate: 1.0,
  integrations: (integrations) => {
    integrations.push(
      Sentry.expoRouterIntegration({
        enableTimeToInitialDisplay: !isRunningInExpoGo(),
      }),
    );
    if (Platform.OS === "web") {
      integrations.push(Sentry.browserReplayIntegration());
    }
    // A no-op (with a warning) in Expo Go and on web, where it isn't supported.
    integrations.push(Sentry.mobileReplayIntegration());
    return integrations;
  },
  enableNativeFramesTracking: !isRunningInExpoGo(),
});

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY!;

if (!publishableKey) {
  throw new Error("Add EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to your .env file");
}

// Attaches the signed-in user's id (only the id, no email or name) to every
// event, log, trace and replay, so an issue can be tied back to an account.
// Cleared on sign-out so the next person on the device isn't misattributed.
function SentryUserSync() {
  const { isLoaded, user } = useUser();
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!isLoaded) return;
    Sentry.setUser(userId ? { id: userId } : null);
  }, [isLoaded, userId]);

  return null;
}

function RootLayout() {
  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <SentryUserSync />
      <Stack screenOptions={{ headerShown: false }} />
    </ClerkProvider>
  );
}

export default Sentry.wrap(RootLayout);
