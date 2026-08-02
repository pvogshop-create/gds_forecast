import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function CircleDetailLoading() {
  return (
    <div>
      <Skeleton className="h-4 w-24 mb-3" />

      <div
        className="rounded-xl p-4 mb-4"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div className="flex items-start gap-3">
          <Skeleton className="w-12 h-12 rounded-xl" />
          <div className="flex-1">
            <SkeletonText className="w-48 mb-2" />
            <SkeletonText className="w-64 h-3 mb-2" />
            <SkeletonText className="w-40 h-3" />
          </div>
        </div>
      </div>

      <Skeleton className="h-5 w-20 mb-3" />
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-3 rounded-xl p-3"
            style={{
              backgroundColor: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
            }}
          >
            <Skeleton className="w-8 h-8 rounded-full" />
            <SkeletonText className="w-32" />
          </div>
        ))}
      </div>
    </div>
  );
}
