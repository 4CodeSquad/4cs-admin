import { and, eq, inArray, ne, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { fundEntries, payments, projectShares, projects, user } from "@/db/schema";

/*
 * What happens to money when a payment is marked paid — and how that is
 * undone. Every function here runs in one transaction, so the payouts, the
 * fund and the payment status can never disagree.
 *
 *   client payment paid  → each member's share becomes a pending payout to them,
 *                          the rest goes into the company fund
 *   cost paid (outgoing, not a member's share) → taken out of the company fund
 *   member share paid    → nothing else (it was never the company's money)
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
 * The fraction of each payment a share takes, in basis points. Fixed shares
 * are their part of the budget: €3,000 of a €12,000 budget = 2500 (25%).
 */
export function effectiveBasisPoints(s: Share, budget: number | null): number {
  if (s.kind === "percent") return s.basisPoints ?? 0;
  if (!budget) return 0;
  return ((s.amount ?? 0) * BP) / budget;
}

/** Checks a project's split before it's saved. Returns an error message or null. */
export function validateSplit(shares: Share[], budget: number | null): string | null {
  if (shares.some((s) => s.kind === "fixed") && !budget) {
    return "Fixed shares need the project budget, so they can be paid out as the client pays. Set the budget first.";
  }
  const total = shares.reduce((t, s) => t + effectiveBasisPoints(s, budget), 0);
  if (total > BP + 1e-9) {
    return `The shares add up to ${(total / 100).toFixed(2)}% of the project — more than 100%.`;
  }
  return null;
}

/**
 * Splits one client payment.
 *
 * - percent: floor(amount × %).
 * - fixed: computed cumulatively — the member should have received
 *   fixed × (client paid so far ÷ budget), capped at fixed; this payment gives
 *   them the difference from what they've already been allocated. So rounding
 *   never drifts, and once the client has paid the whole budget the member has
 *   exactly their fixed amount. Payments beyond the budget give fixed shares 0.
 * - company: whatever is left (never negative while the split is ≤ 100%).
 */
export function computeSplit(input: {
  amount: number;
  budget: number | null;
  /** Client payments already marked paid on this project, excluding this one. */
  paidBefore: number;
  shares: (Share & { allocatedBefore: number })[];
}) {
  const { amount, budget, paidBefore, shares } = input;
  const members = shares.map((s) => {
    let value = 0;
    if (s.kind === "percent") {
      value = Math.floor((amount * (s.basisPoints ?? 0)) / BP);
    } else if (budget && s.amount) {
      const target = Math.min(s.amount, Math.floor((s.amount * (paidBefore + amount)) / budget));
      value = Math.max(0, target - s.allocatedBefore);
    }
    return { userId: s.userId, amount: value };
  });
  const toMembers = members.reduce((t, m) => t + m.amount, 0);
  return { members, company: Math.max(0, amount - toMembers) };
}

/* ------------------------------------------------------------- flows -- */

async function lockPayment(tx: Tx, id: string) {
  const [p] = await tx.select().from(payments).where(eq(payments.id, id)).for("update");
  if (!p) throw new MoneyFlowError("Payment not found.");
  return p;
}

/** Marks a pending payment paid and moves the money (see top of file). */
export async function markPaymentPaid(db: DB, paymentId: string, paidOn: string, actorId: string | null) {
  return db.transaction(async (tx) => {
    const p = await lockPayment(tx, paymentId);
    if (p.status === "paid") return;
    if (p.status === "cancelled") throw new MoneyFlowError("A cancelled payment can't be marked paid.");
    await tx.update(payments).set({ status: "paid", paidOn }).where(eq(payments.id, p.id));

    const [project] = await tx.select().from(projects).where(eq(projects.id, p.projectId)).for("update");

    if (p.direction === "incoming") {
      const shares = await tx.select().from(projectShares).where(eq(projectShares.projectId, p.projectId));
      if (shares.length && p.currency !== project.currency) {
        throw new MoneyFlowError(
          `This project is split in ${project.currency}. Record the client's payment in ${project.currency} so the shares can be worked out.`,
        );
      }
      // What the client had paid before this payment, and what each member has
      // already been allocated from earlier payments on this project.
      const [{ paidBefore }] = await tx
        .select({ paidBefore: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint`.mapWith(Number) })
        .from(payments)
        .where(
          and(
            eq(payments.projectId, p.projectId),
            eq(payments.direction, "incoming"),
            eq(payments.status, "paid"),
            eq(payments.currency, project.currency),
            ne(payments.id, p.id),
          ),
        );
      const allocated = await tx
        .select({
          userId: payments.userId,
          total: sql<number>`coalesce(sum(${payments.amount}), 0)::bigint`.mapWith(Number),
        })
        .from(payments)
        .where(
          and(
            eq(payments.projectId, p.projectId),
            sql`${payments.sourcePaymentId} is not null`,
            ne(payments.status, "cancelled"),
          ),
        )
        .groupBy(payments.userId);
      const before = new Map(allocated.map((a) => [a.userId, a.total]));

      const split = computeSplit({
        amount: p.amount,
        budget: project.budget,
        paidBefore,
        shares: shares.map((s) => ({ ...s, allocatedBefore: before.get(s.userId) ?? 0 })),
      });

      const payouts = split.members.filter((m) => m.amount > 0);
      if (payouts.length) {
        await tx.insert(payments).values(
          payouts.map((m) => ({
            projectId: p.projectId,
            direction: "outgoing" as const,
            userId: m.userId,
            description: `Share of “${p.description}”`,
            amount: m.amount,
            currency: p.currency,
            dueDate: paidOn,
            sourcePaymentId: p.id,
            createdById: actorId,
          })),
        );
      }
      if (split.company > 0) {
        await tx.insert(fundEntries).values({
          entryDate: paidOn,
          direction: "in",
          amount: split.company,
          currency: p.currency,
          category: "Project income",
          description: `${project.name} — company share of “${p.description}”`,
          projectId: p.projectId,
          paymentId: p.id,
          createdById: actorId,
        });
      }
      return;
    }

    // Outgoing. A member's share was never company money; anything else is a
    // cost the company pays from its fund.
    if (p.sourcePaymentId) return;
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
      description: `${project.name} — ${p.description}${payee ? ` (${payee})` : ""}`,
      projectId: p.projectId,
      paymentId: p.id,
      createdById: actorId,
    });
  });
}

/** Reverses markPaymentPaid. Refuses if a member has already been paid from it. */
export async function markPaymentPending(db: DB, paymentId: string) {
  return db.transaction(async (tx) => {
    const p = await lockPayment(tx, paymentId);
    if (p.status !== "paid") return;
    if (p.direction === "incoming") {
      const generated = await tx
        .select({ id: payments.id, status: payments.status })
        .from(payments)
        .where(eq(payments.sourcePaymentId, p.id))
        .for("update");
      if (generated.some((g) => g.status === "paid")) {
        throw new MoneyFlowError(
          "Members have already been paid their share of this payment. Undo those payouts first.",
        );
      }
      if (generated.length) {
        await tx.delete(payments).where(inArray(payments.id, generated.map((g) => g.id)));
      }
    }
    await tx.delete(fundEntries).where(eq(fundEntries.paymentId, p.id));
    await tx.update(payments).set({ status: "pending", paidOn: null }).where(eq(payments.id, p.id));
  });
}

/** Only pending, hand-made payments can be deleted; everything else is undone first. */
export async function deletePaymentSafely(db: DB, paymentId: string) {
  return db.transaction(async (tx) => {
    const p = await lockPayment(tx, paymentId);
    if (p.status === "paid") throw new MoneyFlowError("Mark it unpaid first, then delete it.");
    if (p.sourcePaymentId) {
      throw new MoneyFlowError("This is a member's share of a client payment. Undo that client payment instead.");
    }
    await tx.delete(payments).where(eq(payments.id, p.id));
  });
}
