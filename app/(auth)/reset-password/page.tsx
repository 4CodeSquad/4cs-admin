import type { Metadata } from "next";
import ActionForm from "@/components/ActionForm";
import { resetPassword } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Set your password" };

/** Reached from the emailed link (invite or reset): /reset-password?token=… */
export default async function ResetPage({ searchParams }: PageProps<"/reset-password">) {
  const sp = await searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const invalid = sp.error === "INVALID_TOKEN" || !token;
  return (
    <div className="stack">
      <h1>{sp.invite ? "Welcome — set your password" : "Set a new password"}</h1>
      {invalid ? (
        <p className="msg error">
          This link is invalid or has expired. <a href="/forgot-password">Request a new one</a>.
        </p>
      ) : (
        <ActionForm action={resetPassword} submit="Set password">
          <input type="hidden" name="token" value={token} />
          <label>
            New password (at least 10 characters)
            <input name="password" type="password" autoComplete="new-password" minLength={10} required autoFocus />
          </label>
          <label>
            Repeat it
            <input name="confirm" type="password" autoComplete="new-password" minLength={10} required />
          </label>
        </ActionForm>
      )}
    </div>
  );
}
