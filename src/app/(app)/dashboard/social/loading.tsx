import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function SocialLoading() {
  return (
    <div>
      <Skeleton className="h-7 w-20 mb-4" />
      {/* Leaderboard skeleton */}
      <div
        className="rounded-xl p-4 mb-4 space-y-3"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        <SkeletonText className="w-32 mb-2" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="w-6 h-4 rounded" />
            <Skeleton className="w-8 h-8 rounded-full" />
            <SkeletonText className="flex-1 w-32" />
            <Skeleton className="w-16 h-4 rounded" />
          </div>
        ))}
      </div>
      {/* Feed skeleton */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
          <Skeleton className="h-4 w-32" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <Skeleton className="w-8 h-8 rounded-full flex-shrink-0" />
            <div className="flex-1 space-y-1.5">
              <SkeletonText className="w-3/4" />
              <SkeletonText className="w-1/2 h-3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
