/**
 * `npm run db:migrate` — apply pending migrations in db/migrations.
 * Production deploys run it automatically ("vercel-build" in package.json).
 */
import { requireEnv } from "./env";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "../db/client";

// On Vercel this runs as part of the build ("vercel-build"). Only production
// builds migrate: preview builds must not change the production schema.
if (process.env.VERCEL && process.env.VERCEL_ENV !== "production") {
  console.log(`Skipping migrations on a ${process.env.VERCEL_ENV} build.`);
  process.exit(0);
}

// Migrations need a direct (unpooled) connection when one is available.
const url = process.env.DATABASE_URL_UNPOOLED ?? requireEnv("DATABASE_URL");
const { db, sql } = createDb(url, 1);

await migrate(db, { migrationsFolder: "db/migrations" });
console.log("Migrations applied.");
await sql.end();
