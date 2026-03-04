// Minimal layout for auth routes (login, onboarding) — no sidebar
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--color-bg)" }}>
      {children}
    </div>
  );
}
