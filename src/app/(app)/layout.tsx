import { requireOnboarding, isAdmin } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side: ensure authenticated + onboarded (redirects if not)
  const { user, profile } = await requireOnboarding();
  const adminFlag = await isAdmin();

  return (
    <AppShell user={user} profile={profile} isAdmin={adminFlag}>
      {children}
    </AppShell>
  );
}
