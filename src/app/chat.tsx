import { useAuth } from "@clerk/expo";
import * as Sentry from "@sentry/react-native";
import { Image } from "expo-image";
import { fetch as streamingFetch } from "expo/fetch";
import { SymbolView } from "expo-symbols";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chevron } from "@/components/Chevron";
import { assistantNav } from "@/lib/assistantNav";

// UI from design/assistant-screen-ui-design.png. The conversation is saved per
// user on the server (GET / DELETE /api/assistant) and loaded when the screen
// opens; replies stream in from POST /api/assistant.

const AI_LOGO = require("../../assets/images/ai-logo.png");

// Colors sampled from the design image (a softer blue than the app's
// primary button blue).
const CHAT_BLUE = "#4388E7";
const HEADER_LINE = "#F3F4F7";
const INPUT_LINE = "#ECEEF2";
const BUBBLE_BG = "#F7F7F9";
const INPUT_BG = "#F5F5F7";
const SEND_DISABLED_BG = "#EBECF0";

type Message = { id: number; role: "assistant" | "user"; text: string; isError?: boolean };

type RequestInitLite = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

/**
 * Calls the API with the user's login token attached. Clerk tokens only last
 * about a minute, so one that expires while a request waits (a slow first
 * request on a cold dev server, a weak connection) is rejected with 401; in
 * that case this tries once more with a freshly minted token instead of
 * failing the user's message.
 */
async function fetchAuthed<R extends { status: number }>(
  fetchImpl: (url: string, init: RequestInitLite) => Promise<R>,
  url: string,
  init: RequestInitLite,
  getToken: (options?: { skipCache?: boolean }) => Promise<string | null>,
): Promise<R> {
  const attempt = async (skipCache: boolean) => {
    const token = await getToken({ skipCache });
    return fetchImpl(url, {
      ...init,
      headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    });
  };
  const res = await attempt(false);
  return res.status === 401 ? attempt(true) : res;
}

const GREETING: Message = {
  id: 0,
  role: "assistant",
  text: "Hi! I'm your travel companion. Ask me where to go, when to visit, what to pack, or anything else about planning your next trip.",
};

/** Shared look of every line of a reply. */
const REPLY_TEXT = "text-[16px] leading-[22px]";

/**
 * One line's text with "**bold**" spans drawn bold. An unclosed "**" while a
 * reply is still streaming just renders bold from that point on, which is what
 * it will be once the closing "**" arrives. Stray backticks are dropped.
 */
