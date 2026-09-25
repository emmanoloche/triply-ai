import { useAuth } from "@clerk/expo";
import * as Sentry from "@sentry/react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chevron } from "@/components/Chevron";
import type { BudgetBreakdown, HotelSuggestion, ItineraryDay } from "@/lib/itinerary";
import { titleCase } from "@/lib/text";

const AI_LOGO = require("../../../assets/images/ai-logo.png");

// UI from design/trip-detail-screen-design1.png. The "Map" section is a
// placeholder, not a pixel-match — react-native-maps is native-only, isn't
// installed yet, can't run in Expo Go, and needs a Google Maps API key on
// Android (all already tracked as deferred work in plan.md). Everything
// else here is built to match the design.

const BLUE = "#076FFA";
const NAVY = "10, 24, 39";
const GRADIENT = `linear-gradient(to bottom, rgba(${NAVY},0) 40%, rgba(${NAVY},0.55) 72%, rgba(${NAVY},0.82) 100%)`;
const GRADIENT_STYLE = Platform.OS === "web" ? { backgroundImage: GRADIENT } : { experimental_backgroundImage: GRADIENT };

type Trip = {
  id: string;
  destination: string;
  startDate: string;
  numDays: number;
  numTravelers: number;
  budgetTier: string;
  status: string;
  coverImageUrl: string | null;
  coverImageCredit: string | null;
  itinerary: ItineraryDay[] | null;
  budgetBreakdown: BudgetBreakdown | null;
  hotelSuggestions: HotelSuggestion[] | null;
};

/** Renders a circular button with a shared accessible label and style. */
function RoundIconButton({
  onPress,
  accessibilityLabel,
  disabled,
  style,
  children,
}: {
  onPress?: () => void;
  accessibilityLabel: string;
  disabled?: boolean;
  style?: object;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      className="h-10 w-10 items-center justify-center rounded-full bg-white active:opacity-80"
      style={[{ boxShadow: "0px 2px 6px rgba(0,0,0,0.15)" }, style]}
    >
      {children}
    </Pressable>
  );
}

/** Displays one trip summary statistic with its icon and label. */
function StatItem({ emoji, value, label }: { emoji: string; value: string; label: string }) {
  return (
    <View className="flex-1 items-center">
      <View className="h-14 w-14 items-center justify-center rounded-full" style={{ backgroundColor: "#E8F0FE" }}>
        <Text className="text-[22px]">{emoji}</Text>
      </View>
      <Text className="mt-2 text-[17px] font-bold text-[#0A0A0A]">{value}</Text>
      {label.split("\n").map((line, i) => (
        <Text key={i} className="text-[13px] text-[#6B7280]">
          {line}
        </Text>
      ))}
    </View>
  );
}

