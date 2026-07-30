"use client";

import { useState, useTransition } from "react";
import { Flag } from "lucide-react";
import { submitIncidentReport } from "@/app/(app)/more/actions";

interface ReportOutcomeFormProps {
  marketId: string;
  marketType: "binary" | "over_under";
  ouUnit: string | null;
}

export function ReportOutcomeForm({
  marketId,
  marketType,
  ouUnit,
}: ReportOutcomeFormProps) {
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [outcome, setOutcome] = useState<string>(
    marketType === "binary" ? "yes" : ""
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const isValid =
    description.trim().length >= 10 &&
    outcome.trim() !== "" &&
    (marketType === "binary"
      ? outcome === "yes" || outcome === "no"
      : !isNaN(parseFloat(outcome)));

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await submitIncidentReport(marketId, description.trim(), outcome.trim());
        setSubmitted(true);
        setOpen(false);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to submit report."
        );
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
        }}
      >
        <p className="text-2xl mb-2">✅</p>
        <p
          className="text-sm font-medium"
          style={{ color: "var(--color-ink-primary)" }}
        >
          Report submitted!
        </p>
        <p
          className="text-xs mt-1"
          style={{ color: "var(--color-ink-tertiary)" }}
        >
          The community can now vote on this report in the Reports tab.
        </p>
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
        data-testid="report-outcome-toggle"
        onClick={() => setOpen((prev) => !prev)}
        className="w-full px-4 py-3 flex items-center justify-between text-left transition-colors duration-150 hover:bg-[var(--color-bg-hover)]"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Flag
            size={14}
            style={{ color: "var(--color-ink-tertiary)" }}
          />
          <span
            className="text-sm font-medium"
            style={{ color: "var(--color-ink-primary)" }}
          >
            Report Outcome
          </span>
        </div>
        <span
          className="text-xs"
          style={{ color: "var(--color-ink-tertiary)" }}
        >
          {open ? "Cancel" : "This event happened →"}
        </span>
      </button>

      {open && (
        <form
          onSubmit={handleSubmit}
          className="px-4 pb-4 space-y-3"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          <p
            className="text-xs pt-3"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            Describe what happened and propose how the market should resolve. The
            community will vote — 4+ votes at 60%+ agreement triggers
            auto-resolution after a 24h admin review window.
          </p>

          {/* Outcome selector */}
          {marketType === "binary" ? (
            <div className="flex gap-2">
              {(["yes", "no"] as const).map((o) => (
                <button
                  key={o}
                  type="button"
                  data-testid={`report-outcome-${o}`}
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
          ) : (
            <div>
              <label
                className="block text-xs font-medium mb-1"
                style={{ color: "var(--color-ink-secondary)" }}
                htmlFor="ou-result"
              >
                Actual result ({ouUnit ?? "value"})
              </label>
              <input
                id="ou-result"
                type="number"
                step="any"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
                placeholder={`e.g. ${ouUnit === "pts" ? "105.5" : "3"}`}
                className="w-full px-3 py-2 rounded-lg text-sm outline-none transition-all duration-150"
                style={{
                  backgroundColor: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-ink-primary)",
                }}
              />
            </div>
          )}

          {/* Description */}
          <div>
            <label
              className="block text-xs font-medium mb-1"
              style={{ color: "var(--color-ink-secondary)" }}
              htmlFor="incident-desc"
            >
              What happened? (10–500 chars)
            </label>
            <textarea
              id="incident-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the event with enough detail for others to verify."
              data-testid="report-description"
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
            <p
              className="text-xs"
              style={{ color: "var(--color-danger)" }}
              role="alert"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            data-testid="report-submit"
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
