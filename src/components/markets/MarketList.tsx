import { MarketCard } from "./MarketCard";
import type { Market, Position } from "@/types/database";

interface MarketListProps {
  markets: Market[];
  userPositions?: Record<string, Position>;
  emptyMessage?: string;
  currentUserId?: string | null;
}

export function MarketList({
  markets,
  userPositions,
  emptyMessage = "No markets found.",
  currentUserId,
}: MarketListProps) {
  if (markets.length === 0) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 px-4 text-center rounded-xl"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div className="text-4xl mb-3">📊</div>
        <p
          className="font-medium text-sm"
          style={{ color: "var(--color-ink-secondary)" }}
        >
          {emptyMessage}
        </p>
        <p
          className="text-xs mt-1"
          style={{ color: "var(--color-ink-tertiary)" }}
        >
          Check back soon for new predictions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {markets.map((market) => (
        <MarketCard
          key={market.id}
          market={market}
          currentUserId={currentUserId}
          userPosition={
            userPositions?.[market.id]
              ? {
                  side: userPositions[market.id]!.side,
                  coins_wagered: userPositions[market.id]!.coins_wagered,
                }
              : null
          }
        />
      ))}
    </div>
  );
}
