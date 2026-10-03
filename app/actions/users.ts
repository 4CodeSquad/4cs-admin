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
import { ROLES, type Role } from "@/lib/auth-config";
import { parseForm, text, type FormState } from "@/lib/validation";

// Better Auth's types only know its default "user"/"admin" roles; the custom
// roles are registered at runtime in lib/auth-config.ts (and covered by
// tests/auth.test.ts).
type BetterAuthRole = "admin";

const appUrl = () => process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

/** Emails a "set your password" link (the reset flow, worded as an invite). */
async function sendInvite(email: string) {
  await auth.api.requestPasswordReset({
    body: { email, redirectTo: `${appUrl()}/reset-password?invite=1` },
  });
}

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
  try {
    const res = await auth.api.createUser({
      body: { ...data, role: data.role as BetterAuthRole, password: randomBytes(32).toString("base64url") },
      headers: await headers(),
    });
    await sendInvite(data.email);
    await audit(db, me.id, "invite", "user", res.user.id, `${data.email} as ${data.role}`);
  } catch (e) {
    if (isAPIError(e)) return { error: e.message };
    console.error(e);
    return { error: "Couldn't create the account." };
  }
  revalidatePath("/team");
  return { ok: `Invite sent to ${data.email}.` };
}

export async function resendInvite(userId: string) {
  const me = await requireAdmin();
  const [u] = await db.select({ email: user.email }).from(user).where(eq(user.id, userId));
  if (!u) return;
  await sendInvite(u.email);
  await audit(db, me.id, "resend-invite", "user", userId);
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
