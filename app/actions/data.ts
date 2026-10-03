"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  clients,
  clientUsers,
  fundEntries,
  payments,
  projectShares,
  projectLinks,
  projectMembers,
  projectNotes,
  projects,
  recurringPlans,
  user,
} from "@/db/schema";
import { requireAdmin, requireUser } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { canAddNotes, projectScope } from "@/lib/access";
import {
  deletePaymentSafely,
  markPaymentPaid,
  markPaymentPending,
  MoneyFlowError,
  validateSplit,
  BP,
} from "@/lib/money-flow";
import { today } from "@/lib/dates";
import {
  amount,
  currency,
  date,
  optAmount,
  optDate,
  optEmail,
  optText,
  parseForm,
  text,
  url,
  type FormState,
} from "@/lib/validation";

/*
 * Every write in the app. Each action re-checks the session itself — a server
 * action is a public HTTP endpoint, so the page that rendered the form proves
 * nothing. Everything is admin-only except posting team notes.
 */

const done = (msg = "Saved.") => {
  revalidatePath("/", "layout");
  return { ok: msg } satisfies FormState;
};
const fail = (e: unknown): FormState => {
  console.error(e);
  return { error: "Couldn't save. Check the values and try again." };
};

/* ---------------------------------------------------------------- clients */

const clientSchema = z.object({
  id: z.string().optional(),
  name: text(),
  contactName: optText(200),
  email: optEmail,
  phone: optText(50),
  address: optText(300),
  nipt: optText(20),
  notes: optText(5000),
});

export async function saveClient(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const { success, data, error } = parseForm(clientSchema, fd);
  if (!success) return { error };
  const { id, ...values } = data;
  let clientId = id;
  try {
    if (id) {
      await db.update(clients).set(values).where(eq(clients.id, id));
    } else {
      [{ id: clientId }] = await db.insert(clients).values(values).returning({ id: clients.id });
    }
    await audit(db, me.id, id ? "update" : "create", "client", clientId!, values.name);
  } catch (e) {
    return fail(e);
  }
  if (!id) redirect(`/clients/${clientId}`);
  return done();
}

export async function setClientArchived(clientId: string, archived: boolean) {
  const me = await requireAdmin();
  await db.update(clients).set({ archived }).where(eq(clients.id, clientId));
  await audit(db, me.id, archived ? "archive" : "unarchive", "client", clientId);
  revalidatePath("/", "layout");
}

/** Give a client-role user access to this client's projects. */
export async function linkPortalUser(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const clientId = String(fd.get("clientId"));
  const userId = String(fd.get("userId"));
  const [u] = await db.select({ role: user.role }).from(user).where(eq(user.id, userId));
  if (u?.role !== "client") return { error: "Only users with the Client role can be linked." };
  await db.insert(clientUsers).values({ clientId, userId }).onConflictDoNothing();
  await audit(db, me.id, "link-user", "client", clientId, userId);
  return done("Access granted.");
}

export async function unlinkPortalUser(clientId: string, userId: string) {
  const me = await requireAdmin();
  await db.delete(clientUsers).where(and(eq(clientUsers.clientId, clientId), eq(clientUsers.userId, userId)));
  await audit(db, me.id, "unlink-user", "client", clientId, userId);
  revalidatePath("/", "layout");
}

/* --------------------------------------------------------------- projects */

const projectSchema = z.object({
  id: z.string().optional(),
  clientId: z.string().min(1, "Choose a client"),
  name: text(),
  status: z.enum(["lead", "active", "paused", "completed", "cancelled"]),
  description: optText(10000),
  startDate: optDate,
  dueDate: optDate,
  budget: optAmount,
  currency,
});

