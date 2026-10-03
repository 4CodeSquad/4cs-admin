import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "./auth";
import { ROLES, type Role } from "./auth-config";
import type { Viewer } from "./access";

/**
 * Session checks for pages and server actions (the Next.js "data access
 * layer" pattern). proxy.ts only does a fast cookie check; the real check is
 * here, against the database, on every request.
 */

export type SessionUser = Viewer & {
  name: string;
  email: string;
  twoFactorEnabled: boolean;
};

export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as typeof session.user & { role?: string; twoFactorEnabled?: boolean };
  const role = (ROLES as readonly string[]).includes(u.role ?? "") ? (u.role as Role) : null;
  if (!role) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role,
    twoFactorEnabled: !!u.twoFactorEnabled,
  };
});

/**
 * Any signed-in user. Admins without two-factor are sent to set it up first —
 * an admin account can see every client's finances.
 */
export async function requireUser(opts: { allowWithout2fa?: boolean } = {}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role === "admin" && !user.twoFactorEnabled && !opts.allowWithout2fa) {
    redirect("/account?setup=2fa");
  }
  return user;
}

/** Admin only. Everyone else gets a 404, not a hint that the page exists. */
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") notFound();
  return user;
}
