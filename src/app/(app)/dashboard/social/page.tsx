import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { ActivityFeed } from "@/components/feed/ActivityFeed";
import { Leaderboard } from "@/components/feed/Leaderboard";
import type {
  ActivityFeedEntryWithProfile,
  Profile,
} from "@/types/database";

export default async function SocialPage() {
  await requireAuth();
  const supabase = await createClient();

  const [feedResult, leaderboardResult] = await Promise.all([
    // Activity feed with joined profiles and market titles
    supabase
      .from("activity_feed")
      .select(
        `
        *,
        profiles:user_id (username, display_name, avatar_url),
        markets:market_id (title, category, yes_probability)
        `
      )
      .order("created_at", { ascending: false })
      .limit(50),

    // Leaderboard: top 10 by coins
    supabase
      .from("profiles")
      .select("id, username, display_name, avatar_url, coins, wins, total_bets")
      .not("username", "is", null)
      .order("coins", { ascending: false })
      .limit(10),
  ]);

  const feedEntries =
    (feedResult.data ?? []) as ActivityFeedEntryWithProfile[];
  const leaderboard = (leaderboardResult.data ?? []) as Pick<
    Profile,
    | "id"
    | "username"
    | "display_name"
    | "avatar_url"
    | "coins"
    | "wins"
    | "total_bets"
  >[];

  return (
    <div>
      <h1
        className="text-xl font-bold mb-4"
        style={{ color: "var(--color-ink-primary)" }}
      >
        Social
      </h1>

      <div className="space-y-4">
        {/* Leaderboard */}
        <Leaderboard users={leaderboard} />

        {/* Activity feed */}
        <div
          className="rounded-xl overflow-hidden"
          style={{
            backgroundColor: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div
            className="px-4 py-3"
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >
            <h2
              className="font-semibold text-sm"
              style={{ color: "var(--color-ink-primary)" }}
            >
              Recent Activity
            </h2>
          </div>
          <ActivityFeed entries={feedEntries} />
        </div>
      </div>
    </div>
  );
}
