import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  date,
  primaryKey,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/*
 * Column names are snake_case in Postgres (casing: "snake_case" in the client
 * and drizzle.config.ts); the TypeScript keys below are camelCase.
 *
 * Money is stored as integer minor units (cents / qindarka) in a bigint, never
 * as floats. Calendar dates (due dates, start dates) are `date` columns read
 * as "YYYY-MM-DD" strings so time zones can't shift them by a day.
 */

const id = () => text().primaryKey().$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp().notNull().defaultNow();
const updatedAt = () =>
  timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

/* ------------------------------------------------------------------ auth --
 * Tables Better Auth reads and writes (core + admin + two-factor plugins).
 * Field names must match Better Auth's model fields exactly.
 */

export const user = pgTable("user", {
  id: text().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().notNull().default(false),
  image: text(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  // admin plugin — "admin" | "member" | "client"
  role: text().notNull().default("member"),
  banned: boolean().default(false),
  banReason: text(),
  banExpires: timestamp(),
  // two-factor plugin
  twoFactorEnabled: boolean().default(false),
});

export const session = pgTable(
  "session",
  {
    id: text().primaryKey(),
    expiresAt: timestamp().notNull(),
    token: text().notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text(),
    userAgent: text(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text(),
  },
  (t) => [index().on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text().primaryKey(),
    accountId: text().notNull(),
    providerId: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp(),
    refreshTokenExpiresAt: timestamp(),
    scope: text(),
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text().primaryKey(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.identifier)],
);

export const twoFactor = pgTable(
  "two_factor",
  {
    id: text().primaryKey(),
    secret: text().notNull(),
    backupCodes: text().notNull(),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: boolean().default(true),
    failedVerificationCount: integer().default(0),
    lockedUntil: timestamp(),
  },
  (t) => [index().on(t.userId), index().on(t.secret)],
);

/* -------------------------------------------------------------- business -- */

export const projectStatus = pgEnum("project_status", [
  "lead",
  "active",
  "paused",
  "completed",
  "cancelled",
]);
export const paymentDirection = pgEnum("payment_direction", [
  // money the client pays 4CS
  "incoming",
  // money 4CS pays out — to a team member or a vendor
  "outgoing",
]);
export const paymentStatus = pgEnum("payment_status", ["pending", "paid", "cancelled"]);
export const recurrenceInterval = pgEnum("recurrence_interval", [
  "weekly",
  "monthly",
  "quarterly",
  "yearly",
]);
export const visibility = pgEnum("visibility", [
  // admins + project team only
  "team",
  // also shown to the client's portal users
  "client",
]);
export const currency = pgEnum("currency", ["EUR", "ALL", "USD"]);

export const clients = pgTable("clients", {
  id: id(),
  name: text().notNull(),
  contactName: text(),
  email: text(),
  phone: text(),
  address: text(),
  /** Albanian tax ID, if the client is a registered business. */
  nipt: text(),
  notes: text(),
  archived: boolean().notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Which portal users (role "client") may see which client's projects. */
export const clientUsers = pgTable(
  "client_users",
  {
    clientId: text()
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.userId] }), index().on(t.userId)],
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    clientId: text()
      .notNull()
      .references(() => clients.id, { onDelete: "restrict" }),
    name: text().notNull(),
    status: projectStatus().notNull().default("lead"),
    description: text(),
    startDate: date(),
    dueDate: date(),
    /** Agreed price, minor units. Hidden from team members. */
    budget: bigint({ mode: "number" }),
    currency: currency().notNull().default("EUR"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.clientId), index().on(t.status)],
);

export const projectMembers = pgTable(
  "project_members",
  {
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Free text: "Lead developer", "Designer" … */
    role: text(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] }), index().on(t.userId)],
);

export const recurringPlans = pgTable(
  "recurring_plans",
  {
    id: id(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    direction: paymentDirection().notNull(),
    /** Payee for outgoing plans paid to a team member. */
    userId: text().references(() => user.id, { onDelete: "set null" }),
    description: text().notNull(),
    amount: bigint({ mode: "number" }).notNull(),
    currency: currency().notNull(),
    interval: recurrenceInterval().notNull(),
    /** First due date; every later date is computed from it, so month-end
        dates never drift (31 Jan → 28 Feb → 31 Mar, not → 28 Mar). */
    startDate: date().notNull(),
    endDate: date(),
    /** How many payments have been generated so far. */
    occurrences: integer().notNull().default(0),
    nextDueDate: date().notNull(),
    active: boolean().notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.projectId), index().on(t.active, t.nextDueDate)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    direction: paymentDirection().notNull(),
    /** Team member being paid (outgoing only). */
    userId: text().references(() => user.id, { onDelete: "set null" }),
    /** Vendor or other payee not in the system (outgoing only). */
    counterparty: text(),
    description: text().notNull(),
    amount: bigint({ mode: "number" }).notNull(),
    currency: currency().notNull(),
    /** Overdue isn't stored: it's `pending` with a past due date. */
    status: paymentStatus().notNull().default("pending"),
    dueDate: date().notNull(),
    paidOn: date(),
    method: text(),
    reference: text(),
    recurringPlanId: text().references(() => recurringPlans.id, { onDelete: "set null" }),
    /** Set on member payouts created automatically from a client payment's
        split (lib/money-flow.ts). Such payouts are managed through that payment. */
    sourcePaymentId: text().references((): AnyPgColumn => payments.id, { onDelete: "set null" }),
    createdById: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index().on(t.projectId),
    index().on(t.userId),
    index().on(t.status, t.dueDate),
    // The daily job can run twice without double-billing.
    uniqueIndex().on(t.recurringPlanId, t.dueDate),
    index().on(t.sourcePaymentId),
  ],
);

