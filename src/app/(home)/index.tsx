import { useAuth, useUser } from "@clerk/expo";
import * as Sentry from "@sentry/react-native";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TripCard } from "@/components/TripCard";
import { toCardData, type TripRow } from "@/lib/trips";

const WORLD_ICON = require("../../../assets/images/world.png");

const BLUE = "#076FFA";
const CARD_GRADIENT = "linear-gradient(135deg, #5B94FF 0%, #1B5CEB 100%)";
const CARD_GRADIENT_STYLE =
  Platform.OS === "web" ? { backgroundImage: CARD_GRADIENT } : { experimental_backgroundImage: CARD_GRADIENT };

type PopularDestination = { id: string; name: string; imageUrl: string; imageCredit: string; rating: number };

function DestinationCard({ destination }: { destination: PopularDestination }) {
  const city = destination.name.split(",")[0].trim();
  return (
    <Pressable className="h-[180px] w-[130px] overflow-hidden rounded-[18px] active:opacity-90">
      <Image source={{ uri: destination.imageUrl }} contentFit="cover" style={{ flex: 1 }} />

      <View className="absolute right-2 top-2 flex-row items-center rounded-full bg-white/90 px-2 py-1">
        <Text className="text-[11px]">⭐</Text>
        <Text className="ml-0.5 text-[11px] font-semibold text-[#0A0A0A]">{destination.rating.toFixed(1)}</Text>
      </View>

      <View className="absolute bottom-0 left-0 right-0 px-2.5 pb-2.5">
        <Text className="text-[15px] font-bold text-white">{city}</Text>
      </View>
    </Pressable>
  );
}

export default function Home() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const firstName = user?.firstName ?? "there";

  const [trips, setTrips] = useState<TripRow[] | null>(null);
  const [loading, setLoading] = useState(true);

  // Refetches on every focus (not just first mount) so a trip that just
  // finished generating — or was just deleted — shows up immediately when
  // the user lands back on Home, same pattern as the Trips tab.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      (async () => {
        try {
          const token = await getToken();
          const res = await fetch("/api/trips", {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          if (!res.ok) throw new Error(`Request failed (${res.status})`);
          const data = (await res.json()) as TripRow[];
          if (!cancelled) setTrips(data);
        } catch (err) {
          Sentry.captureException(err);
          if (!cancelled) setTrips((prev) => prev ?? []);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [getToken]),
  );

  const mostRecentTrip = trips && trips.length > 0 ? toCardData(trips[0]) : null;

  const [destinations, setDestinations] = useState<PopularDestination[] | null>(null);
  const [destinationsLoading, setDestinationsLoading] = useState(true);

  // Fetched once on mount, not on every focus — this only changes every ~2
  // days (see refresh-popular-destinations.ts), unlike "Your trips" above.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        const res = await fetch("/api/popular-destinations", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = (await res.json()) as PopularDestination[];
        if (!cancelled) setDestinations(data);
      } catch (err) {
        Sentry.captureException(err);
        if (!cancelled) setDestinations((prev) => prev ?? []);
      } finally {
        if (!cancelled) setDestinationsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [getToken]);

  return (
    <View className="flex-1 bg-white">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 40 }}
      >
        <Text className="px-5 text-[30px] font-bold text-[#0A0A0A]">Hi, {firstName} 👋</Text>

        <View className="mx-5 mt-5 overflow-hidden rounded-[28px]" style={CARD_GRADIENT_STYLE}>
          <View className="flex-row px-5 pb-5 pt-5">
            <View className="flex-1">
              <View className="flex-row items-center">
                <Text className="text-[13px]">✨</Text>
                <Text className="ml-1.5 text-[13px] font-semibold text-white">AI Trip Planner</Text>
              </View>

              <Text className="mt-2 text-[21px] font-bold leading-[25px] text-white">Plan your next trip</Text>

              <Text className="mt-2 text-[14px] leading-[19px] text-white/85">
                Tell us where and when — we&apos;ll{"\n"}build the itinerary.
              </Text>

              <Pressable
                className="mt-4 h-[46px] flex-row items-center justify-center self-start rounded-full bg-white px-6 active:opacity-90"
                accessibilityRole="button"
                accessibilityLabel="Get started"
                onPress={() => router.push("/generate-trip")}
              >
                <Text className="text-[16px] font-semibold" style={{ color: BLUE }}>
                  Get started
                </Text>
                <Text className="ml-1.5 text-[16px] font-semibold" style={{ color: BLUE }}>
                  →
                </Text>
              </Pressable>
            </View>

            <Image
              source={WORLD_ICON}
              contentFit="contain"
              style={{ position: "absolute", right: -52, top: 0, bottom: 0, width: 224 }}
            />
          </View>
        </View>

        <View className="mt-8 flex-row items-center justify-between px-5">
          <Text className="text-[21px] font-bold text-[#0A0A0A]">Your trips</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="See all trips"
            onPress={() => router.push("/trips")}
          >
            <Text className="text-[15px] font-medium" style={{ color: BLUE }}>
              See all ›
            </Text>
          </Pressable>
        </View>

        <View className="mx-5 mt-4">
          {loading ? (
            <View className="h-[220px] items-center justify-center rounded-[24px] bg-[#F3F4F6]">
              <ActivityIndicator color={BLUE} />
            </View>
          ) : mostRecentTrip ? (
            <TripCard trip={mostRecentTrip} />
          ) : (
            <View className="items-center justify-center rounded-[24px] bg-[#F3F4F6] px-6 py-10">
              <Text className="text-center text-[14px] text-[#6B7280]">
                No trips yet — generate one to see it here.
              </Text>
            </View>
          )}
        </View>

        {destinationsLoading || (destinations && destinations.length > 0) ? (
          <>
            <Text className="mt-8 px-5 text-[21px] font-bold text-[#0A0A0A]">Popular destinations</Text>

            {destinationsLoading ? (
              <View className="mt-4 h-[180px] items-center justify-center">
                <ActivityIndicator color={BLUE} />
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                className="mt-4"
                contentContainerStyle={{ paddingHorizontal: 20, gap: 12 }}
              >
                {destinations!.map((destination) => (
                  <DestinationCard key={destination.id} destination={destination} />
                ))}
              </ScrollView>
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
