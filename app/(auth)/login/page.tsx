import type { Metadata } from "next";
import { redirect } from "next/navigation";
import ActionForm from "@/components/ActionForm";
import { login } from "@/app/actions/auth";
import { getSessionUser } from "@/lib/dal";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (await getSessionUser()) redirect("/");
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  return (
    <div className="stack">
      <h1>Sign in</h1>
      {sp.reset && <p className="msg ok">Password set. Sign in with it now.</p>}
      <ActionForm action={login} submit="Sign in">
        <input type="hidden" name="next" value={next} />
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required autoFocus />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
      </ActionForm>
      <p className="muted">
        <a href="/forgot-password">Forgot your password?</a>
      </p>
    </div>
  );
}
