import { beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db, reset } from "./db";
import { seed } from "./fixtures";
import * as s from "../db/schema";
import { generateRecurringPayments } from "@/lib/recurring";

const plan = (over: Partial<typeof s.recurringPlans.$inferInsert> = {}) =>
  db.insert(s.recurringPlans).values({
    id: "R1", projectId: "P1", direction: "incoming", description: "Hosting",
    amount: 5000, currency: "EUR", interval: "monthly",
    startDate: "2026-01-31", nextDueDate: "2026-01-31", ...over,
  });
const dueDates = async () =>
  (await db.select({ d: s.payments.dueDate }).from(s.payments)
    .where(eq(s.payments.recurringPlanId, "R1")).orderBy(asc(s.payments.dueDate))).map((r) => r.d);

beforeEach(async () => {
  await reset();
  await seed();
});

describe("generateRecurringPayments", () => {
  it("creates payments up to 14 days ahead, and nothing twice", async () => {
    await plan();
    expect((await generateRecurringPayments(db, "2026-01-20")).paymentsCreated).toBe(1);
    expect((await generateRecurringPayments(db, "2026-01-20")).paymentsCreated).toBe(0);
    expect(await dueDates()).toEqual(["2026-01-31"]);
  });
  it("catches up on missed runs without month-end drift", async () => {
    await plan();
    await generateRecurringPayments(db, "2026-01-20");
    await generateRecurringPayments(db, "2026-03-20");
    expect(await dueDates()).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    const [p] = await db.select().from(s.recurringPlans);
    expect(p.nextDueDate).toBe("2026-04-30");
    expect(p.occurrences).toBe(3);
  });
  it("stops at the end date and deactivates the plan", async () => {
    await plan({ endDate: "2026-02-28" });
    await generateRecurringPayments(db, "2026-06-01");
    expect(await dueDates()).toEqual(["2026-01-31", "2026-02-28"]);
    expect((await db.select().from(s.recurringPlans))[0].active).toBe(false);
  });
  it("ignores paused plans", async () => {
    await plan({ active: false });
    expect((await generateRecurringPayments(db, "2026-06-01")).paymentsCreated).toBe(0);
  });
  it("is safe when two runs overlap", async () => {
    await plan();
    const [a, b] = await Promise.all([
      generateRecurringPayments(db, "2026-03-20"),
      generateRecurringPayments(db, "2026-03-20"),
    ]);
    expect(a.paymentsCreated + b.paymentsCreated).toBe(3);
    expect(await dueDates()).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
  });
});
