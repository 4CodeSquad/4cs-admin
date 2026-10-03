import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { requireAdmin } from "@/lib/dal";
import { getProject, listClients } from "@/lib/queries";
import { today } from "@/lib/dates";
import ProjectForm from "@/components/ProjectForm";

export const metadata: Metadata = { title: "Edit project" };

export default async function EditProjectPage({ params }: PageProps<"/projects/[id]/edit">) {
  const me = await requireAdmin();
  const { id } = await params;
  const [project, clients] = await Promise.all([getProject(db, me, id, today()), listClients(db)]);
  if (!project) notFound();
  return (
    <div className="stack">
      <div className="page-head">
        <h1>Edit {project.name}</h1>
        <a className="btn secondary" href={`/projects/${id}`}>Back</a>
      </div>
      <div className="card"><ProjectForm project={project} clients={clients} /></div>
    </div>
  );
}