export async function saveProject(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const { success, data, error } = parseForm(projectSchema, fd);
  if (!success) return { error };
  const { id, ...v } = data;
  const values = {
    ...v,
    description: v.description ?? null,
    startDate: v.startDate ?? null,
    dueDate: v.dueDate ?? null,
    budget: v.budget ?? null,
  };
  let projectId = id;
  try {
    if (id) {
      await db.update(projects).set(values).where(eq(projects.id, id));
    } else {
      [{ id: projectId }] = await db.insert(projects).values(values).returning({ id: projects.id });
    }
    await audit(db, me.id, id ? "update" : "create", "project", projectId!, values.name);
  } catch (e) {
    return fail(e);
  }
  redirect(`/projects/${projectId}`);
}

export async function addMember(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const { success, data, error } = parseForm(
    z.object({ projectId: z.string(), userId: z.string().min(1, "Choose a person"), role: optText(100) }),
    fd,
  );
  if (!success) return { error };
  await db
    .insert(projectMembers)
    .values({ projectId: data.projectId, userId: data.userId, role: data.role ?? null })
    .onConflictDoUpdate({
      target: [projectMembers.projectId, projectMembers.userId],
      set: { role: data.role ?? null },
    });
  await audit(db, me.id, "add-member", "project", data.projectId, data.userId);
  return done("Added to the team.");
}

export async function removeMember(projectId: string, userId: string) {
  const me = await requireAdmin();
  await db
    .delete(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)));
  await audit(db, me.id, "remove-member", "project", projectId, userId);
  revalidatePath("/", "layout");
}

/** Admins and the project's own team can post notes; only admins can share with the client. */
export async function addNote(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser();
  if (!canAddNotes(me)) return { error: "Not allowed." };
  const { success, data, error } = parseForm(
    z.object({ projectId: z.string(), body: text(10000), visibility: z.enum(["team", "client"]).default("team") }),
    fd,
  );
  if (!success) return { error };
  const [visible] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, data.projectId), projectScope(me)));
  if (!visible) return { error: "Not allowed." };
  const visibility = me.role === "admin" ? data.visibility : "team";
  await db.insert(projectNotes).values({ projectId: data.projectId, body: data.body, visibility, authorId: me.id });
  await audit(db, me.id, "add-note", "project", data.projectId);
  return done("Note added.");
}

export async function deleteNote(noteId: string) {
  const me = await requireAdmin();
  await db.delete(projectNotes).where(eq(projectNotes.id, noteId));
  await audit(db, me.id, "delete-note", "note", noteId);
  revalidatePath("/", "layout");
}

export async function addLink(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const { success, data, error } = parseForm(
    z.object({ projectId: z.string(), label: text(200), url, visibility: z.enum(["team", "client"]) }),
    fd,
  );
  if (!success) return { error };
  await db.insert(projectLinks).values(data);
  await audit(db, me.id, "add-link", "project", data.projectId, data.label);
  return done("Link added.");
}

export async function deleteLink(linkId: string) {
  const me = await requireAdmin();
  await db.delete(projectLinks).where(eq(projectLinks.id, linkId));
  await audit(db, me.id, "delete-link", "link", linkId);
  revalidatePath("/", "layout");
}

/* --------------------------------------------------------------- payments */

const paymentSchema = z
  .object({
    id: z.string().optional(),
    projectId: z.string().min(1),
    direction: z.enum(["incoming", "outgoing"]),
    userId: optText(100),
    counterparty: optText(200),
    description: text(300),
    amount,
    currency,
    dueDate: date,
    status: z.enum(["pending", "paid", "cancelled"]).default("pending"),
    paidOn: optDate,
    method: optText(100),
    reference: optText(200),
  })
  .refine((p) => p.direction === "outgoing" || (!p.userId && !p.counterparty), {
    message: "Incoming payments come from the client — leave payee empty.",
    path: ["userId"],
  });

