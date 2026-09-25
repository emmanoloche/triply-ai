import { useAuth } from "@clerk/expo";
import * as Sentry from "@sentry/react-native";
import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { TripCard } from "@/components/TripCard";
import { toCardData, type TripRow } from "@/lib/trips";

// UI from design/trips-screen-ui-design.png.

/** Lists ready trips and reloads them whenever the tab gains focus. */
export default function Trips() {
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();

  const [trips, setTrips] = useState<TripRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  // Separate from "trips is an empty array" — a failed request and a
  // genuinely empty list must never look the same on screen, otherwise a
  // network blip / auth hiccup silently reads as "you have no trips".
  const [error, setError] = useState<string | null>(null);

  // useFocusEffect requires a stable callback per its own API contract (it
  // re-subscribes when the reference changes) — this isn't a hand-rolled
  // perf optimization the React Compiler would otherwise handle, so the
  // useCallback here is required, not the kind AGENTS.md says to skip.
  const load = useCallback(async () => {
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch("/api/trips", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = (await res.json()) as TripRow[];
      setTrips(data);
    } catch (err) {
      Sentry.captureException(err);
      setError("Couldn't load your trips. Pull to refresh or reopen this tab to try again.");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  // Refetches every time this tab gains focus — e.g. right after a new trip
  // finishes generating — not just once on first mount.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <View className="flex-1 bg-white">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: 40 }}
      >
        <Text className="px-5 text-[32px] font-bold text-[#0A0A0A]">Trips</Text>
        <Text className="px-5 text-[15px] text-[#6B7280]">
          {trips === null ? " " : `${trips.length} ${trips.length === 1 ? "trip" : "trips"} planned`}
        </Text>

        {loading ? (
          <View className="mt-16 items-center">
            <ActivityIndicator color="#076FFA" />
          </View>
        ) : error ? (
          <View className="mt-16 items-center px-8">
            <Text className="text-center text-[15px] text-[#6B7280]">{error}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry"
              onPress={load}
              className="mt-4 h-10 items-center justify-center rounded-full px-6 active:opacity-90"
              style={{ backgroundColor: "#076FFA" }}
            >
              <Text className="text-[14px] font-semibold text-white">Retry</Text>
            </Pressable>
          </View>
        ) : trips && trips.length > 0 ? (
          <View className="mt-5 gap-4 px-5">
            {trips.map((trip) => (
              <TripCard key={trip.id} trip={toCardData(trip)} />
            ))}
          </View>
        ) : (
          <View className="mt-16 items-center px-8">
            <Text className="text-center text-[15px] text-[#6B7280]">
              No trips yet — generate one from the Home tab to see it here.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}
