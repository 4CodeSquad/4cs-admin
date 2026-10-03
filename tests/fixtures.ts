import { db } from "./db";
import * as s from "../db/schema";
import type { Viewer } from "../lib/access";

/**
 * Two clients, two projects, two team members and one client portal user:
 *   client X → project P1 (member A)     client Y → project P2 (member B)
 *   portal user C belongs to client X
 */
export async function seed() {
  const mk = (id: string, role: string) => ({ id, name: id, email: `${id}@test.local`, role });
  await db.insert(s.user).values([mk("admin", "admin"), mk("memberA", "member"), mk("memberB", "member"), mk("clientC", "client")]);
  await db.insert(s.clients).values([{ id: "X", name: "Client X" }, { id: "Y", name: "Client Y" }]);
  await db.insert(s.clientUsers).values({ clientId: "X", userId: "clientC" });
  await db.insert(s.projects).values([
    { id: "P1", clientId: "X", name: "P1", status: "active", budget: 500000 },
    { id: "P2", clientId: "Y", name: "P2", status: "active", budget: 900000 },
  ]);
  await db.insert(s.projectMembers).values([
    { projectId: "P1", userId: "memberA", role: "Lead" },
    { projectId: "P2", userId: "memberB", role: "Lead" },
  ]);
  const pay = (id: string, projectId: string, direction: "incoming" | "outgoing", userId: string | null) => ({
    id, projectId, direction, userId, description: id, amount: 10000, currency: "EUR" as const, dueDate: "2026-01-10",
  });
  await db.insert(s.payments).values([
    pay("in-P1", "P1", "incoming", null),
    pay("in-P2", "P2", "incoming", null),
    pay("out-A", "P1", "outgoing", "memberA"),
    pay("out-B", "P2", "outgoing", "memberB"),
    // A second payout on A's own project to someone else: A must not see it.
    pay("out-vendor-P1", "P1", "outgoing", null),
  ]);
  await db.insert(s.projectNotes).values([
    { id: "n-team", projectId: "P1", body: "internal", visibility: "team" },
    { id: "n-client", projectId: "P1", body: "for client", visibility: "client" },
    { id: "n-P2", projectId: "P2", body: "P2 note", visibility: "client" },
  ]);
  await db.insert(s.projectLinks).values([
    { id: "l-team", projectId: "P1", label: "repo", url: "https://x", visibility: "team" },
    { id: "l-client", projectId: "P1", label: "contract", url: "https://y", visibility: "client" },
  ]);
}

export const admin: Viewer = { id: "admin", role: "admin" };
export const memberA: Viewer = { id: "memberA", role: "member" };
export const memberB: Viewer = { id: "memberB", role: "member" };
export const clientC: Viewer = { id: "clientC", role: "client" };
export const stranger: Viewer = { id: "nobody", role: "member" };
