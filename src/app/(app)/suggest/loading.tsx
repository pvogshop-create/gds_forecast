import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function SuggestLoading() {
  return (
    <div>
      <div className="mb-4">
        <Skeleton className="h-7 w-36 mb-1" />
        <SkeletonText className="w-64" />
      </div>

      {/* Form skeleton */}
      <div
        className="rounded-xl p-5 space-y-4"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div>
          <SkeletonText className="w-24 mb-2" />
          <Skeleton className="h-10 rounded-xl" />
        </div>
        <div>
          <SkeletonText className="w-40 mb-2" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
        <div>
          <SkeletonText className="w-20 mb-2" />
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 rounded-xl" />
            ))}
          </div>
        </div>
        <Skeleton className="h-10 rounded-xl" />
      </div>

      {/* Past suggestions skeleton */}
      <div className="mt-6">
        <Skeleton className="h-5 w-36 mb-3" />
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl p-4"
              style={{
                backgroundColor: "var(--color-bg-card)",
                border: "1px solid var(--color-border)",
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
              <SkeletonText className="w-full mb-1" />
              <SkeletonText className="w-3/4 h-3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
