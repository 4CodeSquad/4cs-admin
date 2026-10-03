import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Builds a Drizzle client. The app uses the singleton in db/index.ts; scripts
 * and tests call this directly (they can't import "server-only" modules).
 */
export function createDb(url: string, max = 5) {
  // `prepare: false` is required behind Neon's pooled (PgBouncer) endpoint.
  const sql = postgres(url, { prepare: false, max, onnotice: () => {} });
  return { db: drizzle(sql, { schema, casing: "snake_case" }), sql };
}

export type DB = ReturnType<typeof createDb>["db"];
