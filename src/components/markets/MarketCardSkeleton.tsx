import { SkeletonCard } from "@/components/ui/Skeleton";

export function MarketCardSkeleton() {
  return <SkeletonCard />;
}

export function MarketListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <MarketCardSkeleton key={i} />
      ))}
    </div>
  );
}
