import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function CirclesLoading() {
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-8 w-20 rounded-full" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl p-4"
            style={{
              backgroundColor: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div className="flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-xl" />
              <div className="flex-1">
                <SkeletonText className="w-40 mb-1" />
                <SkeletonText className="w-28 h-3" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