export async function savePayment(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const { success, data, error } = parseForm(paymentSchema, fd);
  if (!success) return { error };
  const { id, status, paidOn, ...v } = data;
  void id; // payments are created here, never edited (undo + re-add instead)
  try {
    const [created] = await db
      .insert(payments)
      .values({
        ...v,
        userId: v.direction === "outgoing" ? (v.userId ?? null) : null,
        counterparty: v.direction === "outgoing" ? (v.counterparty ?? null) : null,
        method: v.method ?? null,
        reference: v.reference ?? null,
        status: status === "cancelled" ? "cancelled" : "pending",
        createdById: me.id,
      })
      .returning({ id: payments.id });
    // "Already paid" goes through the same flow as the Mark paid button, so the
    // split and the company fund are updated.
    if (status === "paid") {
      try {
        await markPaymentPaid(db, created.id, paidOn ?? today(), me.id);
      } catch (e) {
        await db.delete(payments).where(eq(payments.id, created.id));
        throw e;
      }
    }
    await audit(db, me.id, "create", "payment", created.id, `${v.description} ${v.amount} ${v.currency}${status === "paid" ? " (paid)" : ""}`);
  } catch (e) {
    if (e instanceof MoneyFlowError) return { error: e.message };
    return fail(e);
  }
  return done();
}

/*
 * Paid / unpaid / delete go through lib/money-flow.ts, which also creates or
 * removes the members' shares and the company-fund entry. Bound to buttons, so
 * they take the id only and return { error } instead of throwing.
 */
async function moneyAction(fn: () => Promise<unknown>): Promise<FormState> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof MoneyFlowError) return { error: e.message };
    throw e;
  }
  revalidatePath("/", "layout");
  return undefined;
}

export async function markPaid(paymentId: string) {
  const me = await requireAdmin();
  return moneyAction(async () => {
    await markPaymentPaid(db, paymentId, today(), me.id);
    await audit(db, me.id, "mark-paid", "payment", paymentId, today());
  });
}

export async function markPending(paymentId: string) {
  const me = await requireAdmin();
  return moneyAction(async () => {
    await markPaymentPending(db, paymentId);
    await audit(db, me.id, "mark-pending", "payment", paymentId);
  });
}

export async function deletePayment(paymentId: string) {
  const me = await requireAdmin();
  return moneyAction(async () => {
    await deletePaymentSafely(db, paymentId);
    await audit(db, me.id, "delete", "payment", paymentId);
  });
}

/* ------------------------------------------------------- money split */

/**
 * Sets one member's share of a project: a percentage of each client payment,
 * or a fixed total paid out as the client pays. Applies to payments marked
 * paid from now on.
 */
export async function setShare(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const { success, data, error } = parseForm(
    z.object({
      projectId: z.string(),
      userId: z.string().min(1, "Choose a person"),
      kind: z.enum(["percent", "fixed"]),
      value: z.string().min(1, "Enter a value"),
    }),
    fd,
  );
  if (!success) return { error };
  const [project] = await db.select().from(projects).where(eq(projects.id, data.projectId));
  if (!project) return { error: "Project not found." };

  let share: { userId: string; kind: "percent" | "fixed"; basisPoints: number | null; amount: number | null };
  if (data.kind === "percent") {
    const pct = Number(data.value.replace(",", ".").replace("%", "").trim());
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return { error: "Percentage must be between 0 and 100." };
    share = { userId: data.userId, kind: "percent", basisPoints: Math.round(pct * 100), amount: null };
  } else {
    const parsed = amount.safeParse(data.value);
    if (!parsed.success || parsed.data <= 0) return { error: "Not a valid amount." };
    share = { userId: data.userId, kind: "fixed", basisPoints: null, amount: parsed.data };
  }

  const others = await db.select().from(projectShares).where(eq(projectShares.projectId, data.projectId));
  const next = [...others.filter((o) => o.userId !== share.userId), share];
  const invalid = validateSplit(next, project.budget);
  if (invalid) return { error: invalid };

  await db
    .insert(projectShares)
    .values({ projectId: data.projectId, ...share })
    .onConflictDoUpdate({
      target: [projectShares.projectId, projectShares.userId],
      set: { kind: share.kind, basisPoints: share.basisPoints, amount: share.amount },
    });
  await audit(db, me.id, "set-share", "project", data.projectId,
    `${data.userId}: ${share.kind === "percent" ? `${share.basisPoints! / (BP / 100)}%` : `${share.amount} ${project.currency}`}`);
  return done("Share saved. It applies to client payments marked paid from now on.");
}

