import { useAuth } from "@clerk/expo";
import * as Sentry from "@sentry/react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { Fragment, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import { titleCase } from "@/lib/text";

// UI from design/trip-loading-screen-design.png. The illustration is
// design/trip-loading-screen-demo.png (copied to assets/images).

const MAP_ILLUSTRATION = require("../../assets/images/trip-loading-map.png");

const BLUE = "#076FFA";
const POLL_INTERVAL_MS = 2000;

type TripStatus = "pending" | "generating" | "ready" | "failed";
type TripMeta = { destination: string; numDays: number };

// The backend only reports coarse status (pending/generating/ready/failed),
// not granular sub-steps — this 3-stage progression is simulated purely for
// perceived progress, same pattern most AI-generation loading screens use.
// It's capped at the last step, not tied to a timeout, so a genuinely slow
// generation just parks on "Finalizing" until the real `ready`/`failed`
// status arrives from polling.
const STEPS = [
  {
    label: "Discovering places",
    icon: { ios: "magnifyingglass" as const, android: "search" as const, web: "search" as const },
    emoji: "🔍",
    messages: ["Scouting the best neighborhoods…", "Finding top-rated spots…", "Checking local favorites…"],
  },
  {
    label: "Organizing itinerary",
    icon: { ios: "map" as const, android: "map" as const, web: "map" as const },
    emoji: "🗺️",
    messages: ["Mapping out each day…", "Balancing your schedule…", "Sequencing your activities…"],
  },
  {
    label: "Finalizing recommendations",
    icon: { ios: "sparkles" as const, android: "auto_awesome" as const, web: "auto_awesome" as const },
    emoji: "✨",
    messages: ["Adding final touches…", "Polishing your itinerary…", "Almost ready…"],
  },
];

const STEP_SECONDS = 15;
const MESSAGE_SECONDS = 4;

function StepDot({
  step,
  status,
}: {
  step: (typeof STEPS)[number];
  status: "done" | "active" | "upcoming";
}) {
  const filled = status !== "upcoming";
  return (
    <View style={{ width: 104, alignItems: "center" }}>
      <View
        className="h-[62px] w-[62px] items-center justify-center rounded-full"
        style={{ backgroundColor: filled ? BLUE : "#F1F3F5" }}
      >
        {status === "done" ? (
          <SymbolView
            name={{ ios: "checkmark", android: "check", web: "check" }}
            size={24}
            tintColor="#FFFFFF"
            fallback={<Text style={{ fontSize: 20, color: "#FFFFFF" }}>✓</Text>}
          />
        ) : (
          <SymbolView
            name={step.icon}
            size={24}
            tintColor={filled ? "#FFFFFF" : "#9CA3AF"}
            fallback={<Text style={{ fontSize: 20 }}>{step.emoji}</Text>}
          />
        )}
      </View>
      <Text
        className="mt-2 text-center text-[12px]"
        style={{ color: status === "upcoming" ? "#9CA3AF" : "#0A0A0A", fontWeight: status === "active" ? "700" : "500" }}
      >
        {step.label}
      </Text>
    </View>
  );
}

export default function TripLoading() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getToken } = useAuth();

  const [status, setStatus] = useState<TripStatus>("pending");
  const [meta, setMeta] = useState<TripMeta | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // Bumping this restarts the polling effect below — used by "Try again" so
  // the same screen resumes polling in place instead of navigating away.
  const [pollGeneration, setPollGeneration] = useState(0);
  const pollingRef = useRef(true);

  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    pollingRef.current = true;

    const poll = async () => {
      while (pollingRef.current) {
        try {
          const token = await getToken();
          const res = await fetch(`/api/trips/${id}/status`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });

          if (res.ok) {
            const data = (await res.json()) as {
              status: TripStatus;
              errorMessage: string | null;
              destination: string;
              numDays: number;
            };
            if (!pollingRef.current) return;

            setStatus(data.status);
            setMeta({ destination: data.destination, numDays: data.numDays });

            if (data.status === "ready") {
              router.replace({ pathname: "/trip/[id]", params: { id } });
              return;
            }
            if (data.status === "failed") {
              setErrorMessage(data.errorMessage ?? "Something went wrong generating your trip.");
              return;
            }
          }
        } catch (err) {
          Sentry.captureException(err);
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
    };

    poll();

    return () => {
      pollingRef.current = false;
    };
  }, [id, router, getToken, pollGeneration]);

  const handleRetry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/trips/${id}/retry`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      // Same trip, same data — just resume polling in place.
      setErrorMessage(null);
      setStatus("pending");
      setElapsed(0);
      setPollGeneration((g) => g + 1);
    } catch (err) {
      Sentry.captureException(err);
      Alert.alert("Couldn't retry", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setRetrying(false);
    }
  };

  if (status === "failed") {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <Text className="text-center text-[18px] font-bold text-[#0A0A0A]">Trip generation failed</Text>
        <Text className="mt-2 text-center text-[14px] text-[#6B7280]">{errorMessage}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try again"
          disabled={retrying}
          onPress={handleRetry}
          className="mt-6 h-12 items-center justify-center rounded-full px-8 active:opacity-90"
          style={{ backgroundColor: BLUE, opacity: retrying ? 0.6 : 1 }}
        >
          {retrying ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text className="text-[15px] font-semibold text-white">Try again</Text>
          )}
        </Pressable>
      </View>
    );
  }

  const stepIndex = Math.min(Math.floor(elapsed / STEP_SECONDS), STEPS.length - 1);
  const currentStep = STEPS[stepIndex];
  const messageIndex = Math.floor((elapsed % STEP_SECONDS) / MESSAGE_SECONDS) % currentStep.messages.length;
  const message = currentStep.messages[messageIndex];

  const subtitle = meta
    ? `${meta.numDays} ${meta.numDays === 1 ? "day" : "days"} in ${titleCase(meta.destination)}`
    : " ";

  return (
    <View className="flex-1 items-center justify-center bg-white px-5">
      <Image source={MAP_ILLUSTRATION} contentFit="contain" style={{ width: 260, height: 200 }} />

      <Text className="mt-8 text-center text-[26px] font-bold text-[#0A0A0A]">Planning your trip</Text>
      <Text className="mt-2 text-center text-[16px] text-[#9CA3AF]">{subtitle}</Text>

      <View className="mt-9 flex-row items-start">
        {STEPS.map((step, i) => (
          <Fragment key={step.label}>
            {i > 0 && <View style={{ width: 14, height: 2, backgroundColor: "#E5E7EB", marginTop: 30 }} />}
            <StepDot step={step} status={i < stepIndex ? "done" : i === stepIndex ? "active" : "upcoming"} />
          </Fragment>
        ))}
      </View>

      <Text className="mt-8 text-center text-[15px] font-medium" style={{ color: BLUE }}>
        {message}
      </Text>
    </View>
  );
}
