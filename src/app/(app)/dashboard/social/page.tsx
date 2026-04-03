import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { MarketBanner } from "@/components/markets/MarketBanner";
import { MarketList } from "@/components/markets/MarketList";
import type { Market, Position } from "@/types/database";

export default async function SocialPage() {
  const user = await requireAuth();
  const supabase = await createClient();

  const [featuredResult, marketsResult, positionsResult] = await Promise.all([
    supabase
      .from("markets")
      .select("*")
      .eq("category", "social")
      .eq("is_featured", true)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),

    supabase
      .from("markets")
      .select("*")
      .eq("category", "social")
      .in("status", ["open", "closed"])
      .order("yes_pool", { ascending: false })
      .limit(30),

    supabase
      .from("positions")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "open"),
  ]);

  const featured = featuredResult.data as Market | null;
  const markets = (marketsResult.data ?? []) as Market[];

  const userPositions: Record<string, Position> = {};
  for (const pos of (positionsResult.data ?? []) as Position[]) {
    if (!userPositions[pos.market_id]) {
      userPositions[pos.market_id] = pos;
    }
  }

  const listMarkets = markets.filter((m) => m.id !== featured?.id);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1
          className="text-xl font-bold"
          style={{ color: "var(--color-ink-primary)" }}
        >
          💬 Social
        </h1>
        <span
          className="text-xs"
          style={{ color: "var(--color-ink-tertiary)" }}
        >
          {markets.length} markets
        </span>
      </div>

      {featured && <MarketBanner market={featured} />}

      <MarketList
        markets={listMarkets}
        userPositions={userPositions}
        emptyMessage="No social markets right now."
      />
    </div>
  );
}
