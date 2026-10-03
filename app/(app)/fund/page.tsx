import type { Metadata } from "next";
import { db } from "@/db";
import { requireAdmin } from "@/lib/dal";
import { fundBalance, listFundEntries, listProjects } from "@/lib/queries";
import { today } from "@/lib/dates";
import { CURRENCIES, formatMoney } from "@/lib/money";
import ActionForm from "@/components/ActionForm";
import ConfirmButton from "@/components/ConfirmButton";
import { D } from "@/components/ui";
import { addFundEntry, deleteFundEntry } from "@/app/actions/data";

export const metadata: Metadata = { title: "Company fund" };

const OUT_CATEGORIES = ["Equipment", "Software & subscriptions", "Marketing", "Office & rent", "Taxes & fees", "Salaries & bonuses", "Training", "Travel", "Other expense"];
const IN_CATEGORIES = ["Other income", "Owner investment", "Loan", "Refund"];

export default async function FundPage({ searchParams }: PageProps<"/fund">) {
  const me = await requireAdmin();
  const sp = await searchParams;
  const dir = sp.dir === "in" || sp.dir === "out" ? sp.dir : undefined;
  const [balance, entries, projects] = await Promise.all([
    fundBalance(db),
    listFundEntries(db, { direction: dir }),
    listProjects(db, me, "all"),
  ]);
  const t = today();

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Admins only</p>
          <h1>Company fund</h1>
        </div>
      </div>

      <div className="grid stats">
        {balance.length === 0 ? (
          <div className="card stat"><p className="eyebrow">Balance</p><p className="value">—</p></div>
        ) : (
          balance.map((b) => (
            <div className="card stat" key={b.currency}>
              <p className="eyebrow">Balance {b.currency}</p>
              <p className={`value${b.total < 0 ? " bad" : ""}`}>{formatMoney(b.total, b.currency)}</p>
              <p className="muted">in {formatMoney(b.in, b.currency)} · out {formatMoney(b.out, b.currency)}</p>
            </div>
          ))
        )}
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Spend from the fund</h2>
          <ActionForm action={addFundEntry} submit="Record expense" resetOnSuccess>
            <input type="hidden" name="direction" value="out" />
            <label>What was it for?<input name="description" required placeholder="New laptop for Dea" /></label>
            <div className="cols">
              <label>Amount<input name="amount" inputMode="decimal" required /></label>
              <label>Currency<select name="currency" defaultValue="EUR">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label>Date<input type="date" name="entryDate" defaultValue={t} required /></label>
            </div>
            <div className="cols">
              <label>Category<select name="category" defaultValue="Equipment">{OUT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label>Project (optional)
                <select name="projectId" defaultValue="">
                  <option value="">—</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>
          </ActionForm>
        </div>
        <div className="card">
          <h2>Add money to the fund</h2>
          <p className="muted" style={{ marginBottom: 12 }}>
            The company&rsquo;s share of client payments is added automatically. Use this for anything else.
          </p>
          <ActionForm action={addFundEntry} submit="Add to fund" resetOnSuccess>
            <input type="hidden" name="direction" value="in" />
            <label>Description<input name="description" required placeholder="Owner investment" /></label>
            <div className="cols">
              <label>Amount<input name="amount" inputMode="decimal" required /></label>
              <label>Currency<select name="currency" defaultValue="EUR">{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label>Date<input type="date" name="entryDate" defaultValue={t} required /></label>
              <label>Category<select name="category" defaultValue="Other income">{IN_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select></label>
            </div>
          </ActionForm>
        </div>
      </div>

      <div className="card table-wrap">
        <div className="spread">
          <h2>History</h2>
          <div className="filters">
            <a href="/fund" aria-current={!dir ? "true" : undefined}>all</a>
            <a href="/fund?dir=in" aria-current={dir === "in" ? "true" : undefined}>in</a>
            <a href="/fund?dir=out" aria-current={dir === "out" ? "true" : undefined}>out</a>
          </div>
        </div>
        {entries.length === 0 ? <p className="empty">Nothing yet.</p> : (
          <table>
            <thead>
              <tr><th>Date</th><th>Description</th><th>Category</th><th className="num">Amount</th><th></th></tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td><D d={e.entryDate} /></td>
                  <td>
                    {e.description}
                    {e.projectId && e.projectName && !e.description.startsWith(e.projectName) && (
                      <> · <a href={`/projects/${e.projectId}`}>{e.projectName}</a></>
                    )}
                    {e.createdByName && <div className="muted">by {e.createdByName}</div>}
                  </td>
                  <td>{e.category}{e.paymentId && <span className="badge" style={{ marginLeft: 6 }}>auto</span>}</td>
                  <td className="num" style={{ color: e.direction === "in" ? "var(--green)" : "var(--red)" }}>
                    {e.direction === "in" ? "+" : "−"}{formatMoney(e.amount, e.currency)}
                  </td>
                  <td className="num">
                    {e.paymentId ? (
                      e.projectId && <a className="btn small secondary" href={`/projects/${e.projectId}`}>Payment</a>
                    ) : (
                      <ConfirmButton action={deleteFundEntry.bind(null, e.id)} className="btn small danger" confirm="Delete this entry?">Delete</ConfirmButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
