import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { Avatar } from "@/components/ui/Avatar";
import { CategoryBadge } from "@/components/ui/Badge";
import { ActivityFeed } from "@/components/feed/ActivityFeed";
import {
  formatCoins,
  formatWinRate,
  formatProbability,
} from "@/lib/utils";
import type {
  Profile,
  Position,
  League,
  ActivityFeedEntryWithProfile,
} from "@/types/database";

interface ProfilePageProps {
  params: Promise<{ username: string }>;
}

type PositionWithMarket = Position & {
  markets: { id: string; title: string; category: string; yes_probability: number; status: string } | null;
};

export default async function ProfilePage({ params }: ProfilePageProps) {
  const currentUser = await requireAuth();
  const { username } = await params;
  const supabase = await createClient();

  const [profileResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("*")
      .eq("username", username)
      .single(),
  ]);

  if (!profileResult.data) notFound();
  const profile = profileResult.data as Profile;

  // Fetch positions, leagues, activity after we have the profile id
  const [positionsResult, leaguesResult, activityResult] = await Promise.all([
    supabase
      .from("positions")
      .select("*, markets:market_id (id, title, category, yes_probability, status)")
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(10),

    supabase
      .from("league_members")
      .select("role, leagues:league_id (id, name, max_members)")
      .eq("user_id", profile.id),

    supabase
      .from("activity_feed")
      .select(
        "*, profiles:user_id (username, display_name, avatar_url), markets:market_id (title, category, yes_probability)"
      )
      .eq("user_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const positions = (positionsResult.data ?? []) as PositionWithMarket[];
  const leagues = (leaguesResult.data ?? []) as unknown as Array<{
    role: string;
    leagues: Pick<League, "id" | "name" | "max_members"> | null;
  }>;
  const activity = (activityResult.data ?? []) as ActivityFeedEntryWithProfile[];

  const isOwnProfile = currentUser.id === profile.id;

  return (
    <div className="space-y-4">
      {/* Profile header */}
      <div
        className="rounded-xl p-5"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <div className="flex items-start gap-4">
          <Avatar
            src={profile.avatar_url}
            displayName={profile.display_name}
            username={profile.username}
            size="lg"
          />
          <div className="flex-1 min-w-0">
            <h1
              className="text-lg font-bold"
              style={{ color: "var(--color-ink-primary)" }}
            >
              {profile.display_name ?? profile.username}
            </h1>
            <p
              className="text-sm"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              <span data-testid="profile-username">@{profile.username}</span>
            </p>

            {isOwnProfile && (
              <Link
                href={`/profile/${profile.username}/edit`}
                className="inline-flex items-center gap-1.5 mt-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors duration-150 hover:bg-[var(--color-bg-hover)]"
                style={{
                  border: "1px solid var(--color-border)",
                  color: "var(--color-ink-secondary)",
                }}
              >
                Edit profile
              </Link>
            )}
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          {[
            {
              id: "coins",
              label: "Coins",
              value: formatCoins(profile.coins),
              color: "var(--color-coin)",
            },
            {
              id: "winrate",
              label: "Win rate",
              value: formatWinRate(profile.wins, profile.total_bets),
              color: "var(--color-primary)",
            },
            {
              id: "bets",
              label: "Total bets",
              value: profile.total_bets.toString(),
              color: "var(--color-ink-primary)",
            },
          ].map(({ id, label, value, color }) => (
            <div
              key={label}
              data-testid={`profile-stat-${id}`}
              className="rounded-xl p-3 text-center"
              style={{ backgroundColor: "var(--color-bg)" }}
            >
              <p
                className="text-lg font-bold"
                style={{ color }}
              >
                {value}
              </p>
              <p
                className="text-xs"
                style={{ color: "var(--color-ink-tertiary)" }}
              >
                {label}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Recent positions */}
      {positions.length > 0 && (
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
              Recent Positions
            </h2>
          </div>
          <ul>
            {positions.map((pos, index) => (
              <li
                key={pos.id}
                className="px-4 py-3 transition-colors duration-150 hover:bg-[var(--color-bg-hover)]"
                style={{
                  borderBottom:
                    index < positions.length - 1
                      ? "1px solid var(--color-border)"
                      : undefined,
                }}
              >
                <Link href={`/market/${pos.market_id}`} className="flex items-start gap-3">
                  {/* Side indicator */}
                  <span
                    className="text-xs font-bold px-2 py-1 rounded-lg flex-shrink-0 mt-0.5"
                    style={{
                      backgroundColor:
                        pos.side === "yes"
                          ? "var(--color-yes-bg)"
                          : "var(--color-no-bg)",
                      color:
                        pos.side === "yes"
                          ? "var(--color-yes)"
                          : "var(--color-no)",
                    }}
                  >
                    {pos.side.toUpperCase()}
                  </span>

                  <div className="flex-1 min-w-0">
                    {pos.markets && (
                      <>
                        <p
                          className="text-sm font-medium truncate"
                          style={{ color: "var(--color-ink-primary)" }}
                        >
                          {pos.markets.title}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <CategoryBadge category={pos.markets.category as never} />
                          <span
                            className="text-xs"
                            style={{ color: "var(--color-ink-tertiary)" }}
                          >
                            {formatProbability(pos.markets.yes_probability)} YES
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Payout or status */}
                  <div className="text-right flex-shrink-0">
                    {pos.status === "won" && pos.payout !== null && (
                      <p
                        className="text-sm font-bold"
                        style={{ color: "var(--color-yes)" }}
                      >
                        +{formatCoins(pos.payout)}
                      </p>
                    )}
                    {pos.status === "lost" && (
                      <p
                        className="text-sm font-medium"
                        style={{ color: "var(--color-no)" }}
                      >
                        Lost
                      </p>
                    )}
                    {pos.status === "open" && (
                      <p
                        className="text-xs"
                        style={{ color: "var(--color-ink-tertiary)" }}
                      >
                        Open
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Leagues */}
      {leagues.length > 0 && (
        <div
          className="rounded-xl p-4"
          style={{
            backgroundColor: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <h2
            className="font-semibold text-sm mb-3"
            style={{ color: "var(--color-ink-primary)" }}
          >
            Leagues
          </h2>
          <div className="flex flex-wrap gap-2">
            {leagues.map(({ leagues: league, role }) =>
              league ? (
                <Link
                  key={league.id}
                  href={`/leagues/${league.id}`}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors duration-150 hover:opacity-80"
                  style={{
                    backgroundColor: "var(--color-primary-light)",
                    color: "var(--color-primary)",
                  }}
                >
                  {league.name}
                  {role === "owner" && " 👑"}
                </Link>
              ) : null
            )}
          </div>
        </div>
      )}

      {/* Activity */}
      {activity.length > 0 && (
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
              Activity
            </h2>
          </div>
          <ActivityFeed entries={activity} />
        </div>
      )}
    </div>
  );
}
