import "server-only";
import { createDb, type DB } from "./client";

/**
 * The app's one connection pool per server instance. On Vercel, DATABASE_URL
 * must be Neon's *pooled* connection string (the host contains "-pooler").
 */
const globalForDb = globalThis as unknown as { db?: DB };

export const db: DB = globalForDb.db ?? createDb(process.env.DATABASE_URL!).db;

if (process.env.NODE_ENV !== "production") globalForDb.db = db;

export type { DB };
