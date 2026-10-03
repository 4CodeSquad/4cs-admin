/**
 * Money is integer minor units everywhere except at the edges: parsed from a
 * form once, formatted for display once.
 */

export const CURRENCIES = ["EUR", "ALL", "USD"] as const;
export type Currency = (typeof CURRENCIES)[number];

/** "1.234,50", "1,234.50", "1234.5", "1234" → 123450. Null if not a number. */
export function parseAmount(input: string): number | null {
  let s = input.trim().replace(/[\s€$]|ALL|EUR|USD|Lek/gi, "");
  if (!s) return null;
  // Whichever separator comes last is the decimal one, if 1–2 digits follow it.
  const decIdx = Math.max(s.lastIndexOf(","), s.lastIndexOf("."));
  if (decIdx !== -1 && s.length - decIdx - 1 <= 2) {
    s = s.slice(0, decIdx).replace(/[.,]/g, "") + "." + s.slice(decIdx + 1);
  } else {
    s = s.replace(/[.,]/g, "");
  }
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

export function formatMoney(minor: number, currency: Currency | string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    // Lek is quoted in whole units in practice.
    minimumFractionDigits: currency === "ALL" ? 0 : 2,
    maximumFractionDigits: currency === "ALL" ? 0 : 2,
  }).format(minor / 100);
}

/** Minor units → the value to prefill an amount input with. */
export const toInputAmount = (minor: number | null | undefined) =>
  minor == null ? "" : (minor / 100).toFixed(2).replace(/\.00$/, "");
