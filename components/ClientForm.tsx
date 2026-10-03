import ActionForm from "./ActionForm";
import { saveClient } from "@/app/actions/data";

type Client = {
  id: string; name: string; contactName: string | null; email: string | null;
  phone: string | null; address: string | null; nipt: string | null; notes: string | null;
};

export default function ClientForm({ client }: { client?: Client }) {
  return (
    <ActionForm action={saveClient} submit={client ? "Save client" : "Create client"}>
      {client && <input type="hidden" name="id" value={client.id} />}
      <div className="cols">
        <label>Company / client name<input name="name" defaultValue={client?.name} required /></label>
        <label>Contact person<input name="contactName" defaultValue={client?.contactName ?? ""} /></label>
        <label>Email<input name="email" type="email" defaultValue={client?.email ?? ""} /></label>
        <label>Phone<input name="phone" defaultValue={client?.phone ?? ""} /></label>
      </div>
      <div className="cols">
        <label>Address<input name="address" defaultValue={client?.address ?? ""} /></label>
        <label>NIPT<input name="nipt" defaultValue={client?.nipt ?? ""} /></label>
      </div>
      <label>Notes<textarea name="notes" defaultValue={client?.notes ?? ""} rows={3} /></label>
    </ActionForm>
  );
}
