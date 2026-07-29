"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  TrendingUp,
  Users,
  Trophy,
  Zap,
  Shield,
  Plus,
  Bell,
  Coins,
  Settings,
  LogOut,
  Wallet,
  Flag,
} from "lucide-react";
import { cn, formatCoins, getInitials } from "@/lib/utils";
import type { Profile } from "@/types/database";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

const NAV_ITEMS = [
  { label: "Trending", href: "/dashboard/trending", icon: TrendingUp },
  { label: "Social", href: "/dashboard/social", icon: Users },
  { label: "Sports", href: "/dashboard/sports", icon: Trophy },
  { label: "Actions", href: "/dashboard/actions", icon: Zap },
] as const;

const SECONDARY_NAV = [
  { label: "My Bets", href: "/more?tab=bets", icon: Wallet },
  { label: "Reports", href: "/more?tab=reports", icon: Flag },
  { label: "Notifications", href: "/notifications", icon: Bell },
  { label: "Leagues", href: "/leagues", icon: Shield },
  { label: "Suggest a Line", href: "/suggest", icon: Plus },
] as const;

interface SidebarProps {
  profile: Profile;
  className?: string;
  isAdmin?: boolean;
}

export function Sidebar({ profile, className, isAdmin }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 h-screen w-64 flex flex-col z-30",
        className
      )}
      style={{
        backgroundColor: "var(--color-bg-card)",
        borderRight: "1px solid var(--color-border)",
      }}
    >
      {/* Logo */}
      <div className="p-5 pb-4">
        <Link
          href="/dashboard/trending"
          className="flex items-center gap-2.5 group"
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 transition-transform duration-200 group-hover:scale-105"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
              <polyline points="16 7 22 7 22 13" />
            </svg>
          </div>
          <span
            className="font-bold text-base"
            style={{ color: "var(--color-ink-primary)" }}
          >
            Forecast
          </span>
        </Link>
      </div>

      {/* Main navigation */}
      <nav className="px-3 pb-2" aria-label="Main navigation">
        {NAV_ITEMS.map(({ label, href, icon: Icon }) => {
          const isActive = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 mb-0.5",
                isActive
                  ? "text-white"
                  : "hover:bg-[var(--color-bg-hover)]"
              )}
              style={{
                backgroundColor: isActive
                  ? "var(--color-primary)"
                  : undefined,
                color: isActive
                  ? "white"
                  : "var(--color-ink-secondary)",
              }}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon
                size={16}
                strokeWidth={2}
                style={{ opacity: isActive ? 1 : 0.7 }}
              />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Divider */}
      <div
        className="mx-4 my-1"
        style={{
          height: "1px",
          backgroundColor: "var(--color-border)",
        }}
      />

      {/* Secondary navigation */}
      <nav className="px-3 pt-2" aria-label="Secondary navigation">
        {SECONDARY_NAV.map(({ label, href, icon: Icon }) => {
          const hrefPath = href.split("?")[0];
          const isActive = pathname === hrefPath || pathname.startsWith(hrefPath + "/");
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 mb-0.5",
                "hover:bg-[var(--color-bg-hover)]"
              )}
              style={{
                backgroundColor: isActive
                  ? "var(--color-primary-light)"
                  : undefined,
                color: isActive
                  ? "var(--color-primary)"
                  : "var(--color-ink-secondary)",
              }}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon size={16} strokeWidth={2} style={{ opacity: 0.7 }} />
              {label}
            </Link>
          );
        })}

        {isAdmin && (
          <Link
            href="/admin"
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 mb-0.5 hover:bg-[var(--color-bg-hover)]"
            style={{ color: "var(--color-coin)" }}
          >
            <Settings size={16} strokeWidth={2} style={{ opacity: 0.7 }} />
            Admin
          </Link>
        )}
      </nav>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Play money badge */}
      <div className="px-4 pb-3">
        <p
          className="text-center play-money-badge"
          style={{ fontSize: "10px", color: "var(--color-ink-tertiary)" }}
        >
          🎮 Play Money — No real currency
        </p>
      </div>

      {/* User + coin balance */}
      <div
        className="p-3 mx-3 mb-3 rounded-xl"
        style={{
          backgroundColor: "var(--color-bg)",
          border: "1px solid var(--color-border)",
        }}
      >
        <Link
          href={`/profile/${profile.username ?? ""}`}
          className="flex items-center gap-3 mb-3 group"
        >
          {/* Avatar */}
          {profile.avatar_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={profile.avatar_url}
              alt={`${profile.username}'s avatar`}
              width={36}
              height={36}
              className="rounded-full flex-shrink-0 ring-2 ring-transparent group-hover:ring-[var(--color-primary)]"
              style={{ transition: "all 0.2s" }}
            />
          ) : (
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold text-white"
              style={{ backgroundColor: "var(--color-primary)" }}
            >
              {getInitials(profile.display_name, profile.username)}
            </div>
          )}
          <div className="min-w-0">
            <p
              className="text-sm font-semibold truncate"
              style={{ color: "var(--color-ink-primary)" }}
            >
              {profile.display_name ?? profile.username}
            </p>
            <p
              className="text-xs truncate"
              style={{ color: "var(--color-ink-tertiary)" }}
            >
              @{profile.username}
            </p>
          </div>
        </Link>

        {/* Coin balance */}
        <div
          className="flex items-center justify-between px-3 py-2 rounded-lg mb-2"
          style={{ backgroundColor: "var(--color-bg-card)" }}
        >
          <div className="flex items-center gap-2">
            <Coins
              size={14}
              style={{ color: "var(--color-coin)" }}
              strokeWidth={2}
            />
            <span
              className="text-xs font-medium"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Coins
            </span>
          </div>
          <span
            className="text-sm font-bold"
            style={{ color: "var(--color-ink-primary)" }}
          >
            {formatCoins(profile.coins)}
          </span>
        </div>

        {/* Sign out */}
        <button
          onClick={handleSignOut}
          className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition-colors duration-150 hover:bg-[var(--color-no-bg)]"
          style={{ color: "var(--color-ink-tertiary)" }}
        >
          <LogOut size={12} strokeWidth={2} />
          Sign out
        </button>
      </div>
    </aside>
  );
}
