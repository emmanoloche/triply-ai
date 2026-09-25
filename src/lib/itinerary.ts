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
