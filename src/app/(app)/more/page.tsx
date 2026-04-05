import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import Link from "next/link";
import { ActivityFeed } from "@/components/feed/ActivityFeed";
import { Leaderboard } from "@/components/feed/Leaderboard";
import { SuggestForm } from "@/app/(app)/suggest/SuggestForm";
import { LeagueCard } from "@/components/leagues/LeagueCard";
import { CreateLeagueButton } from "@/app/(app)/leagues/CreateLeagueButton";
import { JoinLeagueButton } from "@/app/(app)/leagues/JoinLeagueButton";
import { CategoryBadge, StatusBadge } from "@/components/ui/Badge";
import { markAllNotificationsRead } from "@/app/(app)/notifications/actions";
import { formatRelativeTime, formatCoins } from "@/lib/utils";
import { probToAmericanOdds, formatAmericanOdds } from "@/lib/market-logic";
import { EarnCoinsCard } from "./EarnCoinsCard";
import { IncidentVoteButtons } from "./IncidentVoteButtons";
import { SubmitReportForm } from "./SubmitReportForm";
import type {
  Notification,
  ActivityFeedEntryWithProfile,
  Profile,
  MarketSuggestion,
  League,
  LeagueMember,
  PositionWithMarket,
  IncidentReportWithMarket,
  Market,
} from "@/types/database";

type TabId = "bets" | "notifications" | "suggest" | "leagues" | "reports";

