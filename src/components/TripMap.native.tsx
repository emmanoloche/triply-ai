import { Camera, Map, Marker } from "@maplibre/maplibre-react-native";
import { Text, View } from "react-native";

import type { ItineraryDay } from "@/lib/itinerary";

// Free, unlimited, no API key / no billing account required — see the
// "Deferred until the native Android dev build succeeds" note in plan.md for
// why this replaced the originally-planned react-native-maps (Google Maps)
// for this project: Google requires a billing-account card to create a Maps
// API key at all, even though Android usage itself is unlimited/free, and the
// user doesn't have a card to add.
const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

type Point = { lat: number; lng: number; title: string };

/** Pulls every activity with LLM-provided coordinates out of the itinerary. */
function pointsFromItinerary(itinerary: ItineraryDay[] | null): Point[] {
  if (!itinerary) return [];
  const points: Point[] = [];
  for (const day of itinerary) {
    for (const activity of day.activities) {
      if (typeof activity.lat === "number" && typeof activity.lng === "number") {
        points.push({ lat: activity.lat, lng: activity.lng, title: activity.title });
      }
    }
  }
  return points;
}

/** A colored pin rendered as the marker's child view (MapLibre takes any RN view). */
function Pin() {
  return (
    <View
      style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: "#076FFA",
        borderWidth: 2,
        borderColor: "white",
      }}
    />
  );
}

/** Trip-detail map: pins for every itinerary activity that has coordinates. */
export function TripMap({ itinerary }: { itinerary: ItineraryDay[] | null }) {
  const points = pointsFromItinerary(itinerary);

  if (points.length === 0) {
    return (
      <View className="mt-3 h-[190px] items-center justify-center rounded-[18px]" style={{ backgroundColor: "#EEF2F6" }}>
        <Text className="text-[28px]">🗺️</Text>
        <Text className="mt-2 text-center text-[13px] text-[#9CA3AF]">No location data for this trip yet</Text>
      </View>
    );
  }

  // Centers on the first point rather than averaging — simple and good
  // enough for a single-city trip, which is all this app currently plans.
  const center: [number, number] = [points[0].lng, points[0].lat];

  return (
    <View className="mt-3 h-[190px] overflow-hidden rounded-[18px]">
      <Map style={{ flex: 1 }} mapStyle={MAP_STYLE_URL} logo={false} attribution={false}>
        <Camera center={center} zoom={12} />
        {points.map((point, i) => (
          <Marker key={`${point.title}-${i}`} id={`${point.title}-${i}`} lngLat={[point.lng, point.lat]}>
            <Pin />
          </Marker>
        ))}
      </Map>
    </View>
  );
}