function inlineText(line: string, allBold = false) {
  return line
    .replace(/`/g, "")
    .split("**")
    .map((part, index) =>
      part ? (
        <Text key={index} style={{ fontWeight: allBold || index % 2 === 1 ? "700" : "400" }}>
          {part}
        </Text>
      ) : null,
    );
}

/**
 * Draws a reply the way chat apps do, from the small markdown subset the
 * server's prompt asks for: **bold** text, "- " bullets and "1." numbering
 * (and "#" headings, drawn bold, in case the model slips). Each list item is
 * a row with a bold marker beside its text, so wrapped lines line up under the
 * first line instead of under the marker. Blank lines become a small gap.
 */
function ReplyText({ text, color }: { text: string; color: string }) {
  return (
    <View>
      {text.split("\n").map((line, index) => {
        if (line.trim() === "") return <View key={index} style={{ height: 8 }} />;

        const heading = /^#{1,6}\s+(.*)$/.exec(line);
        const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
        const numbered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line);

        if (bullet || numbered) {
          const marker = bullet ? "•" : `${numbered![1]}.`;
          const content = bullet ? bullet[1] : numbered![2];
          return (
            <View key={index} className="flex-row" style={{ marginTop: 3 }}>
              <Text
                className={REPLY_TEXT}
                style={{ color, fontWeight: "800", width: bullet ? 18 : 26 }}
              >
                {marker}
              </Text>
              <Text className={`flex-1 ${REPLY_TEXT}`} style={{ color }}>
                {inlineText(content)}
              </Text>
            </View>
          );
        }

        return (
          <Text key={index} className={REPLY_TEXT} style={{ color }}>
            {inlineText(heading ? heading[1] : line, heading !== null)}
          </Text>
        );
      })}
    </View>
  );
}

/** One chat bubble: assistant on the left in gray, user on the right in blue. */
function Bubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <View
      className={`max-w-[88%] rounded-[20px] px-[14px] py-[11px] ${isUser ? "self-end" : "self-start"}`}
      style={{ backgroundColor: isUser ? CHAT_BLUE : BUBBLE_BG }}
    >
      {isUser ? (
        <Text className="text-[16px] leading-[21px]" style={{ color: "#FFFFFF" }}>
          {message.text}
        </Text>
      ) : (
        <ReplyText text={message.text} color={message.isError ? "#B42318" : "#0A0A0A"} />
      )}
    </View>
  );
}

/**
 * Gray bubble with three dots pulsing one after another, shown only until the
 * reply starts appearing (the "assistant is typing" indicator).
 */
function TypingBubble() {
  const [dots] = useState(() => [0, 1, 2].map(() => new Animated.Value(0.3)));

  useEffect(() => {
    const useNativeDriver = Platform.OS !== "web";
    // Every dot runs the same 1020ms loop; the leading and trailing delays
    // shift each one by 160ms so the pulse travels left to right.
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
    <View
      accessibilityLabel="Assistant is typing"
      className="flex-row items-center self-start rounded-[20px] px-[18px] py-[19px]"
      style={{ backgroundColor: BUBBLE_BG, gap: 5 }}
    >
      {dots.map((opacity, i) => (
        <Animated.View
          key={i}
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#9CA3AF", opacity }}
        />
      ))}
    </View>
  );
}

/**
 * Up arrow for the send button, drawn rather than taken from an icon font so
 * its length and centering are exact: a long shaft with an arrowhead whose tip
 * meets the top of the shaft. The whole shape is symmetrical inside a 24-high
 * box, so it sits in the middle of the button.
 */
function SendArrow({ color }: { color: string }) {
  return (
    <View style={{ width: 24, height: 24, alignItems: "center" }}>
      <View style={{ position: "absolute", top: 4.5, width: 2, height: 15, backgroundColor: color }} />
      <Chevron direction="up" color={color} size={11} style={{ position: "absolute", top: 7 }} />
    </View>
  );
}

/** The white square on the send button while a reply is being written (tap to stop). */
function StopSquare() {
  return <View style={{ width: 14, height: 14, borderRadius: 3, backgroundColor: "#FFFFFF" }} />;
}

/**
 * The Assistant: a general travel chat, shown as its own full-screen page (no
 * tab bar) opened from the Assistant tab. Hiding the native tab bar on a tab
 * screen broke touches on Android, so this lives outside the tabs instead.
 */
export default function AssistantChat() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { getToken } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const inputRef = useRef<TextInput>(null);
  // Last known heights of the message list's content and of its visible area.
  const sizes = useRef({ content: 0, view: 0 });
  const scrollToBottom = (animated: boolean) => {
    const y = Math.max(0, sizes.current.content - sizes.current.view);
    scrollRef.current?.scrollTo({ y, animated });
  };
  const nextId = useRef(1);
  // Stops the reply currently being written; set only while one is running.
  const stopRef = useRef<(() => void) | null>(null);
  // Bumped on "clear" so a reply that arrives after clearing is dropped
  // instead of appearing in the fresh conversation.
  const conversationRef = useRef(0);

  const [messages, setMessages] = useState<Message[]>([GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // The saved conversation is loaded from the server when the screen first opens.
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [clearing, setClearing] = useState(false);

  const canSend = input.trim().length > 0 && !sending && historyLoaded;

  // Opening the chat brings up the keyboard straight away (after the screen has
  // finished sliding in, so the two animations don't fight). Closing it flags
  // that the user just left, so the Assistant tab doesn't reopen it (see
  // src/lib/assistantNav.ts).
  useEffect(() => {
    assistantNav.returning = false;
    const timer = setTimeout(() => inputRef.current?.focus(), 350);
    return () => {
      clearTimeout(timer);
      assistantNav.returning = true;
    };
  }, []);

  // The system navigation bar sits under this full-screen page, so the input bar
  // keeps clear of it — but only while the keyboard is closed; an open keyboard
  // already covers that area.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const showSub = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow", () => {
      setKeyboardOpen(true);
      // The list has just been squeezed by the keyboard padding; once that layout
      // settles, bring the latest message back into view.
      setTimeout(() => scrollToBottom(false), 100);
    });
    const hideSub = Keyboard.addListener(Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide", () =>
      setKeyboardOpen(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Loads the saved conversation once when the screen first opens — not again
  // whenever Clerk's getToken changes identity, which is what this used to do:
  // every rerun replaced the whole chat with the saved copy, wiping a message
  // that hadn't been saved yet. Sending is held back until it arrives, and it
  // only fills in a chat nobody has started typing into.
  const historyRequested = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (historyRequested.current) return;
    historyRequested.current = true;

    (async () => {
      try {
        const res = await fetchAuthed(fetch, "/api/assistant", {}, getToken);
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const saved = (await res.json()) as { role: "user" | "assistant"; content: string }[];
        if (mounted.current && saved.length > 0) {
          const loaded: Message[] = saved.map((m) => ({ id: nextId.current++, role: m.role, text: m.content }));
          setMessages((prev) => (prev.length > 1 ? prev : [GREETING, ...loaded]));
        }
      } catch (err) {
        Sentry.captureException(err);
        Sentry.logger.error("Assistant history failed to load", {
          error_message: err instanceof Error ? err.message : String(err),
        });
      } finally {
        if (mounted.current) setHistoryLoaded(true);
      }
    })();
  }, [getToken]);

  /** Adds the typed text as a user message, then asks the server for a reply. */
  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending || !historyLoaded) return;

    // Close the keyboard so the reply is visible as it appears.
    Keyboard.dismiss();

    const conversation = conversationRef.current;
    const userMessage: Message = { id: nextId.current++, role: "user", text };
    const replyId = nextId.current++;
    // The assistant's message starts empty (shown as the typing dots) and fills
    // in as the reply is revealed.
    setMessages((prev) => [...prev, userMessage, { id: replyId, role: "assistant", text: "" }]);
    setInput("");
    setSending(true);

    const controller = new AbortController();
    let stopped = false; // the user pressed stop

    const startedAt = Date.now();
    let received = ""; // everything the server has sent so far
    let shown = 0; // how much of it is on screen
    let streamDone = false;
    let firstPieceMs: number | null = null;

    // The network delivers text in uneven bursts, so what's drawn is paced
    // separately: a few letters every tick, faster only when a lot has piled
    // up. That gives the steady "being written" look whatever the chunk sizes.
    let finishTyping: () => void = () => {};
    const typingFinished = new Promise<void>((resolve) => {
      finishTyping = resolve;
    });
    const reveal = setInterval(() => {
      if (conversation !== conversationRef.current || stopped) {
        finishTyping();
      } else if (shown < received.length) {
        const backlog = received.length - shown;
        shown = Math.min(received.length, shown + Math.min(6, Math.max(1, Math.ceil(backlog / 40))));
        const visible = received.slice(0, shown);
        setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, text: visible } : m)));
      } else if (streamDone) {
        finishTyping();
      }
    }, 25);

    // The user pressed stop: keep exactly the words that were on screen (like
    // ChatGPT does), or drop the empty reply bubble if nothing had appeared yet.
    const settleStopped = () => {
      const visible = received.slice(0, shown);
      Sentry.logger.info("Assistant reply stopped", {
        message_chars: text.length,
        shown_chars: shown,
        duration_ms: Date.now() - startedAt,
      });
      if (conversation !== conversationRef.current) return;
      setMessages((prev) =>
        visible.trim()
          ? prev.map((m) => (m.id === replyId ? { ...m, text: visible } : m))
          : prev.filter((m) => m.id !== replyId),
      );
    };

    // Runs the moment the user taps stop, so the screen answers immediately
    // instead of waiting for the network to notice the cancel: freeze the text,
    // reset the button, and only then cancel the request (which also makes the
    // server stop the AI).
    const stop = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(reveal);
      finishTyping();
      settleStopped();
      setSending(false);
      controller.abort();
    };
    stopRef.current = stop;

    try {
      // expo/fetch is what can read a streamed body, but unlike the global
      // fetch it doesn't resolve relative URLs, so the origin is added here.
      const origin = globalThis.location?.origin ?? "";
      const res = await fetchAuthed(
        streamingFetch,
        `${origin}/api/assistant`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // The server keeps the conversation, so only the new message is sent.
          body: JSON.stringify({ message: text }),
          signal: controller.signal,
        },
        getToken,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("This device can't read streamed replies");
      const decoder = new TextDecoder();

      for (;;) {
        const { value, done } = await reader.read();
        if (stopped) return;
        if (conversation !== conversationRef.current) {
          await reader.cancel(); // chat was cleared mid-reply: stop it
          return;
        }
        if (done) break;
        received += decoder.decode(value, { stream: true });
        firstPieceMs ??= Date.now() - startedAt;
      }
      received += decoder.decode();
      if (!received.trim()) throw new Error("The reply was empty");

      // Everything has arrived; let the display finish catching up.
      streamDone = true;
      await typingFinished;
      if (stopped) return; // stop() already settled the screen

      Sentry.logger.info("Assistant reply received", {
        message_chars: text.length,
        first_piece_ms: firstPieceMs ?? -1,
        duration_ms: Date.now() - startedAt,
        reply_chars: received.length,
      });
    } catch (err) {
      // Stopping aborts the request, which surfaces here as an error — but it is
      // what the user asked for (and stop() already settled the screen), not a
      // failure to report.
      if (stopped) return;
      Sentry.captureException(err);
      Sentry.logger.error("Assistant reply failed", {
        message_chars: text.length,
        first_piece_ms: firstPieceMs ?? -1,
        duration_ms: Date.now() - startedAt,
        error_message: err instanceof Error ? err.message : String(err),
      });
      if (conversation !== conversationRef.current) return;
      // Show whatever text arrived (all of it, without waiting for the pacing)
      // and add a notice after it; if nothing arrived, the empty message itself
      // becomes the notice.
      setMessages((prev) =>
        received.trim()
          ? [
              ...prev.map((m) => (m.id === replyId ? { ...m, text: received } : m)),
              {
                id: nextId.current++,
                role: "assistant",
                text: "The reply was interrupted. Please try again.",
                isError: true,
              },
            ]
          : prev.map((m) =>
              m.id === replyId
                ? { ...m, text: "Sorry, I couldn't get a reply. Please try again.", isError: true }
                : m,
            ),
      );
    } finally {
      clearInterval(reveal);
      if (stopRef.current === stop) stopRef.current = null;
      if (!stopped && conversation === conversationRef.current) setSending(false);
    }
  };

  /** Stops the reply that is being written; the words already shown stay. */
  const handleStop = () => stopRef.current?.();

  /**
   * Deletes the saved conversation from the database, and only once that has
   * worked clears the screen back to the greeting — so a failed delete never
   * makes it look like the messages are gone when they aren't.
   */
  const clearChat = async () => {
    setClearing(true);
    try {
      const res = await fetchAuthed(fetch, "/api/assistant", { method: "DELETE" }, getToken);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);

      Sentry.logger.info("Assistant conversation cleared");
      conversationRef.current += 1;
      setMessages([GREETING]);
    } catch (err) {
      Sentry.captureException(err);
      Sentry.logger.error("Assistant conversation failed to clear", {
        error_message: err instanceof Error ? err.message : String(err),
      });
      const message = "Couldn't delete the conversation. Please try again.";
      if (Platform.OS === "web") {
        window.alert(message);
      } else {
        Alert.alert("Couldn't delete", message);
      }
    } finally {
      setClearing(false);
    }
  };

  /** Asks for confirmation before deleting (native dialog; window.confirm on web). */
  const confirmClear = () => {
    // Nothing to delete, or a reply is still being written / a delete is running.
    if (messages.length <= 1 || sending || clearing) return;
    const title = "Delete conversation?";
    const message = "This permanently deletes all your messages with the assistant. This can't be undone.";
    if (Platform.OS === "web") {
      if (window.confirm(`${title}\n\n${message}`)) void clearChat();
      return;
    }
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => void clearChat() },
    ]);
  };

  return (
    <KeyboardAvoidingView
      className="flex-1 bg-white"
      // Android is edge-to-edge here, so the window no longer resizes for the
      // keyboard by itself; padding lifts the input bar above it on both.
      behavior="padding"
    >
      <View
        className="flex-row items-center px-4 pb-3"
        style={{ paddingTop: insets.top + 10, borderBottomWidth: 1, borderBottomColor: HEADER_LINE }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close chat"
          onPress={() => router.back()}
          className="mr-3 h-[38px] w-[38px] items-center justify-center rounded-full active:opacity-70"
          style={{ backgroundColor: BUBBLE_BG }}
        >
          <Chevron direction="left" style={{ marginLeft: 2 }} />
        </Pressable>

        <View className="h-[44px] w-[44px] items-center justify-center rounded-full" style={{ backgroundColor: "#E6EFFD" }}>
          <Image source={AI_LOGO} contentFit="cover" style={{ width: 34, height: 34, borderRadius: 17 }} />
        </View>

        <View className="ml-3 flex-1">
          <Text className="text-[22px] font-bold text-[#0A0A0A]">Assistant</Text>
          <Text className="text-[14px] text-[#6B7280]">Your AI travel companion</Text>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Delete conversation"
          disabled={sending || clearing}
          onPress={confirmClear}
          className="h-[38px] w-[38px] items-center justify-center rounded-full active:opacity-70"
          style={{ backgroundColor: BUBBLE_BG, opacity: sending || clearing ? 0.4 : 1 }}
        >
          <SymbolView
            name={{ ios: "trash", android: "delete_outline", web: "delete_outline" }}
            size={20}
            tintColor="#0A0A0A"
            fallback={<Text style={{ fontSize: 16 }}>🗑️</Text>}
          />
        </Pressable>
      </View>

      <ScrollView
        ref={scrollRef}
        className="flex-1"
        contentContainerStyle={{ padding: 12, gap: 14 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        // Not animated while a reply streams in: it grows many times a second,
        // and an animation per chunk would lag behind the text.
        onContentSizeChange={(_, height) => {
          sizes.current.content = height;
          scrollToBottom(!sending);
        }}
        // The visible area shrinks when the keyboard opens (and grows when it
        // closes); keep the latest message in view instead of leaving it behind
        // the keyboard. The new height comes from the event itself — asking the
        // ScrollView to "scroll to end" at this moment can use its old size,
        // which is why this used to work only some of the time.
        onLayout={(e) => {
          sizes.current.view = e.nativeEvent.layout.height;
          scrollToBottom(false);
        }}
      >
        {messages.map((message) =>
          message.role === "assistant" && message.text === "" ? (
            <TypingBubble key={message.id} />
          ) : (
            <Bubble key={message.id} message={message} />
          ),
        )}
      </ScrollView>

      <View
        className="flex-row items-center px-3 py-3"
        style={{
          borderTopWidth: 1,
          borderTopColor: INPUT_LINE,
          gap: 10,
          paddingBottom: keyboardOpen ? 12 : 12 + insets.bottom,
        }}
      >
        <TextInput
          ref={inputRef}
          value={input}
          onChangeText={setInput}
          placeholder="Ask me anything about travel…"
          placeholderTextColor="#B4B8C0"
          onSubmitEditing={handleSend}
          returnKeyType="send"
          className="h-[44px] flex-1 rounded-full px-4 text-[15px] text-[#0A0A0A]"
          style={{ backgroundColor: INPUT_BG }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sending ? "Stop reply" : "Send message"}
          disabled={!sending && !canSend}
          onPress={sending ? handleStop : handleSend}
          className="h-[44px] w-[44px] items-center justify-center rounded-full active:opacity-80"
          style={{ backgroundColor: sending || canSend ? CHAT_BLUE : SEND_DISABLED_BG }}
        >
          {sending ? <StopSquare /> : <SendArrow color={canSend ? "#FFFFFF" : "#9CA3AF"} />}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
