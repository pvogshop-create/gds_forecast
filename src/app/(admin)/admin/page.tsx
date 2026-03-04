import { requireAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminMarkets } from "./AdminMarkets";
import { AdminSuggestions } from "./AdminSuggestions";
import { AdminUsers } from "./AdminUsers";
import type { Market, MarketSuggestion, Profile } from "@/types/database";

export default async function AdminPage() {
  const adminUser = await requireAdmin();
  const admin = createAdminClient();

  const [marketsResult, suggestionsResult, usersResult] = await Promise.all([
    admin
      .from("markets")
      .select("*")
      .in("status", ["open", "closed"])
      .order("created_at", { ascending: false })
      .limit(50),

    admin
      .from("market_suggestions")
      .select("*, profiles:user_id (username, avatar_url)")
      .eq("status", "pending")
      .order("created_at", { ascending: false }),

    admin
      .from("profiles")
      .select("id, username, display_name, avatar_url, coins, total_bets, wins")
      .not("username", "is", null)
      .order("coins", { ascending: false })
      .limit(50),
  ]);

  const markets = (marketsResult.data ?? []) as Market[];
  const suggestions = (suggestionsResult.data ?? []) as Array<
    MarketSuggestion & {
      profiles: Pick<Profile, "username" | "avatar_url"> | null;
    }
  >;
  const users = (usersResult.data ?? []) as Pick<
    Profile,
    "id" | "username" | "display_name" | "avatar_url" | "coins" | "total_bets" | "wins"
  >[];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1
            className="text-xl font-bold"
            style={{ color: "var(--color-ink-primary)" }}
          >
            Admin Dashboard
          </h1>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              backgroundColor: "var(--color-coin)",
              color: "white",
            }}
          >
            Admin
          </span>
        </div>
        <p
          className="text-sm"
          style={{ color: "var(--color-ink-secondary)" }}
        >
          Signed in as {adminUser.email}
        </p>
      </div>

      {/* Pending suggestions */}
      <AdminSuggestions suggestions={suggestions} />

      {/* Open markets */}
      <AdminMarkets markets={markets} />

      {/* Users */}
      <AdminUsers users={users} />
    </div>
  );
}
