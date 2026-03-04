import { MarketListSkeleton } from "@/components/markets/MarketCardSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

export default function ActionsLoading() {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-24" />
      </div>
      <MarketListSkeleton count={5} />
    </div>
  );
}
