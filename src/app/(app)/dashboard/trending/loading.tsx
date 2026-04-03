import { MarketListSkeleton } from "@/components/markets/MarketCardSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

export default function TrendingLoading() {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-28" />
      </div>
      {/* Leaderboard skeleton */}
      <div
        className="rounded-xl overflow-hidden mb-4"
        style={{ border: "1px solid var(--color-border)", backgroundColor: "var(--color-bg-card)" }}
      >
        <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="flex divide-x" style={{ borderColor: "var(--color-border)" }}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1.5 py-2.5 px-2">
              <Skeleton className="h-4 w-4 rounded" />
              <Skeleton className="h-8 w-8 rounded-full" />
              <Skeleton className="h-3 w-14" />
              <Skeleton className="h-3 w-10" />
            </div>
          ))}
        </div>
      </div>
      {/* Banner skeleton */}
      <Skeleton className="h-48 rounded-2xl mb-4" />
      <MarketListSkeleton count={5} />
    </div>
  );
}
