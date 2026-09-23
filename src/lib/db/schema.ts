import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
