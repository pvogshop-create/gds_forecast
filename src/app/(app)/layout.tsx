import { requireOnboarding, isAdmin } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Server-side: ensure authenticated + onboarded (redirects if not)
  const { profile } = await requireOnboarding();
  const adminFlag = await isAdmin();

  return (
    <AppShell profile={profile} isAdmin={adminFlag}>
      {children}
    </AppShell>
  );
}
