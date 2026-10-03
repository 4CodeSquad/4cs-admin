import { Mark } from "@/components/Logo";
import NavLinks from "@/components/NavLinks";
import { logout } from "@/app/actions/auth";
import { requireUser } from "@/lib/dal";

const LINKS = {
  admin: [
    { href: "/", label: "Dashboard" },
    { href: "/projects", label: "Projects" },
    { href: "/payments", label: "Payments" },
    { href: "/fund", label: "Company fund" },
    { href: "/clients", label: "Clients" },
    { href: "/team", label: "Team & access" },
    { href: "/account", label: "Account" },
  ],
  member: [
    { href: "/", label: "Dashboard" },
    { href: "/projects", label: "My projects" },
    { href: "/payments", label: "My payments" },
    { href: "/account", label: "Account" },
  ],
  client: [
    { href: "/", label: "Overview" },
    { href: "/projects", label: "Projects" },
    { href: "/payments", label: "Invoices" },
    { href: "/account", label: "Account" },
  ],
};

/**
 * The signed-in shell. Pages still call requireUser()/requireAdmin()
 * themselves — a layout check alone isn't enough, because layouts don't
 * re-render on every navigation.
 */
export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await requireUser({ allowWithout2fa: true });
  return (
    <div className="shell">
      <aside className="side">
        <a className="brand" href="/">
          <Mark />
          <span>
            4CS <small>Admin</small>
          </span>
        </a>
        <NavLinks links={LINKS[me.role]} />
        <div className="me">
          <strong>{me.name}</strong>
          <span className="mono">{me.role}</span>
          <form action={logout}>
            <button>Sign out</button>
          </form>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
