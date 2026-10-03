import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export function Money({ amount, currency }: { amount: number | null; currency: string }) {
  return <>{amount == null ? "—" : formatMoney(amount, currency)}</>;
}

/** Amounts in several currencies are listed, never added together. */
export function Totals({ rows }: { rows: { currency: string; total: number }[] }) {
  if (!rows.length) return <>—</>;
  return <>{rows.map((r) => formatMoney(r.total, r.currency)).join(" · ")}</>;
}

export const D = ({ d }: { d: string | null | undefined }) => <>{formatDate(d)}</>;

const projectTone: Record<string, string> = { lead: "blue", active: "green", paused: "amber", completed: "", cancelled: "red" };
export const ProjectStatus = ({ status }: { status: string }) => (
  <span className={`badge ${projectTone[status] ?? ""}`}>{status}</span>
);

export function PaymentStatus({ status, dueDate, today }: { status: string; dueDate: string; today: string }) {
  if (status === "paid") return <span className="badge green">paid</span>;
  if (status === "cancelled") return <span className="badge">cancelled</span>;
  if (dueDate < today) return <span className="badge red">overdue</span>;
  return <span className="badge amber">due</span>;
}

export const Direction = ({ d }: { d: string }) => (
  <span className="muted">{d === "incoming" ? "← in" : "out →"}</span>
);
