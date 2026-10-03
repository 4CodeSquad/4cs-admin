import { and, asc, desc, eq, gte, lt, lte, ne, sql, type SQL } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  auditLog,
  clients,
  clientUsers,
  payments,
  projectLinks,
  projectMembers,
  projectNotes,
  projects,
  recurringPlans,
  user,
} from "@/db/schema";
import {
  canSeeBudget,
  linkScope,
  noteScope,
  paymentScope,
  projectScope,
  recurringScope,
  type Viewer,
} from "./access";
import { addDays } from "./dates";

/*
 * Every read the app makes. Each function takes the viewer and applies the
 * matching scope from lib/access.ts — there is no unscoped variant.
 */

export type PaymentFilter = "open" | "overdue" | "paid" | "all";

const paymentFilterSql = (f: PaymentFilter, today: string): SQL | undefined => {
  switch (f) {
    case "open":
      return eq(payments.status, "pending");
    case "overdue":
      return and(eq(payments.status, "pending"), lt(payments.dueDate, today));
    case "paid":
      return eq(payments.status, "paid");
    case "all":
      return undefined;
  }
};

const paymentColumns = {
  id: payments.id,
  projectId: payments.projectId,
  projectName: projects.name,
  direction: payments.direction,
  userId: payments.userId,
  payeeName: user.name,
  counterparty: payments.counterparty,
  description: payments.description,
  amount: payments.amount,
  currency: payments.currency,
  status: payments.status,
  dueDate: payments.dueDate,
  paidOn: payments.paidOn,
  method: payments.method,
  reference: payments.reference,
  recurringPlanId: payments.recurringPlanId,
};

export async function listPayments(
  db: DB,
  v: Viewer,
  opts: { filter?: PaymentFilter; projectId?: string; today: string },
) {
  const filter = opts.filter ?? "open";
  return db
    .select(paymentColumns)
    .from(payments)
    .innerJoin(projects, eq(projects.id, payments.projectId))
    .leftJoin(user, eq(user.id, payments.userId))
    .where(
      and(
        paymentScope(v),
        paymentFilterSql(filter, opts.today),
        opts.projectId ? eq(payments.projectId, opts.projectId) : undefined,
      ),
    )
    .orderBy(filter === "paid" ? desc(payments.paidOn) : asc(payments.dueDate))
    .limit(500);
}

export async function listProjects(db: DB, v: Viewer, status?: string) {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      clientId: projects.clientId,
      clientName: clients.name,
      startDate: projects.startDate,
      dueDate: projects.dueDate,
      budget: projects.budget,
      currency: projects.currency,
    })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(
      and(
        projectScope(v),
        status && status !== "all"
          ? eq(projects.status, status as "active")
          : status === "all"
            ? undefined
            : ne(projects.status, "cancelled"),
      ),
    )
    .orderBy(asc(projects.status), asc(projects.name));
  return rows.map((r) => (canSeeBudget(v) ? r : { ...r, budget: null }));
}

/** Null when the project doesn't exist *or* the viewer may not see it. */
export async function getProject(db: DB, v: Viewer, id: string, today: string) {
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      description: projects.description,
      clientId: projects.clientId,
      clientName: clients.name,
      startDate: projects.startDate,
      dueDate: projects.dueDate,
      budget: projects.budget,
      currency: projects.currency,
    })
    .from(projects)
    .innerJoin(clients, eq(clients.id, projects.clientId))
    .where(and(eq(projects.id, id), projectScope(v)));
  if (!project) return null;

  const [members, paymentRows, plans, notes, links] = await Promise.all([
    db
      .select({ userId: user.id, name: user.name, email: user.email, role: projectMembers.role })
      .from(projectMembers)
      .innerJoin(user, eq(user.id, projectMembers.userId))
      .where(eq(projectMembers.projectId, id))
      .orderBy(asc(user.name)),
    listPayments(db, v, { filter: "all", projectId: id, today }),
    db
      .select({
        id: recurringPlans.id,
        direction: recurringPlans.direction,
        payeeName: user.name,
        description: recurringPlans.description,
        amount: recurringPlans.amount,
        currency: recurringPlans.currency,
        interval: recurringPlans.interval,
        startDate: recurringPlans.startDate,
        endDate: recurringPlans.endDate,
        nextDueDate: recurringPlans.nextDueDate,
        active: recurringPlans.active,
      })
      .from(recurringPlans)
      .leftJoin(user, eq(user.id, recurringPlans.userId))
      .where(and(eq(recurringPlans.projectId, id), recurringScope(v)))
      .orderBy(desc(recurringPlans.active), asc(recurringPlans.nextDueDate)),
    db
      .select({
        id: projectNotes.id,
        body: projectNotes.body,
        visibility: projectNotes.visibility,
        createdAt: projectNotes.createdAt,
        authorName: user.name,
      })
      .from(projectNotes)
      .leftJoin(user, eq(user.id, projectNotes.authorId))
      .where(and(eq(projectNotes.projectId, id), noteScope(v)))
      .orderBy(desc(projectNotes.createdAt)),
    db
      .select()
      .from(projectLinks)
      .where(and(eq(projectLinks.projectId, id), linkScope(v)))
      .orderBy(asc(projectLinks.label)),
  ]);

  return {
    ...project,
    budget: canSeeBudget(v) ? project.budget : null,
    members,
    payments: paymentRows,
    plans,
    notes,
    links,
  };
}

