import type { Metadata } from "next";
import ActionForm from "@/components/ActionForm";
import { requestReset } from "@/app/actions/auth";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <div className="stack">
      <h1>Reset password</h1>
      <ActionForm action={requestReset} submit="Send reset link">
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required autoFocus />
        </label>
      </ActionForm>
      <p className="muted"><a href="/login">Back to sign in</a></p>
    </div>
  );
}
