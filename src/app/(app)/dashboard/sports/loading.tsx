import { MarketListSkeleton } from "@/components/markets/MarketCardSkeleton";
import { Skeleton } from "@/components/ui/Skeleton";

export default function SportsLoading() {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-48 rounded-2xl mb-4" />
      <MarketListSkeleton count={5} />
    </div>
  );
}
