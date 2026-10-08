import { Text, View } from "react-native";

import type { ItineraryDay } from "@/lib/itinerary";

/** Maps are native only (AGENTS.md) — Web gets an explanatory placeholder instead. */
export function TripMap(_props: { itinerary: ItineraryDay[] | null }) {
  return (
    <View className="mt-3 h-[190px] items-center justify-center rounded-[18px]" style={{ backgroundColor: "#EEF2F6" }}>
      <Text className="text-[28px]">🗺️</Text>
      <Text className="mt-2 text-center text-[13px] text-[#9CA3AF]">Map view is available on Android and iOS</Text>
    </View>
  );
}
