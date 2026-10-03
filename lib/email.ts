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
    console.log(`\n[email → ${to}] ${subject}\n${text}\n`);
    return;
  }
  const { error } = await new Resend(key).emails.send({ from: FROM, to, subject, text });
  if (error) throw new Error(`Email to ${to} failed: ${error.message}`);
}
