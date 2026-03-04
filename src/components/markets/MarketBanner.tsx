import Link from "next/link";
import { CategoryBadge } from "@/components/ui/Badge";
import { formatProbability, formatCents, formatTimeRemaining } from "@/lib/utils";
import type { Market } from "@/types/database";

interface MarketBannerProps {
  market: Market | null | undefined;
}

export function MarketBanner({ market }: MarketBannerProps) {
  if (!market) return null;

  const yesProb = market.yes_probability;
  const noProb = 1 - yesProb;

  return (
    <Link href={`/market/${market.id}`} className="block group mb-4">
      <div
        className="rounded-2xl p-5 transition-all duration-200 group-hover:shadow-[var(--shadow-card-hover)]"
        style={{
          background:
            "linear-gradient(135deg, var(--color-primary) 0%, var(--color-btn) 100%)",
          boxShadow: "var(--shadow-glow)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <CategoryBadge
              category={market.category}
              className="bg-white/20 text-white border-0"
            />
            <span className="text-white/60 text-xs">Featured</span>
          </div>
          {market.resolution_date && (
            <span className="text-white/60 text-xs">
              {formatTimeRemaining(market.resolution_date)} left
            </span>
          )}
        </div>

        {/* Title */}
        <h2 className="text-white font-bold text-lg leading-tight mb-4">
          {market.title}
        </h2>

        {/* Probability bar */}
        <div className="mb-4">
          <div className="h-2 bg-white/20 rounded-full overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all duration-500"
              style={{ width: `${Math.round(yesProb * 100)}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-white/80 text-xs font-medium">
              YES {formatProbability(yesProb)}
            </span>
            <span className="text-white/80 text-xs font-medium">
              NO {formatProbability(noProb)}
            </span>
          </div>
        </div>

        {/* Action buttons */}
        {market.status === "open" && (
          <div className="flex gap-3">
            <div className="flex-1 py-2.5 rounded-xl text-center font-bold text-sm bg-white/20 text-white hover:bg-white/30 transition-colors">
              YES {formatCents(yesProb)}
            </div>
            <div className="flex-1 py-2.5 rounded-xl text-center font-bold text-sm bg-white/20 text-white hover:bg-white/30 transition-colors">
              NO {formatCents(noProb)}
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
