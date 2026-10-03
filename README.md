# 4CS Admin

Private dashboard for 4CS projects: clients, projects, team, payments (one-off
and recurring), notes and links, with three kinds of login:

| Role | Sees | Can change |
|---|---|---|
| **Admin** | everything, including the company fund | everything; must use two-step login |
| **Member** (team) | projects they're assigned to; **their own** share and payouts; team notes | can add notes on their projects |
| **Client** | their company's projects, invoices, and notes/links marked "client can see" | nothing |

Everything runs in Node/TypeScript: Next.js 16 (App Router, server actions),
Postgres via Drizzle ORM, Better Auth for logins, Resend for email. Hosted on
Vercel; database on Neon. Both free tiers are enough.

## How access control works

All reads go through `lib/queries.ts`, and every query adds the viewer's scope
from **`lib/access.ts`** — the one file that defines who sees what. Writes are
server actions in `app/actions/`, each of which re-checks the session
(`lib/dal.ts`) — `proxy.ts` only does a fast "is there a cookie" redirect.
`tests/access.test.ts` proves the rules against a real database.

## Money split and the company fund

Each project can split its income between members (Project page → Money split):

- **Percent** — the member gets that % of everything the client pays.
- **Fixed** — an amount for the project that fills up as the client pays and
  is complete once the budget is paid. Fixed shares are measured against the
  budget, or the money actually received if that's more (extras like hosting).
- The **company** keeps the rest. Shares can't add up to more than 100%.

The split is always computed from the project's **total received money**:
after any change (a client payment marked paid or undone, a share changed,
the budget edited) the project is recalculated. What each member is still
owed becomes one pending payout; payouts already paid are never changed. The
company's part is one "Project income" entry in the **company fund**
(admins only, `/fund`). Paid project costs (vendors, hand-made payments to
people) come out of the fund; members' shares don't. Admins record any other
spending or income on the fund page with a description and category.

Undoing a client payment is refused if a member has already been paid more
than their share would then be. The rules live in `lib/money-flow.ts` and are
covered by `tests/money-flow.test.ts`.

## Recurring payments

A recurring plan (e.g. hosting €150/month) turns into real pending payments
14 days before each due date. `/api/cron/daily` runs every morning (see
`vercel.json`), creates them, and emails admins a list of what's overdue or due
this week. Dates never drift (31 Jan → 28 Feb → 31 Mar), missed days catch up,
and running it twice can't double-bill. The app **tracks** payments; it does
not charge cards.

## Local development

Needs Node 24 and a local Postgres.

```bash
npm install
createdb fourcs_admin && createdb fourcs_admin_test
cp .env.example .env.local   # set DATABASE_URL to the local db, BETTER_AUTH_URL=http://localhost:3000,
                             # and generate BETTER_AUTH_SECRET / CRON_SECRET with `openssl rand -base64 32`
npm run db:migrate
npm run seed:demo            # optional demo data; logins printed at the end
npm run dev
npm test                     # unit + database tests (uses fourcs_admin_test)
```

Without `RESEND_API_KEY`, emails (invites, resets, reminders) are printed in
the dev server's console.

Schema change: edit `db/schema.ts` → `npm run db:generate -- --name what_changed`
→ commit the new file in `db/migrations/`. Production deploys apply it.

## Going live (one-time)

1. **Database** — create a free project at neon.tech (region: EU Frankfurt).
   Easiest: in Vercel, Storage → Neon → connect it to this project; that sets
   `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`.
2. **Vercel** — import this repo as a new project. Add env vars (Production):
   `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=https://admin.4cs.al`, `CRON_SECRET`,
   `RESEND_API_KEY`, `EMAIL_FROM`. Don't give Preview deployments the
   production `DATABASE_URL`.
3. **Domain** — Vercel → Domains → add `admin.4cs.al`; add the CNAME it shows
   at your DNS provider.
4. **Email** — in Resend, verify the `4cs.al` domain (DNS records) and set
   `EMAIL_FROM` to an address on it. Until then Resend only delivers to its
   account owner.
5. **First admin** — from your machine, with the production env vars in
   `.env.local`: `npm run create-admin -- you@4cs.al "Your Name"`, then open the
   emailed link, set a password, sign in, and set up two-step login.
6. **Backups** — add the `DATABASE_URL_UNPOOLED` secret to this GitHub repo;
   `.github/workflows/backup.yml` then keeps 30 days of nightly dumps.

## Notes

- Vercel's Hobby plan allows one cron run per day — that's what this uses.
- This repo lives on an exFAT drive; macOS `._*` files are ignored and cleaned
  by `npm run db:generate` (see `scripts/generate.ts`).
- `npm audit` reports a moderate esbuild dev-server advisory via `drizzle-kit`
  (a dev CLI). It doesn't affect the deployed app.
