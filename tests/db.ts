import { createDb } from "../db/client";
import { TEST_URL } from "./global-setup";

export const { db, sql } = createDb(TEST_URL, 2);

export async function reset() {
  await sql.unsafe(`truncate audit_log, project_links, project_notes, payments, recurring_plans,
    project_members, projects, client_users, clients, two_factor, verification, account, session, "user" cascade`);
}
