import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

export default function LeagueDetailLoading() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-40 rounded-xl" />
      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div className="px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
          <Skeleton className="h-4 w-24" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="w-6 h-4 rounded" />
            <Skeleton className="w-8 h-8 rounded-full" />
            <SkeletonText className="flex-1 w-32" />
            <Skeleton className="w-16 h-4 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
