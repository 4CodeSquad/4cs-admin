import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, reset } from "./db";
import { seed } from "./fixtures";
import * as s from "../db/schema";
import {
  computeSplit,
  deletePaymentSafely,
  markPaymentPaid,
  markPaymentPending,
  MoneyFlowError,
  validateSplit,
} from "@/lib/money-flow";

const fixed = (userId: string, amount: number) => ({ userId, kind: "fixed" as const, basisPoints: null, amount });
const pct = (userId: string, basisPoints: number) => ({ userId, kind: "percent" as const, basisPoints, amount: null });

describe("computeSplit", () => {
  it("percent shares round down; the company gets the remainder", () => {
    const r = computeSplit({ amount: 1001, budget: null, paidBefore: 0, shares: [{ ...pct("a", 3333), allocatedBefore: 0 }] });
    expect(r.members[0].amount).toBe(333);
    expect(r.company).toBe(668);
  });
  it("fixed shares reach exactly their amount when the budget is paid, despite rounding", () => {
    let allocated = 0, paid = 0;
    for (const amount of [33333, 33333, 33334]) {
      const r = computeSplit({ amount, budget: 100000, paidBefore: paid, shares: [{ ...fixed("a", 33333), allocatedBefore: allocated }] });
      allocated += r.members[0].amount; paid += amount;
      expect(r.members[0].amount + r.company).toBe(amount);
    }
    expect(allocated).toBe(33333);
  });
  it("fixed shares stop at their amount when the client pays more than the budget", () => {
    const r = computeSplit({ amount: 50000, budget: 100000, paidBefore: 100000, shares: [{ ...fixed("a", 30000), allocatedBefore: 30000 }] });
    expect(r.members[0].amount).toBe(0);
    expect(r.company).toBe(50000);
  });
});

describe("validateSplit", () => {
  it("rejects more than 100%", () => {
    expect(validateSplit([pct("a", 6000), fixed("b", 5000)], 10000)).toMatch(/more than 100%/);
    expect(validateSplit([pct("a", 6000), fixed("b", 4000)], 10000)).toBeNull();
  });
  it("needs a budget for fixed shares", () => {
    expect(validateSplit([fixed("a", 100)], null)).toMatch(/budget/);
  });
});

