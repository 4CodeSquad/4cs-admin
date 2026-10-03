/**
 * `npm run create-admin -- you@4cs.al "Your Name"`
 *
 * Creates the first admin (there is no sign-up page) and sends them a
 * "set your password" link. Without RESEND_API_KEY the link is printed here.
 */
import { requireEnv } from "./env";
import { randomBytes } from "node:crypto";
import { createDb } from "../db/client";
import { captureResetLink, createAuth } from "../lib/auth-config";
import { accountEmail, sendEmail } from "../lib/email";

const [email, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(" ");
if (!email || !name) {
  console.error('Usage: npm run create-admin -- you@4cs.al "Your Name"');
  process.exit(1);
}
requireEnv("BETTER_AUTH_SECRET");
const appUrl = requireEnv("BETTER_AUTH_URL");

const { db, sql } = createDb(process.env.DATABASE_URL_UNPOOLED ?? requireEnv("DATABASE_URL"), 1);
const auth = createAuth(db);

await auth.api.createUser({
  body: { email, name, role: "admin", password: randomBytes(32).toString("base64url") },
});
const url = await captureResetLink(() =>
  auth.api.requestPasswordReset({ body: { email, redirectTo: `${appUrl}/reset-password?invite=1` } }),
);
const { subject, text } = accountEmail("invite", name, url);
await sendEmail(email, subject, text).catch((e) => console.error(`Email not sent: ${e.message}`));
console.log(`\nAdmin ${email} created. Set-password link (valid 48 hours, works once):\n${url}\n`);
await sql.end();
