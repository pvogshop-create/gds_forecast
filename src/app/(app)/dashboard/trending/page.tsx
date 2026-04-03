import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { MarketBanner } from "@/components/markets/MarketBanner";
import { MarketList } from "@/components/markets/MarketList";
import { Leaderboard } from "@/components/feed/Leaderboard";
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
        .limit(5),
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
        <div className="mb-4">
          <Leaderboard users={topBettors} />
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
