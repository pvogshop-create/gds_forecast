"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { CategoryBadge, StatusBadge } from "@/components/ui/Badge";
import { resolveMarket, resolveOuMarket, setMarketStatus, setMarketLine } from "./actions";
import { toast } from "@/components/ui/Toast";
import { ToastContainer } from "@/components/ui/Toast";
import {
  formatProbability,
  formatCoins,
} from "@/lib/utils";
import {
  probToAmericanOdds,
  formatAmericanOdds,
  parseAmericanOdds,
} from "@/lib/market-logic";
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
  // Per-market state for the Set Line UI (binary only)
  const [settingLineId, setSettingLineId] = useState<string | null>(null);
  const [lineInput, setLineInput] = useState("");
  // O/U resolve: result value + confirmation state
  const [ouResolvingId, setOuResolvingId] = useState<string | null>(null);
  const [ouResultInput, setOuResultInput] = useState("");
  const [ouResolveNote, setOuResolveNote] = useState("");

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
      setOuResolvingId(null);
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

  function handleSetLineOpen(id: string, currentOdds: number) {
    setSettingLineId(id);
    setLineInput(formatAmericanOdds(currentOdds));
    setResolving(null);
  }

  function handleSetLineConfirm(id: string) {
    const parsed = parseAmericanOdds(lineInput);
    if (parsed === null) {
      toast.error("Invalid format. Use e.g. +150, -110, +100");
      return;
    }
    startTransition(async () => {
      try {
        await setMarketLine(id, parsed);
        toast.success(`Line set to YES ${formatAmericanOdds(parsed)}`);
        setSettingLineId(null);
        setLineInput("");
      } catch {
        toast.error("Failed to set line.");
      }
    });
  }

  function handleOuResolveOpen(id: string) {
    setOuResolvingId(id);
    setOuResultInput("");
    setOuResolveNote("");
    setResolving(null);
    setSettingLineId(null);
  }

  function handleOuResolveConfirm(id: string) {
    const result = parseFloat(ouResultInput);
    if (isNaN(result)) {
      toast.error("Enter a valid number for the result.");
      return;
    }
    startTransition(async () => {
      try {
        await resolveOuMarket(id, result, ouResolveNote || undefined);
        toast.success(`O/U market resolved! Result: ${result}`);
        setOuResolvingId(null);
        setOuResultInput("");
        setOuResolveNote("");
      } catch {
        toast.error("Failed to resolve O/U market.");
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
            {markets.map((m) => {
              const isOU = m.market_type === "over_under";
              const yesOdds = probToAmericanOdds(m.yes_probability);
              const noOdds = probToAmericanOdds(1 - m.yes_probability);
              const parsedLine =
                settingLineId === m.id ? parseAmericanOdds(lineInput) : null;
              const lineInputError =
                settingLineId === m.id &&
                lineInput.trim() !== "" &&
                parsedLine === null;
              const ouResultValid =
                ouResolvingId === m.id &&
                ouResultInput.trim() !== "" &&
                !isNaN(parseFloat(ouResultInput));

              return (
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
                        {isOU && (
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
                      </div>
                      <p
                        className="text-sm font-semibold leading-snug"
                        style={{ color: "var(--color-ink-primary)" }}
                      >
                        {m.title}
                      </p>
                    </div>
                  </div>

                  {/* Pool stats + current line */}
                  <div className="flex items-center gap-4 mb-3 flex-wrap">
                    {isOU ? (
                      <>
                        <div>
                          <span
                            className="text-xs"
                            style={{ color: "var(--color-ink-tertiary)" }}
                          >
                            Current line:{" "}
                          </span>
                          <span
                            className="text-xs font-semibold"
                            style={{ color: "var(--color-primary)" }}
                          >
                            O/U {m.ou_line} {m.ou_unit}
                          </span>
                        </div>
                        <div>
                          <span
                            className="text-xs"
                            style={{ color: "var(--color-ink-tertiary)" }}
                          >
                            Opening:{" "}
                          </span>
                          <span
                            className="text-xs font-medium"
                            style={{ color: "var(--color-ink-secondary)" }}
                          >
                            {m.ou_opening_line} {m.ou_unit}
                          </span>
                        </div>
                        <div>
                          <span
                            className="text-xs"
                            style={{ color: "var(--color-ink-tertiary)" }}
                          >
                            OVER vol:{" "}
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
                            UNDER vol:{" "}
                          </span>
                          <span
                            className="text-xs font-medium"
                            style={{ color: "var(--color-no)" }}
                          >
                            {formatCoins(m.no_pool)}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
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
                        <div>
                          <span
                            className="text-xs"
                            style={{ color: "var(--color-ink-tertiary)" }}
                          >
                            Line:{" "}
                          </span>
                          <span
                            className="text-xs font-medium"
                            style={{ color: "var(--color-yes)" }}
                          >
                            YES {formatAmericanOdds(yesOdds)}
                          </span>
                          <span
                            className="text-xs"
                            style={{ color: "var(--color-ink-tertiary)" }}
                          >
                            {" / "}
                          </span>
                          <span
                            className="text-xs font-medium"
                            style={{ color: "var(--color-no)" }}
                          >
                            NO {formatAmericanOdds(noOdds)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Set Line input (binary only) */}
                  {!isOU && settingLineId === m.id && (
                    <div className="mb-3 space-y-1">
                      <input
                        type="text"
                        value={lineInput}
                        onChange={(e) => setLineInput(e.target.value)}
                        placeholder="YES odds, e.g. +150 or -110"
                        className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                        style={{
                          backgroundColor: "var(--color-bg)",
                          border: `1px solid ${lineInputError ? "var(--color-danger)" : "var(--color-border)"}`,
                          color: "var(--color-ink-primary)",
                        }}
                      />
                      {lineInputError && (
                        <p
                          className="text-xs"
                          style={{ color: "var(--color-danger)" }}
                        >
                          Invalid format — use e.g. +150, -110, +100
                        </p>
                      )}
                    </div>
                  )}

                  {/* O/U resolve inputs */}
                  {isOU && ouResolvingId === m.id && (
                    <div className="mb-3 space-y-2">
                      <div>
                        <label
                          className="text-xs font-medium block mb-1"
                          style={{ color: "var(--color-ink-secondary)" }}
                        >
                          Actual result value
                        </label>
                        <input
                          type="number"
                          step="0.5"
                          value={ouResultInput}
                          onChange={(e) => setOuResultInput(e.target.value)}
                          placeholder={`e.g. 5 (line was ${m.ou_line} ${m.ou_unit})`}
                          className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                          style={{
                            backgroundColor: "var(--color-bg)",
                            border: "1px solid var(--color-border)",
                            color: "var(--color-ink-primary)",
                          }}
                        />
                      </div>
                      <input
                        type="text"
                        value={ouResolveNote}
                        onChange={(e) => setOuResolveNote(e.target.value)}
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

                  {/* Binary resolution note */}
                  {!isOU && resolving?.id === m.id && (
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
                    {isOU ? (
                      // O/U market actions
                      ouResolvingId === m.id ? (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            className="flex-1"
                            onClick={() => handleOuResolveConfirm(m.id)}
                            isLoading={isPending}
                            disabled={!ouResultValid}
                          >
                            Confirm Result
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setOuResolvingId(null)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            className="flex-1"
                            onClick={() => handleOuResolveOpen(m.id)}
                          >
                            Resolve O/U
                          </Button>
                          {(m.status === "open" || m.status === "closed") && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                handleStatusToggle(
                                  m.id,
                                  m.status as "open" | "closed"
                                )
                              }
                              isLoading={isPending}
                            >
                              {m.status === "open" ? "Close" : "Reopen"}
                            </Button>
                          )}
                        </>
                      )
                    ) : (
                      // Binary market actions
                      settingLineId === m.id ? (
                        <>
                          <Button
                            variant="primary"
                            size="sm"
                            className="flex-1"
                            onClick={() => handleSetLineConfirm(m.id)}
                            isLoading={isPending}
                            disabled={!!lineInputError}
                          >
                            Set Line
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSettingLineId(null)}
                          >
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
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
                          {(m.status === "open" || m.status === "closed") && (
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
                          )}
                          {m.status === "open" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleSetLineOpen(m.id, yesOdds)}
                            >
                              Set Line
                            </Button>
                          )}
                          {resolving?.id === m.id && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setResolving(null)}
                            >
                              Cancel
                            </Button>
                          )}
                        </>
                      )
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
