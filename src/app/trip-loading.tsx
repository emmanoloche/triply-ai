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
// Each step stays on screen at least this long, so a fast stage doesn't
// flash past unreadably and the progress always moves one step at a time.
const MIN_STEP_MS = 1500;
// Beat between "all steps done" and opening the trip.
const COMPLETE_HOLD_MS = 700;
const MESSAGE_SECONDS = 4;

type TripStatus = "pending" | "generating" | "ready" | "failed";
// Real progress of an in-flight generation, reported by
// api/trips/[id]/status+api.ts.
type TripStage = "queued" | "itinerary" | "cover";
type TripMeta = { destination: string; numDays: number };

// The three visible steps follow what the server is actually doing:
//   1. Discovering places       — waiting to start / the AI is writing the itinerary
//   2. Organizing itinerary     — itinerary saved, the cover photo is being fetched
//   3. Finalizing recommendations — everything is done, the trip is being opened
// The messages under each step are cosmetic and just rotate on a timer.
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

const LAST_STEP = STEPS.length - 1;

/** Which step the server's real stage corresponds to. */
function stepForStage(stage: TripStage): number {
  return stage === "cover" ? 1 : 0;
}

/** Shows one visual stage of the generation progress. */
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

/**
 * Rotating status line under the steps. Keyed by step at the call site, so it
 * remounts (and its timer restarts) whenever the step changes.
 */
function StepMessage({ messages }: { messages: string[] }) {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Text className="mt-8 text-center text-[15px] font-medium" style={{ color: BLUE }}>
      {messages[Math.floor(seconds / MESSAGE_SECONDS) % messages.length]}
    </Text>
  );
}

