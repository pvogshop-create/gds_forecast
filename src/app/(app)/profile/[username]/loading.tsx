import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function ProfileLoading() {
  return (
    <div className="space-y-4">
      <div
        className="rounded-xl p-5"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div className="flex items-start gap-4 mb-4">
          <Skeleton className="w-14 h-14 rounded-full" />
          <div className="flex-1">
            <SkeletonText className="w-40 h-5 mb-1" />
            <SkeletonText className="w-28 h-4" />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </div>
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}
