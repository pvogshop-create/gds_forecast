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
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <Skeleton className="h-4 w-28" />
        </div>
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: i < 4 ? "1px solid var(--color-border)" : undefined }}>
            <Skeleton className="h-4 w-6 rounded" />
            <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
            <div className="flex-1">
              <Skeleton className="h-3.5 w-28 mb-1" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
      {/* Banner skeleton */}
      <Skeleton className="h-48 rounded-2xl mb-4" />
      <MarketListSkeleton count={5} />
    </div>
  );
}
