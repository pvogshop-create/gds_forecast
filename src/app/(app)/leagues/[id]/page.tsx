import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { Avatar } from "@/components/ui/Avatar";
import { ActivityFeed } from "@/components/feed/ActivityFeed";
import { CopyInviteCode } from "./CopyInviteCode";
import { formatCoins } from "@/lib/utils";
import type {
  League,
  LeagueMember,
  Profile,
  ActivityFeedEntryWithProfile,
} from "@/types/database";

interface LeaguePageProps {
  params: Promise<{ id: string }>;
}

type MemberWithProfile = LeagueMember & {
  profiles: Pick<Profile, "username" | "display_name" | "avatar_url" | "coins" | "total_bets" | "wins">;
};

const MEDALS = ["🥇", "🥈", "🥉"];

export default async function LeaguePage({ params }: LeaguePageProps) {
  const user = await requireAuth();
  const { id } = await params;
  const supabase = await createClient();

  const [leagueResult, membersResult, activityResult] = await Promise.all([
    supabase.from("leagues").select("*").eq("id", id).single(),

    supabase
      .from("league_members")
      .select("*, profiles:user_id (username, display_name, avatar_url, coins, total_bets, wins)")
      .eq("league_id", id),

    supabase
      .from("activity_feed")
      .select(
        "*, profiles:user_id (username, display_name, avatar_url), markets:market_id (title, category, yes_probability)"
      )
      .in(
        "user_id",
        (
          await supabase
            .from("league_members")
            .select("user_id")
            .eq("league_id", id)
        ).data?.map((m: { user_id: string }) => m.user_id) ?? []
      )
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  if (!leagueResult.data) notFound();

  const league = leagueResult.data as League;
  const members = (membersResult.data ?? []) as MemberWithProfile[];
  const activity = (activityResult.data ?? []) as ActivityFeedEntryWithProfile[];

  // Sort members by coins descending
  const sortedMembers = [...members].sort(
    (a, b) => (b.profiles?.coins ?? 0) - (a.profiles?.coins ?? 0)
  );

  const isOwner = league.creator_id === user.id;

  return (
    <div className="space-y-4">
      {/* League header */}
      <div
        className="rounded-xl p-5"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <div className="flex items-start gap-4">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0"
            style={{ backgroundColor: "var(--color-primary)" }}
          >
            {league.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <h1
              className="text-lg font-bold"
              style={{ color: "var(--color-ink-primary)" }}
            >
              {league.name}
            </h1>
            {league.description && (
              <p
                className="text-sm mt-0.5"
                style={{ color: "var(--color-ink-secondary)" }}
              >
                {league.description}
              </p>
            )}
            <p
              className="text-xs mt-1"
              style={{ color: "var(--color-ink-tertiary)" }}
            >
              {members.length} / {league.max_members} members
            </p>
          </div>
        </div>

        {/* Invite code */}
        <div
          className="mt-4 flex items-center gap-3 px-3 py-2.5 rounded-xl"
          style={{ backgroundColor: "var(--color-bg)" }}
        >
          <span
            className="text-xs"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            Invite code:
          </span>
          <span
            className="font-mono font-bold text-sm tracking-widest flex-1"
            style={{ color: "var(--color-ink-primary)" }}
          >
            {league.invite_code}
          </span>
          <CopyInviteCode code={league.invite_code} />
        </div>
      </div>

      {/* Standings */}
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
            Standings
          </h2>
        </div>
        <ul>
          {sortedMembers.map((member, index) => {
            const p = member.profiles;
            const isCurrentUser = member.user_id === user.id;
            return (
              <li
                key={member.user_id}
                className="flex items-center gap-3 px-4 py-3 transition-colors duration-150"
                style={{
                  borderBottom:
                    index < sortedMembers.length - 1
                      ? "1px solid var(--color-border)"
                      : undefined,
                  backgroundColor: isCurrentUser
                    ? "var(--color-primary-light)"
                    : undefined,
                }}
              >
                {/* Rank */}
                <span className="w-6 text-sm text-center flex-shrink-0">
                  {index < 3 ? MEDALS[index] : (
                    <span style={{ color: "var(--color-ink-tertiary)" }}>
                      {index + 1}
                    </span>
                  )}
                </span>

                <Avatar
                  src={p?.avatar_url}
                  displayName={p?.display_name}
                  username={p?.username}
                  size="sm"
                />

                <div className="flex-1 min-w-0">
                  <p
                    className="text-sm font-medium truncate"
                    style={{ color: "var(--color-ink-primary)" }}
                  >
                    {p?.display_name ?? p?.username}{" "}
                    {isCurrentUser && (
                      <span
                        className="text-xs font-normal"
                        style={{ color: "var(--color-primary)" }}
                      >
                        (you)
                      </span>
                    )}
                    {member.role === "owner" && (
                      <span
                        className="text-xs font-normal ml-1"
                        style={{ color: "var(--color-coin)" }}
                      >
                        👑
                      </span>
                    )}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: "var(--color-ink-tertiary)" }}
                  >
                    @{p?.username}
                  </p>
                </div>

                <div className="text-right flex-shrink-0">
                  <p
                    className="text-sm font-bold"
                    style={{ color: "var(--color-ink-primary)" }}
                  >
                    {formatCoins(p?.coins ?? 0)}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: "var(--color-coin)" }}
                  >
                    coins
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {/* League activity */}
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
              League Activity
            </h2>
          </div>
          <ActivityFeed entries={activity} />
        </div>
      )}

      {/* Owner actions */}
      {isOwner && (
        <div
          className="rounded-xl p-4"
          style={{
            backgroundColor: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
          }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-wide mb-2"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            Owner Settings
          </p>
          <p
            className="text-xs"
            style={{ color: "var(--color-ink-secondary)" }}
          >
            Share the invite code above to grow your league. Members can leave at any time.
          </p>
        </div>
      )}
    </div>
  );
}
