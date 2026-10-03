import type { Metadata } from "next";
import { db } from "@/db";
import { requireAdmin } from "@/lib/dal";
import { listAudit, listUsers } from "@/lib/queries";
import ActionForm from "@/components/ActionForm";
import ConfirmButton from "@/components/ConfirmButton";
import { inviteUser, resendInvite, setBanned, setRole } from "@/app/actions/users";

export const metadata: Metadata = { title: "Team & access" };

export default async function TeamPage() {
  const me = await requireAdmin();
  const [users, log] = await Promise.all([listUsers(db), listAudit(db, 60)]);

  return (
    <div className="stack">
      <div className="page-head"><h1>Team &amp; access</h1></div>

      <div className="card">
        <h2>Invite someone</h2>
        <p className="muted" style={{ marginBottom: 12 }}>
          They get an email with a link to set their own password (valid 48 hours).
          <strong> Member</strong>: sees projects they&rsquo;re assigned to and their own payments.
          <strong> Client</strong>: sees their company&rsquo;s projects and invoices (link them on the client&rsquo;s page).
          <strong> Admin</strong>: sees and edits everything; must turn on two-step login.
        </p>
        <ActionForm action={inviteUser} submit="Send invite" resetOnSuccess>
          <div className="cols">
            <label>Name<input name="name" required /></label>
            <label>Email<input name="email" type="email" required /></label>
            <label>Role
              <select name="role" defaultValue="member">
                <option value="member">Member (team)</option>
                <option value="client">Client</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>
        </ActionForm>
      </div>

      <div className="card table-wrap">
        <h2>People</h2>
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>2-step</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}<div className="muted">{u.email}</div></td>
                <td>
                  {u.id === me.id ? (
                    <span className="badge">{u.role}</span>
                  ) : (
                    <form action={setRole.bind(null, u.id)} className="row">
                      <select name="role" defaultValue={u.role} style={{ width: "auto" }}>
                        <option value="member">member</option>
                        <option value="client">client</option>
                        <option value="admin">admin</option>
                      </select>
                      <button className="btn small secondary">Set</button>
                    </form>
                  )}
                </td>
                <td>{u.twoFactorEnabled ? <span className="badge green">on</span> : <span className="badge">off</span>}</td>
                <td>{u.banned ? <span className="badge red">blocked</span> : <span className="badge green">active</span>}</td>
                <td className="num">
                  {u.id !== me.id && (
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      <ConfirmButton action={resendInvite.bind(null, u.id)}>Send password link</ConfirmButton>
                      <ConfirmButton
                        action={setBanned.bind(null, u.id, !u.banned)}
                        className={`btn small ${u.banned ? "secondary" : "danger"}`}
                        confirm={u.banned ? undefined : `Block ${u.name}? They are signed out everywhere immediately.`}
                      >
                        {u.banned ? "Unblock" : "Block"}
                      </ConfirmButton>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card table-wrap">
        <h2>Activity log</h2>
        {log.length === 0 ? <p className="empty">Nothing yet.</p> : (
          <table>
            <tbody>
              {log.map((l) => (
                <tr key={l.id}>
                  <td className="muted" style={{ whiteSpace: "nowrap" }}>
                    {l.createdAt.toLocaleString("en-GB", { timeZone: "Europe/Tirane", dateStyle: "short", timeStyle: "short" })}
                  </td>
                  <td>{l.actorName ?? "system"}</td>
                  <td><span className="mono">{l.action}</span> {l.entityType}</td>
                  <td className="muted">{l.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
