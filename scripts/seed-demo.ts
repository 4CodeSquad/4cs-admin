/**
 * `npm run seed:demo` — fake clients, projects, payments and three demo users
 * for trying the app locally. Refuses to run against anything but localhost.
 *
 * Demo logins (password for all: demo-password-123):
 *   admin@demo.local (admin, 2FA not yet set up)
 *   dev@demo.local (member)   client@demo.local (client)
 */
import { requireEnv } from "./env";
import { createDb } from "../db/client";
import { createAuth } from "../lib/auth-config";
import * as s from "../db/schema";
import { today, addDays } from "../lib/dates";
import { generateRecurringPayments } from "../lib/recurring";

const url = requireEnv("DATABASE_URL");
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("seed:demo only runs against a local database.");
  process.exit(1);
}
process.env.BETTER_AUTH_SECRET ??= "local-dev-secret-local-dev-secret-0000";
const { db, sql } = createDb(url, 1);
const auth = createAuth(db);
const PASSWORD = "demo-password-123";

const mk = async (email: string, name: string, role: string) =>
  (await auth.api.createUser({ body: { email, name, role: role as "admin", password: PASSWORD } })).user.id;

const admin = await mk("admin@demo.local", "Arbër (demo admin)", "admin");
const dev = await mk("dev@demo.local", "Dea Developer", "member");
const designer = await mk("design@demo.local", "Dritan Designer", "member");
const clientUser = await mk("client@demo.local", "Klara Client", "client");

const t = today();
const [shop, clinic] = await db.insert(s.clients).values([
  { name: "Demo Shop SHPK", contactName: "Klara Client", email: "klara@shop.example", phone: "+355 69 000 0000", nipt: "L00000000A" },
  { name: "Demo Clinic", contactName: "Dr. Example", email: "info@clinic.example" },
]).returning();
await db.insert(s.clientUsers).values({ clientId: shop.id, userId: clientUser });

const [web, app] = await db.insert(s.projects).values([
  { clientId: shop.id, name: "E-commerce platform", status: "active", startDate: addDays(t, -60), dueDate: addDays(t, 45), budget: 1200000, currency: "EUR", description: "Next.js storefront, .NET API, payment integration." },
  { clientId: clinic.id, name: "Booking app", status: "active", startDate: addDays(t, -20), dueDate: addDays(t, 90), budget: 85000000, currency: "ALL", description: "iOS + Android booking app." },
]).returning();
await db.insert(s.projectMembers).values([
  { projectId: web.id, userId: dev, role: "Lead developer" },
  { projectId: web.id, userId: designer, role: "Design" },
  { projectId: app.id, userId: designer, role: "Design" },
]);
await db.insert(s.payments).values([
  { projectId: web.id, direction: "incoming", description: "Deposit 30%", amount: 360000, currency: "EUR", dueDate: addDays(t, -55), status: "paid", paidOn: addDays(t, -50), method: "Bank transfer", createdById: admin },
  { projectId: web.id, direction: "incoming", description: "Milestone 2", amount: 480000, currency: "EUR", dueDate: addDays(t, -5), createdById: admin },
  { projectId: web.id, direction: "incoming", description: "Final 30%", amount: 360000, currency: "EUR", dueDate: addDays(t, 45), createdById: admin },
  { projectId: web.id, direction: "outgoing", userId: dev, description: "Development — sprint 1–4", amount: 250000, currency: "EUR", dueDate: addDays(t, 3), createdById: admin },
  { projectId: web.id, direction: "outgoing", userId: designer, description: "UI design", amount: 90000, currency: "EUR", dueDate: addDays(t, -30), status: "paid", paidOn: addDays(t, -28), createdById: admin },
  { projectId: app.id, direction: "incoming", description: "Deposit", amount: 25500000, currency: "ALL", dueDate: addDays(t, 10), createdById: admin },
  { projectId: app.id, direction: "outgoing", counterparty: "Apple Developer Program", description: "Developer account", amount: 9900, currency: "USD", dueDate: addDays(t, 2), createdById: admin },
]);
await db.insert(s.recurringPlans).values({
  projectId: web.id, direction: "incoming", description: "Hosting & maintenance", amount: 15000, currency: "EUR",
  interval: "monthly", startDate: addDays(t, 5), nextDueDate: addDays(t, 5),
});
await db.insert(s.projectNotes).values([
  { projectId: web.id, authorId: admin, body: "Kickoff done. Staging: https://staging.example", visibility: "client" },
  { projectId: web.id, authorId: dev, body: "Payment provider sandbox keys are in the team vault.", visibility: "team" },
]);
await db.insert(s.projectLinks).values([
  { projectId: web.id, label: "Signed contract", url: "https://drive.google.com/", visibility: "client" },
  { projectId: web.id, label: "Repository", url: "https://github.com/", visibility: "team" },
]);
console.log(await generateRecurringPayments(db, t));
console.log(`Seeded. Sign in as admin@demo.local / dev@demo.local / client@demo.local — password ${PASSWORD}`);
await sql.end();
