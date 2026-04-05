"use client";

import { useState, useTransition } from "react";
import { Flag } from "lucide-react";
import { submitIncidentReport } from "./actions";
import type { Market } from "@/types/database";

interface SubmitReportFormProps {
  markets: Pick<Market, "id" | "title" | "market_type" | "ou_unit">[];
}

export function SubmitReportForm({ markets }: SubmitReportFormProps) {
  const [open, setOpen] = useState(false);
  const [selectedMarketId, setSelectedMarketId] = useState("");
  const [description, setDescription] = useState("");
  const [outcome, setOutcome] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const selectedMarket = markets.find((m) => m.id === selectedMarketId) ?? null;

  const isValid =
    selectedMarketId !== "" &&
    description.trim().length >= 10 &&
    outcome.trim() !== "" &&
    (selectedMarket?.market_type === "binary"
      ? outcome === "yes" || outcome === "no"
      : !isNaN(parseFloat(outcome)));

  function handleMarketChange(id: string) {
    setSelectedMarketId(id);
    // Reset outcome when market changes
    const market = markets.find((m) => m.id === id);
    setOutcome(market?.market_type === "binary" ? "yes" : "");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await submitIncidentReport(selectedMarketId, description.trim(), outcome.trim());
        setSubmitted(true);
        setOpen(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to submit report.");
      }
    });
  }

  if (submitted) {
    return (
      <div
        className="rounded-xl p-4 text-center"
        style={{
          backgroundColor: "var(--color-bg-card)",
          border: "1px solid var(--color-border)",
          boxShadow: "var(--shadow-card)",
        }}
      >
        <p className="text-2xl mb-2">✅</p>
        <p className="text-sm font-medium" style={{ color: "var(--color-ink-primary)" }}>
          Report submitted!
        </p>
        <p className="text-xs mt-1" style={{ color: "var(--color-ink-tertiary)" }}>
          The community can now vote on this report below.
        </p>
        <button
          onClick={() => { setSubmitted(false); setSelectedMarketId(""); setDescription(""); setOutcome(""); }}
          className="mt-3 text-xs font-medium"
          style={{ color: "var(--color-primary)" }}
        >
          Submit another
        </button>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="w-full px-4 py-3 flex items-center justify-between text-left transition-colors duration-150 hover:bg-[var(--color-bg-hover)]"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Flag size={14} style={{ color: "var(--color-ink-tertiary)" }} />
          <span className="text-sm font-medium" style={{ color: "var(--color-ink-primary)" }}>
            Report an Outcome
          </span>
        </div>
        <span className="text-xs" style={{ color: "var(--color-ink-tertiary)" }}>
          {open ? "Cancel" : "An event happened →"}
        </span>
      </button>

      {open && (
        <form
          onSubmit={handleSubmit}
          className="px-4 pb-4 space-y-3"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          <p className="text-xs pt-3" style={{ color: "var(--color-ink-tertiary)" }}>
            Select a market, describe what happened, and propose the outcome. The
            community votes — 4+ votes at 60%+ triggers auto-resolution after a 24h admin review.
          </p>

          {/* Market selector */}
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: "var(--color-ink-secondary)" }}
              htmlFor="report-market"
            >
              Market
            </label>
            <select
              id="report-market"
              value={selectedMarketId}
              onChange={(e) => handleMarketChange(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-all duration-150"
              style={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: selectedMarketId ? "var(--color-ink-primary)" : "var(--color-ink-tertiary)",
              }}
            >
              <option value="">Select a market…</option>
              {markets.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.title}
                </option>
              ))}
            </select>
          </div>

          {/* Outcome selector — only shown once a market is selected */}
          {selectedMarket && (
            selectedMarket.market_type === "binary" ? (
              <div>
                <p
                  className="text-xs font-medium mb-1.5"
                  style={{ color: "var(--color-ink-secondary)" }}
                >
                  Proposed outcome
                </p>
                <div className="flex gap-2">
                  {(["yes", "no"] as const).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setOutcome(o)}
                      className="flex-1 py-2 rounded-lg text-sm font-semibold transition-all duration-150"
                      style={{
                        backgroundColor:
                          outcome === o
                            ? o === "yes"
                              ? "var(--color-yes-bg)"
                              : "var(--color-no-bg)"
                            : "var(--color-bg)",
                        color:
                          outcome === o
                            ? o === "yes"
                              ? "var(--color-yes)"
                              : "var(--color-no)"
                            : "var(--color-ink-secondary)",
                        border: `1px solid ${
                          outcome === o
                            ? o === "yes"
                              ? "var(--color-yes)"
                              : "var(--color-no)"
                            : "var(--color-border)"
                        }`,
                      }}
                    >
                      {o.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <label
                  className="block text-xs font-medium mb-1"
                  style={{ color: "var(--color-ink-secondary)" }}
                  htmlFor="report-ou-result"
                >
                  Actual result ({selectedMarket.ou_unit ?? "value"})
                </label>
                <input
                  id="report-ou-result"
                  type="number"
                  step="any"
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  placeholder={`e.g. ${selectedMarket.ou_unit === "pts" ? "105.5" : "3"}`}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-all duration-150"
                  style={{
                    backgroundColor: "var(--color-bg)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-ink-primary)",
                  }}
                />
              </div>
            )
          )}

          {/* Description */}
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: "var(--color-ink-secondary)" }}
              htmlFor="report-desc"
            >
              What happened? (10–500 chars)
            </label>
            <textarea
              id="report-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the event with enough detail for others to verify."
              rows={3}
              maxLength={500}
              className="w-full px-3 py-2 rounded-lg text-sm outline-none resize-none transition-all duration-150"
              style={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-ink-primary)",
              }}
            />
            <p
              className="text-[10px] text-right mt-0.5"
              style={{ color: "var(--color-ink-tertiary)" }}
            >
              {description.length}/500
            </p>
          </div>

          {error && (
            <p className="text-xs" style={{ color: "var(--color-danger)" }} role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={!isValid || isPending}
            className="w-full py-2.5 px-4 rounded-lg text-sm font-semibold text-white transition-all duration-150"
            style={{
              backgroundColor: "var(--color-primary)",
              opacity: !isValid || isPending ? 0.5 : 1,
              cursor: !isValid || isPending ? "not-allowed" : "pointer",
            }}
          >
            {isPending ? "Submitting…" : "Submit Report"}
          </button>
        </form>
      )}
    </div>
  );
}
