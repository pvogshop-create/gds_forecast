"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TrendingUp, Users, Trophy, Zap, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { label: "Trending", href: "/dashboard/trending", icon: TrendingUp },
  { label: "Sports", href: "/dashboard/sports", icon: Trophy },
  { label: "Actions", href: "/dashboard/actions", icon: Zap },
  { label: "Social", href: "/dashboard/social", icon: Users },
  { label: "More", href: "/more", icon: LayoutGrid },
] as const;

interface BottomTabBarProps {
  className?: string;
}

export function BottomTabBar({ className }: BottomTabBarProps) {
  const pathname = usePathname();

  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-30 flex",
        className
      )}
      style={{
        backgroundColor: "var(--color-bg-card)",
        borderTop: "1px solid var(--color-border)",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
      aria-label="Mobile navigation"
    >
      {TABS.map(({ label, href, icon: Icon }) => {
        const isActive =
          pathname.startsWith(href) ||
          (href === "/more" &&
            (pathname.startsWith("/more") ||
              pathname.startsWith("/notifications") ||
              pathname.startsWith("/leagues") ||
              pathname.startsWith("/suggest") ||
              pathname.startsWith("/profile")));

        return (
          <Link
            key={href}
            href={href}
            className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors duration-150"
            style={{
              color: isActive
                ? "var(--color-primary)"
                : "var(--color-ink-tertiary)",
            }}
            aria-current={isActive ? "page" : undefined}
          >
            <Icon
              size={20}
              strokeWidth={isActive ? 2.5 : 1.8}
            />
            <span className="text-[10px] font-medium">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
