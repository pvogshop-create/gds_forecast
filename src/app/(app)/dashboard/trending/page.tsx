import type React from "react";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { MarketBanner } from "@/components/markets/MarketBanner";
import { MarketList } from "@/components/markets/MarketList";
import { Avatar } from "@/components/ui/Avatar";
import { formatCoins } from "@/lib/utils";
import type { Market, Position, Profile } from "@/types/database";

type LeaderboardUser = Pick<
  Profile,
  "id" | "username" | "display_name" | "avatar_url" | "coins" | "wins" | "total_bets"
>;

export default async function TrendingPage() {
  const user = await requireAuth();
  const supabase = await createClient();

  const [featuredResult, marketsResult, positionsResult, leaderboardResult] =
    await Promise.all([
      supabase
        .from("markets")
        .select("*")
        .eq("is_featured", true)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),

      supabase
        .from("markets")
        .select("*")
        .eq("status", "open")
        .order("yes_pool", { ascending: false })
        .limit(30),

      supabase
        .from("positions")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "open"),

      supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, coins, wins, total_bets")
        .order("coins", { ascending: false })
        .limit(3),
    ]);

  const featured = featuredResult.data as Market | null;
  const markets = (marketsResult.data ?? []) as Market[];
  const topBettors = (leaderboardResult.data ?? []) as LeaderboardUser[];

  // Sort by total pool (yes + no) descending
  markets.sort((a, b) => (b.yes_pool + b.no_pool) - (a.yes_pool + a.no_pool));

  // Build user positions map for quick lookup
  const userPositions: Record<string, Position> = {};
  for (const pos of (positionsResult.data ?? []) as Position[]) {
    if (!userPositions[pos.market_id]) {
      userPositions[pos.market_id] = pos;
    }
  }

  // Non-featured markets for the list
  const listMarkets = markets.filter((m) => m.id !== featured?.id);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1
          className="text-xl font-bold"
          style={{ color: "var(--color-ink-primary)" }}
        >
          Trending
        </h1>
        <span
          className="text-xs"
          style={{ color: "var(--color-ink-tertiary)" }}
        >
          {markets.length} open markets
        </span>
      </div>

      {/* Mini leaderboard */}
      {topBettors.length > 0 && (
        <div
          className="rounded-xl mb-4 overflow-hidden"
          style={{
            backgroundColor: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
          }}
        >
          <div
            className="px-3 py-2 flex items-center justify-between"
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >
            <span
              className="text-xs font-semibold"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Top Bettors
            </span>
          </div>
          <div className="flex divide-x" style={{ "--tw-divide-opacity": 1 } as React.CSSProperties}>
            {topBettors.map((u, i) => (
              <a
                key={u.id}
                href={`/profile/${u.username ?? ""}`}
                className="flex-1 flex flex-col items-center gap-1 py-2.5 px-2 hover:bg-[var(--color-bg-hover)] transition-colors duration-150"
                style={{ borderColor: "var(--color-border)" }}
              >
                <span className="text-base leading-none">{["🥇","🥈","🥉"][i]}</span>
                <Avatar
                  src={u.avatar_url}
                  displayName={u.display_name}
                  username={u.username}
                  size="sm"
                />
                <span
                  className="text-xs font-medium truncate max-w-full px-1"
                  style={{ color: "var(--color-ink-primary)" }}
                >
                  {u.display_name ?? u.username}
                </span>
                <span
                  className="text-xs font-bold"
                  style={{ color: "var(--color-coin)" }}
                >
                  {formatCoins(u.coins)}
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {featured && <MarketBanner market={featured} />}

      <MarketList
        markets={listMarkets}
        userPositions={userPositions}
        emptyMessage="No open markets right now."
      />
    </div>
  );
}
