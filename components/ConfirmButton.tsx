"use client";

import { useTransition } from "react";

/**
 * A button that runs a bound server action, asking first when `confirm` is set.
 * If the action returns `{ error }` (e.g. a refused undo), it's shown to the user.
 */
export default function ConfirmButton({
  action,
  children,
  confirm,
  className = "btn small secondary",
}: {
  action: () => Promise<unknown>;
  children: React.ReactNode;
  confirm?: string;
  className?: string;
}) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() => {
        if (confirm && !window.confirm(confirm)) return;
        start(async () => {
          const result = (await action()) as { error?: string } | undefined;
          if (result?.error) window.alert(result.error);
        });
      }}
    >
      {pending ? "…" : children}
    </button>
  );
}
