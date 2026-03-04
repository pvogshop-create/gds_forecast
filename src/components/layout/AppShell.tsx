import { Sidebar } from "./Sidebar";
import { BottomTabBar } from "./BottomTabBar";
import type { Profile } from "@/types/database";
import type { User } from "@supabase/supabase-js";

interface AppShellProps {
  user: User;
  profile: Profile;
  isAdmin: boolean;
  children: React.ReactNode;
}

export function AppShell({
  user: _user,
  profile,
  isAdmin,
  children,
}: AppShellProps) {
  return (
    <div
      className="flex min-h-screen"
      style={{ backgroundColor: "var(--color-bg)" }}
    >
      {/* Desktop sidebar — hidden on mobile */}
      <Sidebar
        profile={profile}
        isAdmin={isAdmin}
        className="hidden lg:flex lg:flex-col"
      />

      {/* Main content — offset for sidebar on desktop, bottom padding on mobile */}
      <main className="flex-1 lg:ml-64 pb-20 lg:pb-0 min-h-screen">
        <div className="max-w-2xl mx-auto px-4 py-6">{children}</div>
      </main>

      {/* Mobile bottom tab bar — hidden on desktop */}
      <BottomTabBar className="lg:hidden" />
    </div>
  );
}
