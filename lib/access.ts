import { and, eq, sql, type SQL } from "drizzle-orm";
import {
  clientUsers,
  payments,
  projectLinks,
  projectMembers,
  projectNotes,
  projects,
  recurringPlans,
} from "@/db/schema";
import type { Role } from "./auth-config";

/**
 * WHO CAN SEE WHAT — the single source of truth for authorization.
 *
 *              | projects          | payments                    | notes & links       | budget
 *   admin      | all               | all                         | all                 | yes
 *   member     | assigned to them  | outgoing ones paid to them  | all on their projects | no
 *   client     | their company's   | incoming ones on those      | "client" visibility | yes
 *
 * Every query in lib/queries.ts adds one of these conditions, so a page can't
 * forget a check: it can only ever load rows the viewer is allowed to see.
 * Writes are admin-only (lib/dal.ts → requireAdmin), except team notes.
 */

export type Viewer = { id: string; role: Role };

const always = sql`true`;

/** Subquery: ids of projects the viewer may open. */
function visibleProjectIds(v: Viewer) {
  return v.role === "member"
    ? sql`(select ${projectMembers.projectId} from ${projectMembers} where ${projectMembers.userId} = ${v.id})`
    : sql`(select ${projects.id} from ${projects} where ${projects.clientId} in (select ${clientUsers.clientId} from ${clientUsers} where ${clientUsers.userId} = ${v.id}))`;
}

export function projectScope(v: Viewer): SQL {
  if (v.role === "admin") return always;
  return sql`${projects.id} in ${visibleProjectIds(v)}`;
}

export function paymentScope(v: Viewer): SQL {
  if (v.role === "admin") return always;
  if (v.role === "member") {
    return and(eq(payments.direction, "outgoing"), eq(payments.userId, v.id))!;
  }
  return and(
    eq(payments.direction, "incoming"),
    sql`${payments.projectId} in ${visibleProjectIds(v)}`,
  )!;
}

export function recurringScope(v: Viewer): SQL {
  if (v.role === "admin") return always;
  if (v.role === "member") {
    return and(eq(recurringPlans.direction, "outgoing"), eq(recurringPlans.userId, v.id))!;
  }
  return and(
    eq(recurringPlans.direction, "incoming"),
    sql`${recurringPlans.projectId} in ${visibleProjectIds(v)}`,
  )!;
}

export function noteScope(v: Viewer): SQL {
  if (v.role === "admin") return always;
  const onProject = sql`${projectNotes.projectId} in ${visibleProjectIds(v)}`;
  return v.role === "client" ? and(onProject, eq(projectNotes.visibility, "client"))! : onProject;
}

export function linkScope(v: Viewer): SQL {
  if (v.role === "admin") return always;
  const onProject = sql`${projectLinks.projectId} in ${visibleProjectIds(v)}`;
  return v.role === "client" ? and(onProject, eq(projectLinks.visibility, "client"))! : onProject;
}

/** Team members never see what a client pays for the project. */
export const canSeeBudget = (v: Viewer) => v.role !== "member";

/** Members may post team notes on their own projects; clients can't write. */
export const canAddNotes = (v: Viewer) => v.role !== "client";
