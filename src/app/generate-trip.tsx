import { useAuth } from "@clerk/expo";
import * as Sentry from "@sentry/react-native";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Chevron } from "@/components/Chevron";

// UI from design/generate-trip-design1.png and generate-trip-design2.png.
// Submitting posts to /api/trips, which fires the Inngest generation job —
// see plan.md Phase 3.

const BLUE = "#076FFA";
const BORDER = "#E5E7EB";
const MUTED = "#6B7280";
const PLACEHOLDER = "#9CA3AF";

type BudgetTier = "budget" | "comfort" | "luxury";
type TravelPace = "relaxed" | "balanced" | "fast";

const BUDGET_OPTIONS: { key: BudgetTier; label: string }[] = [
  { key: "budget", label: "Budget" },
  { key: "comfort", label: "Comfort" },
  { key: "luxury", label: "Luxury" },
];

const PACE_OPTIONS: { key: TravelPace; label: string }[] = [
  { key: "relaxed", label: "Relaxed" },
  { key: "balanced", label: "Balanced" },
  { key: "fast", label: "Fast-paced" },
];

const INTEREST_OPTIONS = [
  "Adventure",
  "Beaches",
  "Food & drink",
  "Culture",
  "Nature",
  "Nightlife",
  "Shopping",
  "History",
  "Relaxation",
  "Road trips",
];

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function isBeforeToday(year: number, month: number, day: number, today: Date): boolean {
  const cell = new Date(year, month, day).getTime();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return cell < startOfToday;
}

type DayCell = { day: number; key: string } | null;

