import ActionForm from "./ActionForm";
import { saveProject } from "@/app/actions/data";
import { CURRENCIES, toInputAmount } from "@/lib/money";

type Project = {
  id: string;
  clientId: string;
  name: string;
  status: string;
  description: string | null;
  startDate: string | null;
  dueDate: string | null;
  budget: number | null;
  currency: string;
};

export default function ProjectForm({
  project,
  clients,
  defaultClientId,
}: {
  project?: Project;
  clients: { id: string; name: string }[];
  defaultClientId?: string;
}) {
  return (
    <ActionForm action={saveProject} submit={project ? "Save project" : "Create project"}>
      {project && <input type="hidden" name="id" value={project.id} />}
      <div className="cols">
        <label>
          Name
          <input name="name" defaultValue={project?.name} required />
        </label>
        <label>
          Client
          <select name="clientId" defaultValue={project?.clientId ?? defaultClientId ?? ""} required>
            <option value="" disabled>Choose…</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select name="status" defaultValue={project?.status ?? "lead"}>
            {["lead", "active", "paused", "completed", "cancelled"].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="cols">
        <label>
          Start date
          <input type="date" name="startDate" defaultValue={project?.startDate ?? ""} />
        </label>
        <label>
          Due date
          <input type="date" name="dueDate" defaultValue={project?.dueDate ?? ""} />
        </label>
        <label>
          Budget (agreed price)
          <input name="budget" inputMode="decimal" defaultValue={toInputAmount(project?.budget)} placeholder="e.g. 4500" />
        </label>
        <label>
          Currency
          <select name="currency" defaultValue={project?.currency ?? "EUR"}>
            {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <label>
        Description / scope
        <textarea name="description" defaultValue={project?.description ?? ""} rows={5} />
      </label>
    </ActionForm>
  );
}
