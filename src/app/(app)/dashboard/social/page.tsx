import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { MarketBanner } from "@/components/markets/MarketBanner";
import { MarketList } from "@/components/markets/MarketList";
import { MarketTabSwitcher } from "@/components/markets/MarketTabSwitcher";
import type { Market, Position } from "@/types/database";

export default async function SocialPage({
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

  const [featuredResult, marketsResult, positionsResult] = await Promise.all([
    isCompleted
      ? Promise.resolve({ data: null })
      : supabase
          .from("markets")
          .select("*")
          .eq("category", "social")
          .eq("is_featured", true)
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),

    isCompleted
      ? supabase
          .from("markets")
          .select("*")
          .eq("category", "social")
          .in("status", ["closed", "resolved_yes", "resolved_no", "cancelled"])
          .order("resolution_date", { ascending: false })
          .limit(50)
      : supabase
          .from("markets")
          .select("*")
          .eq("category", "social")
          .in("status", ["open"])
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

      <MarketTabSwitcher
        activeHref="/dashboard/social"
        completedHref="/dashboard/social?view=completed"
        isCompleted={isCompleted}
      />

      {!isCompleted && featured && <MarketBanner market={featured} />}

      <MarketList
        markets={listMarkets}
        userPositions={userPositions}
        currentUserId={user.id}
        emptyMessage={
          isCompleted
            ? "No completed social markets yet."
            : "No social markets right now."
        }
      />
    </div>
  );
}
