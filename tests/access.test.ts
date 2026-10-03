import { beforeAll, describe, expect, it } from "vitest";
import { db, reset } from "./db";
import { seed, admin, memberA, memberB, clientC, stranger } from "./fixtures";
import { dashboard, getProject, listPayments, listProjects } from "@/lib/queries";

const T = "2026-02-01";
const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

beforeAll(async () => {
  await reset();
  await seed();
});

describe("projects", () => {
  it("admin sees every project", async () => expect(ids(await listProjects(db, admin))).toEqual(["P1", "P2"]));
  it("members see only assigned projects", async () => {
    expect(ids(await listProjects(db, memberA))).toEqual(["P1"]);
    expect(ids(await listProjects(db, memberB))).toEqual(["P2"]);
  });
  it("clients see only their company's projects", async () => expect(ids(await listProjects(db, clientC))).toEqual(["P1"]));
  it("someone with no links sees nothing", async () => expect(await listProjects(db, stranger)).toEqual([]));
  it("opening another project by id returns null, not data", async () => {
    expect(await getProject(db, memberA, "P2", T)).toBeNull();
    expect(await getProject(db, clientC, "P2", T)).toBeNull();
  });
  it("hides the budget from members only", async () => {
    expect((await listProjects(db, memberA))[0].budget).toBeNull();
    expect((await getProject(db, memberA, "P1", T))!.budget).toBeNull();
    expect((await getProject(db, clientC, "P1", T))!.budget).toBe(500000);
    expect((await getProject(db, admin, "P1", T))!.budget).toBe(500000);
  });
});

describe("payments", () => {
  it("admin sees all", async () => expect(ids(await listPayments(db, admin, { filter: "all", today: T }))).toHaveLength(5));
  it("a member sees only their own payouts", async () => {
    expect(ids(await listPayments(db, memberA, { filter: "all", today: T }))).toEqual(["out-A"]);
    // …even on their own project's page.
    expect(ids((await getProject(db, memberA, "P1", T))!.payments)).toEqual(["out-A"]);
  });
  it("a client sees only incoming payments on their projects", async () => {
    expect(ids(await listPayments(db, clientC, { filter: "all", today: T }))).toEqual(["in-P1"]);
  });
  it("overdue = pending and past due", async () => {
    expect(await listPayments(db, admin, { filter: "overdue", today: "2026-01-10" })).toHaveLength(0);
    expect(await listPayments(db, admin, { filter: "overdue", today: "2026-01-11" })).toHaveLength(5);
  });
  it("dashboard totals respect the same scope", async () => {
    const d = await dashboard(db, memberA, T);
    expect(d.incoming).toEqual([]);
    expect(d.outgoing).toEqual([{ currency: "EUR", total: 10000, overdue: 10000, count: 1 }]);
    const c = await dashboard(db, clientC, T);
    expect(c.outgoing).toEqual([]);
    expect(c.incoming[0].total).toBe(10000);
  });
});

describe("notes and links", () => {
  it("members see team and client notes on their project", async () => {
    expect(ids((await getProject(db, memberA, "P1", T))!.notes)).toEqual(["n-client", "n-team"]);
  });
  it("clients see only client-visible notes and links", async () => {
    const p = (await getProject(db, clientC, "P1", T))!;
    expect(ids(p.notes)).toEqual(["n-client"]);
    expect(ids(p.links)).toEqual(["l-client"]);
  });
});
