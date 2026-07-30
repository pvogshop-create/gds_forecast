"use client";

import { useEffect, useState, useCallback } from "react";

const EMOJIS = ["🔥", "🎯", "🤔", "💰", "✅"] as const;
type Emoji = (typeof EMOJIS)[number];

interface Reaction {
  emoji: Emoji;
  count: number;
  reacted: boolean;
}

interface MarketReactionsProps {
  marketId: string;
  currentUserId: string | null;
}

export function MarketReactions({ marketId, currentUserId }: MarketReactionsProps) {
  const [reactions, setReactions] = useState<Reaction[]>(
    EMOJIS.map((emoji) => ({ emoji, count: 0, reacted: false }))
  );
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<Emoji | null>(null);

  const fetchReactions = useCallback(async () => {
    try {
      const res = await fetch(`/api/markets/${marketId}/reactions`);
      if (!res.ok) return;
      const json = (await res.json()) as { reactions: Reaction[] };
      setReactions(json.reactions);
    } catch {
      // Non-critical — silently ignore fetch failures for reactions
    } finally {
      setLoading(false);
    }
  }, [marketId]);

  useEffect(() => {
    fetchReactions();
  }, [fetchReactions]);

  async function handleToggle(emoji: Emoji) {
    if (!currentUserId || toggling) return;

    // Optimistic update
    setReactions((prev) =>
      prev.map((r) =>
        r.emoji === emoji
          ? { ...r, count: r.reacted ? r.count - 1 : r.count + 1, reacted: !r.reacted }
          : r
      )
    );
    setToggling(emoji);

    try {
      const res = await fetch(`/api/markets/${marketId}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      });
      if (res.ok) {
        const json = (await res.json()) as { emoji: Emoji; count: number; reacted: boolean };
        // Sync server state
        setReactions((prev) =>
          prev.map((r) =>
            r.emoji === json.emoji ? { ...r, count: json.count, reacted: json.reacted } : r
          )
        );
      } else {
        // Revert on error
        await fetchReactions();
      }
    } catch {
      await fetchReactions();
    } finally {
      setToggling(null);
    }
  }

  if (loading) return null;

  // Don't render if all counts are 0 and user is not logged in (nothing to show)
  const hasAnyReaction = reactions.some((r) => r.count > 0);
  if (!hasAnyReaction && !currentUserId) return null;

  return (
    <div
      className="flex items-center gap-1 flex-wrap pt-2"
      style={{ borderTop: "1px solid var(--color-border)" }}
      data-testid="reactions"
    >
      {reactions.map(({ emoji, count, reacted }) => (
        <button
          key={emoji}
          type="button"
          disabled={!currentUserId || toggling === emoji}
          onClick={() => handleToggle(emoji as Emoji)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs transition-all duration-150 hover:scale-105 active:scale-95 disabled:cursor-default"
          style={{
            backgroundColor: reacted
              ? "var(--color-primary-light)"
              : "var(--color-bg)",
            border: `1px solid ${reacted ? "var(--color-primary)" : "var(--color-border)"}`,
            opacity: !currentUserId ? 0.7 : 1,
          }}
          aria-label={`React with ${emoji}${count > 0 ? `, ${count} reactions` : ""}`}
          aria-pressed={reacted}
          data-testid="reaction-button"
          data-emoji={emoji}
          data-count={count}
          data-reacted={reacted}
        >
          <span>{emoji}</span>
          {count > 0 && (
            <span
              className="font-medium tabular-nums"
              style={{ color: reacted ? "var(--color-primary)" : "var(--color-ink-secondary)" }}
            >
              {count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
