import { timingSafeEqual } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { db } from "@/db";
import { payments, projects, user } from "@/db/schema";
import { generateRecurringPayments } from "@/lib/recurring";
import { addDays, today, formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { sendEmail } from "@/lib/email";

/**
 * Daily job (vercel.json → "crons"). Vercel calls it with
 * `Authorization: Bearer $CRON_SECRET`; anyone else gets 401.
 *
 * 1. Creates the payments that recurring plans have coming up.
 * 2. Emails the admins what's overdue or due within a week.
 *
 * Because it touches the database daily, it also stops a free database tier
 * from going to sleep.
 */
export const dynamic = "force-dynamic";

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret) return false;
  const a = Buffer.from(header), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req: Request) {
  if (!authorized(req)) return new Response("Unauthorized", { status: 401 });

  const t = today();
  const generated = await generateRecurringPayments(db, t);

  const due = await db
    .select({
      description: payments.description,
      direction: payments.direction,
      amount: payments.amount,
      currency: payments.currency,
      dueDate: payments.dueDate,
      project: projects.name,
      payee: user.name,
    })
    .from(payments)
    .innerJoin(projects, eq(projects.id, payments.projectId))
    .leftJoin(user, eq(user.id, payments.userId))
    .where(and(eq(payments.status, "pending"), lte(payments.dueDate, addDays(t, 7))))
    .orderBy(payments.dueDate);

  let emailed = 0;
  if (due.length) {
    const line = (p: (typeof due)[number]) =>
      `  ${formatDate(p.dueDate).padEnd(12)} ${p.direction === "incoming" ? "IN " : "OUT"} ${formatMoney(p.amount, p.currency).padStart(12)}  ${p.project} — ${p.description}${p.payee ? ` (${p.payee})` : ""}`;
    const overdue = due.filter((p) => p.dueDate < t);
    const soon = due.filter((p) => p.dueDate >= t);
    const body = [
      overdue.length ? `OVERDUE (${overdue.length})\n${overdue.map(line).join("\n")}` : "",
      soon.length ? `DUE WITHIN 7 DAYS (${soon.length})\n${soon.map(line).join("\n")}` : "",
      `\nOpen: ${process.env.BETTER_AUTH_URL ?? ""}/payments`,
    ].filter(Boolean).join("\n\n");

    const admins = await db.select({ email: user.email }).from(user).where(and(eq(user.role, "admin"), eq(user.banned, false)));
    for (const a of admins) {
      await sendEmail(a.email, `4CS payments: ${overdue.length} overdue, ${soon.length} due this week`, body);
      emailed++;
    }
  }

  return Response.json({ date: t, ...generated, dueOrOverdue: due.length, emailed });
}
