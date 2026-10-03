import type { Metadata } from "next";
import { db } from "@/db";
import { requireUser } from "@/lib/dal";
import { listProjects } from "@/lib/queries";
import { D, Money, ProjectStatus } from "@/components/ui";

export const metadata: Metadata = { title: "Projects" };

const FILTERS = ["current", "lead", "active", "paused", "completed", "cancelled", "all"];

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const me = await requireUser();
  const sp = await searchParams;
  const filter = typeof sp.status === "string" && FILTERS.includes(sp.status) ? sp.status : "current";
  const rows = await listProjects(db, me, filter === "current" ? undefined : filter);

  return (
    <div className="stack">
      <div className="page-head">
        <h1>{me.role === "member" ? "My projects" : "Projects"}</h1>
        {me.role === "admin" && <a className="btn" href="/projects/new">New project</a>}
      </div>
      <div className="filters">
        {FILTERS.map((f) => (
          <a key={f} href={`/projects?status=${f}`} aria-current={f === filter ? "true" : undefined}>{f}</a>
        ))}
      </div>
      <div className="card table-wrap">
        {rows.length === 0 ? (
          <p className="empty">No projects here.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Client</th>
                <th>Status</th>
                <th>Start</th>
                <th>Due</th>
                {me.role !== "member" && <th className="num">Budget</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td><a href={`/projects/${p.id}`}>{p.name}</a></td>
                  <td>{p.clientName}</td>
                  <td><ProjectStatus status={p.status} /></td>
                  <td><D d={p.startDate} /></td>
                  <td><D d={p.dueDate} /></td>
                  {me.role !== "member" && <td className="num"><Money amount={p.budget} currency={p.currency} /></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
