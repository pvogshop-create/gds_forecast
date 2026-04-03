export default function MoreLoading() {
  return (
    <div className="space-y-4">
      {/* Tab bar skeleton — 5 tabs */}
      <div
        className="flex gap-1 rounded-xl p-1"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="flex-1 h-8 rounded-lg animate-pulse"
            style={{ backgroundColor: "var(--color-border)" }}
          />
        ))}
      </div>

      {/* Earn Coins card skeleton */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div
          className="px-4 py-3"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <div
            className="h-4 w-24 rounded animate-pulse"
            style={{ backgroundColor: "var(--color-border)" }}
          />
        </div>
        {[1, 2].map((i) => (
          <div
            key={i}
            className="px-4 py-3 flex items-center gap-3"
            style={{
              borderBottom: i < 2 ? "1px solid var(--color-border)" : undefined,
            }}
          >
            <div
              className="w-8 h-8 rounded-lg flex-shrink-0 animate-pulse"
              style={{ backgroundColor: "var(--color-border)" }}
            />
            <div className="flex-1 space-y-1.5">
              <div
                className="h-3.5 w-1/3 rounded animate-pulse"
                style={{ backgroundColor: "var(--color-border)" }}
              />
              <div
                className="h-3 w-1/2 rounded animate-pulse"
                style={{ backgroundColor: "var(--color-border)" }}
              />
            </div>
            <div
              className="w-14 h-7 rounded-lg flex-shrink-0 animate-pulse"
              style={{ backgroundColor: "var(--color-border)" }}
            />
          </div>
        ))}
      </div>

      {/* Content skeleton */}
      <div
        className="rounded-xl overflow-hidden"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
        }}
      >
        <div
          className="px-4 py-3"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <div
            className="h-4 w-36 rounded animate-pulse"
            style={{ backgroundColor: "var(--color-border)" }}
          />
        </div>
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="px-4 py-3 space-y-2"
            style={{
              borderBottom: i < 3 ? "1px solid var(--color-border)" : undefined,
            }}
          >
            <div
              className="h-3.5 w-3/4 rounded animate-pulse"
              style={{ backgroundColor: "var(--color-border)" }}
            />
            <div
              className="h-3 w-1/2 rounded animate-pulse"
              style={{ backgroundColor: "var(--color-border)" }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
