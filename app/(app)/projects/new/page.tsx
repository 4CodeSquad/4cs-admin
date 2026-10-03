import type { Metadata } from "next";
import { db } from "@/db";
import { requireAdmin } from "@/lib/dal";
import { listClients } from "@/lib/queries";
import ProjectForm from "@/components/ProjectForm";

export const metadata: Metadata = { title: "New project" };

export default async function NewProjectPage({ searchParams }: PageProps<"/projects/new">) {
  await requireAdmin();
  const sp = await searchParams;
  const clients = (await listClients(db)).filter((c) => !c.archived);
  return (
    <div className="stack">
      <div className="page-head"><h1>New project</h1></div>
      {clients.length === 0 ? (
        <p className="msg warn">Add a client first. <a href="/clients/new">New client</a></p>
      ) : (
        <div className="card">
          <ProjectForm clients={clients} defaultClientId={typeof sp.client === "string" ? sp.client : undefined} />
        </div>
      )}
    </div>
  );
}