/** Expands an itinerary day to show its scheduled activities. */
function DayCard({ day, defaultExpanded }: { day: ItineraryDay; defaultExpanded: boolean }) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Day ${day.day}: ${day.title}`}
      onPress={() => setExpanded((e) => !e)}
      className="mt-3 rounded-[18px] p-4 active:opacity-90"
      style={{ backgroundColor: "#EEF3FE" }}
    >
      <View className="flex-row items-center">
        <View className="h-7 w-7 items-center justify-center rounded-full" style={{ backgroundColor: BLUE }}>
          <Text className="text-[13px] font-bold text-white">{day.day}</Text>
        </View>
        <View className="ml-3 flex-1">
          <Text className="text-[15px] font-bold text-[#0A0A0A]">{day.title}</Text>
          {!expanded && (
            <Text numberOfLines={1} className="mt-0.5 text-[13px] text-[#6B7280]">
              {day.activities[0]?.description}
            </Text>
          )}
        </View>
        <Chevron direction={expanded ? "up" : "down"} color="#6B7280" />
      </View>

      {expanded && (
        <View className="mt-3">
          {day.activities.map((activity, i) => (
            <View key={i} className="mt-2.5 flex-row">
              <Text className="w-[54px] text-[12px] text-[#9CA3AF]">{activity.time}</Text>
              <View className="flex-1">
                <Text className="text-[14px] font-semibold text-[#0A0A0A]">{activity.title}</Text>
                <Text className="mt-0.5 text-[13px] text-[#6B7280]">{activity.description}</Text>
              </View>
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

/** Loads a trip and presents its itinerary, budget, and cover controls. */
export default function TripDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { getToken } = useAuth();

  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`/api/trips/${id}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = (await res.json()) as Trip;
        if (!cancelled) setTrip(data);
      } catch (err) {
        Sentry.captureException(err);
        if (!cancelled) setError("Couldn't load this trip.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id, getToken]);

  /** Deletes this trip and navigates to the appropriate remaining view. */
  async function deleteTrip() {
    setDeleting(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/trips/${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = (await res.json()) as { remainingTrips: number };
      // Last trip just got deleted — send them to Home's "generate a trip"
      // CTA instead of an empty Trips list.
      router.replace(data.remainingTrips > 0 ? "/trips" : "/");
    } catch (err) {
      Sentry.captureException(err);
      setDeleting(false);
      // Alert.alert is a no-op on web (react-native-web), so fall back to
      // window.confirm/alert there — both are the platform's own native
      // dialog, just reached through a different API per platform.
      if (Platform.OS === "web") {
        window.alert("Couldn't delete this trip. Try again.");
      } else {
        Alert.alert("Couldn't delete this trip", "Try again.");
      }
    }
  }

  /** Confirms deletion with the platform's native dialog. */
  function confirmDelete() {
    const title = "Delete trip?";
    const message = "This can't be undone.";
    if (Platform.OS === "web") {
      if (window.confirm(`${title}\n\n${message}`)) void deleteTrip();
      return;
    }
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void deleteTrip(),
      },
    ]);
  }

  /** Picks a local photo, uploads it, and updates the trip cover. */
  async function pickAndReplaceCover() {
    if (Platform.OS !== "web") {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("Permission needed", "Allow photo library access to choose a cover photo.");
        return;
      }
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [16, 9],
      // Pre-compressed on-device before it ever leaves the phone — matters
      // on a metered connection, and ImageKit (see uploadCustomCoverImage)
      // further bounds the delivered size regardless.
      quality: 0.6,
      base64: true,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset.base64) return;

    setUploadingCover(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/trips/${id}/cover`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ base64: asset.base64, mimeType: asset.mimeType ?? "image/jpeg" }),
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      const data = (await res.json()) as { coverImageUrl: string };
      setTrip((prev) => (prev ? { ...prev, coverImageUrl: data.coverImageUrl, coverImageCredit: null } : prev));
    } catch (err) {
      Sentry.captureException(err);
      const message = "Couldn't update the cover photo. Try again.";
      if (Platform.OS === "web") {
        window.alert(message);
      } else {
        Alert.alert("Upload failed", message);
      }
    } finally {
      setUploadingCover(false);
    }
  }

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" color={BLUE} />
      </View>
    );
  }

  if (error || !trip) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-8">
        <Text className="text-center text-[16px] text-[#6B7280]">{error ?? "Trip not found."}</Text>
      </View>
    );
  }

  const city = titleCase(trip.destination.split(",")[0].trim());
  const HEADER_HEIGHT = 370;
  const DOME_WIDTH = width * 1.7;

  return (
    <View className="flex-1 bg-white">
      <ScrollView
        showsVerticalScrollIndicator={false}
        // Without this, pulling past the top rubber-bands the whole
        // ScrollView down, revealing the screen's white background above
        // the fixed-height cover header before it springs back.
        bounces={false}
        overScrollMode="never"
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        <View style={{ height: HEADER_HEIGHT }}>
          <View
            style={{
              position: "absolute",
              top: 0,
              left: (width - DOME_WIDTH) / 2,
              width: DOME_WIDTH,
              height: HEADER_HEIGHT,
              borderBottomLeftRadius: DOME_WIDTH / 2,
              borderBottomRightRadius: DOME_WIDTH / 2,
              overflow: "hidden",
              backgroundColor: "#12283F",
            }}
          >
            {trip.coverImageUrl && (
              <Image source={{ uri: trip.coverImageUrl }} contentFit="cover" style={StyleSheet.absoluteFill} />
            )}
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, GRADIENT_STYLE]} />
          </View>

          <RoundIconButton
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            style={{ position: "absolute", top: insets.top + 8, left: 16 }}
          >
            <Chevron direction="left" style={{ marginLeft: 2 }} />
          </RoundIconButton>

          <RoundIconButton
            accessibilityLabel="Change cover photo"
            onPress={pickAndReplaceCover}
            disabled={uploadingCover}
            style={{ position: "absolute", top: insets.top + 8, right: 64 }}
          >
            {uploadingCover ? (
              <ActivityIndicator size="small" color={BLUE} />
            ) : (
              <SymbolView
                name={{ ios: "camera", android: "photo_camera", web: "photo_camera" }}
                size={22}
                tintColor="#0A0A0A"
                fallback={<Text style={{ fontSize: 20 }}>📷</Text>}
              />
            )}
          </RoundIconButton>

          <RoundIconButton
            accessibilityLabel="Delete trip"
            onPress={confirmDelete}
            disabled={deleting}
            style={{ position: "absolute", top: insets.top + 8, right: 16 }}
          >
            {deleting ? (
              <ActivityIndicator size="small" color="#DC2626" />
            ) : (
              <SymbolView
                name={{ ios: "trash", android: "delete_outline", web: "delete_outline" }}
                size={22}
                tintColor="#DC2626"
                fallback={<Text style={{ fontSize: 20 }}>🗑️</Text>}
              />
            )}
          </RoundIconButton>

          <View style={{ position: "absolute", left: 22, right: 22, bottom: 46 }}>
            <View className="flex-row items-center">
              <Text className="text-[16px]">📍</Text>
              <Text className="ml-1.5 text-[18px] font-bold text-white">{city}</Text>
            </View>
            <Text className="mt-1 text-[32px] font-extrabold leading-[38px] text-white">
              {trip.numDays} {trip.numDays === 1 ? "Day" : "Days"} in {city}
            </Text>
            {trip.coverImageCredit && (
              // Left-aligned, not right — right-aligned text here was getting
              // clipped by the dome's own curved edge (the curve cuts inward
              // hardest at the bottom corners, exactly where right-aligned
              // text would sit).
              <Text className="mt-2 text-[11px] text-white/70">
                Photo by <Text className="font-bold text-white/90">{trip.coverImageCredit}</Text> on Unsplash
              </Text>
            )}
          </View>
        </View>

        <View className="flex-row px-5 pt-7">
          <StatItem emoji="📅" value={`${trip.numDays} ${trip.numDays === 1 ? "day" : "days"}`} label="Duration" />
          <StatItem emoji="👥" value={String(trip.numTravelers)} label="Travelers" />
          <StatItem
            emoji="👛"
            value={trip.budgetBreakdown ? `$${trip.budgetBreakdown.total}` : "—"}
            label={"/ person\nBudget"}
          />
        </View>

        <View className="mt-8 px-5">
          <Text className="text-[20px] font-bold text-[#0A0A0A]">Map</Text>
          <View
            className="mt-3 h-[220px] items-center justify-center rounded-[18px]"
            style={{ backgroundColor: "#EEF2F6" }}
          >
            <Text className="text-[28px]">🗺️</Text>
            <Text className="mt-2 text-center text-[13px] text-[#9CA3AF]">
              Map view needs a native build{"\n"}(not available in Expo Go)
            </Text>
          </View>
        </View>

        <View className="mt-8 px-5">
          <Text className="text-[20px] font-bold text-[#0A0A0A]">Itinerary</Text>
          <Text className="text-[14px] text-[#6B7280]">Your day-by-day plan</Text>

          {trip.itinerary?.map((day, i) => <DayCard key={day.day} day={day} defaultExpanded={i === 0} />)}
        </View>

        {trip.hotelSuggestions && trip.hotelSuggestions.length > 0 && (
          <View className="mt-8 px-5">
            <Text className="text-[20px] font-bold text-[#0A0A0A]">Hotel suggestions</Text>
            {trip.hotelSuggestions.map((hotel) => (
              <View key={hotel.name} className="mt-3 rounded-[16px] border border-[#E5E7EB] p-4">
                <Text className="text-[15px] font-bold text-[#0A0A0A]">{hotel.name}</Text>
                <Text className="mt-1 text-[13px] text-[#6B7280]">{hotel.description}</Text>
                <Text className="mt-1 text-[13px] font-medium" style={{ color: BLUE }}>
                  {hotel.priceRange}
                </Text>
              </View>
            ))}
          </View>
        )}

        {trip.budgetBreakdown && (
          <View className="mt-8 px-5">
            <Text className="text-[20px] font-bold text-[#0A0A0A]">Budget breakdown</Text>
            <View className="mt-3 rounded-[16px] border border-[#E5E7EB] p-4">
              {(
                [
                  ["Accommodation", trip.budgetBreakdown.accommodation],
                  ["Food", trip.budgetBreakdown.food],
                  ["Transport", trip.budgetBreakdown.transport],
                  ["Activities", trip.budgetBreakdown.activities],
                  ["Misc", trip.budgetBreakdown.misc],
                ] as const
              ).map(([label, value]) => (
                <View key={label} className="mt-1.5 flex-row justify-between">
                  <Text className="text-[13px] text-[#6B7280]">{label}</Text>
                  <Text className="text-[13px] text-[#0A0A0A]">
                    {trip.budgetBreakdown!.currency} {value}
                  </Text>
                </View>
              ))}
              <View className="mt-2 flex-row justify-between border-t border-[#E5E7EB] pt-2">
                <Text className="text-[14px] font-bold text-[#0A0A0A]">Total</Text>
                <Text className="text-[14px] font-bold text-[#0A0A0A]">
                  {trip.budgetBreakdown.currency} {trip.budgetBreakdown.total}
                </Text>
              </View>
            </View>
          </View>
        )}
      </ScrollView>

      {/* Floating, not inline — stays in the same spot on screen regardless
          of scroll position, unlike a button placed inside the ScrollView
          content. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open AI assistant"
        className="h-[68px] w-[68px] items-center justify-center overflow-hidden rounded-full active:opacity-90"
        style={{
          position: "absolute",
          right: 20,
          bottom: insets.bottom + 20,
          boxShadow: "0px 4px 12px rgba(7, 111, 250, 0.35)",
        }}
      >
        <Image source={AI_LOGO} contentFit="cover" style={{ width: "100%", height: "100%" }} />
      </Pressable>
    </View>
  );
}
