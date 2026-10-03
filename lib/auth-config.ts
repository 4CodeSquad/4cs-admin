import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin, twoFactor } from "better-auth/plugins";
import { adminAc, userAc } from "better-auth/plugins/admin/access";
import { nextCookies } from "better-auth/next-js";
import type { DB } from "@/db/client";
import * as schema from "@/db/schema";
import { AsyncLocalStorage } from "node:async_hooks";
import { accountEmail, sendEmail } from "./email";

/**
 * Better Auth sends reset emails as a "background task" and swallows any
 * error, so a failed invite would look like a sent one. Admin invites run
 * inside captureResetLink(): the link is handed back to the caller, which
 * sends the email itself and can report a failure (and show the link).
 */
const linkCapture = new AsyncLocalStorage<{ url?: string }>();

export async function captureResetLink(request: () => Promise<unknown>): Promise<string> {
  const box: { url?: string } = {};
  await linkCapture.run(box, request);
  if (!box.url) throw new Error("No password link was generated for this account");
  return box.url;
}

export const ROLES = ["admin", "member", "client"] as const;
export type Role = (typeof ROLES)[number];

/**
 * Better Auth, configured for a closed system:
 * - no public sign-up: admins create accounts on the Team page;
 * - a new user gets a "set your password" link (the reset-password flow), so
 *   no password is ever chosen by someone else or sent by email;
 * - admin plugin for roles and banning, two-factor plugin for TOTP.
 *
 * A factory so scripts and tests can build it on their own connection; the
 * app uses the singleton in lib/auth.ts.
 */
export function createAuth(db: DB) {
  return betterAuth({
    appName: "4CS Admin",
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        twoFactor: schema.twoFactor,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      // Invite links have to survive a weekend; reset links are the same token.
      resetPasswordTokenExpiresIn: 60 * 60 * 48,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        const capture = linkCapture.getStore();
        if (capture) {
          capture.url = url;
          return;
        }
        // Self-service "forgot password": failures are only logged, on purpose —
        // the page must not reveal whether an account exists.
        const kind = decodeURIComponent(url).includes("invite=1") ? "invite" : "reset";
        const { subject, text } = accountEmail(kind, user.name, url);
        await sendEmail(user.email, subject, text).catch((e) =>
          console.error(`Password email to ${user.email} failed:`, e),
        );
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    plugins: [
      admin({
        // Only admins manage users; members and clients get no user powers.
        // What each role may *see* is decided in lib/access.ts, not here.
        roles: { admin: adminAc, member: userAc, client: userAc },
        defaultRole: "member",
        adminRoles: ["admin"],
      }),
      twoFactor({ issuer: "4CS Admin" }),
      // Must stay last: lets server actions set auth cookies.
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
