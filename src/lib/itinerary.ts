import { z } from "zod";

// Shape Gemini must return, and the shape stored in `trips.itinerary` /
// `trips.budgetBreakdown` (jsonb). Never trust LLM JSON — this is the one
// place that decides what "valid" means; the Inngest function parses every
// Gemini response through `tripGenerationSchema` before persisting anything.

export const activityCategorySchema = z.enum([
  "food",
  "sightseeing",
  "activity",
  "transport",
  "accommodation",
  "shopping",
  "nightlife",
  "other",
]);

export const itineraryActivitySchema = z.object({
  time: z.string(), // e.g. "09:00" — free-form, Gemini-provided
  title: z.string(),
  description: z.string(),
  // .catch, not just the bare enum: Gemini occasionally invents a category
  // outside this list (confirmed — "invalid_value" on a real run) and one
  // bad enum value shouldn't fail an otherwise-good itinerary. Falls back to
  // "other" instead of rejecting the whole generation.
  category: activityCategorySchema.catch("other"),
  location: z.string().optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

export const itineraryDaySchema = z.object({
  day: z.number().int().positive(),
  title: z.string(),
  activities: z.array(itineraryActivitySchema).min(1),
});

export const budgetBreakdownSchema = z.object({
  currency: z.string().default("USD"),
  accommodation: z.number().nonnegative(),
  food: z.number().nonnegative(),
  transport: z.number().nonnegative(),
  activities: z.number().nonnegative(),
  misc: z.number().nonnegative(),
  total: z.number().nonnegative(),
});

export const hotelSuggestionSchema = z.object({
  name: z.string(),
  description: z.string(),
  priceRange: z.string(),
});

// Full shape asked of Gemini in one call — days become `trips.itinerary`,
// everything else maps to its own column/field.
export const tripGenerationSchema = z.object({
  summary: z.string(),
  days: z.array(itineraryDaySchema).min(1),
  budgetBreakdown: budgetBreakdownSchema,
  hotelSuggestions: z.array(hotelSuggestionSchema).default([]),
});

export type ItineraryDay = z.infer<typeof itineraryDaySchema>;
export type BudgetBreakdown = z.infer<typeof budgetBreakdownSchema>;
export type HotelSuggestion = z.infer<typeof hotelSuggestionSchema>;
export type TripGeneration = z.infer<typeof tripGenerationSchema>;

// Shape asked of the model when refining an already-generated trip via chat
// (src/app/api/trips/[id]/chat+api.ts). It always returns the trip's full
// state back — every field a generation produces, not a patch — whether or
// not the request actually changed anything, so a "change the destination"
// request can update everything that depends on it (itinerary, budget,
// hotels, cover photo) in one edit instead of leaving them stale.
export const chatRefineSchema = z.object({
  reply: z.string(),
  destination: z.string(),
  numDays: z.number().int().positive(),
  numTravelers: z.number().int().positive(),
  budgetTier: z.enum(["budget", "comfort", "luxury"]),
  pace: z.enum(["relaxed", "balanced", "fast"]),
  itinerary: z.array(itineraryDaySchema).min(1),
  budgetBreakdown: budgetBreakdownSchema,
  hotelSuggestions: z.array(hotelSuggestionSchema).default([]),
});

export type ChatRefineResult = z.infer<typeof chatRefineSchema>;