/** Sums of pending payments per currency, split into overdue / not yet due. */
async function outstanding(db: DB, v: Viewer, direction: "incoming" | "outgoing", today: string) {
  return db
    .select({
      currency: payments.currency,
      total: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint`.mapWith(Number),
      overdue: sql<number>`coalesce(sum(${payments.amount}) filter (where ${payments.dueDate} < ${today}), 0)::bigint`.mapWith(Number),
      count: sql<number>`count(*)`.mapWith(Number),
    })
    .from(payments)
    .where(and(paymentScope(v), eq(payments.direction, direction), eq(payments.status, "pending")))
    .groupBy(payments.currency);
}

export async function dashboard(db: DB, v: Viewer, today: string) {
  const [activeProjects, incoming, outgoing, upcoming, paidThisYear] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(projects)
      .where(and(projectScope(v), eq(projects.status, "active"))),
    v.role === "member" ? Promise.resolve([]) : outstanding(db, v, "incoming", today),
    v.role === "client" ? Promise.resolve([]) : outstanding(db, v, "outgoing", today),
    db
      .select(paymentColumns)
      .from(payments)
      .innerJoin(projects, eq(projects.id, payments.projectId))
      .leftJoin(user, eq(user.id, payments.userId))
      .where(
        and(
          paymentScope(v),
          eq(payments.status, "pending"),
          lte(payments.dueDate, addDays(today, 30)),
        ),
      )
      .orderBy(asc(payments.dueDate))
      .limit(20),
    db
      .select({
        currency: payments.currency,
        total: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint`.mapWith(Number),
      })
      .from(payments)
      .where(
        and(
          paymentScope(v),
          eq(payments.status, "paid"),
          gte(payments.paidOn, `${today.slice(0, 4)}-01-01`),
        ),
      )
      .groupBy(payments.currency),
  ]);
  return {
    activeProjects: activeProjects[0]?.n ?? 0,
    incoming,
    outgoing,
    upcoming,
    paidThisYear,
  };
}

/* ------------------------------------------------------- admin-only reads --
 * Callers must have passed requireAdmin(); these are not role-scoped.
 */

export async function listClients(db: DB) {
  return db
    .select({
      id: clients.id,
      name: clients.name,
      contactName: clients.contactName,
      email: clients.email,
      phone: clients.phone,
      archived: clients.archived,
      projectCount: sql<number>`(select count(*) from ${projects} where ${projects.clientId} = ${clients.id})`.mapWith(Number),
    })
    .from(clients)
    .orderBy(asc(clients.archived), asc(clients.name));
}

export async function getClient(db: DB, id: string) {
  const client = await db.query.clients.findFirst({ where: eq(clients.id, id) });
  if (!client) return null;
  const [clientProjects, portalUsers] = await Promise.all([
    db.select().from(projects).where(eq(projects.clientId, id)).orderBy(asc(projects.name)),
    db
      .select({ id: user.id, name: user.name, email: user.email })
      .from(clientUsers)
      .innerJoin(user, eq(user.id, clientUsers.userId))
      .where(eq(clientUsers.clientId, id)),
  ]);
  return { ...client, projects: clientProjects, portalUsers };
}

export async function listUsers(db: DB) {
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      banned: user.banned,
      twoFactorEnabled: user.twoFactorEnabled,
      createdAt: user.createdAt,
    })
    .from(user)
    .orderBy(asc(user.role), asc(user.name));
}

export async function listAudit(db: DB, limit = 100) {
  return db
    .select({
      id: auditLog.id,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      summary: auditLog.summary,
      createdAt: auditLog.createdAt,
      actorName: user.name,
    })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.actorId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}
