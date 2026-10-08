import { useAuth, useClerk, useUser } from "@clerk/expo";
import * as Sentry from "@sentry/react-native";
import Constants from "expo-constants";
import { Image } from "expo-image";
import { useFocusEffect } from "expo-router";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { useCallback, useState } from "react";
import { Alert, Linking, Platform, Pressable, ScrollView, Share, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chevron } from "@/components/Chevron";
import { LEGAL_LINKS } from "@/lib/legal";
import type { TripRow } from "@/lib/trips";

const BLUE = "#076FFA";
const INK = "#0A0A0A";
const GRAY = "#6B7280";
const RED = "#DC2626";

type IconName = { ios: string; android: string; web: string };

const CARD = "rounded-[24px] border border-[#ECEEF2] bg-white";

/** Draws a symbol with the platform-specific icon names the design uses. */
function Icon({ name, color, size = 22 }: { name: IconName; color: string; size?: number }) {
  return <SymbolView name={name as SymbolViewProps["name"]} size={size} tintColor={color} />;
}

type Row = { label: string; icon: IconName; chevron?: boolean; onPress?: () => void };

/** One tappable row inside a section card. */
function MenuRow({ row }: { row: Row }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.label}
      onPress={row.onPress}
      className="h-[50px] flex-row items-center px-4 active:opacity-60"
    >
      <View className="w-[22px] items-center">
        <Icon name={row.icon} color={GRAY} size={20} />
      </View>
      <Text className="ml-3.5 flex-1 text-[16px] text-[#0A0A0A]">{row.label}</Text>
      {row.chevron ? <Chevron direction="right" color="#9CA3AF" size={8} style={{ marginRight: 4 }} /> : null}
    </Pressable>
  );
}

/** A titled group of rows in a rounded card. */
function Section({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <>
      <Text className="mb-2 ml-[6px] mt-5 text-[14px] font-semibold text-[#6B7280]">{title}</Text>
      <View className={`${CARD} py-0.5`}>
        {rows.map((row) => (
          <MenuRow key={row.label} row={row} />
        ))}
      </View>
    </>
  );
}

/** One column of the stats card. */
function Stat({ icon, value, label, divider }: { icon: IconName; value: number; label: string; divider?: boolean }) {
  return (
    <View className="flex-1 items-center">
      <View className="h-8 w-8 items-center justify-center rounded-full bg-[#E8F1FE]">
        <Icon name={icon} color={BLUE} size={16} />
      </View>
      <Text className="mt-2 text-[22px] font-bold text-[#0A0A0A]">{value}</Text>
      <Text className="mt-0.5 text-[14px] text-[#6B7280]">{label}</Text>
      {divider ? <View className="absolute right-0 top-3 h-10 w-px bg-[#ECEEF2]" /> : null}
    </View>
  );
}

/** Countries are the last comma-separated part of "City, Country". */
function countCountries(trips: TripRow[]) {
  const countries = new Set<string>();
  for (const trip of trips) {
    const parts = trip.destination.split(",");
    if (parts.length > 1) countries.add(parts[parts.length - 1].trim().toLowerCase());
  }
  return countries.size;
}

