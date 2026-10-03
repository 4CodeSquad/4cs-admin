import { and, eq, lte } from "drizzle-orm";
import type { DB } from "@/db/client";
import { payments, recurringPlans } from "@/db/schema";
import { addDays, nthOccurrence, type Interval } from "./dates";

/** Payments are created this many days before they fall due. */
export const LEAD_DAYS = 14;

/**
 * Turns every active recurring plan into concrete pending payments, up to
 * `today + LEAD_DAYS`. Run daily by /api/cron/daily.
 *
 * Safe to run any number of times: each plan's progress is stored in
 * `occurrences`, and payments are unique on (recurringPlanId, dueDate), so a
 * retried or overlapping run can't bill twice. A plan that was paused (or the
 * job that didn't run for a week) catches up on every missed date.
 */
export async function generateRecurringPayments(db: DB, today: string) {
  const horizon = addDays(today, LEAD_DAYS);
  const due = await db
    .select()
    .from(recurringPlans)
    .where(and(eq(recurringPlans.active, true), lte(recurringPlans.nextDueDate, horizon)));

  let created = 0;
  for (const plan of due) {
    await db.transaction(async (tx) => {
      // Re-read under a row lock so two concurrent runs can't both advance it.
      const [p] = await tx
        .select()
        .from(recurringPlans)
        .where(eq(recurringPlans.id, plan.id))
        .for("update");
      if (!p?.active) return;

      let n = p.occurrences;
      let next = p.nextDueDate;
      while (next <= horizon && (!p.endDate || next <= p.endDate)) {
        const inserted = await tx
          .insert(payments)
          .values({
            projectId: p.projectId,
            direction: p.direction,
            userId: p.userId,
            description: p.description,
            amount: p.amount,
            currency: p.currency,
            dueDate: next,
            recurringPlanId: p.id,
          })
          .onConflictDoNothing()
          .returning({ id: payments.id });
        created += inserted.length;
        n += 1;
        next = nthOccurrence(p.startDate, p.interval as Interval, n);
      }

      const finished = !!p.endDate && next > p.endDate;
      await tx
        .update(recurringPlans)
        .set({ occurrences: n, nextDueDate: next, active: !finished })
        .where(eq(recurringPlans.id, p.id));
    });
  }
  return { plansChecked: due.length, paymentsCreated: created };
}
