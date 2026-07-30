"use client";

import { useTransition } from "react";
import { ThumbsUp, ThumbsDown } from "lucide-react";
import { castIncidentVote } from "./actions";

interface IncidentVoteButtonsProps {
  reportId: string;
  userVote: boolean | null; // null = not voted yet
  isReporter: boolean;
  isOpen: boolean; // true when status === 'voting'
}

export function IncidentVoteButtons({
  reportId,
  userVote,
  isReporter,
  isOpen,
}: IncidentVoteButtonsProps) {
  const [isPending, startTransition] = useTransition();
  const disabled = !isOpen || isReporter || isPending;

  function handleVote(agrees: boolean) {
    startTransition(async () => {
      try {
        await castIncidentVote(reportId, agrees);
      } catch {
        // errors are surfaced via page re-render
      }
    });
  }

  if (isReporter) {
    return (
      <span
        className="text-xs italic"
        style={{ color: "var(--color-ink-tertiary)" }}
      >
        You reported this
      </span>
    );
  }

  if (!isOpen) {
    return null;
  }

  return (
    <div className="flex gap-2">
      <button
        onClick={() => handleVote(true)}
        disabled={disabled || userVote === true}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150"
        style={{
          backgroundColor:
            userVote === true ? "var(--color-yes-bg)" : "var(--color-bg)",
          color:
            userVote === true ? "var(--color-yes)" : "var(--color-ink-secondary)",
          border: `1px solid ${userVote === true ? "var(--color-yes)" : "var(--color-border)"}`,
          opacity: isPending ? 0.6 : 1,
          cursor: disabled && userVote !== true ? "not-allowed" : "pointer",
        }}
        aria-label="Agree — this incident happened"
        data-testid="incident-vote-agree"
      >
        <ThumbsUp size={11} />
        Agree
      </button>
      <button
        onClick={() => handleVote(false)}
        disabled={disabled || userVote === false}
        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150"
        style={{
          backgroundColor:
            userVote === false ? "var(--color-no-bg)" : "var(--color-bg)",
          color:
            userVote === false ? "var(--color-no)" : "var(--color-ink-secondary)",
          border: `1px solid ${userVote === false ? "var(--color-no)" : "var(--color-border)"}`,
          opacity: isPending ? 0.6 : 1,
          cursor: disabled && userVote !== false ? "not-allowed" : "pointer",
        }}
        aria-label="Disagree — this incident did not happen"
        data-testid="incident-vote-disagree"
      >
        <ThumbsDown size={11} />
        Disagree
      </button>
    </div>
  );
}
