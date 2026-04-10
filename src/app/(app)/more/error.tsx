"use client";

import { useEffect } from "react";

export default function MoreError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[/more] Page error:", error);
  }, [error]);

  return (
    <div
      className="rounded-xl p-10 text-center"
      style={{
        backgroundColor: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="text-4xl mb-3">⚠️</div>
      <p
        className="font-medium text-sm mb-2"
        style={{ color: "var(--color-ink-primary)" }}
      >
        Something went wrong loading this page.
      </p>
      <button
        onClick={reset}
        className="mt-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-150"
        style={{
          backgroundColor: "var(--color-primary)",
          color: "white",
        }}
      >
        Try again
      </button>
    </div>
  );
}
