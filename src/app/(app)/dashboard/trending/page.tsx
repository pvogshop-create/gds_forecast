import type React from "react";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { MarketList } from "@/components/markets/MarketList";
import { MarketTabSwitcher } from "@/components/markets/MarketTabSwitcher";
import { Avatar } from "@/components/ui/Avatar";
import { formatCoins, formatDisplayName } from "@/lib/utils";
import type { Market, Position, Profile } from "@/types/database";

type StreakUser = Pick<Profile, "id" | "username" | "display_name" | "avatar_url"> & {
  win_streak?: number;
  loss_streak?: number;
};

type WeeklyEarner = {
  user_id: string;
  weekly_earned: number;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
};

export default async function TrendingPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const isCompleted = view === "completed";

  const user = await requireAuth();
  const supabase = await createClient();

  // Move any expired open markets to 'closed' so they appear in the Completed tab
  await supabase.rpc("close_expired_markets");

  const [
    marketsResult,
    positionsResult,
    profileResult,
    hotStreakResult,
    coldStreakResult,
    weeklyEarnerResult,
  ] = await Promise.all([
    isCompleted
      ? supabase
          .from("markets")
          .select("*, suggested_by_profile:profiles!suggested_by(username, display_name)")
          .in("status", ["closed", "resolved_yes", "resolved_no", "cancelled"])
          .order("resolution_date", { ascending: false })
          .limit(50)
      : supabase
          .from("markets")
          .select("*, suggested_by_profile:profiles!suggested_by(username, display_name)")
          .eq("status", "open")
          .limit(100),

    supabase
      .from("positions")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "open"),

    supabase.from("profiles").select("username").eq("id", user.id).single(),

    // Stat leaderboard — hot streak
    supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, win_streak")
      .gt("win_streak", 0)
      .order("win_streak", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // Stat leaderboard — cold streak
    supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, loss_streak")
      .gt("loss_streak", 0)
      .order("loss_streak", { ascending: false })
      .limit(1)
      .maybeSingle(),

    // Stat leaderboard — weekly top earner
    supabase.rpc("get_weekly_top_earner"),
  ]);

  const allMarkets = (marketsResult.data ?? []) as Market[];
  const currentUsername =
    (profileResult.data as { username: string | null } | null)?.username ?? null;
  const hotStreakUser = hotStreakResult.data as StreakUser | null;
  const coldStreakUser = coldStreakResult.data as StreakUser | null;
  const weeklyEarner =
    ((weeklyEarnerResult.data as WeeklyEarner[] | null) ?? [])[0] ?? null;

  const userPositions: Record<string, Position> = {};
  for (const pos of (positionsResult.data ?? []) as Position[]) {
    if (!userPositions[pos.market_id]) {
      userPositions[pos.market_id] = pos;
    }
  }

  // ── Active tab: build 4 algorithmic sections ──────────────────────────────
  let newMarkets: Market[] = [];
  let closingSoonMarkets: Market[] = [];
  let mostBetOnMarkets: Market[] = [];
  let mostCommentedMarkets: Market[] = [];

  if (!isCompleted) {
    const now = Date.now();
    const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
    const in48h = new Date(now + 48 * 60 * 60 * 1000).toISOString();
    const nowIso = new Date(now).toISOString();

    newMarkets = [...allMarkets]
      .filter((m) => m.created_at >= threeDaysAgo)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 6);

    closingSoonMarkets = [...allMarkets]
      .filter(
        (m) =>
          m.resolution_date &&
          m.resolution_date > nowIso &&
          m.resolution_date <= in48h
      )
      .sort((a, b) =>
        (a.resolution_date ?? "").localeCompare(b.resolution_date ?? "")
      )
      .slice(0, 6);

    mostBetOnMarkets = [...allMarkets]
      .sort(
        (a, b) => b.yes_pool + b.no_pool - (a.yes_pool + a.no_pool)
      )
      .slice(0, 6);

    // Fetch comment counts for all open market IDs
    const marketIds = allMarkets.map((m) => m.id);
    if (marketIds.length > 0) {
      const { data: commentRows } = await supabase
        .from("market_comments")
        .select("market_id")
        .in("market_id", marketIds);

      const commentCounts = new Map<string, number>();
      for (const { market_id } of commentRows ?? []) {
        commentCounts.set(market_id, (commentCounts.get(market_id) ?? 0) + 1);
      }

      mostCommentedMarkets = [...allMarkets]
        .filter((m) => (commentCounts.get(m.id) ?? 0) > 0)
        .sort(
          (a, b) =>
            (commentCounts.get(b.id) ?? 0) - (commentCounts.get(a.id) ?? 0)
        )
        .slice(0, 6);
    }
  }

  const statCards = [
    hotStreakUser && {
      emoji: "🔥",
      label: "Hot Streak",
      user: hotStreakUser,
      stat: `${hotStreakUser.win_streak} wins in a row`,
    },
    coldStreakUser && {
      emoji: "🥶",
      label: "Cold Streak",
      user: coldStreakUser,
      stat: `${coldStreakUser.loss_streak} losses in a row`,
    },
    weeklyEarner && {
      emoji: "💰",
      label: "Week's Best",
      user: {
        id: weeklyEarner.user_id,
        username: weeklyEarner.username,
        display_name: weeklyEarner.display_name,
        avatar_url: weeklyEarner.avatar_url,
      },
      stat: `+${formatCoins(weeklyEarner.weekly_earned)} this week`,
    },
  ].filter(Boolean) as {
    emoji: string;
    label: string;
    user: {
      id: string;
      username: string | null;
      display_name: string | null;
      avatar_url: string | null;
    };
    stat: string;
  }[];

  const sections = isCompleted
    ? null
    : [
        { title: "✨ New", markets: newMarkets },
        { title: "⏳ Closing Soon", markets: closingSoonMarkets },
        { title: "🔥 Most Bet On", markets: mostBetOnMarkets },
        { title: "💬 Most Commented", markets: mostCommentedMarkets },
      ].filter((s) => s.markets.length > 0);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1
          className="text-xl font-bold"
          style={{ color: "var(--color-ink-primary)" }}
        >
          Trending
        </h1>
        {isCompleted && (
          <span
            className="text-xs"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            {allMarkets.length} completed markets
          </span>
        )}
      </div>

      <MarketTabSwitcher
        activeHref="/dashboard/trending"
        completedHref="/dashboard/trending?view=completed"
        isCompleted={isCompleted}
      />

      {/* Stat leaderboard — active tab only */}
      {!isCompleted && statCards.length > 0 && (
        <div
          className="rounded-xl mb-4 overflow-hidden"
          style={{
            backgroundColor: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
          }}
        >
          <div
            className="px-3 py-2"
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >
            <span
              className="text-xs font-semibold"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Stat Leaders
            </span>
          </div>
          <div
            className="flex divide-x"
            style={{ "--tw-divide-opacity": 1 } as React.CSSProperties}
          >
            {statCards.map((card) => (
              <div
                key={card.label}
                className="flex-1 flex flex-col items-center gap-1 py-3 px-2"
                style={{ borderColor: "var(--color-border)" }}
              >
                <span className="text-base leading-none">{card.emoji}</span>
                <Avatar
                  src={card.user.avatar_url}
                  displayName={card.user.display_name}
                  username={card.user.username}
                  size="sm"
                />
                <span
                  className="text-xs font-medium truncate max-w-full px-1 text-center"
                  style={{ color: "var(--color-ink-primary)" }}
                >
                  {formatDisplayName(card.user.display_name, card.user.username)}
                </span>
                <span
                  className="text-[10px] font-semibold text-center px-1"
                  style={{ color: "var(--color-ink-secondary)" }}
                >
                  {card.label}
                </span>
                <span
                  className="text-[10px] text-center px-1"
                  style={{ color: "var(--color-ink-tertiary)" }}
                >
                  {card.stat}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active tab: algorithmic sections */}
      {!isCompleted && sections && sections.length > 0 && (
        <div className="space-y-6">
          {sections.map((section) => (
            <div key={section.title}>
              <h2
                className="text-sm font-semibold mb-3"
                style={{ color: "var(--color-ink-secondary)" }}
              >
                {section.title}
              </h2>
              <MarketList
                markets={section.markets}
                userPositions={userPositions}
                currentUserId={user.id}
                currentUsername={currentUsername}
              />
            </div>
          ))}
        </div>
      )}

      {!isCompleted && sections?.length === 0 && (
        <p
          className="text-sm text-center py-10"
          style={{ color: "var(--color-ink-tertiary)" }}
        >
          No open markets right now.
        </p>
      )}

      {/* Completed tab: flat list */}
      {isCompleted && (
        <MarketList
          markets={allMarkets}
          userPositions={userPositions}
          currentUserId={user.id}
          currentUsername={currentUsername}
          emptyMessage="No completed markets yet."
        />
      )}
    </div>
  );
}
