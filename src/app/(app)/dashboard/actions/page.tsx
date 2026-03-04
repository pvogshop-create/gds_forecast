import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { MarketList } from "@/components/markets/MarketList";
import type { Market, Position } from "@/types/database";

export default async function ActionsPage() {
  const user = await requireAuth();
  const supabase = await createClient();

  const [marketsResult, positionsResult] = await Promise.all([
    supabase
      .from("markets")
      .select("*")
      .eq("category", "actions")
      .in("status", ["open", "closed"])
      .order("yes_pool", { ascending: false })
      .limit(30),

    supabase
      .from("positions")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "open"),
  ]);

  const markets = (marketsResult.data ?? []) as Market[];

  const userPositions: Record<string, Position> = {};
  for (const pos of (positionsResult.data ?? []) as Position[]) {
    if (!userPositions[pos.market_id]) {
      userPositions[pos.market_id] = pos;
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1
          className="text-xl font-bold"
          style={{ color: "var(--color-ink-primary)" }}
        >
          ⚡ Actions
        </h1>
        <span
          className="text-xs"
          style={{ color: "var(--color-ink-tertiary)" }}
        >
          {markets.length} markets
        </span>
      </div>

      <MarketList
        markets={markets}
        userPositions={userPositions}
        emptyMessage="No actions markets right now."
      />
    </div>
  );
}