export default async function MorePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
  const tab: TabId =
    rawTab === "notifications" ||
    rawTab === "suggest" ||
    rawTab === "leagues" ||
    rawTab === "reports"
      ? rawTab
      : "bets";

  const user = await requireAuth();
  const supabase = await createClient();

  // ── My Bets tab ────────────────────────────────────────────────────────────
  let positions: PositionWithMarket[] = [];
  let profileData: Pick<
    Profile,
    "last_daily_claim" | "referral_code" | "referral_count"
  > | null = null;

  if (tab === "bets") {
    const [posResult, profResult] = await Promise.all([
      supabase
        .from("positions")
        .select(
          `*, markets (id, title, category, status, market_type, yes_probability, ou_line, ou_unit, resolution_date)`
        )
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("profiles")
        .select("last_daily_claim, referral_code, referral_count")
        .eq("id", user.id)
        .single(),
    ]);
    positions = (posResult.data ?? []) as PositionWithMarket[];
    profileData = profResult.data as unknown as Pick<Profile, "last_daily_claim" | "referral_code" | "referral_count"> | null;
  }

  // ── Notifications tab ──────────────────────────────────────────────────────
  let notifications: Notification[] = [];
  let feedEntries: ActivityFeedEntryWithProfile[] = [];
  let leaderboard: Pick<
    Profile,
    "id" | "username" | "display_name" | "avatar_url" | "coins" | "wins" | "total_bets"
  >[] = [];

  if (tab === "notifications") {
    const [notifResult, feedResult, leaderboardResult] = await Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("activity_feed")
        .select(
          `*, profiles:user_id (username, display_name, avatar_url), markets:market_id (title, category, yes_probability)`
        )
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("profiles")
        .select("id, username, display_name, avatar_url, coins, wins, total_bets")
        .not("username", "is", null)
        .order("coins", { ascending: false })
        .limit(10),
    ]);
    notifications = (notifResult.data ?? []) as Notification[];
    feedEntries = (feedResult.data ?? []) as ActivityFeedEntryWithProfile[];
    leaderboard = (leaderboardResult.data ?? []) as typeof leaderboard;
  }

  // ── Suggest tab ────────────────────────────────────────────────────────────
  let suggestions: MarketSuggestion[] = [];

  if (tab === "suggest") {
    const { data } = await supabase
      .from("market_suggestions")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    suggestions = (data ?? []) as MarketSuggestion[];
  }

  // ── Leagues tab ────────────────────────────────────────────────────────────
  let leagues: League[] = [];
  let memberCounts: Record<string, number> = {};

  if (tab === "leagues") {
    const { data: memberships } = await supabase
      .from("league_members")
      .select("league_id, role")
      .eq("user_id", user.id);

    const leagueIds = (memberships ?? []).map(
      (m: Pick<LeagueMember, "league_id" | "role">) => m.league_id
    );

    const [leaguesResult, memberCountsResult] = await Promise.all([
      leagueIds.length > 0
        ? supabase.from("leagues").select("*").in("id", leagueIds)
        : Promise.resolve({ data: [] }),
      leagueIds.length > 0
        ? supabase
            .from("league_members")
            .select("league_id")
            .in("league_id", leagueIds)
        : Promise.resolve({ data: [] }),
    ]);

    leagues = (leaguesResult.data ?? []) as League[];
    for (const row of memberCountsResult.data ?? []) {
      const r = row as { league_id: string };
      memberCounts[r.league_id] = (memberCounts[r.league_id] ?? 0) + 1;
    }
  }

  // ── Reports tab ────────────────────────────────────────────────────────────
  let incidentReports: IncidentReportWithMarket[] = [];
  let reportableMarkets: Pick<Market, "id" | "title" | "market_type" | "ou_unit">[] = [];

  if (tab === "reports") {
    const [reportsResult, marketsResult] = await Promise.all([
      supabase
        .from("incident_reports")
        .select(
          `*, markets (id, title, category, status, market_type), incident_votes (user_id, agrees)`
        )
        .in("status", ["voting", "passed"])
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("markets")
        .select("id, title, market_type, ou_unit")
        .in("status", ["open", "closed"])
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    incidentReports = (reportsResult.data ?? []) as IncidentReportWithMarket[];
    reportableMarkets = (marketsResult.data ?? []) as Pick<Market, "id" | "title" | "market_type" | "ou_unit">[];
  }

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  // ── Bets: group by status ──────────────────────────────────────────────────
  const openBets = positions.filter((p) => p.status === "open");
  const wonBets = positions.filter((p) => p.status === "won");
  const closedBets = positions.filter(
    (p) => p.status === "lost" || p.status === "cancelled"
  );

  const totalWagered = positions.reduce((sum, p) => sum + p.coins_wagered, 0);
  const totalWins = positions.filter((p) => p.status === "won").length;
  const resolvedBets = positions.filter(
    (p) => p.status === "won" || p.status === "lost"
  ).length;

  return (
    <div className="space-y-4">
      {/* Tab bar — mobile only; desktop uses sidebar links */}
      <nav
        className="flex gap-1 rounded-xl p-1 overflow-x-auto lg:hidden"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
        aria-label="More sections"
      >
        {(
          [
            { id: "bets" as TabId, label: "My Bets", badge: null },
            {
              id: "notifications" as TabId,
              label: "Alerts",
              badge: tab === "notifications" && unreadCount > 0 ? unreadCount : null,
            },
            { id: "suggest" as TabId, label: "Suggest", badge: null },
            { id: "leagues" as TabId, label: "Leagues", badge: null },
            { id: "reports" as TabId, label: "Reports", badge: null },
          ] as const
        ).map(({ id, label, badge }) => {
          const isActive = tab === id;
          return (
            <Link
              key={id}
              href={`/more?tab=${id}`}
              className="flex items-center gap-1.5 px-2 py-2 rounded-lg text-xs font-medium transition-all duration-150 flex-1 justify-center whitespace-nowrap"
              style={{
                backgroundColor: isActive ? "var(--color-bg)" : "transparent",
                color: isActive
                  ? "var(--color-ink-primary)"
                  : "var(--color-ink-secondary)",
                boxShadow: isActive ? "var(--shadow-card)" : "none",
              }}
              aria-current={isActive ? "page" : undefined}
            >
              {label}
              {badge !== null && (
                <span
                  className="px-1.5 py-0.5 rounded-full text-[10px] font-bold leading-none"
                  style={{
                    backgroundColor: "var(--color-danger)",
                    color: "white",
                  }}
                >
                  {badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* ── My Bets ───────────────────────────────────────────────────────── */}
      {tab === "bets" && (
        <div className="space-y-4">
          {/* Earn Coins card */}
          <EarnCoinsCard
            lastDailyClaim={profileData?.last_daily_claim ?? null}
            referralCode={profileData?.referral_code ?? null}
            referralCount={profileData?.referral_count ?? 0}
          />

          {/* Stats strip */}
          {positions.length > 0 && (
            <div
              className="rounded-xl p-4 flex items-center justify-around"
              style={{
                backgroundColor: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
                boxShadow: "var(--shadow-card)",
              }}
            >
              <div className="text-center">
                <p
                  className="text-lg font-bold"
                  style={{ color: "var(--color-coin)" }}
                >
                  {formatCoins(totalWagered)}
                </p>
                <p
                  className="text-xs"
                  style={{ color: "var(--color-ink-tertiary)" }}
                >
                  coins wagered
                </p>
              </div>
              <div
                className="w-px h-8 self-center"
                style={{ backgroundColor: "var(--color-border)" }}
              />
              <div className="text-center">
                <p
                  className="text-lg font-bold"
                  style={{ color: "var(--color-ink-primary)" }}
                >
                  {resolvedBets > 0
                    ? `${totalWins}/${resolvedBets}`
                    : `${positions.length}`}
                </p>
                <p
                  className="text-xs"
                  style={{ color: "var(--color-ink-tertiary)" }}
                >
                  {resolvedBets > 0 ? "W/L record" : "total bets"}
                </p>
              </div>
              <div
                className="w-px h-8 self-center"
                style={{ backgroundColor: "var(--color-border)" }}
              />
              <div className="text-center">
                <p
                  className="text-lg font-bold"
                  style={{ color: "var(--color-yes)" }}
                >
                  {openBets.length}
                </p>
                <p
                  className="text-xs"
                  style={{ color: "var(--color-ink-tertiary)" }}
                >
                  open bets
                </p>
              </div>
            </div>
          )}

          {positions.length === 0 ? (
            <div
              className="rounded-xl p-10 text-center"
              style={{
                backgroundColor: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div className="text-4xl mb-3">📊</div>
              <p
                className="font-medium text-sm mb-2"
                style={{ color: "var(--color-ink-primary)" }}
              >
                No bets yet.
              </p>
              <Link
                href="/dashboard/trending"
                className="text-xs font-medium transition-colors duration-150 hover:underline"
                style={{ color: "var(--color-primary)" }}
              >
                Find a market to get started →
              </Link>
            </div>
          ) : (
            <div className="space-y-4">
              {openBets.length > 0 && (
                <BetsSection title="Open" bets={openBets} />
              )}
              {wonBets.length > 0 && (
                <BetsSection title="Won" bets={wonBets} />
              )}
              {closedBets.length > 0 && (
                <BetsSection title="Lost / Cancelled" bets={closedBets} />
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Notifications ─────────────────────────────────────────────────── */}
      {tab === "notifications" && (
        <div className="space-y-4">
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
              <div className="flex items-center gap-2">
                <h2
                  className="font-semibold text-sm"
                  style={{ color: "var(--color-ink-primary)" }}
                >
                  Your Notifications
                </h2>
                {unreadCount > 0 && (
                  <span
                    className="min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                    style={{ backgroundColor: "var(--color-danger)" }}
                  >
                    {unreadCount}
                  </span>
                )}
              </div>
              {unreadCount > 0 && (
                <form action={markAllNotificationsRead}>
                  <button
                    type="submit"
                    className="text-xs transition-colors duration-150"
                    style={{ color: "var(--color-primary)" }}
                  >
                    Mark all as read
                  </button>
                </form>
              )}
            </div>

            {notifications.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <p className="text-2xl mb-2">🔔</p>
                <p
                  className="text-sm"
                  style={{ color: "var(--color-ink-secondary)" }}
                >
                  No notifications yet.
                </p>
              </div>
            ) : (
              <ul>
                {notifications.map((notif, index) => (
                  <li
                    key={notif.id}
                    className="px-4 py-3 transition-colors duration-150"
                    style={{
                      backgroundColor: notif.is_read
                        ? undefined
                        : "var(--color-primary-light)",
                      borderBottom:
                        index < notifications.length - 1
                          ? "1px solid var(--color-border)"
                          : undefined,
                    }}
                  >
                    <p
                      className="text-sm font-semibold"
                      style={{ color: "var(--color-ink-primary)" }}
                    >
                      {notif.title}
                    </p>
                    <p
                      className="text-xs mt-0.5"
                      style={{ color: "var(--color-ink-secondary)" }}
                    >
                      {notif.body}
                    </p>
                    <time
                      className="text-xs mt-1 block"
                      style={{ color: "var(--color-ink-tertiary)" }}
                      dateTime={notif.created_at}
                    >
                      {formatRelativeTime(notif.created_at)}
                    </time>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Leaderboard users={leaderboard} />

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
      )}

      {/* ── Suggest ───────────────────────────────────────────────────────── */}
      {tab === "suggest" && (
        <div className="space-y-6">
          <div>
            <h1
              className="text-xl font-bold"
              style={{ color: "var(--color-ink-primary)" }}
            >
              Suggest a Market
            </h1>
            <p
              className="text-sm mt-1"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Have a prediction idea? Submit it and an admin will review it.
            </p>
          </div>

          <SuggestForm userId={user.id} />

          {suggestions.length > 0 && (
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
                  Your Suggestions
                </h2>
              </div>
              <ul>
                {suggestions.map((s, index) => (
                  <li
                    key={s.id}
                    className="px-4 py-3"
                    style={{
                      borderBottom:
                        index < suggestions.length - 1
                          ? "1px solid var(--color-border)"
                          : undefined,
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <p
                          className="text-sm font-medium"
                          style={{ color: "var(--color-ink-primary)" }}
                        >
                          {s.title}
                        </p>
                        <p
                          className="text-xs mt-0.5 line-clamp-2"
                          style={{ color: "var(--color-ink-tertiary)" }}
                        >
                          {s.description}
                        </p>
                        {s.admin_note && (
                          <p
                            className="text-xs mt-1 italic"
                            style={{ color: "var(--color-ink-secondary)" }}
                          >
                            Admin note: {s.admin_note}
                          </p>
                        )}
                        <time
                          className="text-xs"
                          style={{ color: "var(--color-ink-tertiary)" }}
                        >
                          {formatRelativeTime(s.created_at)}
                        </time>
                      </div>
                      <StatusBadge status={s.status} className="flex-shrink-0" />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Leagues ───────────────────────────────────────────────────────── */}
      {tab === "leagues" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h1
              className="text-xl font-bold"
              style={{ color: "var(--color-ink-primary)" }}
            >
              Leagues
            </h1>
            <div className="flex gap-2">
              <JoinLeagueButton />
              <CreateLeagueButton userId={user.id} />
            </div>
          </div>

          {leagues.length === 0 ? (
            <div
              className="rounded-xl p-8 text-center"
              style={{
                backgroundColor: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div className="text-4xl mb-3">🏆</div>
              <p
                className="font-medium text-sm mb-2"
                style={{ color: "var(--color-ink-primary)" }}
              >
                You haven&apos;t joined any leagues yet.
              </p>
              <p
                className="text-xs"
                style={{ color: "var(--color-ink-tertiary)" }}
              >
                Create a league or join one with an invite code.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {leagues.map((league) => (
                <LeagueCard
                  key={league.id}
                  league={league}
                  memberCount={memberCounts[league.id] ?? 0}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Reports ───────────────────────────────────────────────────────── */}
      {tab === "reports" && (
        <div className="space-y-4">
          <div>
            <h1
              className="text-xl font-bold"
              style={{ color: "var(--color-ink-primary)" }}
            >
              Incident Reports
            </h1>
            <p
              className="text-sm mt-1"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Vote on whether these events actually happened. 4+ votes at 60%
              agreement triggers auto-resolution.
            </p>
          </div>

          {/* Submit report form */}
          <SubmitReportForm markets={reportableMarkets} />

          {incidentReports.length === 0 ? (
            <div
              className="rounded-xl p-10 text-center"
              style={{
                backgroundColor: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div className="text-4xl mb-3">🔍</div>
              <p
                className="font-medium text-sm"
                style={{ color: "var(--color-ink-primary)" }}
              >
                No active incident reports.
              </p>
              <p
                className="text-xs mt-1"
                style={{ color: "var(--color-ink-tertiary)" }}
              >
                Use the form above to report that an outcome has occurred.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {incidentReports.map((report) => {
                const myVote = report.incident_votes.find(
                  (v) => v.user_id === user.id
                );
                const total = report.yes_votes + report.no_votes;
                const agreeRate =
                  total > 0 ? Math.round((report.yes_votes / total) * 100) : 0;
                const isPassed = report.status === "passed";
                const isVoting = report.status === "voting";

                // Time until auto-resolve (when passed)
                let vetoCountdown: string | null = null;
                if (isPassed && report.veto_deadline) {
                  const ms =
                    new Date(report.veto_deadline).getTime() - Date.now();
                  if (ms > 0) {
                    const h = Math.floor(ms / (1000 * 60 * 60));
                    const m = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
                    vetoCountdown = h > 0 ? `${h}h ${m}m` : `${m}m`;
                  } else {
                    vetoCountdown = "resolving soon";
                  }
                }

                return (
                  <div
                    key={report.id}
                    className="rounded-xl overflow-hidden"
                    style={{
                      backgroundColor: "var(--color-bg-card)",
                      border: `1px solid ${isPassed ? "var(--color-yes)" : "var(--color-border)"}`,
                      boxShadow: "var(--shadow-card)",
                    }}
                  >
                    <div className="px-4 py-3">
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <Link
                          href={`/market/${report.markets.id}`}
                          className="text-sm font-medium leading-snug hover:underline flex-1 min-w-0"
                          style={{
                            color: "var(--color-ink-primary)",
                            textDecorationColor: "var(--color-primary)",
                          }}
                        >
                          {report.markets.title}
                        </Link>
                        <span
                          className="flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold"
                          style={{
                            backgroundColor: isPassed
                              ? "var(--color-yes-bg)"
                              : "var(--color-primary-light)",
                            color: isPassed
                              ? "var(--color-yes)"
                              : "var(--color-primary)",
                          }}
                        >
                          {isPassed ? "PASSED" : "VOTING"}
                        </span>
                      </div>

                      {/* Description */}
                      <p
                        className="text-xs mb-2 line-clamp-2"
                        style={{ color: "var(--color-ink-secondary)" }}
                      >
                        {report.description}
                      </p>

                      {/* Proposed outcome */}
                      <p
                        className="text-xs mb-3"
                        style={{ color: "var(--color-ink-tertiary)" }}
                      >
                        Proposed outcome:{" "}
                        <span
                          className="font-semibold"
                          style={{ color: "var(--color-ink-primary)" }}
                        >
                          {report.proposed_outcome.toUpperCase()}
                        </span>
                      </p>

                      {/* Vote bar */}
                      <div className="mb-3">
                        <div
                          className="h-1.5 rounded-full overflow-hidden"
                          style={{ backgroundColor: "var(--color-border)" }}
                        >
                          {total > 0 && (
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${agreeRate}%`,
                                backgroundColor:
                                  agreeRate >= 60
                                    ? "var(--color-yes)"
                                    : "var(--color-no)",
                              }}
                            />
                          )}
                        </div>
                        <p
                          className="text-xs mt-1"
                          style={{ color: "var(--color-ink-tertiary)" }}
                        >
                          {total === 0
                            ? "No votes yet"
                            : `${report.yes_votes} agree · ${report.no_votes} disagree · ${agreeRate}%`}
                        </p>
                      </div>

                      {/* Footer row */}
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <IncidentVoteButtons
                          reportId={report.id}
                          userVote={myVote ? myVote.agrees : null}
                          isReporter={report.reporter_id === user.id}
                          isOpen={isVoting}
                        />
                        {isPassed && vetoCountdown && (
                          <span
                            className="text-xs"
                            style={{ color: "var(--color-yes)" }}
                          >
                            Auto-resolves in {vetoCountdown}
                          </span>
                        )}
                        <CategoryBadge
                          category={report.markets.category}
                          className="flex-shrink-0"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── BetsSection helper ───────────────────────────────────────────────────────

function BetsSection({
  title,
  bets,
}: {
  title: string;
  bets: PositionWithMarket[];
}) {
  return (
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
          {title}
        </h2>
      </div>
      <ul>
        {bets.map((pos, index) => {
          const market = pos.markets;
          const isOU = market.market_type === "over_under";
          const side = pos.side;
          const sideLabel = isOU
            ? side === "yes"
              ? "OVER"
              : "UNDER"
            : side.toUpperCase();

          // Locked price info
          let lockedInfo: string;
          if (isOU) {
            lockedInfo = `Line: ${pos.ou_line_at_bet ?? "—"} ${market.ou_unit ?? ""}`.trim();
          } else {
            const oddsNum =
              side === "yes"
                ? pos.yes_odds_at_bet
                : probToAmericanOdds(1 - pos.price_at_bet);
            lockedInfo = formatAmericanOdds(oddsNum);
          }

          // Payout display
          let payoutEl: React.ReactNode;
          if (pos.status === "won" && pos.payout != null) {
            payoutEl = (
              <span
                className="text-xs font-semibold"
                style={{ color: "var(--color-yes)" }}
              >
                +{formatCoins(pos.payout)} coins
              </span>
            );
          } else if (pos.status === "lost") {
            payoutEl = (
              <span
                className="text-xs font-medium"
                style={{ color: "var(--color-no)" }}
              >
                Lost
              </span>
            );
          } else if (pos.status === "cancelled") {
            payoutEl = (
              <span
                className="text-xs"
                style={{ color: "var(--color-ink-tertiary)" }}
              >
                Cancelled
              </span>
            );
          } else {
            payoutEl = (
              <span
                className="text-xs"
                style={{ color: "var(--color-ink-tertiary)" }}
              >
                pending
              </span>
            );
          }

          return (
            <li
              key={pos.id}
              className="px-4 py-3"
              style={{
                borderBottom:
                  index < bets.length - 1
                    ? "1px solid var(--color-border)"
                    : undefined,
              }}
            >
              <div className="flex items-start gap-3">
                {/* Side badge */}
                <span
                  className="flex-shrink-0 mt-0.5 px-2 py-0.5 rounded-full text-xs font-bold"
                  style={{
                    backgroundColor:
                      side === "yes"
                        ? "var(--color-yes-bg)"
                        : "var(--color-no-bg)",
                    color:
                      side === "yes"
                        ? "var(--color-yes)"
                        : "var(--color-no)",
                  }}
                >
                  {sideLabel}
                </span>

                {/* Main content */}
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/market/${market.id}`}
                    className="text-sm font-medium leading-snug hover:underline"
                    style={{
                      color: "var(--color-ink-primary)",
                      textDecorationColor: "var(--color-primary)",
                    }}
                  >
                    {market.title}
                  </Link>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <CategoryBadge category={market.category} />
                    <span
                      className="text-xs"
                      style={{ color: "var(--color-ink-tertiary)" }}
                    >
                      {formatCoins(pos.coins_wagered)} coins · {lockedInfo}
                    </span>
                  </div>
                </div>

                {/* Payout / status */}
                <div className="flex-shrink-0 text-right">{payoutEl}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
