"use server";

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { isAPIError } from "better-auth/api";
import { db } from "@/db";
import { user } from "@/db/schema";
import { auth } from "@/lib/auth";
import { requireAdmin } from "@/lib/dal";
import { audit } from "@/lib/audit";
import { ROLES, captureResetLink, type Role } from "@/lib/auth-config";
import { accountEmail, sendEmail } from "@/lib/email";
import { parseForm, text, type FormState } from "@/lib/validation";

// Better Auth's types only know its default "user"/"admin" roles; the custom
// roles are registered at runtime in lib/auth-config.ts (and covered by
// tests/auth.test.ts).
type BetterAuthRole = "admin";

const appUrl = () => process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

/**
 * Creates a fresh "set your password" link and emails it. Never throws for an
 * email problem: the result says whether the email went out, and always
 * carries the link so an admin can pass it on another way.
 */
async function sendInvite(email: string, name: string): Promise<{ url: string; emailError?: string }> {
  const url = await captureResetLink(() =>
    auth.api.requestPasswordReset({ body: { email, redirectTo: `${appUrl()}/reset-password?invite=1` } }),
  );
  const { subject, text } = accountEmail("invite", name, url);
  try {
    await sendEmail(email, subject, text);
    return { url };
  } catch (e) {
    console.error(`Invite email to ${email} failed:`, e);
    return { url, emailError: e instanceof Error ? e.message : String(e) };
  }
}

const inviteResult = (email: string, r: { url: string; emailError?: string }, verb: string): FormState =>
  r.emailError
    ? {
        error: `${verb}, but the email to ${email} was not delivered: ${r.emailError}\n\nSend them this link yourself (valid 48 hours, works once):\n${r.url}`,
      }
    : { ok: `Email with a set-password link sent to ${email}.` };

/**
 * Creates the account with a random password nobody knows, then emails the
 * person a link to choose their own. There is no public sign-up.
 */
export async function inviteUser(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const { success, data, error } = parseForm(
    z.object({ name: text(), email: z.string().trim().toLowerCase().email("Not a valid email"), role: z.enum(ROLES) }),
    fd,
  );
  if (!success) return { error };
  let userId: string;
  try {
    const res = await auth.api.createUser({
      body: { ...data, role: data.role as BetterAuthRole, password: randomBytes(32).toString("base64url") },
      headers: await headers(),
    });
    userId = res.user.id;
  } catch (e) {
    if (isAPIError(e)) return { error: e.message };
    console.error(e);
    return { error: "Couldn't create the account." };
  }
  const r = await sendInvite(data.email, data.name);
  await audit(db, me.id, "invite", "user", userId, `${data.email} as ${data.role}${r.emailError ? " (email failed)" : ""}`);
  revalidatePath("/team");
  return inviteResult(data.email, r, "Account created");
}

/** "Send password link" on the Team page — a new link for an existing person. */
export async function resendInvite(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireAdmin();
  const [u] = await db
    .select({ email: user.email, name: user.name })
    .from(user)
    .where(eq(user.id, String(fd.get("userId"))));
  if (!u) return { error: "No such user." };
  const r = await sendInvite(u.email, u.name);
  await audit(db, me.id, "resend-invite", "user", String(fd.get("userId")), r.emailError ? "email failed" : undefined);
  return inviteResult(u.email, r, "New link created");
}

export async function setRole(userId: string, fd: FormData) {
  const me = await requireAdmin();
  const role = String(fd.get("role")) as Role;
  if (!ROLES.includes(role)) return;
  // Never let the last admin lock everyone out by demoting themselves.
  if (userId === me.id && role !== "admin") return;
  await auth.api.setRole({ body: { userId, role: role as BetterAuthRole }, headers: await headers() });
  await audit(db, me.id, "set-role", "user", userId, role);
  revalidatePath("/team");
}

/** Blocks sign-in and ends every session the person has. */
export async function setBanned(userId: string, banned: boolean) {
  const me = await requireAdmin();
  if (userId === me.id) return;
  const h = await headers();
  if (banned) {
    await auth.api.banUser({ body: { userId, banReason: "Access removed by an admin" }, headers: h });
  } else {
    await auth.api.unbanUser({ body: { userId }, headers: h });
  }
  await audit(db, me.id, banned ? "ban" : "unban", "user", userId);
  revalidatePath("/team");
}
