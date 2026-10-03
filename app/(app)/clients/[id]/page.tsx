import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireAdmin } from "@/lib/dal";
import { getClient, listUsers } from "@/lib/queries";
import ClientForm from "@/components/ClientForm";
import ActionForm from "@/components/ActionForm";
import ConfirmButton from "@/components/ConfirmButton";
import { D, ProjectStatus } from "@/components/ui";
import { linkPortalUser, setClientArchived, unlinkPortalUser } from "@/app/actions/data";

export const metadata: Metadata = { title: "Client" };

export default async function ClientPage({ params }: PageProps<"/clients/[id]">) {
  await requireAdmin();
  const { id } = await params;
  const [c, users] = await Promise.all([getClient(db, id), listUsers(db)]);
  if (!c) notFound();
  const linkable = users.filter((u) => u.role === "client" && !c.portalUsers.some((p) => p.id === u.id));

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">Client</p>
          <h1>{c.name}</h1>
        </div>
        <div className="row">
          <a className="btn" href={`/projects/new?client=${c.id}`}>New project</a>
          <ConfirmButton action={setClientArchived.bind(null, c.id, !c.archived)}>
            {c.archived ? "Unarchive" : "Archive"}
          </ConfirmButton>
        </div>
      </div>

      <div className="grid two">
        <div className="card">
          <h2>Projects</h2>
          {c.projects.length === 0 ? <p className="empty">None yet.</p> : (
            <table>
              <tbody>
                {c.projects.map((p) => (
                  <tr key={p.id}>
                    <td><a href={`/projects/${p.id}`}>{p.name}</a></td>
                    <td><ProjectStatus status={p.status} /></td>
                    <td className="muted"><D d={p.dueDate} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h2>Client portal access</h2>
          <p className="muted" style={{ marginBottom: 12 }}>
            People here can sign in and see this client&rsquo;s projects, invoices, and the notes and links marked
            &ldquo;client can see&rdquo;. Create them on <a href="/team">Team &amp; access</a> with the Client role first.
          </p>
          {c.portalUsers.length === 0 ? <p className="empty">No one has portal access.</p> : (
            <table>
              <tbody>
                {c.portalUsers.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}<div className="muted">{u.email}</div></td>
                    <td className="num">
                      <ConfirmButton action={unlinkPortalUser.bind(null, c.id, u.id)} className="btn small danger" confirm={`Remove ${u.name}'s access?`}>
                        Remove
                      </ConfirmButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {linkable.length > 0 && (
            <ActionForm action={linkPortalUser} submit="Give access" resetOnSuccess className="fields" >
              <input type="hidden" name="clientId" value={c.id} />
              <label>Client user
                <select name="userId" required defaultValue="">
                  <option value="" disabled>Choose…</option>
                  {linkable.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
                </select>
              </label>
            </ActionForm>
          )}
        </div>
      </div>

      <div className="card">
        <h2>Details</h2>
        <ClientForm client={c} />
      </div>
    </div>
  );
}
