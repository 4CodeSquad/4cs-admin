import type { Metadata } from "next";
import { requireAdmin } from "@/lib/dal";
import ClientForm from "@/components/ClientForm";

export const metadata: Metadata = { title: "New client" };

export default async function NewClientPage() {
  await requireAdmin();
  return (
    <div className="stack">
      <div className="page-head"><h1>New client</h1></div>
      <div className="card"><ClientForm /></div>
    </div>
  );
}
