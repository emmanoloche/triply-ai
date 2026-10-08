import { useAuth } from "@clerk/expo";
import * as Sentry from "@sentry/react-native";
import { SymbolView } from "expo-symbols";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { BudgetBreakdown, HotelSuggestion, ItineraryDay } from "@/lib/itinerary";

// UI from design/refine-ai-ui-design.png: a bottom sheet over the trip detail
// screen (not a separate page, unlike the general Assistant tab in chat.tsx)
// where the user asks in plain English for changes to THIS trip. Each reply
// is one synchronous edit from POST /api/trips/[id]/chat — the model always
// hands back the trip's full itinerary and budget, changed or not (see
// src/lib/tripRefine.ts) — which is applied via onTripUpdated so the detail
// screen reflects it immediately, without a refetch.

const BLUE = "#076FFA";
const AVATAR_BG = "#E6EFFD";
const BUBBLE_BG = "#F7F7F9";
const INPUT_BG = "#F5F5F7";
const SEND_DISABLED_BG = "#EBECF0";

const SUGGESTIONS = ["Make it more relaxed", "Add more local food", "We're vegetarian"];

type Message = { id: number; role: "assistant" | "user"; text: string; isError?: boolean };

const GREETING: Message = {
  id: 0,
  role: "assistant",
  text: "Hi! Want to tweak this trip? Tell me what to change — or tap a suggestion below.",
};

/** The assistant's sparkle mark, drawn at two sizes/colors (header avatar vs. message avatar). */
function SparkleIcon({ size, color }: { size: number; color: string }) {
  return (
    <SymbolView
      name={{ ios: "sparkles", android: "auto_awesome", web: "auto_awesome" }}
      size={size}
      tintColor={color}
      fallback={<Text style={{ fontSize: size * 0.8, color }}>✨</Text>}
    />
  );
}

/** Assistant-style bubble with three dots pulsing left to right, shown while an edit is being generated. */
function ThinkingBubble() {
  const [dots] = useState(() => [0, 1, 2].map(() => new Animated.Value(0.3)));

  useEffect(() => {
    const useNativeDriver = Platform.OS !== "web";
    const loops = dots.map((opacity, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 160),
          Animated.timing(opacity, { toValue: 1, duration: 350, useNativeDriver }),
          Animated.timing(opacity, { toValue: 0.3, duration: 350, useNativeDriver }),
          Animated.delay((2 - i) * 160),
        ]),
      ),
    );
    loops.forEach((loop) => loop.start());
    return () => loops.forEach((loop) => loop.stop());
  }, [dots]);

  return (
    <View className="flex-row items-end self-start" style={{ gap: 8 }}>
      <View className="h-7 w-7 items-center justify-center rounded-full" style={{ backgroundColor: AVATAR_BG }}>
        <SparkleIcon size={14} color={BLUE} />
      </View>
      <View
        accessibilityLabel="Assistant is thinking"
        className="flex-row items-center rounded-[20px] px-[18px] py-[16px]"
        style={{ backgroundColor: BUBBLE_BG, gap: 5 }}
      >
        {dots.map((opacity, i) => (
          <Animated.View
            key={i}
            style={{ width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#9CA3AF", opacity }}
          />
        ))}
      </View>
    </View>
  );
}

/** The white square shown on the send button while a reply is generating (tap to stop). */
function StopSquare() {
  return <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: "#FFFFFF" }} />;
}

/** One message row: assistant on the left with its sparkle avatar, user on the right in blue. */
function Bubble({ message }: { message: Message }) {
  if (message.role === "user") {
    return (
      <View className="max-w-[85%] self-end rounded-[20px] px-[14px] py-[11px]" style={{ backgroundColor: BLUE }}>
        <Text className="text-[15px] leading-[21px] text-white">{message.text}</Text>
      </View>
    );
  }
  return (
    <View className="flex-row items-end self-start" style={{ gap: 8, maxWidth: "90%" }}>
      <View className="h-7 w-7 items-center justify-center rounded-full" style={{ backgroundColor: AVATAR_BG }}>
        <SparkleIcon size={14} color={BLUE} />
      </View>
      <View className="shrink rounded-[20px] px-[14px] py-[11px]" style={{ backgroundColor: BUBBLE_BG }}>
        <Text className="text-[15px] leading-[21px]" style={{ color: message.isError ? "#B42318" : "#0A0A0A" }}>
          {message.text}
        </Text>
      </View>
    </View>
  );
}

type RequestInitLite = { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal };

/**
 * Same retry-once-on-401 approach as the general Assistant tab (chat.tsx):
 * Clerk tokens only last about a minute, so one that expires mid-wait is
 * rejected with 401 and retried once with a fresh token.
 */
