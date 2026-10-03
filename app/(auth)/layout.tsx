import { Mark } from "@/components/Logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="auth">
      <div className="card">
        <div className="brand">
          <Mark /> 4CS Admin
        </div>
        {children}
      </div>
    </main>
  );
}
