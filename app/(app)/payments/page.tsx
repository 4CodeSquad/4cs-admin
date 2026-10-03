import type { Metadata } from "next";
import { db } from "@/db";
import { requireUser } from "@/lib/dal";
import { listPayments, type PaymentFilter } from "@/lib/queries";
import { today, formatDate } from "@/lib/dates";
import ConfirmButton from "@/components/ConfirmButton";
import { D, Direction, Money, PaymentStatus, Totals } from "@/components/ui";
import { markPaid, markPending } from "@/app/actions/data";

export const metadata: Metadata = { title: "Payments" };

const FILTERS: PaymentFilter[] = ["open", "overdue", "paid", "all"];

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const me = await requireUser();
  const sp = await searchParams;
  const filter = FILTERS.includes(sp.filter as PaymentFilter) ? (sp.filter as PaymentFilter) : "open";
  const dir = sp.dir === "incoming" || sp.dir === "outgoing" ? sp.dir : undefined;
  const t = today();
  const rows = (await listPayments(db, me, { filter, today: t })).filter((r) => !dir || r.direction === dir);
  const isAdmin = me.role === "admin";

  // Per-currency sums of what's listed (currencies are never added together).
  const sums = Object.values(
    rows.reduce<Record<string, { currency: string; total: number }>>((acc, r) => {
      if (r.status === "cancelled") return acc;
      const k = `${r.direction}:${r.currency}`;
      acc[k] ??= { currency: r.currency, total: 0 };
      acc[k].total += r.direction === "incoming" ? r.amount : -r.amount;
      return acc;
    }, {}),
  );
  const href = (f: string, d = dir) => `/payments?filter=${f}${d ? `&dir=${d}` : ""}`;

  return (
    <div className="stack">
      <div className="page-head">
        <h1>{me.role === "member" ? "My payments" : me.role === "client" ? "Invoices" : "Payments"}</h1>
      </div>
      <div className="spread">
        <div className="filters">
          {FILTERS.map((f) => (
            <a key={f} href={href(f)} aria-current={f === filter ? "true" : undefined}>{f}</a>
          ))}
        </div>
        {isAdmin && (
          <div className="filters">
            <a href={href(filter, undefined)} aria-current={!dir ? "true" : undefined}>both</a>
            <a href={href(filter, "incoming")} aria-current={dir === "incoming" ? "true" : undefined}>incoming</a>
            <a href={href(filter, "outgoing")} aria-current={dir === "outgoing" ? "true" : undefined}>outgoing</a>
          </div>
        )}
      </div>
      <div className="card table-wrap">
        {rows.length === 0 ? (
          <p className="empty">Nothing here.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Due</th>
                {isAdmin && <th></th>}
                <th>Project</th>
                <th>Description</th>
                <th className="num">Amount</th>
                <th>Status</th>
                <th>Paid</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.id}>
                  <td><D d={x.dueDate} /></td>
                  {isAdmin && <td><Direction d={x.direction} /></td>}
                  <td><a href={`/projects/${x.projectId}`}>{x.projectName}</a></td>
                  <td>{x.description}{(x.payeeName || x.counterparty) && <span className="muted"> · {x.payeeName ?? x.counterparty}</span>}</td>
                  <td className="num"><Money amount={x.amount} currency={x.currency} /></td>
                  <td><PaymentStatus status={x.status} dueDate={x.dueDate} today={t} /></td>
                  <td className="muted">{x.paidOn ? formatDate(x.paidOn) : ""}</td>
                  {isAdmin && (
                    <td className="num">
                      {x.status === "pending" ? (
                        <ConfirmButton action={markPaid.bind(null, x.id)}>Mark paid</ConfirmButton>
                      ) : x.status === "paid" ? (
                        <ConfirmButton action={markPending.bind(null, x.id)}>Undo</ConfirmButton>
                      ) : null}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {isAdmin && rows.length > 0 && (
        <p className="muted">Net of what&rsquo;s listed (incoming − outgoing): <strong><Totals rows={sums} /></strong></p>
      )}
    </div>
  );
}
