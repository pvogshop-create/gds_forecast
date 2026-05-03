import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { MarketList } from "@/components/markets/MarketList";
import { MarketTabSwitcher } from "@/components/markets/MarketTabSwitcher";
import type { Market, Position, Profile } from "@/types/database";

export default async function ActionsPage({
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

  const [marketsResult, positionsResult, profileResult] = await Promise.all([
    isCompleted
      ? supabase
          .from("markets")
          .select("*")
          .eq("category", "actions")
          .in("status", ["closed", "resolved_yes", "resolved_no", "cancelled"])
          .order("resolution_date", { ascending: false })
          .limit(50)
      : supabase
          .from("markets")
          .select("*")
          .eq("category", "actions")
          .in("status", ["open"])
          .order("yes_pool", { ascending: false })
          .limit(30),

    supabase
      .from("positions")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "open"),

    supabase.from("profiles").select("username").eq("id", user.id).single(),
  ]);

  const markets = (marketsResult.data ?? []) as Market[];
  const currentUsername = (profileResult.data as Pick<Profile, "username"> | null)?.username ?? null;

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

      <MarketTabSwitcher
        activeHref="/dashboard/actions"
        completedHref="/dashboard/actions?view=completed"
        isCompleted={isCompleted}
      />

      <MarketList
        markets={markets}
        userPositions={userPositions}
        currentUserId={user.id}
        currentUsername={currentUsername}
        emptyMessage={
          isCompleted
            ? "No completed actions markets yet."
            : "No actions markets right now."
        }
      />
    </div>
  );
}
