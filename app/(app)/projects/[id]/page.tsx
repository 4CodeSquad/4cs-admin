import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireUser } from "@/lib/dal";
import { getProject, listUsers } from "@/lib/queries";
import { today, formatDate } from "@/lib/dates";
import { CURRENCIES } from "@/lib/money";
import ActionForm from "@/components/ActionForm";
import ConfirmButton from "@/components/ConfirmButton";
import { D, Direction, Money, PaymentStatus, ProjectStatus, Totals } from "@/components/ui";
import { effectiveBasisPoints, splitBase, BP } from "@/lib/money-flow";
import { formatMoney } from "@/lib/money";
import {
  addLink,
  addMember,
  addNote,
  createPlan,
  deleteLink,
  deleteNote,
  deletePayment,
  deletePlan,
  markPaid,
  markPending,
  removeMember,
  removeShare,
  savePayment,
  setShare,
  setPlanActive,
} from "@/app/actions/data";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const me = await requireUser();
  const { id } = await params;
  const t = today();
  const p = await getProject(db, me, id, t);
  // Same 404 whether the project doesn't exist or isn't theirs.
  if (!p) notFound();
  const isAdmin = me.role === "admin";
  const people = isAdmin ? (await listUsers(db)).filter((u) => u.role !== "client" && !u.banned) : [];

  // Split summary: each share as a % of every client payment; the company keeps the rest.
  const pctOf = (bp: number) => `${(bp / 100).toFixed(2).replace(/\.00$/, "")}%`;
  const shareLabel = (s: (typeof p.shares)[number]) =>
    s.kind === "percent"
      ? `${pctOf(s.basisPoints ?? 0)} of each client payment`
      : `${formatMoney(s.amount ?? 0, p.currency)} fixed for the project`;
  // Fixed shares are measured against the budget, or what the client paid if more.
  const received = p.money?.received.find((r) => r.currency === p.currency)?.total ?? 0;
  const base = splitBase(p.budget, received);
  const splitBp = p.shares.reduce((t, s) => t + effectiveBasisPoints(s, base), 0);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">
            {isAdmin ? <a href={`/clients/${p.clientId}`}>{p.clientName}</a> : p.clientName}
          </p>
          <h1>{p.name}</h1>
        </div>
        <div className="row">
          <ProjectStatus status={p.status} />
          {isAdmin && <a className="btn secondary" href={`/projects/${p.id}/edit`}>Edit</a>}
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Details</h2>
          <dl className="facts">
            <dt>Start</dt><dd><D d={p.startDate} /></dd>
            <dt>Due</dt><dd><D d={p.dueDate} /></dd>
            {me.role !== "member" && (<><dt>Budget</dt><dd><Money amount={p.budget} currency={p.currency} /></dd></>)}
          </dl>
          {p.description && <p className="prewrap" style={{ marginTop: 12 }}>{p.description}</p>}
        </div>

        <div className="card">
          <h2>Team</h2>
          {p.members.length === 0 ? <p className="empty">No one assigned yet.</p> : (
            <table>
              <tbody>
                {p.members.map((m) => (
                  <tr key={m.userId}>
                    <td>{m.name}{isAdmin && <div className="muted">{m.email}</div>}</td>
                    <td className="muted">{m.role}</td>
                    {isAdmin && (
                      <td className="num">
                        <ConfirmButton action={removeMember.bind(null, p.id, m.userId)} confirm={`Remove ${m.name} from this project?`}>
                          Remove
                        </ConfirmButton>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {isAdmin && (
            <details className="add" style={{ marginTop: 12 }}>
              <summary className="btn small secondary">Add person</summary>
              <ActionForm action={addMember} submit="Add" resetOnSuccess>
                <input type="hidden" name="projectId" value={p.id} />
                <div className="cols">
                  <label>Person
                    <select name="userId" required defaultValue="">
                      <option value="" disabled>Choose…</option>
                      {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </label>
                  <label>Role on project<input name="role" placeholder="Lead developer" /></label>
                </div>
              </ActionForm>
            </details>
          )}
        </div>
      </div>

      {me.role !== "client" && (
        <div className="grid two">
          <div className="card">
            <h2>Money split</h2>
            {me.role === "member" ? (
              p.shares.length ? (
                <p>
                  Your share: <strong>{shareLabel(p.shares[0])}</strong>.
                  {p.shares[0].kind === "fixed" && " It's paid out step by step as the client pays."} Each time the client pays,
                  your part appears under your payments.
                </p>
              ) : (
                <p className="empty">No share set for you on this project.</p>
              )
            ) : (
              <>
                <p className="muted" style={{ marginBottom: 8 }}>
                  Measured against {formatMoney(base, p.currency)}
                  {received > (p.budget ?? 0) ? " (money received, more than the budget)" : " (the budget)"}.
                </p>
                {p.shares.length === 0 ? (
                  <p className="empty">No split yet — everything the client pays goes to the company fund.</p>
                ) : (
                  <table>
                    <tbody>
                      {p.shares.map((s) => (
                        <tr key={s.userId}>
                          <td>{s.name}</td>
                          <td>{shareLabel(s)}</td>
                          <td className="num muted">{pctOf(effectiveBasisPoints(s, base))}</td>
                          <td className="num">
                            <ConfirmButton action={removeShare.bind(null, p.id, s.userId)} className="btn small danger" confirm={`Remove ${s.name}'s share? Payouts already created stay.`}>
                              Remove
                            </ConfirmButton>
                          </td>
                        </tr>
                      ))}
                      <tr>
                        <td><strong>Company fund</strong></td>
                        <td className="muted">the rest of each payment</td>
                        <td className="num"><strong>{pctOf(Math.max(0, BP - splitBp))}</strong></td>
                        <td></td>
                      </tr>
                    </tbody>
                  </table>
                )}
                <details className="add" style={{ marginTop: 12 }}>
                  <summary className="btn small secondary">Set a share</summary>
                  <ActionForm action={setShare} submit="Save share" resetOnSuccess>
                    <input type="hidden" name="projectId" value={p.id} />
                    <div className="cols">
                      <label>Person
                        <select name="userId" required defaultValue="">
                          <option value="" disabled>Choose…</option>
                          {(p.members.length ? p.members.map((m) => ({ id: m.userId, name: m.name })) : people).map((u) => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                      </label>
                      <label>Type
                        <select name="kind" defaultValue="percent">
                          <option value="percent">% of each client payment</option>
                          <option value="fixed">Fixed amount for the project ({p.currency})</option>
                        </select>
                      </label>
                      <label>Value<input name="value" required inputMode="decimal" placeholder="40  or  3000" /></label>
                    </div>
                    <p className="muted">
                      Shares are taken from everything the client has paid on this project. A fixed amount fills up as
                      the client pays and is complete once the budget is paid; it can be up to the budget or the money
                      received, whichever is more. Saving recalculates the project; payouts already paid stay.
                    </p>
                  </ActionForm>
                </details>
              </>
            )}
          </div>
          {p.money && (
            <div className="card">
              <h2>Where the money went</h2>
              <dl className="facts">
                <dt>Client paid</dt><dd><Totals rows={p.money.received} /></dd>
                <dt>Team — paid</dt><dd><Totals rows={p.money.teamPaid} /></dd>
                <dt>Team — still to pay</dt><dd><Totals rows={p.money.teamPending} /></dd>
                <dt>Into company fund</dt><dd><Totals rows={p.money.companyShare} /></dd>
                <dt>Project costs (from fund)</dt><dd><Totals rows={p.money.costs} /></dd>
              </dl>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <div className="spread">
          <h2>{me.role === "member" ? "Your payments on this project" : me.role === "client" ? "Invoices" : "Payments"}</h2>
        </div>
        {p.payments.length === 0 ? <p className="empty">No payments yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Due</th>
                  {isAdmin && <th></th>}
                  <th>Description</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th>Paid</th>
                  {isAdmin && <th></th>}
                </tr>
              </thead>
              <tbody>
                {p.payments.map((x) => (
                  <tr key={x.id}>
                    <td><D d={x.dueDate} /></td>
                    {isAdmin && <td><Direction d={x.direction} /></td>}
                    <td>
                      {x.description}
                      {(x.payeeName || x.counterparty) && <span className="muted"> · {x.payeeName ?? x.counterparty}</span>}
                      {x.recurringPlanId && <span className="badge" style={{ marginLeft: 6 }}>recurring</span>}
                      {x.sourcePaymentId && <span className="badge blue" style={{ marginLeft: 6 }}>share</span>}
                    </td>
                    <td className="num"><Money amount={x.amount} currency={x.currency} /></td>
                    <td><PaymentStatus status={x.status} dueDate={x.dueDate} today={t} /></td>
                    <td className="muted">{x.paidOn ? formatDate(x.paidOn) : ""}{x.method ? ` · ${x.method}` : ""}</td>
                    {isAdmin && (
                      <td className="num">
                        <div className="row" style={{ justifyContent: "flex-end" }}>
                          {x.status === "pending" ? (
                            <ConfirmButton action={markPaid.bind(null, x.id)}>Mark paid</ConfirmButton>
                          ) : (
                            <ConfirmButton action={markPending.bind(null, x.id)}>Undo</ConfirmButton>
                          )}
                          {x.status !== "paid" && !x.sourcePaymentId && (
                            <ConfirmButton action={deletePayment.bind(null, x.id)} className="btn small danger" confirm="Delete this payment?">
                              Delete
                            </ConfirmButton>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {isAdmin && (
          <details className="add" style={{ marginTop: 12 }}>
            <summary className="btn small">Add payment</summary>
            <ActionForm action={savePayment} submit="Add payment" resetOnSuccess>
              <input type="hidden" name="projectId" value={p.id} />
              <div className="cols">
                <label>Direction
                  <select name="direction" defaultValue="incoming">
                    <option value="incoming">Incoming — client pays 4CS</option>
                    <option value="outgoing">Outgoing — 4CS pays someone</option>
                  </select>
                </label>
                <label>Description<input name="description" required placeholder="Deposit 30%" /></label>
                <label>Amount<input name="amount" inputMode="decimal" required /></label>
                <label>Currency
                  <select name="currency" defaultValue={p.currency}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
                </label>
              </div>
              <div className="cols">
                <label>Due date<input type="date" name="dueDate" required defaultValue={t} /></label>
                <label>Status
                  <select name="status" defaultValue="pending">
                    <option value="pending">Pending</option>
                    <option value="paid">Already paid</option>
                  </select>
                </label>
                <label>Paid to (outgoing only)
                  <select name="userId" defaultValue="">
                    <option value="">— not a team member —</option>
                    {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                  </select>
                </label>
                <label>Or vendor name (outgoing)<input name="counterparty" /></label>
              </div>
              <div className="cols">
                <label>Method<input name="method" placeholder="Bank transfer" /></label>
                <label>Reference / invoice no.<input name="reference" /></label>
              </div>
            </ActionForm>
          </details>
        )}
      </div>

      {(p.plans.length > 0 || isAdmin) && (
        <div className="card">
          <h2>Recurring</h2>
          {p.plans.length === 0 ? <p className="empty">No recurring payments.</p> : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    {isAdmin && <th></th>}
                    <th>Description</th>
                    <th className="num">Amount</th>
                    <th>Every</th>
                    <th>Next due</th>
                    <th>Ends</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {p.plans.map((r) => (
                    <tr key={r.id}>
                      {isAdmin && <td><Direction d={r.direction} /></td>}
                      <td>{r.description}{r.payeeName && <span className="muted"> · {r.payeeName}</span>}</td>
                      <td className="num"><Money amount={r.amount} currency={r.currency} /></td>
                      <td>{r.interval}</td>
                      <td>{r.active ? <D d={r.nextDueDate} /> : "—"}</td>
                      <td><D d={r.endDate} /></td>
                      <td className="num">
                        {isAdmin ? (
                          <div className="row" style={{ justifyContent: "flex-end" }}>
                            <ConfirmButton action={setPlanActive.bind(null, r.id, !r.active)}>{r.active ? "Pause" : "Resume"}</ConfirmButton>
                            <ConfirmButton action={deletePlan.bind(null, r.id)} className="btn small danger" confirm="Delete this plan? Payments it already created are kept.">
                              Delete
                            </ConfirmButton>
                          </div>
                        ) : (
                          <span className={`badge ${r.active ? "green" : ""}`}>{r.active ? "active" : "ended"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {isAdmin && (
            <details className="add" style={{ marginTop: 12 }}>
              <summary className="btn small">Add recurring payment</summary>
              <ActionForm action={createPlan} submit="Set up" resetOnSuccess>
                <input type="hidden" name="projectId" value={p.id} />
                <div className="cols">
                  <label>Direction
                    <select name="direction" defaultValue="incoming">
                      <option value="incoming">Incoming — client pays 4CS</option>
                      <option value="outgoing">Outgoing — 4CS pays someone</option>
                    </select>
                  </label>
                  <label>Description<input name="description" required placeholder="Hosting & maintenance" /></label>
                  <label>Amount<input name="amount" inputMode="decimal" required /></label>
                  <label>Currency
                    <select name="currency" defaultValue={p.currency}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</select>
                  </label>
                </div>
                <div className="cols">
                  <label>Every
                    <select name="interval" defaultValue="monthly">
                      <option value="weekly">Week</option>
                      <option value="monthly">Month</option>
                      <option value="quarterly">Quarter</option>
                      <option value="yearly">Year</option>
                    </select>
                  </label>
                  <label>First due date<input type="date" name="startDate" required defaultValue={t} /></label>
                  <label>Last date (optional)<input type="date" name="endDate" /></label>
                  <label>Paid to (outgoing only)
                    <select name="userId" defaultValue="">
                      <option value="">—</option>
                      {people.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </label>
                </div>
              </ActionForm>
            </details>
          )}
        </div>
      )}

      <div className="grid two">
        <div className="card">
          <h2>Notes</h2>
          {me.role !== "client" && (
            <ActionForm action={addNote} submit="Add note" resetOnSuccess>
              <input type="hidden" name="projectId" value={p.id} />
              <textarea name="body" required placeholder="Decisions, meeting notes, credentials location…" rows={3} />
              {isAdmin && (
                <label className="check">
                  <select name="visibility" defaultValue="team" style={{ width: "auto" }}>
                    <option value="team">Team only</option>
                    <option value="client">Also visible to the client</option>
                  </select>
                </label>
              )}
            </ActionForm>
          )}
          {p.notes.length === 0 ? <p className="empty">No notes.</p> : (
            <div className="stack" style={{ marginTop: 16 }}>
              {p.notes.map((n) => (
                <div key={n.id}>
                  <div className="spread">
                    <span className="muted">
                      {n.authorName ?? "—"} · {n.createdAt.toLocaleDateString("en-GB", { timeZone: "Europe/Tirane" })}
                      {me.role !== "client" && n.visibility === "client" && <span className="badge blue" style={{ marginLeft: 6 }}>client can see</span>}
                    </span>
                    {isAdmin && (
                      <ConfirmButton action={deleteNote.bind(null, n.id)} className="btn small danger" confirm="Delete this note?">Delete</ConfirmButton>
                    )}
                  </div>
                  <p className="prewrap">{n.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h2>Files & links</h2>
          {p.links.length === 0 ? <p className="empty">No links.</p> : (
            <table>
              <tbody>
                {p.links.map((l) => (
                  <tr key={l.id}>
                    <td><a href={l.url} target="_blank" rel="noopener noreferrer">{l.label}</a></td>
                    {me.role !== "client" && <td>{l.visibility === "client" && <span className="badge blue">client can see</span>}</td>}
                    {isAdmin && (
                      <td className="num">
                        <ConfirmButton action={deleteLink.bind(null, l.id)} className="btn small danger" confirm="Remove this link?">Remove</ConfirmButton>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {isAdmin && (
            <details className="add" style={{ marginTop: 12 }}>
              <summary className="btn small secondary">Add link</summary>
              <ActionForm action={addLink} submit="Add" resetOnSuccess>
                <input type="hidden" name="projectId" value={p.id} />
                <label>Label<input name="label" required placeholder="Signed contract (Drive)" /></label>
                <label>URL<input name="url" type="url" required placeholder="https://" /></label>
                <label>Visibility
                  <select name="visibility" defaultValue="team">
                    <option value="team">Team only</option>
                    <option value="client">Also visible to the client</option>
                  </select>
                </label>
              </ActionForm>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
