import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";
import { View } from "react-native";

import { assistantNav } from "@/lib/assistantNav";

/**
 * The Assistant tab is a doorway: the chat itself is a full-screen page with no
 * tab bar (src/app/chat.tsx) — hiding the native tab bar on a tab screen broke
 * touches on Android, so the chat lives outside the tabs.
 *
 * Focusing this tab opens the chat. When the chat is closed the app lands back
 * here, so a flag set by the chat (see src/lib/assistantNav.ts) tells "the user
 * just left the chat" apart from "the user tapped the tab" — in that case they
 * are sent Home instead of the chat being reopened. (useCallback is required by
 * useFocusEffect's API.)
 */
export default function AssistantTab() {
  const router = useRouter();

  useFocusEffect(
    useCallback(() => {
      if (assistantNav.returning) {
        assistantNav.returning = false;
        router.navigate("/");
      } else {
        router.push("/chat");
      }
    }, [router]),
  );

  return <View className="flex-1 bg-white" />;
}
