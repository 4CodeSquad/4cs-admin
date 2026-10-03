import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, reset } from "./db";
import { seed } from "./fixtures";
import * as s from "../db/schema";
import {
  deletePaymentSafely,
  entitlements,
  markPaymentPaid,
  markPaymentPending,
  MoneyFlowError,
  reconcile,
  saveShare,
  validateSplit,
} from "@/lib/money-flow";

const fixed = (userId: string, amount: number) => ({ userId, kind: "fixed" as const, basisPoints: null, amount });
const pct = (userId: string, basisPoints: number) => ({ userId, kind: "percent" as const, basisPoints, amount: null });

describe("entitlements and validation", () => {
  it("fixed shares fill up as the client pays and complete at the budget", () => {
    expect(entitlements([fixed("a", 30000)], 120000, 48000)).toEqual([{ userId: "a", amount: 12000 }]);
    expect(entitlements([fixed("a", 30000)], 120000, 120000)[0].amount).toBe(30000);
  });
  it("money received beyond the budget counts (extras like hosting)", () => {
    // budget 400, client paid 500 → 3 × 150 = 450 is 90%, allowed
    expect(validateSplit([fixed("a", 15000), fixed("b", 15000), fixed("c", 15000)], 40000, 50000)).toBeNull();
    expect(entitlements([fixed("a", 15000), fixed("b", 15000), fixed("c", 15000)], 40000, 50000).map((e) => e.amount))
      .toEqual([15000, 15000, 15000]);
  });
  it("refuses more than 100% of max(budget, received), with a clear reason", () => {
    expect(validateSplit([fixed("a", 15000), fixed("b", 15000), fixed("c", 15000)], 40000, 40000)).toMatch(/only 400/);
    expect(validateSplit([pct("a", 6000), pct("b", 5000)], null, 0)).toMatch(/more than 100%/);
  });
  it("never gives the team more than came in", () => {
    const e = entitlements([fixed("a", 30000), fixed("b", 30000)], 40000, 40000); // budget lowered below the split
    expect(e.reduce((t, x) => t + x.amount, 0)).toBeLessThanOrEqual(40000);
  });
});

