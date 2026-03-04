import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAuth } from "@/lib/auth";
import { CategoryBadge, StatusBadge } from "@/components/ui/Badge";
import { BettingPanel } from "@/components/markets/BettingPanel";
import { ProbabilityChart } from "@/components/markets/ProbabilityChart";
import { ActivityFeed } from "@/components/feed/ActivityFeed";
import { ToastContainer } from "@/components/ui/Toast";
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
  Profile,
} from "@/types/database";

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

  const [marketResult, historyResult, positionResult, activityResult, profileResult] =
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
        .select("coins")
        .eq("id", user.id)
        .single(),
    ]);

  if (!marketResult.data) notFound();

  const market = marketResult.data as Market;
  const history = (historyResult.data ?? []) as MarketProbabilityHistory[];
  const userPosition = positionResult.data as Position | null;
  const activity = (activityResult.data ?? []) as ActivityFeedEntryWithProfile[];
  const profile = profileResult.data as Pick<Profile, "coins"> | null;

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
        </div>

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

        {/* Probability display */}
        <div
          className="rounded-xl p-4 mb-4"
          style={{
            backgroundColor: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          {/* Big probability */}
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
                backgroundColor: "var(--color-yes)",
              }}
            />
          </div>
        </div>

        {/* Probability history chart */}
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
      </article>

      {/* Betting panel */}
      <BettingPanel
        market={market}
        userPosition={userPosition}
        userBalance={profile?.coins ?? 0}
        initialSide={
          initialSide === "yes" || initialSide === "no" ? initialSide : "yes"
        }
      />

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
    </div>
  );
}