export async function removeShare(projectId: string, userId: string) {
  const me = await requireAdmin();
  await db.delete(projectShares).where(and(eq(projectShares.projectId, projectId), eq(projectShares.userId, userId)));
  await audit(db, me.id, "remove-share", "project", projectId, userId);
  revalidatePath("/", "layout");
}

/* ------------------------------------------------------- company fund */

export async function addFundEntry(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const { success, data, error } = parseForm(
    z.object({
      direction: z.enum(["in", "out"]),
      amount,
      currency,
      entryDate: date,
      category: text(100),
      description: text(1000),
      projectId: optText(100),
    }),
    fd,
  );
  if (!success) return { error };
  if (data.amount <= 0) return { error: "Amount must be more than zero." };
  const [e] = await db
    .insert(fundEntries)
    .values({ ...data, projectId: data.projectId ?? null, createdById: me.id })
    .returning({ id: fundEntries.id });
  await audit(db, me.id, data.direction === "in" ? "fund-in" : "fund-out", "fund", e.id, `${data.description} ${data.amount} ${data.currency}`);
  return done(data.direction === "in" ? "Added to the fund." : "Expense recorded.");
}

/** Only hand-made entries; automatic ones follow their payment (undo it instead). */
export async function deleteFundEntry(entryId: string): Promise<FormState> {
  const me = await requireAdmin();
  const [e] = await db.select().from(fundEntries).where(eq(fundEntries.id, entryId));
  if (!e) return { error: "Entry not found." };
  if (e.paymentId) return { error: "This entry comes from a payment. Undo that payment instead." };
  await db.delete(fundEntries).where(eq(fundEntries.id, entryId));
  await audit(db, me.id, "fund-delete", "fund", entryId, e.description);
  revalidatePath("/", "layout");
  return undefined;
}

/* ------------------------------------------------------ recurring plans */

const planSchema = z
  .object({
    projectId: z.string().min(1),
    direction: z.enum(["incoming", "outgoing"]),
    userId: optText(100),
    description: text(300),
    amount,
    currency,
    interval: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
    startDate: date,
    endDate: optDate,
  })
  .refine((p) => !p.endDate || p.endDate >= p.startDate, {
    message: "End date is before the start date",
    path: ["endDate"],
  });

export async function createPlan(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const { success, data, error } = parseForm(planSchema, fd);
  if (!success) return { error };
  try {
    const [p] = await db
      .insert(recurringPlans)
      .values({
        ...data,
        userId: data.direction === "outgoing" ? (data.userId ?? null) : null,
        endDate: data.endDate ?? null,
        nextDueDate: data.startDate,
      })
      .returning({ id: recurringPlans.id });
    await audit(db, me.id, "create", "recurring-plan", p.id, data.description);
  } catch (e) {
    return fail(e);
  }
  return done("Recurring payment set up. The daily job creates each payment 14 days before it's due.");
}

export async function setPlanActive(planId: string, active: boolean) {
  const me = await requireAdmin();
  await db.update(recurringPlans).set({ active }).where(eq(recurringPlans.id, planId));
  await audit(db, me.id, active ? "resume" : "pause", "recurring-plan", planId);
  revalidatePath("/", "layout");
}

export async function deletePlan(planId: string) {
  const me = await requireAdmin();
  // Payments it already created stay (their recurringPlanId becomes null).
  await db.delete(recurringPlans).where(eq(recurringPlans.id, planId));
  await audit(db, me.id, "delete", "recurring-plan", planId);
  revalidatePath("/", "layout");
}
