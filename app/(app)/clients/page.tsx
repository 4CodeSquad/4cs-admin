import type { Metadata } from "next";
import { db } from "@/db";
import { requireAdmin } from "@/lib/dal";
import { listClients } from "@/lib/queries";

export const metadata: Metadata = { title: "Clients" };

export default async function ClientsPage() {
  await requireAdmin();
  const rows = await listClients(db);
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Clients</h1>
        <a className="btn" href="/clients/new">New client</a>
      </div>
      <div className="card table-wrap">
        {rows.length === 0 ? <p className="empty">No clients yet.</p> : (
          <table>
            <thead><tr><th>Client</th><th>Contact</th><th>Email</th><th>Phone</th><th className="num">Projects</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td><a href={`/clients/${c.id}`}>{c.name}</a>{c.archived && <span className="badge" style={{ marginLeft: 6 }}>archived</span>}</td>
                  <td>{c.contactName}</td>
                  <td>{c.email}</td>
                  <td>{c.phone}</td>
                  <td className="num">{c.projectCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
