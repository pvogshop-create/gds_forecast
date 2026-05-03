import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { CategoryBadge, StatusBadge } from "@/components/ui/Badge";
import { BettingPanel } from "@/components/markets/BettingPanel";
import { ProbabilityChart } from "@/components/markets/ProbabilityChart";
import { ActivityFeed } from "@/components/feed/ActivityFeed";
import { MarketComments } from "@/components/markets/MarketComments";
import { ToastContainer } from "@/components/ui/Toast";
import { ReportOutcomeForm } from "./ReportOutcomeForm";
import { IncidentVoteButtons } from "@/app/(app)/more/IncidentVoteButtons";
import {
  formatProbability,
  formatCoins,
  formatTimeRemaining,
} from "@/lib/utils";
import type {
  Market,
  Position,
  MarketProbabilityHistory,
  ActivityFeedEntryWithProfile,
  MarketCommentWithProfile,
  Profile,
  IncidentReport,
  IncidentVote,
} from "@/types/database";

interface ActiveLeagueWeek {
  league_id: string;
  league_name: string;
  week_number: number;
  week_id: string;
}

interface MarketPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ side?: string }>;
}

export default async function MarketPage({
  params,
  searchParams,
}: MarketPageProps) {
  const user = await requireAuth();
  const { id } = await params;
  const { side: initialSide } = await searchParams;
  const supabase = await createClient();

  const [marketResult, historyResult, positionResult, activityResult, profileResult, betCountResult, incidentResult, leagueWeeksResult, commentsResult] =
    await Promise.all([
      supabase.from("markets").select("*").eq("id", id).single(),

      supabase
        .from("market_probability_history")
        .select("*")
        .eq("market_id", id)
        .order("recorded_at", { ascending: true })
        .limit(100),

      supabase
        .from("positions")
        .select("*")
        .eq("market_id", id)
        .eq("user_id", user.id)
        .maybeSingle(),

      supabase
        .from("activity_feed")
        .select(
          `*, profiles:user_id (username, display_name, avatar_url), markets:market_id (title, category, yes_probability)`
        )
        .eq("market_id", id)
        .order("created_at", { ascending: false })
        .limit(20),

      supabase
        .from("profiles")
        .select("coins, username")
        .eq("id", user.id)
        .single(),

      // Count total bets on this market for calibration period enforcement
      supabase
        .from("positions")
        .select("*", { count: "exact", head: true })
        .eq("market_id", id),

      // Active incident report for this market
      supabase
        .from("incident_reports")
        .select("*, incident_votes (user_id, agrees)")
        .eq("market_id", id)
        .in("status", ["voting", "passed"])
        .maybeSingle(),

      // Active league weeks the user is participating in (for bet tagging)
      supabase
        .from("league_week_participants")
        .select("week_id, league_id, league_weeks!inner(week_number, status), leagues!inner(name)")
        .eq("user_id", user.id)
        .eq("league_weeks.status", "active"),

      // Market comments (most recent 50, ascending so oldest shows first)
      supabase
        .from("market_comments")
        .select("id, market_id, user_id, body, created_at, profiles(username, display_name, avatar_url)")
        .eq("market_id", id)
        .order("created_at", { ascending: true })
        .limit(50),
    ]);

  if (!marketResult.data) notFound();

  const market = marketResult.data as Market;
  const history = (historyResult.data ?? []) as MarketProbabilityHistory[];
  const userPosition = positionResult.data as Position | null;
  const activity = (activityResult.data ?? []) as ActivityFeedEntryWithProfile[];
  const profile = profileResult.data as Pick<Profile, "coins" | "username"> | null;
  const marketBetCount = betCountResult.count ?? 0;
  const comments = (commentsResult.data ?? []) as unknown as MarketCommentWithProfile[];

  // Fetch the suggester's profile if this market was user-submitted
  const suggesterResult = market.suggested_by
    ? await supabase
        .from("profiles")
        .select("username, display_name")
        .eq("id", market.suggested_by)
        .single()
    : { data: null };
  const suggester = suggesterResult.data as Pick<Profile, "username" | "display_name"> | null;

  type IncidentReportWithVotes = IncidentReport & {
    incident_votes: Pick<IncidentVote, "user_id" | "agrees">[];
  };
  const activeIncident = incidentResult.data as IncidentReportWithVotes | null;

  // Supabase returns joined relations as arrays; take first element of each.
  const activeLeagueWeeks: ActiveLeagueWeek[] = (
    (leagueWeeksResult.data ?? []) as Array<{
      week_id: string;
      league_id: string;
      league_weeks: { week_number: number; status: string } | { week_number: number; status: string }[];
      leagues: { name: string } | { name: string }[];
    }>
  ).map((row) => {
    const lw = Array.isArray(row.league_weeks) ? row.league_weeks[0] : row.league_weeks;
    const lg = Array.isArray(row.leagues) ? row.leagues[0] : row.leagues;
    return {
      league_id: row.league_id,
      league_name: lg?.name ?? "",
      week_number: lw?.week_number ?? 0,
      week_id: row.week_id,
    };
  }).filter((r) => r.week_number > 0);
  const canReport =
    !activeIncident &&
    (market.status === "open" || market.status === "closed");

  const isOU = market.market_type === "over_under";
  const totalPool = market.yes_pool + market.no_pool;
  const yesProb = market.yes_probability;
  const noProb = 1 - yesProb;

  return (
    <div className="space-y-4">
      <ToastContainer />

      {/* Market header */}
      <article>
        <div className="flex items-center gap-2 mb-2">
          <CategoryBadge category={market.category} />
          <StatusBadge status={market.status} />
          {isOU && (
            <span
              className="text-xs font-semibold px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: "var(--color-primary-light)",
                color: "var(--color-primary)",
              }}
            >
              Over/Under
            </span>
          )}
        </div>

        {suggester && (
          <p
            className="text-xs mb-2"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            Suggested by{" "}
            <span
              className="font-semibold"
              style={{ color: "var(--color-primary)" }}
            >
              @{suggester.username ?? suggester.display_name ?? "a user"}
            </span>
          </p>
        )}

        <h1
          className="text-xl font-bold leading-snug mb-2"
          style={{ color: "var(--color-ink-primary)" }}
        >
          {market.title}
        </h1>

        <p
          className="text-sm leading-relaxed mb-4"
          style={{ color: "var(--color-ink-secondary)" }}
        >
          {market.description}
        </p>

        {/* Stats display */}
        <div
          className="rounded-xl p-4 mb-4"
          style={{
            backgroundColor: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          {isOU ? (
            /* O/U display */
            <>
              <div className="flex justify-between items-center mb-3">
                <div className="text-center">
                  <p
                    className="text-3xl font-bold"
                    style={{ color: "var(--color-yes)" }}
                  >
                    {formatCoins(Math.round(market.yes_pool))}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: "var(--color-ink-tertiary)" }}
                  >
                    OVER volume
                  </p>
                </div>
                <div className="text-center">
                  <p
                    className="text-3xl font-bold"
                    style={{ color: "var(--color-primary)" }}
                  >
                    {market.ou_line}
                  </p>
                  <p
                    className="text-xs font-semibold"
                    style={{ color: "var(--color-ink-secondary)" }}
                  >
                    {market.ou_unit} · Current Line
                  </p>
                  {market.resolution_date && (
                    <p
                      className="text-xs mt-1"
                      style={{ color: "var(--color-ink-tertiary)" }}
                    >
                      {formatTimeRemaining(market.resolution_date)} remaining
                    </p>
                  )}
                  {market.resolution_value !== null && market.resolution_value !== undefined && (
                    <p
                      className="text-xs mt-1 font-semibold"
                      style={{ color: "var(--color-yes)" }}
                    >
                      Result: {market.resolution_value} {market.ou_unit}
                    </p>
                  )}
                </div>
                <div className="text-center">
                  <p
                    className="text-3xl font-bold"
                    style={{ color: "var(--color-no)" }}
                  >
                    {formatCoins(Math.round(market.no_pool))}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: "var(--color-ink-tertiary)" }}
                  >
                    UNDER volume
                  </p>
                </div>
              </div>
              {/* Volume bar (OVER vs UNDER) */}
              {totalPool > 0 && (
                <div
                  className="h-3 rounded-full overflow-hidden"
                  style={{ backgroundColor: "var(--color-no-bg)" }}
                  role="progressbar"
                  aria-valuenow={Math.round(yesProb * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`OVER volume: ${Math.round(yesProb * 100)}%`}
                >
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.round(yesProb * 100)}%`,
                      backgroundColor: "var(--color-yes)",
                    }}
                  />
                </div>
              )}
              <p
                className="text-xs mt-2 text-center"
                style={{ color: "var(--color-ink-tertiary)" }}
              >
                Opening line: {market.ou_opening_line} {market.ou_unit} · Both sides +100 (2× payout)
              </p>
            </>
          ) : (
            /* Binary display */
            <>
              <div className="flex justify-between items-center mb-3">
                <div className="text-center">
                  <p
                    className="text-3xl font-bold"
                    style={{ color: "var(--color-yes)" }}
                  >
                    {formatProbability(yesProb)}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: "var(--color-ink-tertiary)" }}
                  >
                    YES
                  </p>
                </div>
                <div
                  className="text-center"
                  style={{ color: "var(--color-ink-tertiary)" }}
                >
                  <p className="text-sm font-medium">
                    {formatCoins(Math.round(totalPool))} coins wagered
                  </p>
                  {market.resolution_date && (
                    <p className="text-xs">
                      {formatTimeRemaining(market.resolution_date)} remaining
                    </p>
                  )}
                </div>
                <div className="text-center">
                  <p
                    className="text-3xl font-bold"
                    style={{ color: "var(--color-no)" }}
                  >
                    {formatProbability(noProb)}
                  </p>
                  <p
                    className="text-xs"
                    style={{ color: "var(--color-ink-tertiary)" }}
                  >
                    NO
                  </p>
                </div>
              </div>
              {/* Probability bar */}
              <div
                className="h-3 rounded-full overflow-hidden"
                style={{ backgroundColor: "var(--color-no-bg)" }}
                role="progressbar"
                aria-valuenow={Math.round(yesProb * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.round(yesProb * 100)}%`,
                    backgroundColor:
                      yesProb < 0.34
                        ? "var(--color-no)"
                        : yesProb < 0.67
                        ? "var(--color-warning)"
                        : "var(--color-yes)",
                  }}
                />
              </div>
            </>
          )}
        </div>

        {/* Probability history chart — binary markets only */}
        {!isOU && (
          <div
            className="rounded-xl p-4 mb-4"
            style={{
              backgroundColor: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <h2
              className="text-xs font-semibold uppercase tracking-wide mb-3"
              style={{ color: "var(--color-ink-tertiary)" }}
            >
              Probability History
            </h2>
            <ProbabilityChart history={history} />
          </div>
        )}
      </article>

      {/* Betting panel */}
      <BettingPanel
        market={market}
        userPosition={userPosition}
        userBalance={profile?.coins ?? 0}
        marketBetCount={marketBetCount}
        initialSide={
          initialSide === "yes" || initialSide === "no" ? initialSide : "yes"
        }
        activeLeagueWeeks={activeLeagueWeeks}
      />

      {/* Incident report widget */}
      {activeIncident && (() => {
        const myVote = activeIncident.incident_votes.find(
          (v) => v.user_id === user.id
        );
        const total = activeIncident.yes_votes + activeIncident.no_votes;
        const agreeRate =
          total > 0 ? Math.round((activeIncident.yes_votes / total) * 100) : 0;
        const isPassed = activeIncident.status === "passed";
        return (
          <div
            className="rounded-xl overflow-hidden"
            style={{
              backgroundColor: "var(--color-bg-card)",
              border: `1px solid ${isPassed ? "var(--color-yes)" : "var(--color-border)"}`,
              boxShadow: "var(--shadow-card)",
            }}
          >
            <div
              className="px-4 py-3 flex items-center justify-between"
              style={{ borderBottom: "1px solid var(--color-border)" }}
            >
              <h2
                className="text-sm font-semibold"
                style={{ color: "var(--color-ink-primary)" }}
              >
                Community Incident Report
              </h2>
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                style={{
                  backgroundColor: isPassed
                    ? "var(--color-yes-bg)"
                    : "var(--color-primary-light)",
                  color: isPassed ? "var(--color-yes)" : "var(--color-primary)",
                }}
              >
                {isPassed ? "PASSED" : "VOTING"}
              </span>
            </div>
            <div className="px-4 py-3">
              <p
                className="text-sm mb-1"
                style={{ color: "var(--color-ink-secondary)" }}
              >
                {activeIncident.description}
              </p>
              <p
                className="text-xs mb-3"
                style={{ color: "var(--color-ink-tertiary)" }}
              >
                Proposed outcome:{" "}
                <span
                  className="font-semibold"
                  style={{ color: "var(--color-ink-primary)" }}
                >
                  {activeIncident.proposed_outcome.toUpperCase()}
                </span>
              </p>
              <div className="mb-3">
                <div
                  className="h-1.5 rounded-full overflow-hidden"
                  style={{ backgroundColor: "var(--color-border)" }}
                >
                  {total > 0 && (
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${agreeRate}%`,
                        backgroundColor:
                          agreeRate >= 60 ? "var(--color-yes)" : "var(--color-no)",
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
                    : `${activeIncident.yes_votes} agree · ${activeIncident.no_votes} disagree · ${agreeRate}%`}
                </p>
              </div>
              <IncidentVoteButtons
                reportId={activeIncident.id}
                userVote={myVote ? myVote.agrees : null}
                isReporter={activeIncident.reporter_id === user.id}
                isOpen={activeIncident.status === "voting"}
              />
            </div>
          </div>
        );
      })()}

      {canReport && (
        <ReportOutcomeForm
          marketId={market.id}
          marketType={market.market_type}
          ouUnit={market.ou_unit}
        />
      )}

      {/* Market activity */}
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
              className="text-sm font-semibold"
              style={{ color: "var(--color-ink-primary)" }}
            >
              Market Activity
            </h2>
          </div>
          <ActivityFeed entries={activity} />
        </div>
      )}

      {/* Comments section */}
      <MarketComments
        marketId={market.id}
        currentUserId={user.id}
        currentUsername={profile?.username ?? null}
        initialComments={comments}
      />
    </div>
  );
}
