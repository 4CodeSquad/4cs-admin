import type { Metadata } from "next";
import { db } from "@/db";
import { requireUser } from "@/lib/dal";
import { dashboard, fundBalance } from "@/lib/queries";
import { today } from "@/lib/dates";
import { D, Direction, Money, PaymentStatus, Totals } from "@/components/ui";

export const metadata: Metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const me = await requireUser();
  const t = today();
  const [d, fund] = await Promise.all([dashboard(db, me, t), me.role === "admin" ? fundBalance(db) : Promise.resolve([])]);
  const overdue = (rows: { currency: string; overdue: number }[]) =>
    rows.filter((r) => r.overdue > 0).map((r) => ({ currency: r.currency, total: r.overdue }));

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">{me.role === "client" ? "Overview" : "Dashboard"}</p>
          <h1>Hello, {me.name.split(" ")[0]}</h1>
        </div>
      </div>

      <div className="grid stats">
        <div className="card stat">
          <p className="eyebrow">Active projects</p>
          <p className="value">{d.activeProjects}</p>
        </div>
        {me.role !== "member" && (
          <>
            <div className="card stat">
              <p className="eyebrow">{me.role === "client" ? "To pay" : "Owed to 4CS"}</p>
              <p className="value"><Totals rows={d.incoming} /></p>
            </div>
            <div className="card stat">
              <p className="eyebrow">Overdue</p>
              <p className={`value${overdue(d.incoming).length ? " bad" : ""}`}><Totals rows={overdue(d.incoming)} /></p>
            </div>
          </>
        )}
        {me.role !== "client" && (
          <div className="card stat">
            <p className="eyebrow">{me.role === "member" ? "Owed to you" : "4CS owes"}</p>
            <p className="value"><Totals rows={d.outgoing} /></p>
          </div>
        )}
        {me.role === "admin" && (
          <a className="card stat" href="/fund" style={{ textDecoration: "none" }}>
            <p className="eyebrow">Company fund</p>
            <p className="value"><Totals rows={fund} /></p>
          </a>
        )}
        <div className="card stat">
          <p className="eyebrow">{me.role === "admin" ? "Settled this year" : "Paid this year"}</p>
          <p className="value"><Totals rows={d.paidThisYear} /></p>
        </div>
      </div>

      <div className="card">
        <div className="spread">
          <h2>Due in the next 30 days (and overdue)</h2>
          <a className="btn small secondary" href="/payments">All payments</a>
        </div>
        {d.upcoming.length === 0 ? (
          <p className="empty">Nothing due.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Due</th>
                  {me.role === "admin" && <th></th>}
                  <th>Project</th>
                  <th>Description</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {d.upcoming.map((p) => (
                  <tr key={p.id}>
                    <td><D d={p.dueDate} /></td>
                    {me.role === "admin" && <td><Direction d={p.direction} /></td>}
                    <td><a href={`/projects/${p.projectId}`}>{p.projectName}</a></td>
                    <td>{p.description}{p.payeeName && <span className="muted"> · {p.payeeName}</span>}</td>
                    <td className="num"><Money amount={p.amount} currency={p.currency} /></td>
                    <td><PaymentStatus status={p.status} dueDate={p.dueDate} today={t} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
