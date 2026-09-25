import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";

// Shared between (home)/index.tsx's "Your trips" preview and (home)/trips.tsx's
// full list — same card from design/home-screen-ui-design.png and
// design/trips-screen-ui-design.png (identical style in both).

const BLUE = "#076FFA";
const CARD_SHADOW = { boxShadow: "0px 4px 16px rgba(15, 23, 42, 0.08)" };

export type TripCardData = {
  id: string;
  title: string; // e.g. "3 Days in Osaka"
  location: string; // e.g. "Osaka"
  days: number;
  estimate: number | null; // budget total per person; null while not yet known
  imageUrl: string | null;
};

/** Renders a trip preview that opens the matching trip detail screen. */
export function TripCard({ trip }: { trip: TripCardData }) {
  const router = useRouter();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={trip.title}
      onPress={() => router.push({ pathname: "/trip/[id]", params: { id: trip.id } })}
      className="overflow-hidden rounded-[24px] bg-white active:opacity-90"
      style={CARD_SHADOW}
    >
      <View className="h-[220px] w-full">
        {trip.imageUrl ? (
          <Image source={{ uri: trip.imageUrl }} contentFit="cover" style={{ flex: 1 }} />
        ) : (
          <View className="flex-1 items-center justify-center bg-[#1E3A5F]">
            <Text className="text-[13px] text-white/70">No cover image</Text>
          </View>
        )}

        <View className="absolute right-3 top-3 flex-row items-center rounded-full bg-black/45 px-3 py-1.5">
          <Text className="text-[13px]">📅</Text>
          <Text className="ml-1 text-[13px] font-medium text-white">{trip.days} days</Text>
        </View>

        <View className="absolute bottom-0 left-0 right-0 px-4 pb-3">
          <Text className="text-[22px] font-bold text-white">{trip.title}</Text>
          <Text className="mt-0.5 text-[14px] text-white">📍 {trip.location}</Text>
        </View>
      </View>

      <View className="flex-row items-center justify-between px-4 py-3.5">
        <Text className="text-[14px] font-medium text-[#5B6472]">
          {trip.estimate !== null ? `💰 Est. $${trip.estimate} / person` : "💰 Budget pending"}
        </Text>
        <Text className="text-[14px] font-semibold" style={{ color: BLUE }}>
          View ›
        </Text>
      </View>
    </Pressable>
  );
}
