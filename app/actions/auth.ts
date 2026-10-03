"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAPIError } from "better-auth/api";
import QRCode from "qrcode";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { requireUser } from "@/lib/dal";
import { parseForm, type FormState } from "@/lib/validation";

const appUrl = () => process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

/** Better Auth errors carry a user-safe message; anything else stays generic. */
function authError(e: unknown, fallback = "Something went wrong. Try again.") {
  if (isAPIError(e)) return e.message || fallback;
  console.error(e);
  return fallback;
}

/** Only same-site paths, so ?next= can't bounce a user to another domain. */
const safeNext = (v: FormDataEntryValue | null) =>
  typeof v === "string" && v.startsWith("/") && !v.startsWith("//") ? v : "/";

export async function login(_: FormState, fd: FormData): Promise<FormState> {
  const { success, data, error } = parseForm(
    z.object({ email: z.string().trim().email("Enter your email"), password: z.string().min(1, "Enter your password") }),
    fd,
  );
  if (!success) return { error };
  let needs2fa = false;
  try {
    const res = (await auth.api.signInEmail({ body: data, headers: await headers() })) as {
      twoFactorRedirect?: boolean;
    };
    needs2fa = !!res?.twoFactorRedirect;
  } catch (e) {
    // Same message for unknown email and wrong password.
    return { error: isAPIError(e) && e.status === "FORBIDDEN" ? e.message : "Wrong email or password." };
  }
  const next = safeNext(fd.get("next"));
  redirect(needs2fa ? `/two-factor?next=${encodeURIComponent(next)}` : next);
}

export async function verifyTwoFactor(_: FormState, fd: FormData): Promise<FormState> {
  const code = String(fd.get("code") ?? "").replace(/\s/g, "");
  const trustDevice = fd.get("trust") === "on";
  try {
    if (/^\d{6}$/.test(code)) {
      await auth.api.verifyTOTP({ body: { code, trustDevice }, headers: await headers() });
    } else {
      // Anything that isn't 6 digits is treated as a backup code.
      await auth.api.verifyBackupCode({ body: { code, trustDevice }, headers: await headers() });
    }
  } catch (e) {
    return { error: authError(e, "That code didn't work.") };
  }
  redirect(safeNext(fd.get("next")));
}

export async function logout() {
  await auth.api.signOut({ headers: await headers() });
  redirect("/login");
}

export async function requestReset(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "").trim();
  try {
    await auth.api.requestPasswordReset({
      body: { email, redirectTo: `${appUrl()}/reset-password` },
      headers: await headers(),
    });
  } catch (e) {
    console.error(e);
  }
  // Same answer whether or not the account exists.
  return { ok: "If that email has an account, a reset link is on its way." };
}

export async function resetPassword(_: FormState, fd: FormData): Promise<FormState> {
  const { success, data, error } = parseForm(
    z
      .object({
        token: z.string().min(1, "This link is missing its token — request a new one."),
        password: z.string().min(10, "At least 10 characters"),
        confirm: z.string(),
      })
      .refine((d) => d.password === d.confirm, { message: "Passwords don't match", path: ["confirm"] }),
    fd,
  );
  if (!success) return { error };
  try {
    await auth.api.resetPassword({ body: { token: data.token, newPassword: data.password } });
  } catch (e) {
    return { error: authError(e, "This link has expired. Ask for a new one.") };
  }
  redirect("/login?reset=1");
}

export async function changePassword(_: FormState, fd: FormData): Promise<FormState> {
  await requireUser({ allowWithout2fa: true });
  const { success, data, error } = parseForm(
    z.object({ current: z.string().min(1, "Enter your current password"), password: z.string().min(10, "At least 10 characters") }),
    fd,
  );
  if (!success) return { error };
  try {
    await auth.api.changePassword({
      body: { currentPassword: data.current, newPassword: data.password, revokeOtherSessions: true },
      headers: await headers(),
    });
  } catch (e) {
    return { error: authError(e) };
  }
  return { ok: "Password changed. Other devices have been signed out." };
}

export type TwoFactorSetup =
  | { error?: string; ok?: string; qr?: string; secret?: string; backupCodes?: string[] }
  | undefined;

/** Step 1: confirm the password, get a QR code and backup codes. */
export async function startTwoFactor(_: TwoFactorSetup, fd: FormData): Promise<TwoFactorSetup> {
  await requireUser({ allowWithout2fa: true });
  try {
    const res = await auth.api.enableTwoFactor({
      body: { password: String(fd.get("password") ?? "") },
      headers: await headers(),
    });
    if (res.method !== "totp") return { error: "Authenticator apps aren't enabled." };
    const secret = new URL(res.totpURI).searchParams.get("secret") ?? undefined;
    const qr = await QRCode.toString(res.totpURI, { type: "svg", margin: 1, width: 200 });
    return { qr, secret, backupCodes: res.backupCodes };
  } catch (e) {
    return { error: authError(e, "Wrong password.") };
  }
}

/** Step 2: prove the authenticator works; only then is 2FA switched on. */
export async function confirmTwoFactor(_: FormState, fd: FormData): Promise<FormState> {
  await requireUser({ allowWithout2fa: true });
  try {
    await auth.api.verifyTOTP({
      body: { code: String(fd.get("code") ?? "").replace(/\s/g, "") },
      headers: await headers(),
    });
  } catch (e) {
    return { error: authError(e, "That code didn't work. Check the time on your phone.") };
  }
  redirect("/account?2fa=on");
}

export async function disableTwoFactor(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser({ allowWithout2fa: true });
  if (user.role === "admin") return { error: "Admins must keep two-step login on." };
  try {
    await auth.api.disableTwoFactor({
      body: { password: String(fd.get("password") ?? "") },
      headers: await headers(),
    });
  } catch (e) {
    return { error: authError(e, "Wrong password.") };
  }
  redirect("/account");
}
