"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { ToastContainer } from "@/components/ui/Toast";
import { createMarket } from "./actions";
import { parseAmericanOdds, formatAmericanOdds } from "@/lib/market-logic";
import type { MarketCategory, MarketType } from "@/types/database";

const CATEGORIES: { value: MarketCategory; label: string; emoji: string }[] = [
  { value: "sports", label: "Sports", emoji: "🏆" },
  { value: "actions", label: "Actions", emoji: "⚡" },
  { value: "social", label: "Social", emoji: "👥" },
  { value: "trending", label: "Trending", emoji: "📈" },
];

export function AdminCreateMarket() {
  const formRef = useRef<HTMLFormElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [category, setCategory] = useState<MarketCategory>("actions");
  const [marketType, setMarketType] = useState<MarketType>("binary");
  const [isFeatured, setIsFeatured] = useState(false);

  // Binary-specific
  const [oddsInput, setOddsInput] = useState("");
  // O/U-specific
  const [ouLine, setOuLine] = useState("");
  const [ouUnit, setOuUnit] = useState("");

  const parsedOdds = oddsInput.trim() ? parseAmericanOdds(oddsInput) : null;
  const oddsError =
    oddsInput.trim() && parsedOdds === null
      ? "Enter a valid line, e.g. +150, -110, +100"
      : null;

  const parsedOuLine = ouLine.trim() ? parseFloat(ouLine) : null;
  const ouLineError =
    ouLine.trim() && (isNaN(parsedOuLine ?? NaN) || (parsedOuLine ?? 0) <= 0)
      ? "Enter a positive number, e.g. 3.5"
      : null;

  const isSubmitDisabled =
    isLoading ||
    (marketType === "binary" && !!oddsError) ||
    (marketType === "over_under" &&
      (!ouLine.trim() || !!ouLineError || !ouUnit.trim()));

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsLoading(true);

    const formData = new FormData(e.currentTarget);
    // Inject controlled values that aren't standard form fields
    formData.set("category", category);
    formData.set("market_type", marketType);
    formData.set("is_featured", String(isFeatured));
    if (marketType === "binary") {
      formData.set("initial_odds", String(parsedOdds ?? 100));
    }

    try {
      await createMarket(formData);
      toast.success(
        marketType === "over_under"
          ? `O/U market created! Line: ${parsedOuLine} ${ouUnit.trim()}`
          : "Market created!"
      );
      // Reset form
      formRef.current?.reset();
      setOddsInput("");
      setOuLine("");
      setOuUnit("");
      setCategory("actions");
      setMarketType("binary");
      setIsFeatured(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to create market."
      );
    } finally {
      setIsLoading(false);
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
          Create Market
        </h2>
        <form
          ref={formRef}
          onSubmit={handleSubmit}
          className="rounded-xl p-5 space-y-4"
          style={{
            backgroundColor: "var(--color-bg-card)",
            border: "1px solid var(--color-border)",
            boxShadow: "var(--shadow-card)",
          }}
        >
          {/* Title */}
          <div>
            <label
              htmlFor="create-title"
              className="block text-xs font-medium mb-1.5"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Market title *
            </label>
            <input
              id="create-title"
              name="title"
              type="text"
              required
              maxLength={150}
              placeholder="e.g. Will GDS win the championship?"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all duration-150"
              style={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-ink-primary)",
              }}
            />
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="create-desc"
              className="block text-xs font-medium mb-1.5"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Description & resolution criteria *
            </label>
            <textarea
              id="create-desc"
              name="description"
              required
              maxLength={500}
              rows={3}
              placeholder={
                marketType === "over_under"
                  ? "What is this measuring? What counts as the final value?"
                  : "When does this resolve? What counts as YES vs NO?"
              }
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all duration-150 resize-none"
              style={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-ink-primary)",
              }}
            />
          </div>

          {/* Category */}
          <div>
            <p
              className="block text-xs font-medium mb-2"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Category
            </p>
            <div className="grid grid-cols-2 gap-2">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setCategory(cat.value)}
                  className="flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
                  style={{
                    backgroundColor:
                      category === cat.value
                        ? "var(--color-primary-light)"
                        : "var(--color-bg)",
                    border: `1px solid ${
                      category === cat.value
                        ? "var(--color-primary)"
                        : "var(--color-border)"
                    }`,
                    color:
                      category === cat.value
                        ? "var(--color-primary)"
                        : "var(--color-ink-secondary)",
                  }}
                >
                  <span>{cat.emoji}</span>
                  <span>{cat.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Market type */}
          <div>
            <p
              className="block text-xs font-medium mb-2"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Market type
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMarketType("binary")}
                className="flex flex-col items-start px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
                style={{
                  backgroundColor:
                    marketType === "binary"
                      ? "var(--color-primary-light)"
                      : "var(--color-bg)",
                  border: `1px solid ${
                    marketType === "binary"
                      ? "var(--color-primary)"
                      : "var(--color-border)"
                  }`,
                  color:
                    marketType === "binary"
                      ? "var(--color-primary)"
                      : "var(--color-ink-secondary)",
                }}
              >
                <span className="font-semibold">Yes / No</span>
                <span
                  className="text-xs font-normal mt-0.5"
                  style={{ color: "var(--color-ink-tertiary)" }}
                >
                  Binary outcome
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMarketType("over_under")}
                className="flex flex-col items-start px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150"
                style={{
                  backgroundColor:
                    marketType === "over_under"
                      ? "var(--color-primary-light)"
                      : "var(--color-bg)",
                  border: `1px solid ${
                    marketType === "over_under"
                      ? "var(--color-primary)"
                      : "var(--color-border)"
                  }`,
                  color:
                    marketType === "over_under"
                      ? "var(--color-primary)"
                      : "var(--color-ink-secondary)",
                }}
              >
                <span className="font-semibold">Over / Under</span>
                <span
                  className="text-xs font-normal mt-0.5"
                  style={{ color: "var(--color-ink-tertiary)" }}
                >
                  Moving line, even odds
                </span>
              </button>
            </div>
          </div>

          {/* Binary: YES odds */}
          {marketType === "binary" && (
            <div>
              <label
                htmlFor="create-odds"
                className="block text-xs font-medium mb-1.5"
                style={{ color: "var(--color-ink-secondary)" }}
              >
                Opening YES odds{" "}
                <span style={{ color: "var(--color-ink-tertiary)" }}>
                  (optional, defaults to +100)
                </span>
              </label>
              <input
                id="create-odds"
                type="text"
                value={oddsInput}
                onChange={(e) => setOddsInput(e.target.value)}
                placeholder="+100 (even), +150 (underdog), -150 (favorite)"
                className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all duration-150"
                style={{
                  backgroundColor: "var(--color-bg)",
                  border: `1px solid ${
                    oddsError ? "var(--color-danger)" : "var(--color-border)"
                  }`,
                  color: "var(--color-ink-primary)",
                }}
              />
              {oddsError ? (
                <p
                  className="text-xs mt-1"
                  style={{ color: "var(--color-danger)" }}
                >
                  {oddsError}
                </p>
              ) : parsedOdds !== null ? (
                <p
                  className="text-xs mt-1"
                  style={{ color: "var(--color-ink-tertiary)" }}
                >
                  Will open at YES {formatAmericanOdds(parsedOdds)} / NO{" "}
                  {formatAmericanOdds(-parsedOdds)}
                </p>
              ) : (
                <p
                  className="text-xs mt-1"
                  style={{ color: "var(--color-ink-tertiary)" }}
                >
                  Leave blank for even odds (+100 / +100).
                </p>
              )}
            </div>
          )}

          {/* O/U: line + unit */}
          {marketType === "over_under" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="create-ou-line"
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: "var(--color-ink-secondary)" }}
                  >
                    Opening line *
                  </label>
                  <input
                    id="create-ou-line"
                    name="ou_line"
                    type="number"
                    step="0.5"
                    min="0"
                    value={ouLine}
                    onChange={(e) => setOuLine(e.target.value)}
                    placeholder="3.5"
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all duration-150"
                    style={{
                      backgroundColor: "var(--color-bg)",
                      border: `1px solid ${
                        ouLineError
                          ? "var(--color-danger)"
                          : "var(--color-border)"
                      }`,
                      color: "var(--color-ink-primary)",
                    }}
                  />
                  {ouLineError && (
                    <p
                      className="text-xs mt-1"
                      style={{ color: "var(--color-danger)" }}
                    >
                      {ouLineError}
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor="create-ou-unit"
                    className="block text-xs font-medium mb-1.5"
                    style={{ color: "var(--color-ink-secondary)" }}
                  >
                    Unit *
                  </label>
                  <input
                    id="create-ou-unit"
                    name="ou_unit"
                    type="text"
                    value={ouUnit}
                    onChange={(e) => setOuUnit(e.target.value)}
                    placeholder="pts, goals, etc."
                    maxLength={20}
                    className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all duration-150"
                    style={{
                      backgroundColor: "var(--color-bg)",
                      border: "1px solid var(--color-border)",
                      color: "var(--color-ink-primary)",
                    }}
                  />
                </div>
              </div>
              {parsedOuLine && ouUnit.trim() && !ouLineError && (
                <p
                  className="text-xs px-1"
                  style={{ color: "var(--color-ink-tertiary)" }}
                >
                  O/U {parsedOuLine} {ouUnit.trim()} · Both sides +100 · Line shifts
                  after every bet
                </p>
              )}
            </div>
          )}

          {/* Resolution date */}
          <div>
            <label
              htmlFor="create-date"
              className="block text-xs font-medium mb-1.5"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Resolution date{" "}
              <span style={{ color: "var(--color-ink-tertiary)" }}>
                (optional — market auto-closes on this date)
              </span>
            </label>
            <input
              id="create-date"
              name="resolution_date"
              type="date"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all duration-150"
              style={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-ink-primary)",
              }}
            />
          </div>

          {/* Featured */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              role="checkbox"
              aria-checked={isFeatured}
              onClick={() => setIsFeatured((v) => !v)}
              className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-all duration-150"
              style={{
                backgroundColor: isFeatured
                  ? "var(--color-primary)"
                  : "var(--color-bg)",
                border: `1.5px solid ${
                  isFeatured ? "var(--color-primary)" : "var(--color-border)"
                }`,
              }}
            >
              {isFeatured && (
                <svg
                  width="10"
                  height="8"
                  viewBox="0 0 10 8"
                  fill="none"
                >
                  <path
                    d="M1 4L3.5 6.5L9 1"
                    stroke="white"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
            <span
              className="text-sm"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Feature this market (pinned to top of dashboard)
            </span>
          </div>

          <Button
            type="submit"
            variant="primary"
            size="md"
            className="w-full"
            isLoading={isLoading}
            disabled={isSubmitDisabled}
          >
            Create Market
          </Button>
        </form>
      </section>
    </>
  );
}
