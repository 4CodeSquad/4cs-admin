import type { Metadata } from "next";
import { requireUser } from "@/lib/dal";
import ActionForm from "@/components/ActionForm";
import TwoFactorSetup from "@/components/TwoFactorSetup";
import { changePassword, disableTwoFactor } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  const me = await requireUser({ allowWithout2fa: true });
  const sp = await searchParams;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <p className="eyebrow">{me.role}</p>
          <h1>{me.name}</h1>
          <p className="muted">{me.email}</p>
        </div>
      </div>
      {sp.setup === "2fa" && (
        <p className="msg warn">Admins must turn on two-step login before using the dashboard.</p>
      )}
      {sp["2fa"] === "on" && <p className="msg ok">Two-step login is on.</p>}

      <div className="grid two">
        <div className="card">
          <h2>Two-step login</h2>
          {me.twoFactorEnabled ? (
            <div className="stack">
              <p><span className="badge green">on</span> You&rsquo;ll be asked for a code from your authenticator app when you sign in.</p>
              {me.role !== "admin" && (
                <details className="add">
                  <summary className="btn small danger">Turn off</summary>
                  <ActionForm action={disableTwoFactor} submit="Turn off two-step login">
                    <label>Your password<input type="password" name="password" required /></label>
                  </ActionForm>
                </details>
              )}
            </div>
          ) : (
            <TwoFactorSetup />
          )}
        </div>
        <div className="card">
          <h2>Change password</h2>
          <ActionForm action={changePassword} submit="Change password" resetOnSuccess>
            <label>Current password<input type="password" name="current" required autoComplete="current-password" /></label>
            <label>New password (at least 10 characters)<input type="password" name="password" minLength={10} required autoComplete="new-password" /></label>
          </ActionForm>
        </div>
      </div>
    </div>
  );
}