describe("project money (database)", () => {
  beforeEach(async () => {
    await reset();
    await seed();
  });
  const pay = async (id: string, amount: number, opts: Partial<typeof s.payments.$inferInsert> = {}) =>
    db.insert(s.payments).values({ id, projectId: "P1", direction: "incoming", description: id, amount, currency: "EUR", dueDate: "2026-10-01", ...opts });
  const payouts = async () =>
    (await db.select({ userId: s.payments.userId, amount: s.payments.amount, status: s.payments.status })
      .from(s.payments).where(and(eq(s.payments.projectId, "P1"), isNotNull(s.payments.sourcePaymentId)))
      .orderBy(s.payments.userId, s.payments.status));
  const company = async () =>
    (await db.select().from(s.fundEntries).where(and(eq(s.fundEntries.projectId, "P1"), eq(s.fundEntries.category, "Project income"))))
      .reduce((t, e) => t + e.amount, 0);

  it("REGRESSION (PPG.AL): split set after the money came in, 3 × €150 of €500 → company €50", async () => {
    await db.update(s.projects).set({ budget: 40000 }).where(eq(s.projects.id, "P1"));
    await pay("full", 40000);
    await markPaymentPaid(db, "full", "2026-10-03", "admin"); // paid before any split
    expect(await company()).toBe(40000);

    await saveShare(db, "P1", fixed("memberA", 15000), "admin");
    await saveShare(db, "P1", fixed("memberB", 15000), "admin");
    expect(await payouts()).toEqual([
      { userId: "memberA", amount: 15000, status: "pending" },
      { userId: "memberB", amount: 15000, status: "pending" },
    ]);
    expect(await company()).toBe(10000);

    // Both paid, then the €100 hosting payment comes in
    for (const p of await db.select().from(s.payments).where(isNotNull(s.payments.sourcePaymentId))) {
      await markPaymentPaid(db, p.id, "2026-10-03", "admin");
    }
    await pay("hosting", 10000);
    await markPaymentPaid(db, "hosting", "2026-10-03", "admin");
    expect((await payouts()).every((p) => p.status === "paid")).toBe(true); // no new payouts out of thin air
    expect(await company()).toBe(20000);

    // Third person, €150: allowed because €500 was received (budget was only €400)
    await saveShare(db, "P1", fixed("admin", 15000), "admin");
    expect((await payouts()).filter((p) => p.status === "pending")).toEqual([{ userId: "admin", amount: 15000, status: "pending" }]);
    expect(await company()).toBe(5000);
  });

  it("percent shares grow with each payment; the pending payout is always 'owed minus paid'", async () => {
    await saveShare(db, "P1", pct("memberA", 2000), "admin");
    await pay("p1", 100000); await markPaymentPaid(db, "p1", "2026-10-01", null);
    let [a] = await payouts();
    expect(a).toEqual({ userId: "memberA", amount: 20000, status: "pending" });
    await markPaymentPaid(db, (await db.select().from(s.payments).where(isNotNull(s.payments.sourcePaymentId)))[0].id, "2026-10-02", null);
    await pay("p2", 50000); await markPaymentPaid(db, "p2", "2026-10-05", null);
    expect(await payouts()).toEqual([
      { userId: "memberA", amount: 10000, status: "pending" },
      { userId: "memberA", amount: 20000, status: "paid" },
    ]);
    expect(await company()).toBe(120000);
  });

  it("is idempotent and order-independent", async () => {
    await db.update(s.projects).set({ budget: 100000 }).where(eq(s.projects.id, "P1"));
    await pay("p1", 60000); await pay("p2", 40000);
    await markPaymentPaid(db, "p2", "2026-10-02", null);
    await saveShare(db, "P1", fixed("memberA", 30000), "admin");
    await markPaymentPaid(db, "p1", "2026-10-01", null);
    await reconcile(db, "P1", null);
    await reconcile(db, "P1", null);
    expect(await payouts()).toEqual([{ userId: "memberA", amount: 30000, status: "pending" }]);
    expect(await company()).toBe(70000);
  });

  it("undo is refused if a member was already paid more than they'd be owed", async () => {
    await saveShare(db, "P1", fixed("memberA", 30000), "admin");
    await db.update(s.projects).set({ budget: 100000 }).where(eq(s.projects.id, "P1"));
    await pay("p1", 100000); await markPaymentPaid(db, "p1", "2026-10-01", null);
    const [share] = await db.select().from(s.payments).where(isNotNull(s.payments.sourcePaymentId));
    await markPaymentPaid(db, share.id, "2026-10-02", null);
    await expect(markPaymentPending(db, "p1")).rejects.toThrow(/already been paid/);
    const [p] = await db.select().from(s.payments).where(eq(s.payments.id, "p1"));
    expect(p.status).toBe("paid"); // rolled back
  });

  it("undo without paid payouts recalculates everything", async () => {
    await saveShare(db, "P1", pct("memberA", 5000), "admin");
    await pay("p1", 100000); await markPaymentPaid(db, "p1", "2026-10-01", null);
    await markPaymentPending(db, "p1");
    expect(await payouts()).toEqual([]);
    expect(await company()).toBe(0);
  });

  it("shares can't exceed 100% of what the project brings in", async () => {
    await db.update(s.projects).set({ budget: 40000 }).where(eq(s.projects.id, "P1"));
    await saveShare(db, "P1", fixed("memberA", 15000), "admin");
    await saveShare(db, "P1", fixed("memberB", 15000), "admin");
    await expect(saveShare(db, "P1", fixed("admin", 15000), "admin")).rejects.toBeInstanceOf(MoneyFlowError);
  });

  it("removing a share returns its unpaid part to the company", async () => {
    await saveShare(db, "P1", pct("memberA", 5000), "admin");
    await pay("p1", 100000); await markPaymentPaid(db, "p1", "2026-10-01", null);
    expect(await company()).toBe(50000);
    await saveShare(db, "P1", { userId: "memberA", remove: true }, "admin");
    expect(await payouts()).toEqual([]);
    expect(await company()).toBe(100000);
  });

  it("project costs come out of the fund; members' shares don't", async () => {
    await saveShare(db, "P1", pct("memberA", 5000), "admin");
    await pay("p1", 100000); await markPaymentPaid(db, "p1", "2026-10-01", null);
    const [share] = await db.select().from(s.payments).where(isNotNull(s.payments.sourcePaymentId));
    await markPaymentPaid(db, share.id, "2026-10-02", null);
    await markPaymentPaid(db, "out-vendor-P1", "2026-10-02", null);
    const out = await db.select().from(s.fundEntries).where(eq(s.fundEntries.direction, "out"));
    expect(out).toEqual([expect.objectContaining({ amount: 10000, category: "Project cost" })]);
  });

  it("refuses a client payment in another currency on a split project", async () => {
    await saveShare(db, "P1", pct("memberA", 5000), "admin");
    await pay("all", 100000, { currency: "ALL" });
    await expect(markPaymentPaid(db, "all", "2026-10-01", null)).rejects.toThrow(/split in EUR/);
  });

  it("guards deletes", async () => {
    await saveShare(db, "P1", pct("memberA", 5000), "admin");
    await pay("p1", 100000); await markPaymentPaid(db, "p1", "2026-10-01", null);
    await expect(deletePaymentSafely(db, "p1")).rejects.toThrow(/unpaid first/);
    const [share] = await db.select().from(s.payments).where(isNotNull(s.payments.sourcePaymentId));
    await expect(deletePaymentSafely(db, share.id)).rejects.toThrow(/member's share/);
  });
});
