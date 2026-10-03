import { z } from "zod";
import { parseAmount, CURRENCIES } from "./money";
import { isValidDate } from "./dates";

/** Shape every form action returns to useActionState. */
export type FormState = { error?: string; ok?: string } | undefined;

const optional = (s: z.ZodString) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), s.optional());

export const text = (max = 200) => z.string().trim().min(1, "Required").max(max);
export const optText = (max = 2000) => optional(z.string().trim().max(max));
export const optEmail = optional(z.string().trim().email("Not a valid email"));
export const date = z.string().refine(isValidDate, "Not a valid date");
export const optDate = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().refine(isValidDate, "Not a valid date").optional(),
);
export const amount = z
  .string()
  .transform((v, ctx) => {
    const n = parseAmount(v);
    if (n === null || n < 0) {
      ctx.addIssue({ code: "custom", message: "Not a valid amount" });
      return z.NEVER;
    }
    return n;
  });
export const optAmount = z.preprocess((v) => (v === "" ? undefined : v), amount.optional());
export const currency = z.enum(CURRENCIES);
export const url = z.string().trim().url("Not a valid URL").refine((u) => /^https?:\/\//.test(u), "Must start with http(s)://");

/**
 * FormData → plain object, then validate. Returns the first error message.
 * Destructure as `const { success, data, error } = parseForm(...)` and bail
 * with `if (!success) return { error }` — the literal flag narrows `data`.
 */
export function parseForm<T extends z.ZodType>(schema: T, fd: FormData):
  | { success: true; data: z.infer<T>; error?: undefined }
  | { success: false; data?: undefined; error: string } {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) if (!k.startsWith("$ACTION")) obj[k] = v;
  const r = schema.safeParse(obj);
  if (r.success) return { success: true, data: r.data };
  const issue = r.error.issues[0];
  const field = issue.path.join(".");
  return { success: false, error: field ? `${field}: ${issue.message}` : issue.message };
}
