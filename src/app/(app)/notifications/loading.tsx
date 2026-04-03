import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function NotificationsLoading() {
  return (
    <div>
      <Skeleton className="h-7 w-36 mb-4" />

      <div className="space-y-4">
        {/* Notifications skeleton */}
        <div
          className="rounded-xl overflow-hidden"
          style={{
            backgroundColor: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
          }}
        >
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
            <Skeleton className="h-4 w-40" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="px-4 py-3 space-y-1.5" style={{ borderBottom: "1px solid var(--color-border)" }}>
              <SkeletonText className="w-3/4" />
              <SkeletonText className="w-1/2 h-3" />
              <SkeletonText className="w-1/4 h-3" />
            </div>
          ))}
        </div>

        {/* Leaderboard skeleton */}
        <div
          className="rounded-xl p-4 space-y-3"
          style={{
            backgroundColor: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
          }}
        >
          <SkeletonText className="w-28 mb-2" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Skeleton className="w-6 h-4 rounded" />
              <Skeleton className="w-8 h-8 rounded-full" />
              <SkeletonText className="flex-1 w-32" />
              <Skeleton className="w-14 h-4 rounded" />
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
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--color-border)" }}>
            <Skeleton className="h-4 w-32" />
          </div>
          {Array.from({ length: 6 }).map((_, i) => (
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
    </div>
  );
}
