import Link from "next/link";
import { Clock, TrendingUp } from "lucide-react";
import { CategoryBadge, ClosingSoonBadge, NewBadge } from "@/components/ui/Badge";
import { MarketReactions } from "@/components/markets/MarketReactions";
import { MarketCardComments } from "@/components/markets/MarketCardComments";
import {
  formatProbability,
  formatCoins,
  formatTimeRemaining,
  isNewMarket,
  cn,
} from "@/lib/utils";
import {
  probToAmericanOdds,
  formatAmericanOdds,
} from "@/lib/market-logic";
import type { Market } from "@/types/database";

interface MarketCardProps {
  market: Market;
  userPosition?: { side: "yes" | "no"; coins_wagered: number } | null;
  currentUserId?: string | null;
  currentUsername?: string | null;
  className?: string;
}

export function MarketCard({
  market,
  userPosition,
  currentUserId,
  currentUsername,
  className,
}: MarketCardProps) {
  const isOU = market.market_type === "over_under";
  const totalPool = market.yes_pool + market.no_pool;
  const yesProb = market.yes_probability;
  const noProb = 1 - yesProb;
  const isNew = isNewMarket(market.created_at);
  const isClosingSoon = (() => {
    if (!market.resolution_date) return false;
    const diff = new Date(market.resolution_date).getTime() - Date.now();
    return diff > 0 && diff < 24 * 60 * 60 * 1000;
  })();
  const isResolved =
    market.status === "resolved_yes" || market.status === "resolved_no";

  return (
    <article
      className={cn(
        "rounded-xl p-4 transition-all duration-200 hover:shadow-[var(--shadow-card-hover)]",
        className
      )}
      style={{
        backgroundColor: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {/* Header row: category badge + meta */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <CategoryBadge category={market.category} />
          {isNew && <NewBadge />}
          {isClosingSoon && <ClosingSoonBadge />}
          {userPosition && (
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{
                backgroundColor:
                  userPosition.side === "yes"
                    ? "var(--color-yes-bg)"
                    : "var(--color-no-bg)",
                color:
                  userPosition.side === "yes"
                    ? "var(--color-yes)"
                    : "var(--color-no)",
              }}
            >
              {isOU
                ? userPosition.side === "yes"
                  ? "OVER position"
                  : "UNDER position"
                : `${userPosition.side.toUpperCase()} position`}
            </span>
          )}
        </div>
        {market.resolution_date && !isResolved && (
          <div
            className="flex items-center gap-1 text-xs"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            <Clock size={11} strokeWidth={2} />
            <span>{formatTimeRemaining(market.resolution_date)}</span>
          </div>
        )}
        {isResolved && (
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{
              backgroundColor:
                market.status === "resolved_yes"
                  ? "var(--color-yes-bg)"
                  : "var(--color-no-bg)",
              color:
                market.status === "resolved_yes"
                  ? "var(--color-yes)"
                  : "var(--color-no)",
            }}
          >
            {market.status === "resolved_yes" ? "Resolved YES" : "Resolved NO"}
          </span>
        )}
      </div>

      {/* Title */}
      <Link href={`/market/${market.id}`} className="block group">
        <h3
          className="font-semibold text-sm leading-snug mb-1.5 group-hover:underline"
          style={{ color: "var(--color-ink-primary)", textDecorationColor: "var(--color-primary)" }}
        >
          {market.title}
        </h3>
      </Link>

      {/* Suggester attribution */}
      {market.suggested_by && market.suggested_by_profile && (
        <p className="text-xs mb-2.5" style={{ color: "var(--color-ink-tertiary)" }}>
          by{" "}
          <a
            href={`/profile/${market.suggested_by_profile.username ?? ""}`}
            className="font-medium hover:underline"
            style={{ color: "var(--color-primary)" }}
          >
            @{market.suggested_by_profile.username
                ?? market.suggested_by_profile.display_name
                ?? "user"}
          </a>
        </p>
      )}

      {/* Probability / volume bar */}
      <div className="mb-3">
        {isOU ? (
          /* O/U: show current line prominently instead of bar */
          <div className="flex items-center justify-between">
            <span
              className="text-base font-bold"
              style={{ color: "var(--color-primary)" }}
            >
              O/U {market.ou_line} {market.ou_unit}
            </span>
            <span
              className="text-xs"
              style={{ color: "var(--color-ink-tertiary)" }}
            >
              +100 both sides
            </span>
          </div>
        ) : (
          <>
          <div className="flex justify-between text-xs mb-1">
            <span style={{ color: "var(--color-yes)" }}>{Math.round(yesProb * 100)}% YES</span>
            <span style={{ color: "var(--color-no)" }}>{Math.round((1 - yesProb) * 100)}% NO</span>
          </div>
          <div
            className="h-2 rounded-full overflow-hidden"
            style={{ backgroundColor: "var(--color-bg)" }}
            role="progressbar"
            aria-valuenow={Math.round(yesProb * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`YES probability: ${formatProbability(yesProb)}`}
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

      {/* Bottom row: volume + bet buttons */}
      <div className="flex items-center justify-between gap-3">
        {/* Stats */}
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-1 text-xs"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            <TrendingUp size={11} strokeWidth={2} />
            <span>{formatCoins(Math.round(totalPool))} coins</span>
          </div>
        </div>

        {/* Bet buttons */}
        {!isResolved && market.status === "open" ? (
          <div className="flex gap-2">
            <Link href={`/market/${market.id}?side=yes`}>
              <button
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all duration-150 hover:scale-105 active:scale-95"
                style={{
                  backgroundColor: "var(--color-yes-bg)",
                  color: "var(--color-yes)",
                  border: "1px solid rgba(26,107,60,0.2)",
                }}
                aria-label={
                  isOU
                    ? `Bet OVER ${market.ou_line} ${market.ou_unit}`
                    : `Bet YES at ${formatProbability(yesProb)}`
                }
              >
                {isOU ? "OVER" : "YES"}{" "}
                <span className="opacity-70">
                  {isOU
                    ? "+100"
                    : formatAmericanOdds(probToAmericanOdds(yesProb))}
                </span>
              </button>
            </Link>
            <Link href={`/market/${market.id}?side=no`}>
              <button
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all duration-150 hover:scale-105 active:scale-95"
                style={{
                  backgroundColor: "var(--color-no-bg)",
                  color: "var(--color-no)",
                  border: "1px solid rgba(239,68,68,0.2)",
                }}
                aria-label={
                  isOU
                    ? `Bet UNDER ${market.ou_line} ${market.ou_unit}`
                    : `Bet NO at ${formatProbability(noProb)}`
                }
              >
                {isOU ? "UNDER" : "NO"}{" "}
                <span className="opacity-70">
                  {isOU
                    ? "+100"
                    : formatAmericanOdds(probToAmericanOdds(noProb))}
                </span>
              </button>
            </Link>
          </div>
        ) : (
          <Link
            href={`/market/${market.id}`}
            className="text-xs font-medium transition-colors duration-150 hover:underline"
            style={{ color: "var(--color-primary)" }}
          >
            View details →
          </Link>
        )}
      </div>

      {/* Emoji reactions */}
      <MarketReactions marketId={market.id} currentUserId={currentUserId ?? null} />

      {/* Inline comment section */}
      <MarketCardComments
        marketId={market.id}
        currentUserId={currentUserId ?? null}
        currentUsername={currentUsername ?? null}
      />
    </article>
  );
}
