import { Resend } from "resend";

const FROM = process.env.EMAIL_FROM ?? "4CS Admin <onboarding@resend.dev>";

/**
 * Sends a transactional email through Resend. Without RESEND_API_KEY (local
 * development) the message is printed to the console instead, so invite and
 * reset links still work while developing.
 *
 * Note: Resend's shared onboarding@resend.dev sender only delivers to the
 * Resend account owner's address. To email anyone else, verify 4cs.al in
 * Resend and set EMAIL_FROM, e.g. "4CS <admin@4cs.al>".
 */
export async function sendEmail(to: string, subject: string, text: string) {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    // On Vercel a missing key is a configuration error, not a dev convenience.
    if (process.env.VERCEL) throw new Error("RESEND_API_KEY is not set in Vercel's environment variables");
    console.log(`\n[email → ${to}] ${subject}\n${text}\n`);
    return;
  }
  const { error } = await new Resend(key).emails.send({ from: FROM, to, subject, text });
  if (error) throw new Error(error.message);
}

/** The two account emails, shared by the auth config and the invite action. */
export const accountEmail = (kind: "invite" | "reset", name: string, url: string) =>
  kind === "invite"
    ? {
        subject: "Your 4CS Admin account",
        text: `Hi ${name},\n\nAn account has been created for you on 4CS Admin.\nSet your password here (link valid for 48 hours):\n\n${url}\n`,
      }
    : {
        subject: "Reset your 4CS Admin password",
        text: `Hi ${name},\n\nUse this link to set a new password (valid for 48 hours):\n\n${url}\n\nIf you didn't ask for this, ignore this email.\n`,
      };
