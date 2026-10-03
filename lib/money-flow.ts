import { and, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { fundEntries, payments, projectShares, projects, user } from "@/db/schema";

/*
 * Where a project's money goes. The model is deliberately simple:
 *
 *   everything the client has paid on the project
 *     → each member's share of that total (their payouts)
 *     → the rest belongs to the company (one "Project income" fund entry)
 *
 * After anything that changes the picture — a client payment marked paid or
 * undone, a share set or removed, the budget edited — reconcileProject()
 * recomputes the whole project from scratch: what each member is owed in
 * total, minus what they've already been paid, becomes one pending payout;
 * the company's part is rewritten. Payouts already marked paid are history
 * and are never changed. So the order in which things happened can't skew
 * the numbers.
 *
 * Project costs (outgoing payments that aren't a member's share) come out of
 * the company fund when paid.
 */

export class MoneyFlowError extends Error {}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

export type Share = {
  userId: string;
  kind: "percent" | "fixed";
  basisPoints: number | null;
  amount: number | null;
};

/** 10000 basis points = 100%. */
export const BP = 10000;

/**
 * What fixed shares are measured against: the budget, or what the client has
 * actually paid if that's more (extras like hosting on top of the price).
 */
export const splitBase = (budget: number | null, received: number) => Math.max(budget ?? 0, received);

/** A share as a fraction of the project, in basis points (for display and validation). */
export function effectiveBasisPoints(s: Share, base: number): number {
  if (s.kind === "percent") return s.basisPoints ?? 0;
  if (!base) return 0;
  return ((s.amount ?? 0) * BP) / base;
}

/** Checks a project's split before it's saved. Returns an error message or null. */
export function validateSplit(shares: Share[], budget: number | null, received: number): string | null {
  const base = splitBase(budget, received);
  if (shares.some((s) => s.kind === "fixed") && !base) {
    return "Fixed shares need a project budget (or a client payment) to be measured against. Set the budget first.";
  }
  const total = shares.reduce((t, s) => t + effectiveBasisPoints(s, base), 0);
  if (total > BP + 1e-9) {
    const fixed = shares.filter((s) => s.kind === "fixed").reduce((t, s) => t + (s.amount ?? 0), 0);
    return (
      `The shares add up to ${(total / 100).toFixed(2)}% — more than 100%.` +
      (fixed ? ` Fixed shares total ${(fixed / 100).toFixed(2)}, but the project's budget / money received is only ${(base / 100).toFixed(2)}.` : "")
    );
  }
  return null;
}

/**
 * Each member's share of what the client has paid so far.
 *  - percent: floor(received × %)
 *  - fixed: the amount × received ÷ base (base = budget, or received if more),
 *    so it fills up as the client pays and is complete once the budget is paid.
 */
export function entitlements(shares: Share[], budget: number | null, received: number) {
  const base = splitBase(budget, received);
  const raw = shares.map((s) => ({
    userId: s.userId,
    amount:
      s.kind === "percent"
        ? Math.floor((received * (s.basisPoints ?? 0)) / BP)
        : base
          ? Math.min(s.amount ?? 0, Math.floor(((s.amount ?? 0) * received) / base))
          : 0,
  }));
  // Never promise the team more than came in (e.g. the budget was lowered
  // after the split was set): scale everyone down by the same factor.
  const total = raw.reduce((t, r) => t + r.amount, 0);
  if (total <= received) return raw;
  return raw.map((r) => ({ ...r, amount: Math.floor((r.amount * received) / total) }));
}

/* ------------------------------------------------------------ reconcile -- */

/**
 * Recomputes a project's payouts and company income. Call inside a
 * transaction, after the change. Throws if members have already been paid
 * more than their share now allows (the caller's change is rolled back).
 */
export async function reconcileProject(tx: Tx, projectId: string, actorId: string | null) {
  const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
  if (!project) throw new MoneyFlowError("Project not found.");

  const incoming = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.projectId, projectId), eq(payments.direction, "incoming"), eq(payments.status, "paid")))
    .orderBy(desc(payments.paidOn), desc(payments.createdAt));
  const shares = await tx.select().from(projectShares).where(eq(projectShares.projectId, projectId));

  const inCurrency = incoming.filter((p) => p.currency === project.currency);
  const other = incoming.filter((p) => p.currency !== project.currency);
  if (shares.length && other.length) {
    throw new MoneyFlowError(
      `This project is split in ${project.currency}. Record the client's payments in ${project.currency} so the shares can be worked out.`,
    );
  }
  const received = inCurrency.reduce((t, p) => t + p.amount, 0);

  // Start clean: unpaid payouts and the company's income entries are rebuilt.
  await tx
    .delete(payments)
    .where(and(eq(payments.projectId, projectId), isNotNull(payments.sourcePaymentId), eq(payments.status, "pending")));
  const allIncomingIds = (
    await tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.projectId, projectId), eq(payments.direction, "incoming")))
  ).map((r) => r.id);
  if (allIncomingIds.length) {
    await tx.delete(fundEntries).where(inArray(fundEntries.paymentId, allIncomingIds));
  }

  // What each member has already been paid from this project's split.
  const paidRows = await tx
    .select({
      userId: payments.userId,
      total: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint`.mapWith(Number),
    })
    .from(payments)
    .where(and(eq(payments.projectId, projectId), isNotNull(payments.sourcePaymentId), eq(payments.status, "paid")))
    .groupBy(payments.userId);
  const alreadyPaid = new Map(paidRows.map((r) => [r.userId!, r.total]));

  const owed = entitlements(shares, project.budget, received);
  const names = new Map(
    (shares.length
      ? await tx.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, shares.map((s) => s.userId)))
      : []
    ).map((u) => [u.id, u.name]),
  );
  for (const [userId, paid] of alreadyPaid) {
    const entitled = owed.find((o) => o.userId === userId)?.amount ?? 0;
    if (paid > entitled) {
      const fmt = (n: number) => `${(n / 100).toFixed(2)} ${project.currency}`;
      throw new MoneyFlowError(
        `${names.get(userId) ?? "A member"} has already been paid ${fmt(paid)} from this project, but their share would now be ${fmt(entitled)}. Undo some of their payouts first.`,
      );
    }
  }

  const latest = inCurrency[0];
  if (latest) {
    const payouts = owed
      .map((o) => ({ ...o, due: o.amount - (alreadyPaid.get(o.userId) ?? 0) }))
      .filter((o) => o.due > 0);
    if (payouts.length) {
      await tx.insert(payments).values(
        payouts.map((o) => ({
          projectId,
          direction: "outgoing" as const,
          userId: o.userId,
          description: `Share of ${project.name}`,
          amount: o.due,
          currency: project.currency,
          dueDate: latest.paidOn ?? latest.dueDate,
          sourcePaymentId: latest.id,
          createdById: actorId,
        })),
      );
    }
    const toTeam = owed.reduce((t, o) => t + o.amount, 0);
    const company = received - toTeam;
    if (company > 0) {
      await tx.insert(fundEntries).values({
        entryDate: latest.paidOn ?? latest.dueDate,
        direction: "in",
        amount: company,
        currency: project.currency,
        category: "Project income",
        description:
          `${project.name} — company share` +
          (toTeam ? ` (${fmtPlain(received)} received, ${fmtPlain(toTeam)} to the team)` : ""),
        projectId,
        paymentId: latest.id,
        createdById: actorId,
      });
    }
  }

  // Client payments in another currency (only allowed without a split) go to the fund whole.
  for (const p of other) {
    await tx.insert(fundEntries).values({
      entryDate: p.paidOn ?? p.dueDate,
      direction: "in",
      amount: p.amount,
      currency: p.currency,
      category: "Project income",
      description: `${project.name} — ${p.description}`,
      projectId,
      paymentId: p.id,
      createdById: actorId,
    });
  }
}

const fmtPlain = (minor: number) => (minor / 100).toFixed(2).replace(/\.00$/, "");

/* --------------------------------------------------------------- actions -- */

async function lockPayment(tx: Tx, id: string) {
  const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
  if (!p) throw new MoneyFlowError("Payment not found.");
  return p;
}

/** Records a project cost the company paid (any outgoing payment that isn't a member's share). */
async function addCostEntry(tx: Tx, p: typeof payments.$inferSelect, paidOn: string, actorId: string | null) {
  const [project] = await tx.select({ name: projects.name }).from(projects).where(eq(projects.id, p.projectId));
  let payee = p.counterparty;
  if (p.userId) {
    const [u] = await tx.select({ name: user.name }).from(user).where(eq(user.id, p.userId));
    payee = u?.name ?? null;
  }
  await tx.insert(fundEntries).values({
    entryDate: paidOn,
    direction: "out",
    amount: p.amount,
    currency: p.currency,
    category: p.userId ? "Team payment" : "Project cost",
    description: `${project?.name ?? "Project"} — ${p.description}${payee ? ` (${payee})` : ""}`,
    projectId: p.projectId,
    paymentId: p.id,
    createdById: actorId,
  });
}

export async function markPaymentPaid(db: DB, paymentId: string, paidOn: string, actorId: string | null) {
  return db.transaction(async (tx) => {
    const p = await lockPayment(tx, paymentId);
    if (p.status === "paid") return;
    if (p.status === "cancelled") throw new MoneyFlowError("A cancelled payment can't be marked paid.");
    await tx.update(payments).set({ status: "paid", paidOn }).where(eq(payments.id, p.id));
    if (p.direction === "incoming") await reconcileProject(tx, p.projectId, actorId);
    else if (!p.sourcePaymentId) await addCostEntry(tx, p, paidOn, actorId);
    // A member's share being paid needs nothing else: it was never company money.
  });
}

export async function markPaymentPending(db: DB, paymentId: string) {
  return db.transaction(async (tx) => {
    const p = await lockPayment(tx, paymentId);
    if (p.status !== "paid") return;
    await tx.update(payments).set({ status: "pending", paidOn: null }).where(eq(payments.id, p.id));
    if (p.direction === "incoming" || p.sourcePaymentId) {
      // Throws (and rolls back) if members were already paid more than allowed.
      await reconcileProject(tx, p.projectId, null);
    } else {
      await tx.delete(fundEntries).where(eq(fundEntries.paymentId, p.id));
    }
  });
}

/** Only pending, hand-made payments can be deleted; everything else is undone first. */
export async function deletePaymentSafely(db: DB, paymentId: string) {
  return db.transaction(async (tx) => {
    const p = await lockPayment(tx, paymentId);
    if (p.status === "paid") throw new MoneyFlowError("Mark it unpaid first, then delete it.");
    if (p.sourcePaymentId) {
      throw new MoneyFlowError("This is a member's share. Change the split or the client payments instead.");
    }
    await tx.delete(payments).where(eq(payments.id, p.id));
  });
}

/** Sets or removes one member's share, then recalculates the project. */
export async function saveShare(
  db: DB,
  projectId: string,
  share: Share | { userId: string; remove: true },
  actorId: string | null,
) {
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(projects).where(eq(projects.id, projectId)).for("update");
    if (!project) throw new MoneyFlowError("Project not found.");
    if ("remove" in share) {
      await tx
        .delete(projectShares)
        .where(and(eq(projectShares.projectId, projectId), eq(projectShares.userId, share.userId)));
    } else {
      const others = await tx
        .select()
        .from(projectShares)
        .where(and(eq(projectShares.projectId, projectId), ne(projectShares.userId, share.userId)));
      const [{ received }] = await tx
        .select({ received: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint`.mapWith(Number) })
        .from(payments)
        .where(
          and(
            eq(payments.projectId, projectId),
            eq(payments.direction, "incoming"),
            eq(payments.status, "paid"),
            eq(payments.currency, project.currency),
          ),
        );
      const invalid = validateSplit([...others, share], project.budget, received);
      if (invalid) throw new MoneyFlowError(invalid);
      await tx
        .insert(projectShares)
        .values({ projectId, ...share })
        .onConflictDoUpdate({
          target: [projectShares.projectId, projectShares.userId],
          set: { kind: share.kind, basisPoints: share.basisPoints, amount: share.amount },
        });
    }
    await reconcileProject(tx, projectId, actorId);
  });
}

/** After a budget change: recalculate (fixed shares are measured against the budget). */
export async function reconcile(db: DB, projectId: string, actorId: string | null) {
  return db.transaction((tx) => reconcileProject(tx, projectId, actorId));
}
