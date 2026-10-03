/**
 * Recreates the test database schema from the real migrations before the run.
 * Uses TEST_DATABASE_URL (default: local `fourcs_admin_test`) — never the app DB.
 */
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../db/client";

export const TEST_URL =
  process.env.TEST_DATABASE_URL ?? `postgres://${process.env.USER}@localhost:5432/fourcs_admin_test`;

export default async function setup() {
  if (!/test/.test(TEST_URL)) throw new Error("TEST_DATABASE_URL must point at a test database");
  const { db, sql } = createDb(TEST_URL, 1);
  await sql.unsafe("drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;");
  await migrate(db, { migrationsFolder: "db/migrations" });
  await sql.end();
}
