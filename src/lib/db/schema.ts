import { sql } from "drizzle-orm";
import {
  date,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  BudgetBreakdown,
  HotelSuggestion,
  ItineraryDay,
} from "@/lib/itinerary";

/**
 * Mirrors the Clerk user, kept in sync via the `user.created` webhook →
 * Inngest pipeline. Clerk stays the source of truth for identity; this row
 * lets the rest of the app (trips, etc.) join against a plain Postgres id.
 */
export const users = pgTable("users", {
  id: text("id").primaryKey(), // Clerk user id, e.g. "user_..."
  email: text("email").notNull(),
  name: text("name"),
  imageUrl: text("image_url"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // Tombstone, not a hard delete: keeps the row so an out-of-order/redelivered
  // `user.updated` webhook event can't resurrect a deleted user (see
  // sync-user-update.ts's setWhere guard and sync-user-deletion.ts). null = active.
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export const tripStatusEnum = pgEnum("trip_status", [
  "pending",
  "generating",
  "ready",
  "failed",
]);
export const budgetTierEnum = pgEnum("budget_tier", [
  "budget",
  "comfort",
  "luxury",
]);
export const travelPaceEnum = pgEnum("travel_pace", [
  "relaxed",
  "balanced",
  "fast",
]);

/**
 * One row per generation request. `itinerary`/`budgetBreakdown`/`hotelSuggestions`
 * are null until Gemini actually produces them (status flips pending → generating
 * → ready|failed; see src/lib/inngest/functions/generate-trip.ts).
 */
export const trips = pgTable(
  "trips",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    destination: text("destination").notNull(),
    startDate: date("start_date").notNull(),
    numDays: integer("num_days").notNull(),
    numTravelers: integer("num_travelers").notNull(),
    budgetTier: budgetTierEnum("budget_tier").notNull(),
    pace: travelPaceEnum("pace").notNull().default("balanced"),
    interests: jsonb("interests").$type<string[]>().notNull().default([]),
    status: tripStatusEnum("status").notNull().default("pending"),
    coverImageUrl: text("cover_image_url"),
    // Unsplash's API guidelines require crediting the photographer wherever
    // the photo is shown — see design/trip-detail-screen-design1.png's
    // "Photo by X on Unsplash" line.
    coverImageCredit: text("cover_image_credit"),
    itinerary: jsonb("itinerary").$type<ItineraryDay[]>(),
    budgetBreakdown: jsonb("budget_breakdown").$type<BudgetBreakdown>(),
    hotelSuggestions: jsonb("hotel_suggestions").$type<HotelSuggestion[]>(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // At most one in-flight generation per user, enforced by the DB so two
    // concurrent POSTs can't both pass the app-level check in api/trips+api.ts.
    uniqueIndex("trips_one_in_flight_per_user")
      .on(table.userId)
      .where(sql`${table.status} in ('pending', 'generating')`),
  ],
);

/**
 * The Home screen's "Popular destinations" row — global, not per-user.
 * Repopulated wholesale every ~2 days by a scheduled Inngest function (see
 * src/lib/inngest/functions/refresh-popular-destinations.ts): Gemini names
 * a fresh set of destinations, each gets a real photo via the same
 * Unsplash + ImageKit pipeline trips use. `rank` is the display order.
 */
export const popularDestinations = pgTable("popular_destinations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(), // e.g. "Santorini, Greece"
  imageUrl: text("image_url").notNull(),
  imageCredit: text("image_credit").notNull(),
  // Cosmetic, not sourced from anywhere real — there's no actual per-destination
  // rating data in this pipeline. Randomly assigned once per refresh (see
  // refresh-popular-destinations.ts) so the card UI has something to show,
  // same as most "popular X" UI mockups do.
  rating: real("rating").notNull(),
  rank: integer("rank").notNull(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Per-user, per-day counter backing the 20-generations/day safety cap (see
 * src/lib/usage.ts). One row per (userId, day); `count` is incremented
 * atomically on submit and decremented if generation ultimately fails, so a
 * failed generation doesn't cost the user part of their daily quota.
 */
export const generationUsage = pgTable(
  "generation_usage",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.day] })],
);