export const shareKind = pgEnum("share_kind", ["percent", "fixed"]);

/**
 * How a project's income is split. Each member has either a percentage of
 * every client payment, or a fixed total for the project (paid out pro rata to
 * the budget as the client pays). The company keeps whatever is left.
 */
export const projectShares = pgTable(
  "project_shares",
  {
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: text()
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: shareKind().notNull(),
    /** percent shares: hundredths of a percent (4000 = 40.00%). */
    basisPoints: integer(),
    /** fixed shares: total for the project, minor units, project currency. */
    amount: bigint({ mode: "number" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.userId] })],
);

export const fundDirection = pgEnum("fund_direction", ["in", "out"]);

/**
 * The company fund: every movement of the company's own money. Entries with a
 * paymentId are written automatically when a payment is marked paid (the
 * company's share of client income, or a project cost the company paid);
 * the rest are added by hand with a description.
 */
export const fundEntries = pgTable(
  "fund_entries",
  {
    id: id(),
    entryDate: date().notNull(),
    direction: fundDirection().notNull(),
    amount: bigint({ mode: "number" }).notNull(),
    currency: currency().notNull(),
    category: text().notNull(),
    description: text().notNull(),
    projectId: text().references(() => projects.id, { onDelete: "set null" }),
    paymentId: text().references(() => payments.id, { onDelete: "cascade" }),
    createdById: text().references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.entryDate),
    // At most one fund movement per payment.
    uniqueIndex().on(t.paymentId),
  ],
);

export const projectNotes = pgTable(
  "project_notes",
  {
    id: id(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    authorId: text().references(() => user.id, { onDelete: "set null" }),
    body: text().notNull(),
    visibility: visibility().notNull().default("team"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.projectId)],
);

/** Contracts, repos, designs, invoices kept elsewhere (Drive, GitHub, Figma …). */
export const projectLinks = pgTable(
  "project_links",
  {
    id: id(),
    projectId: text()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text().notNull(),
    url: text().notNull(),
    visibility: visibility().notNull().default("team"),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.projectId)],
);

/** Who changed what. Written by every mutating server action. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    actorId: text().references(() => user.id, { onDelete: "set null" }),
    action: text().notNull(),
    entityType: text().notNull(),
    entityId: text(),
    summary: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.createdAt), index().on(t.entityType, t.entityId)],
);

/* ------------------------------------------------------------ relations -- */

export const clientsRelations = relations(clients, ({ many }) => ({
  projects: many(projects),
  users: many(clientUsers),
}));

export const clientUsersRelations = relations(clientUsers, ({ one }) => ({
  client: one(clients, { fields: [clientUsers.clientId], references: [clients.id] }),
  user: one(user, { fields: [clientUsers.userId], references: [user.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  client: one(clients, { fields: [projects.clientId], references: [clients.id] }),
  members: many(projectMembers),
  payments: many(payments),
  recurringPlans: many(recurringPlans),
  notes: many(projectNotes),
  links: many(projectLinks),
}));

export const projectMembersRelations = relations(projectMembers, ({ one }) => ({
  project: one(projects, { fields: [projectMembers.projectId], references: [projects.id] }),
  user: one(user, { fields: [projectMembers.userId], references: [user.id] }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  project: one(projects, { fields: [payments.projectId], references: [projects.id] }),
  user: one(user, { fields: [payments.userId], references: [user.id] }),
}));

export const recurringPlansRelations = relations(recurringPlans, ({ one }) => ({
  project: one(projects, { fields: [recurringPlans.projectId], references: [projects.id] }),
  user: one(user, { fields: [recurringPlans.userId], references: [user.id] }),
}));

export const projectNotesRelations = relations(projectNotes, ({ one }) => ({
  project: one(projects, { fields: [projectNotes.projectId], references: [projects.id] }),
  author: one(user, { fields: [projectNotes.authorId], references: [user.id] }),
}));

export const projectLinksRelations = relations(projectLinks, ({ one }) => ({
  project: one(projects, { fields: [projectLinks.projectId], references: [projects.id] }),
}));