function getMonthWeeks(year: number, month: number): DayCell[][] {
  const startWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: DayCell[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push({ day, key: `${year}-${month}-${day}` });
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: DayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <View className="mt-3 flex-row gap-2">
      {options.map((opt) => {
        const selected = opt.key === value;
        return (
          <Pressable
            key={opt.key}
            accessibilityRole="button"
            accessibilityLabel={opt.label}
            onPress={() => onChange(opt.key)}
            className="h-11 flex-1 items-center justify-center rounded-full border active:opacity-90"
            style={{
              borderColor: selected ? "transparent" : BORDER,
              backgroundColor: selected ? BLUE : "transparent",
            }}
          >
            <Text className="text-[15px] font-semibold" style={{ color: selected ? "#FFFFFF" : MUTED }}>
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function GenerateTrip() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();

  const [destination, setDestination] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [startDay, setStartDay] = useState<number | null>(today.getDate());
  const [endDay, setEndDay] = useState<number | null>(null);

  const [budget, setBudget] = useState<BudgetTier>("comfort");
  const [travelers, setTravelers] = useState(2);
  const [interests, setInterests] = useState<string[]>(["Beaches", "Food & drink"]);
  const [pace, setPace] = useState<TravelPace>("relaxed");

  const weeks = getMonthWeeks(viewYear, viewMonth);
  const isViewingCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();

  const goPrevMonth = () => {
    if (isViewingCurrentMonth) return;
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const goNextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const handleDayPress = (day: number) => {
    if (isBeforeToday(viewYear, viewMonth, day, today)) return;
    if (startDay === null || endDay !== null) {
      setStartDay(day);
      setEndDay(null);
      return;
    }
    if (day === startDay) {
      setStartDay(null);
      return;
    }
    if (day < startDay) {
      setStartDay(day);
      return;
    }
    setEndDay(day);
  };

  const toggleInterest = (interest: string) => {
    setInterests((prev) =>
      prev.includes(interest) ? prev.filter((i) => i !== interest) : [...prev, interest],
    );
  };

  const isFormValid = destination.trim().length > 0;

  const handleGenerate = async () => {
    if (!isFormValid || submitting) return;
    setSubmitting(true);
    try {
      // startDay can be null if the user deselected it (tapped it again) —
      // fall back to today's real date rather than crash, since the submit
      // button is only gated on destination, not on a date being picked.
      const effectiveYear = startDay !== null ? viewYear : today.getFullYear();
      const effectiveMonth = startDay !== null ? viewMonth : today.getMonth();
      const effectiveDay = startDay ?? today.getDate();
      const numDays = startDay !== null && endDay ? endDay - startDay + 1 : 1;
      const startDateStr = `${effectiveYear}-${String(effectiveMonth + 1).padStart(2, "0")}-${String(effectiveDay).padStart(2, "0")}`;

      const token = await getToken();
      const res = await fetch("/api/trips", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          destination: destination.trim(),
          startDate: startDateStr,
          numDays,
          numTravelers: travelers,
          budgetTier: budget,
          pace,
          interests,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }

      const { id, reused } = (await res.json()) as { id: string; reused: boolean };
      if (reused) {
        // The server found a trip already pending/generating for this user
        // and returned that one instead of starting a second — this form's
        // data was never used, so say so rather than silently redirecting
        // to what might look like the wrong trip.
        Alert.alert(
          "Already generating a trip",
          "You already have a trip being generated. Showing that one instead of starting a new one.",
        );
      }
      router.replace(`/trip-loading?id=${id}`);
    } catch (err) {
      Sentry.captureException(err);
      Alert.alert("Couldn't start generation", err instanceof Error ? err.message : "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const dateRangeLabel =
    startDay === null
      ? "Select your dates"
      : `${MONTH_NAMES[viewMonth].slice(0, 3)} ${startDay}${endDay ? ` – ${MONTH_NAMES[viewMonth].slice(0, 3)} ${endDay}` : ""}`;

  return (
    <View className="flex-1 bg-white">
      <View
        className="flex-row items-center px-4 pb-3"
        style={{ paddingTop: insets.top + 8 }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          onPress={() => router.back()}
          className="h-9 w-9 items-center justify-center rounded-full bg-[#F1F2F4] active:opacity-80"
        >
          <Chevron direction="left" style={{ marginLeft: 2 }} />
        </Pressable>
        <Text className="flex-1 text-center text-[17px] font-bold text-[#0A0A0A]" style={{ marginRight: 36 }}>
          Plan a trip
        </Text>
      </View>

      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mt-2 flex-row items-start rounded-[20px] border p-4" style={{ borderColor: BORDER }}>
          <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: BLUE }}>
            <Text className="text-[16px] text-white">✨</Text>
          </View>
          <View className="ml-3 flex-1">
            <Text className="text-[16px] font-bold text-[#0A0A0A]">Hi! I&apos;m your AI travel assistant.</Text>
            <Text className="mt-1 text-[14px] leading-[20px]" style={{ color: MUTED }}>
              Tell me a few details and I&apos;ll craft a day-by-day itinerary.
            </Text>
          </View>
        </View>

        <Text className="mt-6 text-[17px] font-bold text-[#0A0A0A]">Where to?</Text>
        <View
          className="mt-3 h-[52px] flex-row items-center rounded-full border px-4"
          style={{ borderColor: BORDER }}
        >
          <Text className="text-[16px]">📍</Text>
          <TextInput
            value={destination}
            onChangeText={setDestination}
            placeholder="e.g. Tokyo, Japan"
            placeholderTextColor={PLACEHOLDER}
            className="ml-2 flex-1 text-[15px] text-[#0A0A0A]"
          />
        </View>
        <Text className="ml-1 mt-1.5 text-[12px]" style={{ color: PLACEHOLDER }}>
          Format: City, Country
        </Text>

        <Text className="mt-6 text-[17px] font-bold text-[#0A0A0A]">When?</Text>
        <View className="mt-3 rounded-[20px] border p-4" style={{ borderColor: BORDER }}>
          <View className="flex-row items-center">
            <Text className="text-[15px]">📅</Text>
            <Text
              className="ml-2 text-[15px]"
              style={{ color: startDay === null ? PLACEHOLDER : "#0A0A0A" }}
            >
              {dateRangeLabel}
            </Text>
          </View>

          <View className="mt-4 flex-row items-center justify-between">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              disabled={isViewingCurrentMonth}
              onPress={goPrevMonth}
              className="h-8 w-8 items-center justify-center rounded-full bg-[#F1F2F4] active:opacity-80"
              style={{ opacity: isViewingCurrentMonth ? 0.35 : 1 }}
            >
              <Chevron direction="left" style={{ marginLeft: 2 }} />
            </Pressable>
            <Text className="text-[16px] font-bold text-[#0A0A0A]">
              {MONTH_NAMES[viewMonth]} {viewYear}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next month"
              onPress={goNextMonth}
              className="h-8 w-8 items-center justify-center rounded-full bg-[#F1F2F4] active:opacity-80"
            >
              <Chevron direction="right" style={{ marginLeft: -2 }} />
            </Pressable>
          </View>

          <View className="mt-4 flex-row">
            {WEEKDAY_LABELS.map((label, i) => (
              <Text key={i} className="flex-1 text-center text-[12px] font-medium" style={{ color: PLACEHOLDER }}>
                {label}
              </Text>
            ))}
          </View>

          {weeks.map((week, wi) => (
            <View key={wi} className="mt-1.5 flex-row">
              {week.map((cell, di) => {
                if (!cell) return <View key={di} className="h-9 flex-1" />;

                const { day } = cell;
                const isStart = day === startDay;
                const isEnd = day === endDay;
                const isEndpoint = isStart || isEnd;
                const isInRange = startDay !== null && endDay !== null && day > startDay && day < endDay;
                const isPast = isBeforeToday(viewYear, viewMonth, day, today);

                return (
                  <View key={di} className="h-9 flex-1 items-center justify-center">
                    {isInRange && (
                      <View
                        pointerEvents="none"
                        className="absolute inset-y-0 left-0 right-0"
                        style={{ backgroundColor: "#DCE9FF" }}
                      />
                    )}
                    {isEnd && (
                      <View
                        pointerEvents="none"
                        className="absolute inset-y-0 left-0 right-1/2"
                        style={{ backgroundColor: "#DCE9FF" }}
                      />
                    )}
                    {isStart && endDay !== null && (
                      <View
                        pointerEvents="none"
                        className="absolute inset-y-0 left-1/2 right-0"
                        style={{ backgroundColor: "#DCE9FF" }}
                      />
                    )}

                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Select day ${day}`}
                      disabled={isPast}
                      onPress={() => handleDayPress(day)}
                      className="h-8 w-8 items-center justify-center rounded-full active:opacity-80"
                      style={{ backgroundColor: isEndpoint ? BLUE : "transparent" }}
                    >
                      <Text
                        className="text-[14px]"
                        style={{
                          color: isPast ? "#D1D5DB" : isEndpoint ? "#FFFFFF" : isInRange ? BLUE : "#0A0A0A",
                          fontWeight: isEndpoint ? "700" : "400",
                        }}
                      >
                        {day}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ))}
        </View>

        <Text className="mt-6 text-[17px] font-bold text-[#0A0A0A]">Budget (per person)</Text>
        <SegmentedControl options={BUDGET_OPTIONS} value={budget} onChange={setBudget} />

        <Text className="mt-6 text-[17px] font-bold text-[#0A0A0A]">Travelers</Text>
        <View
          className="mt-3 h-[56px] flex-row items-center justify-between rounded-full border px-4"
          style={{ borderColor: BORDER }}
        >
          <View className="flex-row items-center">
            <Text className="text-[16px]">👥</Text>
            <Text className="ml-2 text-[15px] text-[#0A0A0A]">
              {travelers} {travelers === 1 ? "traveler" : "travelers"}
            </Text>
          </View>
          <View className="flex-row items-center gap-2.5">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Decrease travelers"
              disabled={travelers <= 1}
              onPress={() => setTravelers((t) => Math.max(1, t - 1))}
              className="h-8 w-8 items-center justify-center rounded-full bg-[#F1F2F4] active:opacity-80"
              style={{ opacity: travelers <= 1 ? 0.4 : 1 }}
            >
              <Text className="text-[18px] text-[#0A0A0A]">−</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Increase travelers"
              disabled={travelers >= 10}
              onPress={() => setTravelers((t) => Math.min(10, t + 1))}
              className="h-8 w-8 items-center justify-center rounded-full bg-[#F1F2F4] active:opacity-80"
              style={{ opacity: travelers >= 10 ? 0.4 : 1 }}
            >
              <Text className="text-[18px] text-[#0A0A0A]">+</Text>
            </Pressable>
          </View>
        </View>

        <Text className="mt-6 text-[17px] font-bold text-[#0A0A0A]">Interests</Text>
        <View className="mt-3 flex-row flex-wrap gap-2">
          {INTEREST_OPTIONS.map((interest) => {
            const selected = interests.includes(interest);
            return (
              <Pressable
                key={interest}
                accessibilityRole="button"
                accessibilityLabel={interest}
                onPress={() => toggleInterest(interest)}
                className="h-10 items-center justify-center rounded-full border px-4 active:opacity-90"
                style={{ borderColor: selected ? "transparent" : BORDER, backgroundColor: selected ? BLUE : "transparent" }}
              >
                <Text className="text-[14px] font-medium" style={{ color: selected ? "#FFFFFF" : MUTED }}>
                  {interest}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text className="mt-6 text-[17px] font-bold text-[#0A0A0A]">Travel pace</Text>
        <SegmentedControl options={PACE_OPTIONS} value={pace} onChange={setPace} />
      </ScrollView>

      {/* Pinned footer — always visible without scrolling, unlike the rest of
          the form. Faint/disabled until the required fields are filled in;
          "required" is just the destination for now (a placeholder rule —
          revisit once real submission/validation is implemented). */}
      <View className="border-t px-5 pt-3" style={{ borderColor: BORDER, paddingBottom: insets.bottom + 12 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Generate my trip"
          disabled={!isFormValid || submitting}
          onPress={handleGenerate}
          className="h-[54px] flex-row items-center justify-center rounded-full active:opacity-90"
          style={{ backgroundColor: BLUE, opacity: isFormValid ? 1 : 0.4 }}
        >
          {submitting ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <>
              <Text className="text-[16px] text-white">✨</Text>
              <Text className="ml-2 text-[16px] font-bold text-white">Generate My Trip</Text>
            </>
          )}
        </Pressable>
      </View>
    </View>
  );
}
