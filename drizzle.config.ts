import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./db/schema.ts",
  // scripts/generate.ts points this at a temp dir (see why there).
  out: process.env.DRIZZLE_OUT ?? "./db/migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL! },
  casing: "snake_case",
  strict: true,
});
