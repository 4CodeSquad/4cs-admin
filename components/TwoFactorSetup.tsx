"use client";

import { useActionState } from "react";
import { startTwoFactor, confirmTwoFactor, type TwoFactorSetup as State } from "@/app/actions/auth";

/** Two steps: password → QR + backup codes → confirm with a code from the app. */
export default function TwoFactorSetup() {
  const [setup, start, starting] = useActionState<State, FormData>(startTwoFactor, undefined);
  const [confirmState, confirm, confirming] = useActionState(confirmTwoFactor, undefined);

  if (!setup?.qr) {
    return (
      <form action={start} className="fields">
        <label>Your password<input type="password" name="password" required autoComplete="current-password" /></label>
        {setup?.error && <p className="msg error">{setup.error}</p>}
        <div><button className="btn" disabled={starting}>{starting ? "…" : "Start setup"}</button></div>
      </form>
    );
  }

  return (
    <div className="stack">
      <p>1. Scan this with an authenticator app (Google Authenticator, 1Password, Authy…).</p>
      <div className="qr" dangerouslySetInnerHTML={{ __html: setup.qr }} />
      <p className="muted">Can&rsquo;t scan? Enter this key: <span className="mono">{setup.secret}</span></p>
      <p>2. Save these backup codes somewhere safe. Each works once if you lose your phone.</p>
      <div className="codes">{setup.backupCodes?.map((c) => <span key={c}>{c}</span>)}</div>
      <form action={confirm} className="fields">
        <label>3. Enter the 6-digit code from the app
          <input name="code" inputMode="numeric" autoComplete="one-time-code" required pattern="\d{6}" />
        </label>
        {confirmState?.error && <p className="msg error">{confirmState.error}</p>}
        <div><button className="btn" disabled={confirming}>{confirming ? "…" : "Turn on two-step login"}</button></div>
      </form>
    </div>
  );
}
