import { Text, View } from "react-native";

// Placeholder — UI design for this tab comes from design/assistant-screen-ui-design.png
// and refine-ai-ui-design.png, not built yet (see plan.md Phase 4).
export default function Assistant() {
  return (
    <View className="flex-1 items-center justify-center bg-white px-6">
      <Text className="text-center text-lg font-semibold text-[#0A0A0A]">Assistant</Text>
      <Text className="mt-2 text-center text-[14px] text-[#5B6472]">Coming soon</Text>
    </View>
  );
}
