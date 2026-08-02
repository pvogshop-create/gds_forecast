import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { Avatar } from "@/components/ui/Avatar";
import { CopyInviteCode } from "@/components/ui/CopyInviteCode";
import { LeagueChat } from "./LeagueChat";
import { formatCoins, formatDisplayName } from "@/lib/utils";
import type {
  League,
  LeagueMember,
  LeagueWeek,
  LeagueMessageWithProfile,
  Profile,
} from "@/types/database";

interface LeaguePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

type MemberWithProfile = LeagueMember & {
  profiles: Pick<Profile, "username" | "display_name" | "avatar_url">;
};

interface LiveScore {
  user_id: string;
  gross_payout: number;
}

const MEDALS = ["🥇", "🥈", "🥉"];

function daysRemaining(weekEnd: string): number {
  const diff = new Date(weekEnd).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
}

export default async function LeaguePage({
  params,
  searchParams,
}: LeaguePageProps) {
  const user = await requireAuth();
  const { id } = await params;
  const { tab } = await searchParams;
  const isWeeklyTab = tab !== "standings";
  const supabase = await createClient();

  const [leagueResult, membersResult, messagesResult, activeWeekResult] =
    await Promise.all([
      supabase.from("leagues").select("*").eq("id", id).single(),

      supabase
        .from("league_members")
        .select("*, profiles:user_id (username, display_name, avatar_url)")
        .eq("league_id", id),

      supabase
        .from("league_messages")
        .select("*, profiles:user_id (username, display_name, avatar_url)")
        .eq("league_id", id)
        .order("created_at", { ascending: true })
        .limit(50),

      supabase
        .from("league_weeks")
        .select("*")
        .eq("league_id", id)
        .eq("status", "active")
        .maybeSingle(),
    ]);

  if (!leagueResult.data) notFound();

  const league = leagueResult.data as League;
  const members = (membersResult.data ?? []) as MemberWithProfile[];
  const messages = (messagesResult.data ?? []) as LeagueMessageWithProfile[];
  const activeWeek = activeWeekResult.data as LeagueWeek | null;

  // Fetch live scores and user's tagged bet stats only if there is an active week
  let liveScores: LiveScore[] = [];
  let myTaggedCoins = 0;
  let myTaggedCount = 0;
  if (activeWeek) {
    const [scoresResult, myBetsResult] = await Promise.all([
      supabase.rpc("get_live_week_scores", { p_week_id: activeWeek.id }),
      supabase
        .from("league_bets")
        .select("positions!inner(coins_wagered)")
        .eq("week_id", activeWeek.id)
        .eq("user_id", user.id),
    ]);
    liveScores = (scoresResult.data ?? []) as LiveScore[];
    const myBets = (myBetsResult.data ?? []) as unknown as { positions: { coins_wagered: number } }[];
    myTaggedCount = myBets.length;
    myTaggedCoins = myBets.reduce((sum, b) => sum + (b.positions?.coins_wagered ?? 0), 0);
  }

  const isOwner = league.creator_id === user.id;

  // Build lookup map
  const memberByUser = Object.fromEntries(
    members.map((m) => [m.user_id, m])
  );

  // Weekly standings: members who are participants this week, sorted by payout desc
  const weeklyParticipants = liveScores
    .map((s) => ({
      ...s,
      member: memberByUser[s.user_id] as MemberWithProfile | undefined,
    }))
    .filter((r): r is typeof r & { member: MemberWithProfile } => r.member !== undefined)
    .sort((a, b) => b.gross_payout - a.gross_payout);

  // All-time standings: all members sorted by total_points asc (golf: lower = better)
  // Members with weeks_played > 0 first, unranked last
  const sortedAllTime = [...members].sort((a, b) => {
    if (a.weeks_played === 0 && b.weeks_played === 0) return 0;
    if (a.weeks_played === 0) return 1;
    if (b.weeks_played === 0) return -1;
    return a.total_points - b.total_points;
  });

  const tabHref = (t: string) => `/leagues/${id}?tab=${t}`;

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
            className="w-12 h-12 rounded-xl flex items-center justify-center text-white font-bold flex-shrink-0 text-lg"
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
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
              <span
                className="text-xs"
                style={{ color: "var(--color-ink-tertiary)" }}
              >
                {members.length} / {league.max_members} members
              </span>
              <span
                className="text-xs font-medium"
                style={{ color: "var(--color-coin)" }}
              >
                {league.buy_in_coins} coin buy-in / week
              </span>
              {activeWeek && (
                <span
                  className="text-xs"
                  style={{ color: "var(--color-ink-tertiary)" }}
                >
                  Week {activeWeek.week_number} · {daysRemaining(activeWeek.week_end)}d left
                </span>
              )}
            </div>
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
            data-testid="league-invite-code"
          >
            {league.invite_code}
          </span>
          <CopyInviteCode code={league.invite_code} />
        </div>
      </div>

      {/* Tab switcher */}
      <div
        className="flex rounded-xl p-1 gap-1"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
        role="tablist"
      >
        {[
          { label: "This Week", href: tabHref("weekly"), active: isWeeklyTab, id: "weekly" },
          { label: "All-Time Standings", href: tabHref("standings"), active: !isWeeklyTab, id: "standings" },
        ].map(({ label, href, active, id }) => (
          <a
            key={label}
            href={href}
            data-testid={`league-tab-${id}`}
            role="tab"
            aria-selected={active}
            className="flex-1 text-center py-2 px-3 rounded-lg text-sm font-medium transition-all duration-150"
            style={{
              backgroundColor: active ? "var(--color-primary)" : "transparent",
              color: active ? "white" : "var(--color-ink-secondary)",
            }}
          >
            {label}
          </a>
        ))}
      </div>

      {/* This Week panel */}
      {isWeeklyTab && (
        <div
          className="rounded-xl overflow-hidden"
          style={{
            backgroundColor: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          <div
            className="px-4 py-3 flex items-center justify-between"
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >
            <h2
              className="font-semibold text-sm"
              style={{ color: "var(--color-ink-primary)" }}
            >
              {activeWeek
                ? `Week ${activeWeek.week_number} — Live Scores`
                : "Weekly Standings"}
            </h2>
            {activeWeek && (
              <div className="flex items-center gap-2">
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: "var(--color-yes-bg)",
                    color: "var(--color-yes)",
                  }}
                >
                  <span data-testid="league-pool" data-pool={activeWeek.pool_coins}>Pool: {formatCoins(activeWeek.pool_coins)} coins</span>
                </span>
                <span
                  className="text-xs font-semibold px-2 py-0.5 rounded-full"
                  style={{
                    backgroundColor: "var(--color-primary-light)",
                    color: "var(--color-primary)",
                  }}
                >
                  You: {myTaggedCount} bet{myTaggedCount !== 1 ? "s" : ""} · {formatCoins(myTaggedCoins)} wagered
                </span>
              </div>
            )}
          </div>

          {!activeWeek ? (
            <div className="px-4 py-8 text-center">
              <p className="text-2xl mb-2">⏳</p>
              <p
                className="text-sm font-medium"
                style={{ color: "var(--color-ink-secondary)" }}
              >
                No active week yet
              </p>
              <p
                className="text-xs mt-1"
                style={{ color: "var(--color-ink-tertiary)" }}
              >
                {league.week_start_date
                  ? `First week starts ${new Date(league.week_start_date).toLocaleDateString()}`
                  : "The league manager hasn't set a start date."}
              </p>
            </div>
          ) : weeklyParticipants.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p className="text-2xl mb-2">📊</p>
              <p
                className="text-sm font-medium"
                style={{ color: "var(--color-ink-secondary)" }}
              >
                No bets tagged yet this week
              </p>
              <p
                className="text-xs mt-1"
                style={{ color: "var(--color-ink-tertiary)" }}
              >
                Tag your bets to this league to appear on the leaderboard.
              </p>
            </div>
          ) : (
            <ul>
              {weeklyParticipants.map((row, index) => {
                const p = row.member.profiles;
                const isCurrentUser = row.user_id === user.id;
                return (
                  <li
                    key={row.user_id}
                    data-testid="weekly-standings-row"
                    data-rank={index + 1}
                    data-user-id={row.user_id}
                    className="flex items-center gap-3 px-4 py-3"
                    style={{
                      borderBottom:
                        index < weeklyParticipants.length - 1
                          ? "1px solid var(--color-border)"
                          : undefined,
                      backgroundColor: isCurrentUser
                        ? "var(--color-primary-light)"
                        : undefined,
                    }}
                  >
                    <span className="w-6 text-sm text-center flex-shrink-0">
                      {index < 3 ? (
                        MEDALS[index]
                      ) : (
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
                        {formatDisplayName(p?.display_name, p?.username)}
                        {isCurrentUser && (
                          <span
                            className="text-xs font-normal ml-1"
                            style={{ color: "var(--color-primary)" }}
                          >
                            (you)
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
                        style={{
                          color:
                            row.gross_payout > 0
                              ? "var(--color-yes)"
                              : "var(--color-ink-tertiary)",
                        }}
                      >
                        {row.gross_payout > 0
                          ? `+${formatCoins(row.gross_payout)}`
                          : "—"}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: "var(--color-ink-tertiary)" }}
                      >
                        coins
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* All-Time Standings panel */}
      {!isWeeklyTab && (
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
              All-Time Standings
            </h2>
            <p
              className="text-xs mt-0.5"
              style={{ color: "var(--color-ink-tertiary)" }}
            >
              Golf scoring — lower points is better
            </p>
          </div>

          {sortedAllTime.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <p
                className="text-sm"
                style={{ color: "var(--color-ink-secondary)" }}
              >
                No standings yet.
              </p>
            </div>
          ) : (
            <ul>
              {sortedAllTime.map((member, index) => {
                const p = member.profiles;
                const isCurrentUser = member.user_id === user.id;
                const hasPlayed = member.weeks_played > 0;
                return (
                  <li
                    key={member.user_id}
                    data-testid="alltime-standings-row"
                    data-rank={index + 1}
                    data-user-id={member.user_id}
                    data-total-points={member.total_points}
                    className="flex items-center gap-3 px-4 py-3"
                    style={{
                      borderBottom:
                        index < sortedAllTime.length - 1
                          ? "1px solid var(--color-border)"
                          : undefined,
                      backgroundColor: isCurrentUser
                        ? "var(--color-primary-light)"
                        : undefined,
                    }}
                  >
                    <span className="w-6 text-sm text-center flex-shrink-0">
                      {hasPlayed && index < 3 ? (
                        MEDALS[index]
                      ) : (
                        <span style={{ color: "var(--color-ink-tertiary)" }}>
                          {hasPlayed ? index + 1 : "—"}
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
                        {formatDisplayName(p?.display_name, p?.username)}
                        {isCurrentUser && (
                          <span
                            className="text-xs font-normal ml-1"
                            style={{ color: "var(--color-primary)" }}
                          >
                            (you)
                          </span>
                        )}
                        {member.role === "owner" && (
                          <span className="ml-1 text-xs">👑</span>
                        )}
                      </p>
                      <p
                        className="text-xs"
                        style={{ color: "var(--color-ink-tertiary)" }}
                      >
                        {hasPlayed
                          ? `${member.weeks_played} week${member.weeks_played !== 1 ? "s" : ""} played`
                          : "Not yet participated"}
                      </p>
                    </div>

                    <div className="text-right flex-shrink-0">
                      {hasPlayed ? (
                        <>
                          <p
                            className="text-sm font-bold"
                            style={{ color: "var(--color-ink-primary)" }}
                          >
                            {member.total_points} pts
                          </p>
                          <p
                            className="text-xs"
                            style={{ color: "var(--color-ink-tertiary)" }}
                          >
                            points
                          </p>
                        </>
                      ) : (
                        <p
                          className="text-sm"
                          style={{ color: "var(--color-ink-tertiary)" }}
                        >
                          —
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {/* League chat */}
      <LeagueChat
        leagueId={league.id}
        currentUserId={user.id}
        initialMessages={messages}
      />

      {/* Pool info for owner */}
      {isOwner && league.carry_over_pool > 0 && (
        <div
          className="rounded-xl p-4"
          style={{
            backgroundColor: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
          }}
        >
          <p
            className="text-xs font-semibold uppercase tracking-wide mb-1"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            Carried-Over Pool
          </p>
          <p
            className="text-sm"
            style={{ color: "var(--color-coin)" }}
          >
            {formatCoins(league.carry_over_pool)} coins waiting for next week&apos;s winner
          </p>
        </div>
      )}

    </div>
  );
}
