import Link from "next/link";
import { Clock, Users, TrendingUp } from "lucide-react";
import { CategoryBadge, NewBadge } from "@/components/ui/Badge";
import {
  formatProbability,
  formatCents,
  formatCoins,
  formatTimeRemaining,
  isNewMarket,
  cn,
} from "@/lib/utils";
import type { Market } from "@/types/database";

interface MarketCardProps {
  market: Market;
  userPosition?: { side: "yes" | "no"; coins_wagered: number } | null;
  className?: string;
}

export function MarketCard({
  market,
  userPosition,
  className,
}: MarketCardProps) {
  const totalPool = market.yes_pool + market.no_pool;
  const yesProb = market.yes_probability;
  const noProb = 1 - yesProb;
  const isNew = isNewMarket(market.created_at);
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
              {userPosition.side.toUpperCase()} position
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
          className="font-semibold text-sm leading-snug mb-3 group-hover:underline"
          style={{ color: "var(--color-ink-primary)", textDecorationColor: "var(--color-primary)" }}
        >
          {market.title}
        </h3>
      </Link>

      {/* Probability bar */}
      <div className="mb-3">
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
              backgroundColor: "var(--color-yes)",
            }}
          />
        </div>
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
                aria-label={`Bet YES at ${formatProbability(yesProb)}`}
              >
                YES <span className="opacity-70">{formatCents(yesProb)}</span>
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
                aria-label={`Bet NO at ${formatProbability(noProb)}`}
              >
                NO <span className="opacity-70">{formatCents(noProb)}</span>
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
    </article>
  );
}
