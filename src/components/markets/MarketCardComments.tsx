"use client";

import { useState, useEffect, useTransition } from "react";
import { Send, MessageSquare } from "lucide-react";
import { postComment } from "@/app/(app)/market/[id]/actions";
import { formatDisplayName } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { createClient } from "@/lib/supabase/client";
import type { MarketCommentWithProfile } from "@/types/database";

interface MarketCardCommentsProps {
  marketId: string;
  currentUserId: string | null;
  currentUsername?: string | null;
}

export function MarketCardComments({
  marketId,
  currentUserId,
  currentUsername,
}: MarketCardCommentsProps) {
  const [comments, setComments] = useState<MarketCommentWithProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Fetch last 3 comments on mount
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("market_comments")
      .select(
        "id, market_id, user_id, body, created_at, profiles(username, display_name, avatar_url)",
        { count: "exact" }
      )
      .eq("market_id", marketId)
      .order("created_at", { ascending: false })
      .limit(3)
      .then(({ data, count }) => {
        // Reverse so oldest appears first (top → bottom)
        setComments(
          ((data ?? []) as unknown as MarketCommentWithProfile[]).reverse()
        );
        setTotal(count ?? 0);
      });
  }, [marketId]);

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = input.trim();
    if (!body || !currentUserId) return;

    setError(null);
    setInput("");

    const optimistic: MarketCommentWithProfile = {
      id: `optimistic-${Date.now()}`,
      market_id: marketId,
      user_id: currentUserId,
      body,
      created_at: new Date().toISOString(),
      profiles: {
        username: currentUsername ?? null,
        display_name: null,
        avatar_url: null,
      },
    };
    setComments((prev) => [...prev.slice(-2), optimistic]);
    setTotal((prev) => prev + 1);

    startTransition(async () => {
      try {
        await postComment(marketId, body);
      } catch {
        setError("Failed to post.");
        setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
        setTotal((prev) => prev - 1);
        setInput(body);
      }
    });
  }

  const showViewAll = total > 3;

  return (
    <div
      className="mt-3 pt-3"
      style={{ borderTop: "1px solid var(--color-border)" }}
    >
      {/* View-all link + comment count */}
      {(total > 0 || showViewAll) && (
        <div className="flex items-center gap-1.5 mb-2">
          <MessageSquare
            size={11}
            style={{ color: "var(--color-ink-tertiary)" }}
          />
          <a
            href={`/market/${marketId}`}
            className="text-xs transition-colors duration-150 hover:underline"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            {showViewAll ? `View all ${total} comments` : `${total} comment${total !== 1 ? "s" : ""}`}
          </a>
        </div>
      )}

      {/* Recent comments (max 3) */}
      {comments.length > 0 && (
        <div className="space-y-1.5 mb-2.5">
          {comments.map((comment) => {
            const isMe = comment.user_id === currentUserId;
            const name = formatDisplayName(
              comment.profiles?.display_name,
              comment.profiles?.username
            );

            return (
              <div key={comment.id} className="flex items-start gap-1.5">
                {!isMe && (
                  <Avatar
                    src={comment.profiles?.avatar_url}
                    displayName={comment.profiles?.display_name}
                    username={comment.profiles?.username}
                    size="xs"
                  />
                )}
                <p
                  className="text-xs leading-snug flex-1 min-w-0"
                  style={{ color: "var(--color-ink-primary)" }}
                >
                  {!isMe && (
                    <span
                      className="font-semibold mr-1"
                      style={{ color: "var(--color-ink-secondary)" }}
                    >
                      {name}
                    </span>
                  )}
                  {renderBody(comment.body)}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Inline comment input (only for logged-in users) */}
      {currentUserId ? (
        <>
          {error && (
            <p
              className="text-xs mb-1"
              style={{ color: "var(--color-danger)" }}
            >
              {error}
            </p>
          )}
          <form onSubmit={handleSend} className="flex items-center gap-1.5">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Add a comment…"
              maxLength={500}
              className="flex-1 px-2.5 py-1.5 rounded-lg text-xs outline-none transition-all duration-150"
              style={{
                backgroundColor: "var(--color-bg)",
                border: "1px solid var(--color-border)",
                color: "var(--color-ink-primary)",
              }}
            />
            <button
              type="submit"
              disabled={!input.trim() || isPending}
              className="flex-shrink-0 p-1.5 rounded-lg transition-all duration-150"
              style={{
                backgroundColor:
                  input.trim() && !isPending
                    ? "var(--color-primary)"
                    : "var(--color-bg)",
                color:
                  input.trim() && !isPending
                    ? "white"
                    : "var(--color-ink-tertiary)",
                border: "1px solid var(--color-border)",
                opacity: isPending ? 0.6 : 1,
                cursor: !input.trim() || isPending ? "not-allowed" : "pointer",
              }}
              aria-label="Post comment"
            >
              <Send size={11} />
            </button>
          </form>
        </>
      ) : (
        <a
          href={`/market/${marketId}`}
          className="text-xs transition-colors duration-150 hover:underline"
          style={{ color: "var(--color-ink-tertiary)" }}
        >
          Sign in to comment
        </a>
      )}
    </div>
  );
}

// Highlight @mentions in comment body (plain text, no bubble context)
function renderBody(body: string) {
  const parts = body.split(/(@\w+)/g);
  return parts.map((part, i) =>
    /^@\w+$/.test(part) ? (
      <span key={i} className="font-semibold" style={{ color: "var(--color-primary)" }}>
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}
