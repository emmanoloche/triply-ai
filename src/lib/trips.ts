import type { TripCardData } from "@/components/TripCard";
import type { BudgetBreakdown } from "@/lib/itinerary";
import { titleCase } from "@/lib/text";

// Shape returned by GET /api/trips — used by both (home)/index.tsx's "Your
// trips" preview and (home)/trips.tsx's full list.
export type TripRow = {
  id: string;
  destination: string;
  numDays: number;
  coverImageUrl: string | null;
  budgetBreakdown: BudgetBreakdown | null;
};

export function toCardData(row: TripRow): TripCardData {
  const city = titleCase(row.destination.split(",")[0].trim());
  return {
    id: row.id,
    title: `${row.numDays} ${row.numDays === 1 ? "Day" : "Days"} in ${city}`,
    location: city,
    days: row.numDays,
    estimate: row.budgetBreakdown?.total ?? null,
    imageUrl: row.coverImageUrl,
  };
}
