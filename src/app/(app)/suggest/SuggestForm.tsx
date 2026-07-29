"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/ui/Toast";
import { ToastContainer } from "@/components/ui/Toast";
import { parseAmericanOdds, formatAmericanOdds } from "@/lib/market-logic";
import type { MarketCategory, MarketType } from "@/types/database";

const CATEGORIES: { value: MarketCategory; label: string; emoji: string }[] = [
  { value: "sports", label: "Sports", emoji: "🏆" },
  { value: "actions", label: "Actions", emoji: "⚡" },
  { value: "social", label: "Social", emoji: "👥" },
];

interface SuggestFormProps {
  userId: string;
}

export function SuggestForm({ userId }: SuggestFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<MarketCategory>("actions");
  const [marketType, setMarketType] = useState<MarketType>("binary");
  // Binary fields
  const [lineInput, setLineInput] = useState("");
  // O/U fields
  const [ouLine, setOuLine] = useState("");
  const [ouUnit, setOuUnit] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const parsedLine = lineInput.trim() ? parseAmericanOdds(lineInput) : null;
  const lineError =
    lineInput.trim() && parsedLine === null
      ? "Enter a valid line, e.g. +150, -110, +100"
      : null;

  const parsedOuLine = ouLine.trim() ? parseFloat(ouLine) : null;
  const ouLineError =
    ouLine.trim() && (isNaN(parsedOuLine ?? NaN) || (parsedOuLine ?? 0) <= 0)
      ? "Enter a positive number, e.g. 3.5"
      : null;

  const isSubmitDisabled =
    !title.trim() ||
    !description.trim() ||
    (marketType === "binary" && !!lineError) ||
    (marketType === "over_under" &&
      (!ouLine.trim() || !!ouLineError || !ouUnit.trim()));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isSubmitDisabled) return;

    setIsLoading(true);
    const supabase = createClient();

    const insertData =
      marketType === "over_under"
        ? {
            user_id: userId,
            title: title.trim(),
            description: description.trim(),
            category,
            market_type: "over_under" as const,
            ou_opening_line: parsedOuLine,
            ou_unit: ouUnit.trim(),
            suggested_yes_odds: 100,
          }
        : {
            user_id: userId,
            title: title.trim(),
            description: description.trim(),
            category,
            market_type: "binary" as const,
            suggested_yes_odds: parsedLine ?? 100,
          };

    const { error } = await supabase
      .from("market_suggestions")
      .insert(insertData);

    if (error) {
      toast.error("Failed to submit suggestion. Please try again.");
      setIsLoading(false);
      return;
    }

    toast.success("Suggestion submitted! An admin will review it.");
    setTitle("");
    setDescription("");
    setCategory("actions");
    setMarketType("binary");
    setLineInput("");
    setOuLine("");
    setOuUnit("");
    router.refresh();
    setIsLoading(false);
  }

  return (
    <>
      <ToastContainer />
      <form
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
            htmlFor="suggest-title"
            className="block text-xs font-medium mb-1.5"
            style={{ color: "var(--color-ink-secondary)" }}
          >
            Market title *
          </label>
          <input
            id="suggest-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Will our team win the championship?"
            maxLength={150}
            required
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all duration-150"
            style={{
              backgroundColor: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-ink-primary)",
            }}
          />
          <p
            className="text-xs mt-1"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            {150 - title.length} characters remaining
          </p>
        </div>

        {/* Description */}
        <div>
          <label
            htmlFor="suggest-description"
            className="block text-xs font-medium mb-1.5"
            style={{ color: "var(--color-ink-secondary)" }}
          >
            Description & resolution criteria *
          </label>
          <textarea
            id="suggest-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={
              marketType === "over_under"
                ? "What is the over/under measuring? What counts as the final value?"
                : "When should this resolve? What counts as YES vs NO?"
            }
            maxLength={500}
            rows={4}
            required
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

        {/* Market type selector */}
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

        {/* Binary: Suggested YES odds */}
        {marketType === "binary" && (
          <div>
            <label
              htmlFor="suggest-line"
              className="block text-xs font-medium mb-1.5"
              style={{ color: "var(--color-ink-secondary)" }}
            >
              Suggested YES odds{" "}
              <span style={{ color: "var(--color-ink-tertiary)" }}>
                (optional)
              </span>
            </label>
            <input
              id="suggest-line"
              type="text"
              value={lineInput}
              onChange={(e) => setLineInput(e.target.value)}
              placeholder="+100 (even), +150 (underdog), -150 (favorite)"
              className="w-full px-3 py-2.5 rounded-xl text-sm outline-none transition-all duration-150"
              style={{
                backgroundColor: "var(--color-bg)",
                border: `1px solid ${
                  lineError ? "var(--color-danger)" : "var(--color-border)"
                }`,
                color: "var(--color-ink-primary)",
              }}
              aria-describedby={lineError ? "line-error" : undefined}
            />
            {lineError ? (
              <p
                id="line-error"
                className="text-xs mt-1"
                style={{ color: "var(--color-danger)" }}
                role="alert"
              >
                {lineError}
              </p>
            ) : parsedLine !== null ? (
              <p
                className="text-xs mt-1"
                style={{ color: "var(--color-ink-tertiary)" }}
              >
                YES: {formatAmericanOdds(parsedLine)} / NO:{" "}
                {formatAmericanOdds(-parsedLine)}
              </p>
            ) : (
              <p
                className="text-xs mt-1"
                style={{ color: "var(--color-ink-tertiary)" }}
              >
                Leave blank for even odds (+100). Admin can adjust before
                approving.
              </p>
            )}
          </div>
        )}

        {/* Over/Under: line + unit */}
        {marketType === "over_under" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="ou-line"
                  className="block text-xs font-medium mb-1.5"
                  style={{ color: "var(--color-ink-secondary)" }}
                >
                  Opening line *
                </label>
                <input
                  id="ou-line"
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
                      ouLineError ? "var(--color-danger)" : "var(--color-border)"
                    }`,
                    color: "var(--color-ink-primary)",
                  }}
                  aria-describedby={ouLineError ? "ou-line-error" : undefined}
                />
                {ouLineError && (
                  <p
                    id="ou-line-error"
                    className="text-xs mt-1"
                    style={{ color: "var(--color-danger)" }}
                    role="alert"
                  >
                    {ouLineError}
                  </p>
                )}
              </div>
              <div>
                <label
                  htmlFor="ou-unit"
                  className="block text-xs font-medium mb-1.5"
                  style={{ color: "var(--color-ink-secondary)" }}
                >
                  Unit *
                </label>
                <input
                  id="ou-unit"
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
                O/U {parsedOuLine} {ouUnit.trim()} · Both sides always +100 (2×
                payout) · Line shifts after every bet
              </p>
            )}
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          size="md"
          className="w-full"
          isLoading={isLoading}
          disabled={isSubmitDisabled}
        >
          Submit Suggestion
        </Button>
      </form>
    </>
  );
}
