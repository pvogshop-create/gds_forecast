"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { CategoryBadge, StatusBadge } from "@/components/ui/Badge";
import { resolveMarket, setMarketStatus } from "./actions";
import { toast } from "@/components/ui/Toast";
import { ToastContainer } from "@/components/ui/Toast";
import { formatProbability, formatCoins } from "@/lib/utils";
import type { Market } from "@/types/database";

interface AdminMarketsProps {
  markets: Market[];
}

type ResolvingState = {
  id: string;
  outcome: "yes" | "no";
} | null;

export function AdminMarkets({ markets }: AdminMarketsProps) {
  const [isPending, startTransition] = useTransition();
  const [resolving, setResolving] = useState<ResolvingState>(null);
  const [resolveNote, setResolveNote] = useState("");

  function handleResolveClick(id: string, outcome: "yes" | "no") {
    if (resolving?.id === id && resolving.outcome === outcome) {
      startTransition(async () => {
        try {
          await resolveMarket(id, outcome, resolveNote || undefined);
          toast.success(`Market resolved ${outcome.toUpperCase()}!`);
          setResolving(null);
          setResolveNote("");
        } catch {
          toast.error("Failed to resolve market.");
        }
      });
    } else {
      setResolving({ id, outcome });
      setResolveNote("");
    }
  }

  function handleStatusToggle(id: string, currentStatus: "open" | "closed") {
    const next = currentStatus === "open" ? "closed" : "open";
    startTransition(async () => {
      try {
        await setMarketStatus(id, next);
        toast.success(`Market ${next}.`);
      } catch {
        toast.error("Failed to update market status.");
      }
    });
  }

  return (
    <>
      <ToastContainer />
      <section>
        <h2
          className="font-semibold text-sm mb-3"
          style={{ color: "var(--color-ink-primary)" }}
        >
          Active Markets{" "}
          {markets.length > 0 && (
            <span
              className="ml-1 px-1.5 py-0.5 rounded-full text-xs"
              style={{
                backgroundColor: "var(--color-primary)",
                color: "white",
              }}
            >
              {markets.length}
            </span>
          )}
        </h2>

        {markets.length === 0 ? (
          <div
            className="rounded-xl p-6 text-center"
            style={{
              backgroundColor: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
            }}
          >
            <p
              className="text-sm"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              No active markets.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {markets.map((m) => (
              <div
                key={m.id}
                className="rounded-xl p-4"
                style={{
                  backgroundColor: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                  boxShadow: "var(--shadow-card)",
                }}
              >
                {/* Market info */}
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <CategoryBadge category={m.category} />
                      <StatusBadge status={m.status} />
                    </div>
                    <p
                      className="text-sm font-semibold leading-snug"
                      style={{ color: "var(--color-ink-primary)" }}
                    >
                      {m.title}
                    </p>
                  </div>
                </div>

                {/* Pool stats */}
                <div className="flex items-center gap-4 mb-3">
                  <div>
                    <span
                      className="text-xs"
                      style={{ color: "var(--color-ink-tertiary)" }}
                    >
                      YES pool:{" "}
                    </span>
                    <span
                      className="text-xs font-medium"
                      style={{ color: "var(--color-yes)" }}
                    >
                      {formatCoins(m.yes_pool)}
                    </span>
                  </div>
                  <div>
                    <span
                      className="text-xs"
                      style={{ color: "var(--color-ink-tertiary)" }}
                    >
                      NO pool:{" "}
                    </span>
                    <span
                      className="text-xs font-medium"
                      style={{ color: "var(--color-no)" }}
                    >
                      {formatCoins(m.no_pool)}
                    </span>
                  </div>
                  <div>
                    <span
                      className="text-xs"
                      style={{ color: "var(--color-ink-tertiary)" }}
                    >
                      Prob:{" "}
                    </span>
                    <span
                      className="text-xs font-medium"
                      style={{ color: "var(--color-ink-primary)" }}
                    >
                      {formatProbability(m.yes_probability)}
                    </span>
                  </div>
                </div>

                {/* Resolution note input */}
                {resolving?.id === m.id && (
                  <div className="mb-3">
                    <input
                      type="text"
                      value={resolveNote}
                      onChange={(e) => setResolveNote(e.target.value)}
                      placeholder="Resolution note (optional)"
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{
                        backgroundColor: "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        color: "var(--color-ink-primary)",
                      }}
                    />
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2 flex-wrap">
                  <Button
                    variant="yes"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleResolveClick(m.id, "yes")}
                    isLoading={
                      isPending &&
                      resolving?.id === m.id &&
                      resolving.outcome === "yes"
                    }
                  >
                    {resolving?.id === m.id && resolving.outcome === "yes"
                      ? "Confirm YES"
                      : "Resolve YES"}
                  </Button>
                  <Button
                    variant="no"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleResolveClick(m.id, "no")}
                    isLoading={
                      isPending &&
                      resolving?.id === m.id &&
                      resolving.outcome === "no"
                    }
                  >
                    {resolving?.id === m.id && resolving.outcome === "no"
                      ? "Confirm NO"
                      : "Resolve NO"}
                  </Button>
                  {m.status === "open" || m.status === "closed" ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        handleStatusToggle(
                          m.id,
                          m.status as "open" | "closed"
                        )
                      }
                      isLoading={isPending && resolving === null}
                    >
                      {m.status === "open" ? "Close" : "Reopen"}
                    </Button>
                  ) : null}
                  {resolving?.id === m.id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setResolving(null)}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