describe("payment flows (database)", () => {
  // P1 budget €12,000. memberA: fixed €3,000 (25%). memberB: 20%. Company: the rest.
  beforeEach(async () => {
    await reset();
    await seed();
    await db.update(s.projects).set({ budget: 1200000 }).where(eq(s.projects.id, "P1"));
    await db.insert(s.projectShares).values([
      { projectId: "P1", userId: "memberA", kind: "fixed", amount: 300000 },
      { projectId: "P1", userId: "memberB", kind: "percent", basisPoints: 2000 },
    ]);
  });
  const inc = async (id: string, amount: number, currency: "EUR" | "ALL" = "EUR") =>
    db.insert(s.payments).values({ id, projectId: "P1", direction: "incoming", description: id, amount, currency, dueDate: "2026-02-01" });
  const payouts = (src: string) =>
    db.select({ userId: s.payments.userId, amount: s.payments.amount, status: s.payments.status })
      .from(s.payments).where(eq(s.payments.sourcePaymentId, src)).orderBy(s.payments.userId);
  const fund = () => db.select().from(s.fundEntries).orderBy(s.fundEntries.createdAt);

  it("splits a client payment into member payouts and the company fund", async () => {
    await inc("pay1", 480000);
    await markPaymentPaid(db, "pay1", "2026-02-02", "admin");
    expect(await payouts("pay1")).toEqual([
      { userId: "memberA", amount: 120000, status: "pending" }, // 25% of 4,800
      { userId: "memberB", amount: 96000, status: "pending" },  // 20%
    ]);
    const [f] = await fund();
    expect(f).toMatchObject({ direction: "in", amount: 264000, category: "Project income", paymentId: "pay1" });
  });

  it("completes the fixed share exactly over several payments, then stops", async () => {
    await inc("pay1", 480000); await markPaymentPaid(db, "pay1", "2026-02-02", null);
    await inc("pay2", 720000); await markPaymentPaid(db, "pay2", "2026-03-02", null);
    await inc("pay3", 100000); await markPaymentPaid(db, "pay3", "2026-04-02", null); // beyond the budget
    const a = await db.select({ amount: s.payments.amount }).from(s.payments)
      .where(and(eq(s.payments.userId, "memberA"), isNotNull(s.payments.sourcePaymentId)));
    expect(a.reduce((t, r) => t + r.amount, 0)).toBe(300000);
    expect((await payouts("pay3")).map((p) => [p.userId, p.amount])).toEqual([["memberB", 20000]]);
  });

  it("is idempotent", async () => {
    await inc("pay1", 480000);
    await markPaymentPaid(db, "pay1", "2026-02-02", null);
    await markPaymentPaid(db, "pay1", "2026-02-02", null);
    expect(await payouts("pay1")).toHaveLength(2);
    expect(await fund()).toHaveLength(1);
  });

  it("undo removes the payouts and the fund entry", async () => {
    await inc("pay1", 480000);
    await markPaymentPaid(db, "pay1", "2026-02-02", null);
    await markPaymentPending(db, "pay1");
    expect(await payouts("pay1")).toEqual([]);
    expect(await fund()).toEqual([]);
    const [p] = await db.select().from(s.payments).where(eq(s.payments.id, "pay1"));
    expect(p).toMatchObject({ status: "pending", paidOn: null });
  });

  it("undo is refused once a member has been paid their share", async () => {
    await inc("pay1", 480000);
    await markPaymentPaid(db, "pay1", "2026-02-02", null);
    await db.update(s.payments).set({ status: "paid" }).where(and(eq(s.payments.sourcePaymentId, "pay1"), eq(s.payments.userId, "memberA")));
    await expect(markPaymentPending(db, "pay1")).rejects.toBeInstanceOf(MoneyFlowError);
  });

  it("paying a member's share doesn't touch the fund; paying a cost takes it out of the fund", async () => {
    await inc("pay1", 480000);
    await markPaymentPaid(db, "pay1", "2026-02-02", null);
    const [share] = await db.select().from(s.payments).where(eq(s.payments.sourcePaymentId, "pay1")).limit(1);
    await markPaymentPaid(db, share.id, "2026-02-03", null);
    expect(await fund()).toHaveLength(1);
    await markPaymentPaid(db, "out-vendor-P1", "2026-02-04", null); // €100 vendor cost from the fixture
    const entries = await fund();
    expect(entries[1]).toMatchObject({ direction: "out", amount: 10000, category: "Project cost" });
  });

  it("refuses a client payment in another currency on a split project", async () => {
    await inc("payALL", 100000, "ALL");
    await expect(markPaymentPaid(db, "payALL", "2026-02-02", null)).rejects.toThrow(/split in EUR/);
    const [p] = await db.select().from(s.payments).where(eq(s.payments.id, "payALL"));
    expect(p.status).toBe("pending"); // the whole transaction rolled back
  });

  it("projects without a split put the whole payment in the fund", async () => {
    await markPaymentPaid(db, "in-P2", "2026-02-02", null);
    expect((await fund())[0]).toMatchObject({ direction: "in", amount: 10000 });
  });

  it("guards deletes", async () => {
    await inc("pay1", 480000);
    await markPaymentPaid(db, "pay1", "2026-02-02", null);
    await expect(deletePaymentSafely(db, "pay1")).rejects.toThrow(/unpaid first/);
    const [share] = await payouts("pay1");
    const [row] = await db.select().from(s.payments).where(and(eq(s.payments.sourcePaymentId, "pay1"), eq(s.payments.userId, share.userId!)));
    await expect(deletePaymentSafely(db, row.id)).rejects.toThrow(/Undo that client payment/);
    await deletePaymentSafely(db, "in-P2");
  });
});
