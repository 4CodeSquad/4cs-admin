"use client";

import { useActionState, useEffect, useRef, type ReactNode } from "react";
import type { FormState } from "@/lib/validation";

/**
 * A form wired to a server action through useActionState: shows the action's
 * error/ok message, disables the button while pending, and (optionally)
 * clears itself after a successful save.
 */
export default function ActionForm({
  action,
  children,
  submit = "Save",
  resetOnSuccess = false,
  className = "fields",
}: {
  action: (state: FormState, fd: FormData) => Promise<FormState>;
  children: ReactNode;
  submit?: string;
  resetOnSuccess?: boolean;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (resetOnSuccess && state?.ok) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state?.error && <p className="msg error" role="alert">{state.error}</p>}
      {state?.ok && <p className="msg ok" role="status">{state.ok}</p>}
      <div>
        <button className="btn" disabled={pending}>
          {pending ? "Saving…" : submit}
        </button>
      </div>
    </form>
  );
}