async function fetchAuthed(
  url: string,
  init: RequestInitLite,
  getToken: (options?: { skipCache?: boolean }) => Promise<string | null>,
): Promise<Response> {
  const attempt = async (skipCache: boolean) => {
    const token = await getToken({ skipCache });
    return fetch(url, {
      ...init,
      headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  };
  const res = await attempt(false);
  return res.status === 401 ? attempt(true) : res;
}

type ChatRow = { role: "user" | "assistant"; content: string };

/** Everything about the trip a refine edit can change — the route always returns the full set. */
export type RefinedTrip = {
  destination: string;
  numDays: number;
  numTravelers: number;
  budgetTier: "budget" | "comfort" | "luxury";
  pace: "relaxed" | "balanced" | "fast";
  itinerary: ItineraryDay[];
  budgetBreakdown: BudgetBreakdown;
  hotelSuggestions: HotelSuggestion[];
  coverImageUrl: string | null;
  coverImageCredit: string | null;
};

type ChatResult = RefinedTrip & { reply: string };

/**
 * "Refine with AI": a bottom sheet, opened from the sparkle button on the
 * trip detail screen, for asking the AI to tweak THIS trip — not just the
 * day-by-day plan, but the destination, length, traveler count, budget tier,
 * pace, hotels, and cover photo too — in plain English. Accepted changes are
 * applied immediately — there's no separate "accept" step, since every reply
 * is already the trip's next real state (see the route's own comment for why).
 */
export function RefineTripSheet({
  visible,
  onClose,
  tripId,
  onTripUpdated,
}: {
  visible: boolean;
  onClose: () => void;
  tripId: string;
  onTripUpdated: (trip: RefinedTrip) => void;
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { getToken } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const nextId = useRef(1);

  // Pixel caps, not percentages: the sheet's parent (KeyboardAvoidingView)
  // sizes itself to content rather than to the screen, so a percentage
  // maxHeight on the sheet has nothing definite to resolve against and won't
  // reliably stop it from growing to fill the screen. Computing off the
  // actual window height keeps the trip underneath always partly visible.
  const sheetMaxHeight = Math.round(windowHeight * 0.82);
  const messagesMaxHeight = Math.max(180, Math.round(windowHeight * 0.4));

  // Same reasoning as the general Assistant tab (chat.tsx): the safe-area
  // bottom inset clears the nav bar, but an open keyboard already covers that
  // area — adding both leaves a dead gap between the input and the keyboard.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const showSub = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () =>
      setKeyboardOpen(true),
    );
    const hideSub = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () =>
      setKeyboardOpen(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);

  // Loads this trip's saved refine conversation once, the first time the
  // sheet is opened (not on every open/close, and not again on reopen).
  const historyRequested = useRef(false);
  useEffect(() => {
    if (!visible || historyRequested.current) return;
    historyRequested.current = true;

    (async () => {
      try {
        const res = await fetchAuthed(`/api/trips/${tripId}/chat`, {}, getToken);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const saved = (await res.json()) as ChatRow[];
        if (saved.length > 0) {
          setMessages([GREETING, ...saved.map((m) => ({ id: nextId.current++, role: m.role, text: m.content }))]);
        }
      } catch (err) {
        Sentry.captureException(err);
        Sentry.logger.error("Trip refine history failed to load", {
          trip_id: tripId,
          error_message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setHistoryLoaded(true);
      }
    })();
  }, [visible, tripId, getToken]);

  const canSend = input.trim().length > 0 && !sending && historyLoaded;
  // Stops the reply currently being generated; set only while one is running
  // (same pattern as the general Assistant tab's stop button — chat.tsx).
  const stopRef = useRef<(() => void) | null>(null);

  /** Sends a message (typed or a tapped suggestion) and applies the edit it comes back with. */
  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending || !historyLoaded) return;

    setMessages((prev) => [...prev, { id: nextId.current++, role: "user", text: trimmed }]);
    setInput("");
    setSending(true);
    const startedAt = Date.now();

    const controller = new AbortController();
    let stopped = false; // the user pressed stop

    // Runs the moment the user taps stop: reset the button immediately
    // instead of waiting for the network, then abort the request (which also
    // tells the server to skip saving/applying a result nobody's waiting for
    // — see api/trips/[id]/chat+api.ts).
    const stop = () => {
      if (stopped) return;
      stopped = true;
      setSending(false);
      Sentry.logger.info("Trip refine stopped", {
        trip_id: tripId,
        message_chars: trimmed.length,
        duration_ms: Date.now() - startedAt,
      });
      controller.abort();
    };
    stopRef.current = stop;

    try {
      const res = await fetchAuthed(
        `/api/trips/${tripId}/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed }),
          signal: controller.signal,
        },
        getToken,
      );
      if (stopped) return;
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const result = (await res.json()) as ChatResult;
      if (stopped) return;

      const { reply, ...refined } = result;
      onTripUpdated(refined);
      setMessages((prev) => [...prev, { id: nextId.current++, role: "assistant", text: reply }]);
      Sentry.logger.info("Trip refine reply applied", {
        trip_id: tripId,
        message_chars: trimmed.length,
        duration_ms: Date.now() - startedAt,
      });
    } catch (err) {
      // Stopping aborts the request, which surfaces here as an error — but it
      // is what the user asked for (stop() already reset the screen), not a
      // failure to report.
      if (stopped) return;
      Sentry.captureException(err);
      Sentry.logger.error("Trip refine failed", {
        trip_id: tripId,
        message_chars: trimmed.length,
        duration_ms: Date.now() - startedAt,
        error_message: err instanceof Error ? err.message : String(err),
      });
      setMessages((prev) => [
        ...prev,
        {
          id: nextId.current++,
          role: "assistant",
          text: err instanceof Error ? err.message : "Sorry, I couldn't make that change. Please try again.",
          isError: true,
        },
      ]);
    } finally {
      if (stopRef.current === stop) stopRef.current = null;
      if (!stopped) setSending(false);
    }
  };

  /** Stops the reply that is being generated; already-applied changes (if any) stay. */
  const handleStop = () => stopRef.current?.();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end" style={{ backgroundColor: "rgba(10,24,39,0.45)" }}>
        <Pressable accessibilityLabel="Close" style={{ flex: 1 }} onPress={onClose} />
        <KeyboardAvoidingView behavior="padding">
          <View
            className="rounded-t-[28px] bg-white"
            style={{ maxHeight: sheetMaxHeight, paddingBottom: keyboardOpen ? 12 : insets.bottom + 12 }}
          >
            <View className="items-center pt-2.5">
              <View className="h-[5px] w-9 rounded-full" style={{ backgroundColor: "#E5E7EB" }} />
            </View>

            <View
              className="flex-row items-center px-5 pb-4 pt-3"
              style={{ borderBottomWidth: 1, borderBottomColor: "#F3F4F7" }}
            >
              <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: BLUE }}>
                <SparkleIcon size={20} color="#FFFFFF" />
              </View>
              <View className="ml-3 flex-1">
                <Text className="text-[18px] font-bold text-[#0A0A0A]">Refine with AI</Text>
                <Text className="text-[13px] text-[#6B7280]">Ask for changes in plain English</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={onClose}
                className="h-9 w-9 items-center justify-center rounded-full active:opacity-70"
                style={{ backgroundColor: BUBBLE_BG }}
              >
                <SymbolView
                  name={{ ios: "xmark", android: "close", web: "close" }}
                  size={16}
                  tintColor="#0A0A0A"
                  fallback={<Text style={{ fontSize: 14 }}>✕</Text>}
                />
              </Pressable>
            </View>

            <ScrollView
              ref={scrollRef}
              contentContainerStyle={{ padding: 16, gap: 14, flexGrow: 1 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
              style={{ maxHeight: messagesMaxHeight }}
            >
              {messages.map((message) => (
                <Bubble key={message.id} message={message} />
              ))}
              {sending && <ThinkingBubble />}
            </ScrollView>

            {messages.length <= 1 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12, gap: 8 }}
              >
                {SUGGESTIONS.map((suggestion) => (
                  <Pressable
                    key={suggestion}
                    accessibilityRole="button"
                    disabled={sending || !historyLoaded}
                    onPress={() => send(suggestion)}
                    className="rounded-full border px-4 py-2 active:opacity-70"
                    style={{ borderColor: BLUE, opacity: sending || !historyLoaded ? 0.5 : 1 }}
                  >
                    <Text className="text-[13px] font-medium" style={{ color: BLUE }}>
                      {suggestion}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}

            <View className="flex-row items-center px-4 pt-2" style={{ gap: 10 }}>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Tell me what to change…"
                placeholderTextColor="#B4B8C0"
                onSubmitEditing={() => send(input)}
                returnKeyType="send"
                editable={historyLoaded}
                className="h-[46px] flex-1 rounded-full px-4 text-[15px] text-[#0A0A0A]"
                style={{ backgroundColor: INPUT_BG }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={sending ? "Stop reply" : "Send message"}
                disabled={!sending && !canSend}
                onPress={sending ? handleStop : () => send(input)}
                className="h-[46px] w-[46px] items-center justify-center rounded-full active:opacity-80"
                style={{ backgroundColor: sending || canSend ? BLUE : SEND_DISABLED_BG }}
              >
                {!historyLoaded ? (
                  <ActivityIndicator size="small" color="#9CA3AF" />
                ) : sending ? (
                  <StopSquare />
                ) : (
                  <SymbolView
                    name={{ ios: "arrow.up", android: "arrow_upward", web: "arrow_upward" }}
                    size={18}
                    tintColor={canSend ? "#FFFFFF" : "#9CA3AF"}
                    fallback={<Text style={{ fontSize: 16, color: canSend ? "#FFFFFF" : "#9CA3AF" }}>↑</Text>}
                  />
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