/** Shows the signed-in account, its travel stats, and settings/support links. */
export default function Profile() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const { signOut } = useClerk();
  const insets = useSafeAreaInsets();
  const [trips, setTrips] = useState<TripRow[]>([]);

  // Refetches on focus so the stats reflect trips just created or deleted.
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
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [getToken]),
  );

  const name = user?.fullName ?? user?.firstName ?? "Traveler";
  const email = user?.primaryEmailAddress?.emailAddress ?? "";
  const initial = name.charAt(0).toUpperCase();
  const daysAway = trips.reduce((sum, t) => sum + t.numDays, 0);

  /** Asks first, then signs out and reports any failure. */
  const handleSignOut = () => {
    const doSignOut = async () => {
      try {
        await signOut();
      } catch (err) {
        Sentry.captureException(err);
      }
    };
    if (Platform.OS === "web") {
      if (window.confirm("Are you sure you want to log out?")) void doSignOut();
      return;
    }
    Alert.alert("Log out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      { text: "Log out", style: "destructive", onPress: doSignOut },
    ]);
  };

  /** Deleting the Clerk user fires the user.deleted webhook, which removes their data. */
  const confirmDelete = () => {
    const doDelete = async () => {
      try {
        await user?.delete();
      } catch (err) {
        Sentry.captureException(err);
        Alert.alert("Couldn't delete account", "Something went wrong. Please try again.");
      }
    };
    if (Platform.OS === "web") {
      if (window.confirm("Delete your account and all your trips? This can't be undone.")) void doDelete();
      return;
    }
    Alert.alert("Delete account", "This permanently deletes your account and all your trips. This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: doDelete },
    ]);
  };

  const inviteFriends = () => {
    Share.share({ message: "Plan your next trip with Triply, the AI trip planner." }).catch((err) =>
      Sentry.captureException(err),
    );
  };

  const openLegalLink = (url: string) => {
    Linking.openURL(url).catch((err) => Sentry.captureException(err));
  };

  const account: Row[] = [
    { label: "Travel preferences", icon: { ios: "slider.horizontal.3", android: "tune", web: "tune" }, chevron: true },
    { label: "Notifications", icon: { ios: "bell", android: "notifications_none", web: "notifications_none" }, chevron: true },
    { label: "Payment methods", icon: { ios: "creditcard", android: "credit_card", web: "credit_card" }, chevron: true },
  ];
  const preferences: Row[] = [
    { label: "Settings", icon: { ios: "gearshape", android: "settings", web: "settings" }, chevron: true },
    { label: "Appearance", icon: { ios: "moon", android: "dark_mode", web: "dark_mode" }, chevron: true },
    { label: "Language", icon: { ios: "character.bubble", android: "translate", web: "translate" }, chevron: true },
  ];
  const support: Row[] = [
    {
      label: "Help & support",
      icon: { ios: "questionmark.circle", android: "help_outline", web: "help_outline" },
      onPress: () => openLegalLink(LEGAL_LINKS.support),
    },
    {
      label: "Privacy policy",
      icon: { ios: "checkmark.shield", android: "verified_user", web: "verified_user" },
      onPress: () => openLegalLink(LEGAL_LINKS.privacyPolicy),
    },
    {
      label: "Terms of service",
      icon: { ios: "doc.text", android: "description", web: "description" },
      onPress: () => openLegalLink(LEGAL_LINKS.termsOfService),
    },
    { label: "Rate Triply", icon: { ios: "star", android: "star_border", web: "star_border" } },
    {
      label: "Invite friends",
      icon: { ios: "gift", android: "card_giftcard", web: "card_giftcard" },
      chevron: true,
      onPress: inviteFriends,
    },
    // Dev-only: verifies native crash reporting actually reaches Sentry in a
    // real dev-client build (Expo Go/web have no native layer to crash).
    // `__DEV__` keeps this out of production builds entirely.
    ...(__DEV__ && Platform.OS !== "web"
      ? [
          {
            label: "Test native crash (dev only)",
            icon: { ios: "ant", android: "bug_report", web: "bug_report" },
            onPress: () => Sentry.nativeCrash(),
          } satisfies Row,
        ]
      : []),
  ];

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 16, paddingBottom: 32 }}
    >
      <Text className="mb-4 ml-1 text-[34px] font-extrabold text-[#0A0A0A]">Profile</Text>

      <View className={`${CARD} flex-row items-center px-4 py-[18px]`}>
        {user?.hasImage ? (
          <Image source={{ uri: user.imageUrl }} contentFit="cover" style={{ width: 60, height: 60, borderRadius: 30 }} />
        ) : (
          <View className="h-[60px] w-[60px] items-center justify-center rounded-full bg-[#1F5296]">
            <Text className="text-[30px] text-white">{initial}</Text>
          </View>
        )}
        <View className="ml-4 flex-1">
          <Text numberOfLines={1} className="text-[20px] font-bold text-[#0A0A0A]">
            {name}
          </Text>
          <Text numberOfLines={1} className="mt-1 text-[15px] text-[#6B7280]">
            {email}
          </Text>
        </View>
      </View>

      <View className={`${CARD} mt-4 flex-row px-2 py-[18px]`}>
        <Stat icon={{ ios: "airplane", android: "flight", web: "flight" }} value={trips.length} label="Trips" divider />
        <Stat icon={{ ios: "globe", android: "public", web: "public" }} value={countCountries(trips)} label="Countries" divider />
        <Stat icon={{ ios: "calendar", android: "calendar_month", web: "calendar_month" }} value={daysAway} label="Days away" />
      </View>

      <Section title="Account" rows={account} />
      <Section title="Preferences" rows={preferences} />
      <Section title="Support" rows={support} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Log out"
        onPress={handleSignOut}
        className="mt-5 h-[46px] flex-row items-center justify-center rounded-full border border-[#ECEEF2] bg-white active:opacity-60"
      >
        <Icon name={{ ios: "rectangle.portrait.and.arrow.right", android: "logout", web: "logout" }} color={INK} size={20} />
        <Text className="ml-2 text-[16px] font-semibold text-[#0A0A0A]">Log out</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Delete account"
        onPress={confirmDelete}
        className="mt-3 h-[46px] flex-row items-center justify-center rounded-full border border-[#ECEEF2] bg-white active:opacity-60"
      >
        <Icon name={{ ios: "trash", android: "delete_outline", web: "delete_outline" }} color={RED} size={20} />
        <Text className="ml-2 text-[16px] font-semibold text-[#DC2626]">Delete account</Text>
      </Pressable>

      <Text className="mt-6 text-center text-[14px] text-[#9CA3AF]">Triply v{Constants.expoConfig?.version ?? "1.0.0"}</Text>
    </ScrollView>
  );
}
