import { beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, reset } from "./db";
import * as s from "../db/schema";

process.env.BETTER_AUTH_SECRET = "test-secret-test-secret-test-secret-123";
process.env.BETTER_AUTH_URL = "http://localhost:3000";

// Capture outgoing email instead of sending it.
const sent: { to: string; subject: string; text: string }[] = [];
vi.mock("@/lib/email", () => ({
  sendEmail: async (to: string, subject: string, text: string) => void sent.push({ to, subject, text }),
}));

const { createAuth } = await import("@/lib/auth-config");
const auth = createAuth(db);

beforeAll(reset);

describe("auth", () => {
  it("creates users with the custom roles and invites them by email", async () => {
    for (const [email, role] of [["m@test.local", "member"], ["c@test.local", "client"]] as const) {
      const res = await auth.api.createUser({ body: { email, name: email, role: role as "admin", password: "x".repeat(40) } });
      expect(res.user.role).toBe(role);
      await auth.api.requestPasswordReset({ body: { email, redirectTo: "http://localhost:3000/reset-password?invite=1" } });
    }
    expect(sent.map((m) => m.subject)).toEqual(["Your 4CS Admin account", "Your 4CS Admin account"]);
  });

  it("lets the invited user set a password from the emailed link and sign in", async () => {
    const link = sent[0].text.match(/https?:\/\/\S+/)![0];
    const token = new URL(link).pathname.split("/").pop()!;
    await auth.api.resetPassword({ body: { token, newPassword: "a-good-password-1" } });
    const res = await auth.api.signInEmail({ body: { email: "m@test.local", password: "a-good-password-1" } });
    expect(res.user.email).toBe("m@test.local");
    // The token is single-use.
    await expect(auth.api.resetPassword({ body: { token, newPassword: "another-password-2" } })).rejects.toThrow();
  });

  it("rejects unknown roles", async () => {
    await expect(
      auth.api.createUser({ body: { email: "x@test.local", name: "x", role: "superuser" as "admin", password: "x".repeat(40) } }),
    ).rejects.toThrow();
  });

  it("has no public sign-up", async () => {
    await expect(
      auth.api.signUpEmail({ body: { email: "evil@test.local", password: "password-123456", name: "e" } }),
    ).rejects.toThrow();
    expect(await db.select().from(s.user).where(eq(s.user.email, "evil@test.local"))).toHaveLength(0);
  });

  it("blocks banned users from signing in", async () => {
    await db.update(s.user).set({ banned: true }).where(eq(s.user.email, "m@test.local"));
    await expect(
      auth.api.signInEmail({ body: { email: "m@test.local", password: "a-good-password-1" } }),
    ).rejects.toThrow();
  });
});