/** Polls trip status and displays progress, success, or retry controls. */
export default function TripLoading() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { getToken } = useAuth();

  const [status, setStatus] = useState<TripStatus>("pending");
  const [stage, setStage] = useState<TripStage>("queued");
  const [meta, setMeta] = useState<TripMeta | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // Bumping this restarts the polling effect below — used by "Try again" so
  // the same screen resumes polling in place instead of navigating away.
  const [pollGeneration, setPollGeneration] = useState(0);
  const pollingRef = useRef(true);
  // For the generation-duration attribute on the finished/failed logs below.
  const startedAtRef = useRef(0);

  // The server reported `ready`. The steps then catch up and complete before
  // the trip opens (see the reveal effect below).
  const [finished, setFinished] = useState(false);
  // The step currently shown. Trails the real stage, never leads it.
  const [displayedStep, setDisplayedStep] = useState(0);
  const [allDone, setAllDone] = useState(false);
  const stepShownAtRef = useRef(0);

  useEffect(() => {
    startedAtRef.current = Date.now();
    stepShownAtRef.current = Date.now();
  }, []);

  useEffect(() => {
    pollingRef.current = true;

    // One trace per generation attempt covering the wait the user actually
    // experiences (submit -> ready/failed), so its p50/p95 show up in Sentry
    // Performance. A standalone transaction, since it outlives the
    // navigation span that's active when this screen opens.
    const generationSpan = Sentry.startInactiveSpan({
      name: "Trip generation",
      op: "trip.generation",
      forceTransaction: true,
      attributes: { trip_id: id, attempt: pollGeneration + 1 },
    });
    let spanEnded = false;
    // Status codes per Sentry's span API: 1 = ok, 2 = error.
    const endGenerationSpan = (ok: boolean, message?: string, numDays?: number) => {
      if (spanEnded) return;
      spanEnded = true;
      if (numDays !== undefined) generationSpan.setAttribute("num_days", numDays);
      generationSpan.setStatus(ok ? { code: 1 } : { code: 2, message });
      generationSpan.end();
    };

    /** Polls until generation finishes or this screen unmounts. */
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
              stage: TripStage;
              errorMessage: string | null;
              destination: string;
              numDays: number;
            };
            if (!pollingRef.current) return;

            setStatus(data.status);
            setStage(data.stage);
            setMeta({ destination: data.destination, numDays: data.numDays });

            if (data.status === "ready") {
              endGenerationSpan(true, undefined, data.numDays);
              Sentry.logger.info("Trip generation finished", {
                trip_id: id,
                num_days: data.numDays,
                duration_ms: Date.now() - startedAtRef.current,
              });
              // Don't navigate yet — let the steps finish, then open the trip.
              setFinished(true);
              return;
            }
            if (data.status === "failed") {
              endGenerationSpan(false, "generation_failed", data.numDays);
              Sentry.logger.error("Trip generation failed", {
                trip_id: id,
                num_days: data.numDays,
                error_message: data.errorMessage ?? "unknown",
                duration_ms: Date.now() - startedAtRef.current,
              });
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
      // Left the screen (or restarted polling) before it finished.
      endGenerationSpan(false, "cancelled");
    };
  }, [id, router, getToken, pollGeneration]);

  // Where the progress should be right now: the real stage while generating,
  // the last step once the server says ready.
  const targetStep = finished ? LAST_STEP : stepForStage(stage);

  // Moves the displayed step toward the target one step at a time, honoring
  // the minimum time each step stays visible; once finished and on the last
  // step, marks everything done and then opens the trip.
  useEffect(() => {
    const sinceShown = Date.now() - stepShownAtRef.current;
    const remaining = Math.max(0, MIN_STEP_MS - sinceShown);

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (displayedStep < targetStep) {
      timer = setTimeout(() => {
        stepShownAtRef.current = Date.now();
        setDisplayedStep((s) => s + 1);
      }, remaining);
    } else if (finished && !allDone) {
      timer = setTimeout(() => setAllDone(true), remaining);
    } else if (allDone) {
      timer = setTimeout(() => router.replace({ pathname: "/trip/[id]", params: { id } }), COMPLETE_HOLD_MS);
    }
    return () => clearTimeout(timer);
  }, [displayedStep, targetStep, finished, allDone, router, id]);

  /** Restarts a failed trip generation and resumes status polling. */
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
      Sentry.logger.info("Trip generation retry requested", { trip_id: id });
      startedAtRef.current = Date.now();
      stepShownAtRef.current = Date.now();
      setErrorMessage(null);
      setStatus("pending");
      setStage("queued");
      setFinished(false);
      setAllDone(false);
      setDisplayedStep(0);
      setPollGeneration((g) => g + 1);
    } catch (err) {
      Sentry.captureException(err);
      Sentry.logger.error("Trip generation retry failed", {
        trip_id: id,
        error_message: err instanceof Error ? err.message : String(err),
      });
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

  const subtitle = meta
    ? `${meta.numDays} ${meta.numDays === 1 ? "day" : "days"} in ${titleCase(meta.destination)}`
    : " ";

  return (
    <View className="flex-1 items-center justify-center bg-white px-5">
      <Image source={MAP_ILLUSTRATION} contentFit="contain" style={{ width: 260, height: 200 }} />

      <Text className="mt-8 text-center text-[26px] font-bold text-[#0A0A0A]">
        {allDone ? "Your trip is ready" : "Planning your trip"}
      </Text>
      <Text className="mt-2 text-center text-[16px] text-[#9CA3AF]">{subtitle}</Text>

      <View className="mt-9 flex-row items-start">
        {STEPS.map((step, i) => (
          <Fragment key={step.label}>
            {i > 0 && <View style={{ width: 14, height: 2, backgroundColor: "#E5E7EB", marginTop: 30 }} />}
            <StepDot
              step={step}
              status={allDone || i < displayedStep ? "done" : i === displayedStep ? "active" : "upcoming"}
            />
          </Fragment>
        ))}
      </View>

      {allDone ? (
        <Text className="mt-8 text-center text-[15px] font-medium" style={{ color: BLUE }}>
          Opening your itinerary…
        </Text>
      ) : (
        <StepMessage key={displayedStep} messages={STEPS[displayedStep].messages} />
      )}
    </View>
  );
}
