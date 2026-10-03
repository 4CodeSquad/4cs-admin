/**
 * `npm run create-admin -- you@4cs.al "Your Name"`
 *
 * Creates the first admin (there is no sign-up page) and sends them a
 * "set your password" link. Without RESEND_API_KEY the link is printed here.
 */
import { requireEnv } from "./env";
import { randomBytes } from "node:crypto";
import { createDb } from "../db/client";
import { createAuth } from "../lib/auth-config";

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
await auth.api.requestPasswordReset({ body: { email, redirectTo: `${appUrl}/reset-password?invite=1` } });
console.log(`Admin ${email} created. Check the email (or the output above) for the set-password link.`);
await sql.end();
