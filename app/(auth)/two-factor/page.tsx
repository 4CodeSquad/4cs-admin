import type { Metadata } from "next";
import ActionForm from "@/components/ActionForm";
import { verifyTwoFactor } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Two-step login" };

export default async function TwoFactorPage({ searchParams }: PageProps<"/two-factor">) {
  const sp = await searchParams;
  return (
    <div className="stack">
      <h1>Two-step login</h1>
      <p className="muted">Enter the 6-digit code from your authenticator app, or one of your backup codes.</p>
      <ActionForm action={verifyTwoFactor} submit="Verify">
        <input type="hidden" name="next" value={typeof sp.next === "string" ? sp.next : "/"} />
        <label>
          Code
          <input name="code" inputMode="numeric" autoComplete="one-time-code" required autoFocus />
        </label>
        <label className="check">
          <input type="checkbox" name="trust" /> Trust this device for 30 days
        </label>
      </ActionForm>
    </div>
  );
}
