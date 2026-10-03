/**
 * Calendar dates are "YYYY-MM-DD" strings end to end, so no time zone can move
 * a due date. "Today" is today in Tirana, wherever the server runs (Vercel
 * functions run in UTC).
 */

export const TIMEZONE = "Europe/Tirane";

export type Interval = "weekly" | "monthly" | "quarterly" | "yearly";

export function today(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(now);
}

const parse = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return { y, m, day };
};
const fmt = (y: number, m: number, day: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function addDays(d: string, n: number): string {
  const { y, m, day } = parse(d);
  const t = new Date(Date.UTC(y, m - 1, day + n));
  return fmt(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function addMonths(d: string, n: number): string {
  const { y, m, day } = parse(d);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  // Clamp: 31 Jan + 1 month = 28/29 Feb.
  return fmt(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

/**
 * The n-th due date of a schedule (n = 0 is the start date). Always computed
 * from the start date rather than from the previous due date, so a plan that
 * starts on the 31st returns to the 31st after a short month.
 */
export function nthOccurrence(start: string, interval: Interval, n: number): string {
  switch (interval) {
    case "weekly":
      return addDays(start, 7 * n);
    case "monthly":
      return addMonths(start, n);
    case "quarterly":
      return addMonths(start, 3 * n);
    case "yearly":
      return addMonths(start, 12 * n);
  }
}

export const isValidDate = (d: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d + "T00:00:00Z")) &&
  fmt(parse(d).y, parse(d).m, parse(d).day) === new Date(d + "T00:00:00Z").toISOString().slice(0, 10);

export function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(d + "T00:00:00Z"));
}
