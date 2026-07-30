"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { CategoryBadge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { approveSuggestion, rejectSuggestion } from "./actions";
import { toast } from "@/components/ui/Toast";
import { ToastContainer } from "@/components/ui/Toast";
import {
  parseAmericanOdds,
  formatAmericanOdds,
} from "@/lib/market-logic";
import type { MarketSuggestion, Profile } from "@/types/database";

type SuggestionWithProfile = MarketSuggestion & {
  profiles: Pick<Profile, "username" | "avatar_url"> | null;
};

interface AdminSuggestionsProps {
  suggestions: SuggestionWithProfile[];
}

export function AdminSuggestions({ suggestions }: AdminSuggestionsProps) {
  const [isPending, startTransition] = useTransition();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  // Per-suggestion binary odds override (keyed by suggestion id)
  const [lineOverrides, setLineOverrides] = useState<Record<string, string>>(
    {}
  );
  // Per-suggestion O/U line override (keyed by suggestion id)
  const [ouLineOverrides, setOuLineOverrides] = useState<Record<string, string>>({});

  function handleApprove(
    id: string,
    suggestedOdds: number | null,
    marketType: string,
    suggestedOuLine: number | null
  ) {
    if (marketType === "over_under") {
      const rawOuOverride = ouLineOverrides[id]?.trim();
      const ouOverride = rawOuOverride ? parseFloat(rawOuOverride) : undefined;
      const effectiveOuLine =
        ouOverride !== undefined && !isNaN(ouOverride)
          ? ouOverride
          : (suggestedOuLine ?? undefined);
      startTransition(async () => {
        try {
          await approveSuggestion(id, 100, effectiveOuLine);
          toast.success("Suggestion approved and O/U market created!");
        } catch {
          toast.error("Failed to approve suggestion.");
        }
      });
      return;
    }

    const rawOverride = lineOverrides[id]?.trim();
    const lineOverride = rawOverride
      ? parseAmericanOdds(rawOverride)
      : undefined;

    if (rawOverride && lineOverride === null) {
      toast.error("Invalid odds format. Use e.g. +150, -110, +100");
      return;
    }

    startTransition(async () => {
      try {
        await approveSuggestion(id, lineOverride ?? suggestedOdds ?? 100);
        toast.success("Suggestion approved and market created!");
      } catch {
        toast.error("Failed to approve suggestion.");
      }
    });
  }

  function handleReject(id: string) {
    if (rejectingId === id) {
      startTransition(async () => {
        try {
          await rejectSuggestion(id, rejectNote || undefined);
          toast.success("Suggestion rejected.");
          setRejectingId(null);
          setRejectNote("");
        } catch {
          toast.error("Failed to reject suggestion.");
        }
      });
    } else {
      setRejectingId(id);
      setRejectNote("");
    }
  }

  return (
    <>
      <ToastContainer />
      <section>
        <h2
          className="font-semibold text-sm mb-3"
          style={{ color: "var(--color-ink-primary)" }}
        >
          Pending Suggestions{" "}
          {suggestions.length > 0 && (
            <span
              className="ml-1 px-1.5 py-0.5 rounded-full text-xs"
              style={{
                backgroundColor: "var(--color-warning)",
                color: "white",
              }}
            >
              {suggestions.length}
            </span>
          )}
        </h2>

        {suggestions.length === 0 ? (
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
              No pending suggestions. 🎉
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {suggestions.map((s) => {
              const defaultOdds = s.suggested_yes_odds ?? 100;
              const rawOverride = lineOverrides[s.id]?.trim() ?? "";
              const parsedOverride = rawOverride
                ? parseAmericanOdds(rawOverride)
                : null;
              const overrideError =
                rawOverride && parsedOverride === null
                  ? "Invalid format"
                  : null;
              const effectiveOdds =
                parsedOverride !== null ? parsedOverride : defaultOdds;

              return (
                <div
                  key={s.id}
                  data-testid="admin-suggestion-row"
                  data-suggestion-id={s.id}
                  className="rounded-xl p-4"
                  style={{
                    backgroundColor: "var(--color-bg-card)",
                    border: "1px solid var(--color-border)",
                    boxShadow: "var(--shadow-card)",
                  }}
                >
                  <div className="flex items-start gap-3 mb-3">
                    <Avatar
                      src={s.profiles?.avatar_url}
                      username={s.profiles?.username}
                      size="xs"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <CategoryBadge category={s.category} />
                        {s.market_type === "over_under" && (
                          <span
                            className="text-xs font-medium px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: "var(--color-primary-light)",
                              color: "var(--color-primary)",
                            }}
                          >
                            O/U
                          </span>
                        )}
                        <span
                          className="text-xs"
                          style={{ color: "var(--color-ink-tertiary)" }}
                        >
                          @{s.profiles?.username ?? "unknown"}
                        </span>
                      </div>
                      <p
                        className="text-sm font-semibold"
                        style={{ color: "var(--color-ink-primary)" }}
                      >
                        {s.title}
                      </p>
                      <p
                        className="text-xs mt-0.5"
                        style={{ color: "var(--color-ink-secondary)" }}
                      >
                        {s.description}
                      </p>
                    </div>
                  </div>

                  {/* Suggested line + admin override */}
                  <div
                    className="rounded-lg px-3 py-2.5 mb-3 space-y-2"
                    style={{ backgroundColor: "var(--color-bg)" }}
                  >
                    {s.market_type === "over_under" ? (
                      // O/U suggestion: editable opening line override
                      (() => {
                        const rawOuOverride = ouLineOverrides[s.id]?.trim() ?? "";
                        const parsedOuOverride = rawOuOverride ? parseFloat(rawOuOverride) : null;
                        const ouOverrideError =
                          rawOuOverride &&
                          (isNaN(parsedOuOverride ?? NaN) || (parsedOuOverride ?? 0) <= 0)
                            ? "Must be a positive number"
                            : null;
                        const effectiveLine =
                          parsedOuOverride !== null && !ouOverrideError
                            ? parsedOuOverride
                            : s.ou_opening_line;
                        return (
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between text-xs">
                              <span style={{ color: "var(--color-ink-tertiary)" }}>
                                Opening line
                              </span>
                              <span
                                className="text-xs"
                                style={{ color: "var(--color-ink-tertiary)" }}
                              >
                                suggested: {s.ou_opening_line} {s.ou_unit}
                              </span>
                            </div>
                            <input
                              type="number"
                              step="0.5"
                              min="0.5"
                              value={ouLineOverrides[s.id] ?? (s.ou_opening_line?.toString() ?? "")}
                              onChange={(e) =>
                                setOuLineOverrides((prev) => ({
                                  ...prev,
                                  [s.id]: e.target.value,
                                }))
                              }
                              placeholder={s.ou_opening_line?.toString() ?? "e.g. 3.5"}
                              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none transition-all duration-150"
                              style={{
                                backgroundColor: "var(--color-bg-card)",
                                border: `1px solid ${ouOverrideError ? "var(--color-danger)" : "var(--color-border)"}`,
                                color: "var(--color-ink-primary)",
                              }}
                            />
                            {ouOverrideError ? (
                              <p
                                className="text-xs"
                                style={{ color: "var(--color-danger)" }}
                              >
                                {ouOverrideError}
                              </p>
                            ) : (
                              <p
                                className="text-xs"
                                style={{ color: "var(--color-ink-tertiary)" }}
                              >
                                Will open at O/U {effectiveLine} {s.ou_unit} · +100 both sides
                              </p>
                            )}
                          </div>
                        );
                      })()
                    ) : (
                      // Binary suggestion: show YES/NO odds + allow admin override
                      <>
                        <div className="flex items-center justify-between text-xs">
                          <span style={{ color: "var(--color-ink-tertiary)" }}>
                            Suggested line
                          </span>
                          <span
                            className="font-medium"
                            style={{ color: "var(--color-ink-primary)" }}
                          >
                            YES {formatAmericanOdds(defaultOdds)} / NO{" "}
                            {formatAmericanOdds(-defaultOdds)}
                          </span>
                        </div>
                        <div>
                          <input
                            type="text"
                            value={lineOverrides[s.id] ?? ""}
                            onChange={(e) =>
                              setLineOverrides((prev) => ({
                                ...prev,
                                [s.id]: e.target.value,
                              }))
                            }
                            placeholder={`Override (e.g. ${formatAmericanOdds(defaultOdds)})`}
                            className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none transition-all duration-150"
                            style={{
                              backgroundColor: "var(--color-bg-card)",
                              border: `1px solid ${overrideError ? "var(--color-danger)" : "var(--color-border)"}`,
                              color: "var(--color-ink-primary)",
                            }}
                          />
                          {overrideError ? (
                            <p
                              className="text-xs mt-1"
                              style={{ color: "var(--color-danger)" }}
                            >
                              {overrideError} — use e.g. +150, -110
                            </p>
                          ) : parsedOverride !== null ? (
                            <p
                              className="text-xs mt-1"
                              style={{ color: "var(--color-ink-tertiary)" }}
                            >
                              Will use YES {formatAmericanOdds(effectiveOdds)} / NO{" "}
                              {formatAmericanOdds(-effectiveOdds)}
                            </p>
                          ) : null}
                        </div>
                      </>
                    )}
                  </div>

                  {rejectingId === s.id && (
                    <div className="mb-3">
                      <input
                        type="text"
                        value={rejectNote}
                        onChange={(e) => setRejectNote(e.target.value)}
                        placeholder="Rejection note (optional)"
                        data-testid="admin-reject-note"
                        className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                        style={{
                          backgroundColor: "var(--color-bg)",
                          border: "1px solid var(--color-border)",
                          color: "var(--color-ink-primary)",
                        }}
                      />
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      className="flex-1"
                      data-testid="admin-approve"
                      onClick={() =>
                        handleApprove(s.id, s.suggested_yes_odds, s.market_type, s.ou_opening_line)
                      }
                      isLoading={isPending}
                      disabled={(() => {
                        if (s.market_type === "binary") return !!overrideError;
                        const raw = ouLineOverrides[s.id]?.trim() ?? "";
                        if (!raw) return false;
                        const v = parseFloat(raw);
                        return isNaN(v) || v <= 0;
                      })()}
                    >
                      ✓ Approve
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      className="flex-1"
                      onClick={() => handleReject(s.id)}
                      isLoading={isPending && rejectingId === s.id}
                    >
                      {rejectingId === s.id ? "Confirm Reject" : "✕ Reject"}
                    </Button>
                    {rejectingId === s.id && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRejectingId(null)}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
