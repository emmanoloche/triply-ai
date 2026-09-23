import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// drizzle-kit runs as a standalone CLI (npm script), not through Expo/Metro,
// so it does not get `.env` loaded automatically — `dotenv/config` does that
// here. This is the only place in the project that should read
// `process.env.DATABASE_URL` directly instead of via `src/lib/env.ts`.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("Missing required env var: DATABASE_URL");
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
