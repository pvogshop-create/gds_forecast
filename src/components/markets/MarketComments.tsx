"use client";

import {
  useState,
  useTransition,
  useRef,
  useEffect,
  useCallback,
} from "react";
import { Send, Trash2, MessageSquare } from "lucide-react";
import { postComment, deleteComment } from "@/app/(app)/market/[id]/actions";
import { formatRelativeTime, formatDisplayName } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { createClient } from "@/lib/supabase/client";
import type { MarketCommentWithProfile } from "@/types/database";

interface MentionSuggestion {
  username: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface MarketCommentsProps {
  marketId: string;
  currentUserId: string;
  currentUsername: string | null;
  initialComments: MarketCommentWithProfile[];
}

export function MarketComments({
  marketId,
  currentUserId,
  currentUsername,
  initialComments,
}: MarketCommentsProps) {
  const [comments, setComments] =
    useState<MarketCommentWithProfile[]>(initialComments);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // @mention autocomplete state
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  // Exposed to the DOM so an E2E test can wait for the realtime channel to be
  // live before triggering the event it expects to receive. Subscribing is
  // asynchronous and finishes after mount, so "the page rendered" is not the
  // same as "this client will receive INSERTs" — acting too early drops the
  // event and the test fails intermittently.
  const [realtimeReady, setRealtimeReady] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scroll to bottom when comments change
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [comments]);

  // Realtime subscription for new comments from other users
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`market-comments-${marketId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "market_comments",
          filter: `market_id=eq.${marketId}`,
        },
        async (payload) => {
          // Skip own comments — already added optimistically
          if (payload.new.user_id === currentUserId) return;

          const { data: profile } = await supabase
            .from("profiles")
            .select("username, display_name, avatar_url")
            .eq("id", payload.new.user_id)
            .single();

          const incoming: MarketCommentWithProfile = {
            id: payload.new.id,
            market_id: payload.new.market_id,
            user_id: payload.new.user_id,
            body: payload.new.body,
            created_at: payload.new.created_at,
            profiles: profile ?? {
              username: null,
              display_name: null,
              avatar_url: null,
            },
          };
          setComments((prev) => [...prev, incoming]);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "market_comments",
          filter: `market_id=eq.${marketId}`,
        },
        (payload) => {
          setComments((prev) => prev.filter((c) => c.id !== payload.old.id));
        }
      )
      .subscribe((status) => {
        setRealtimeReady(status === "SUBSCRIBED");
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [marketId, currentUserId]);

  // ── @mention autocomplete ──────────────────────────────────────────────────
  const fetchSuggestions = useCallback(async (partial: string) => {
    if (!partial) {
      setSuggestions([]);
      setSuggestionsOpen(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/users/search?q=${encodeURIComponent(partial)}`
      );
      if (!res.ok) return;
      const data: MentionSuggestion[] = await res.json();
      setSuggestions(data);
      setSuggestionsOpen(data.length > 0);
    } catch {
      // Autocomplete failure is non-critical
    }
  }, []);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setInput(value);

    // Detect `@partial` at end of current text
    const mentionMatch = /@(\w*)$/.exec(value);
    if (mentionMatch) {
      const partial = mentionMatch[1] ?? "";
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchSuggestions(partial), 300);
    } else {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSuggestions([]);
      setSuggestionsOpen(false);
    }
  }

  function handleSelectSuggestion(username: string) {
    // Replace the trailing @partial with @username + space
    const replaced = input.replace(/@(\w*)$/, `@${username} `);
    setInput(replaced);
    setSuggestionsOpen(false);
    setSuggestions([]);
    inputRef.current?.focus();
  }

  function closeSuggestions() {
    setSuggestionsOpen(false);
    setSuggestions([]);
  }

  // ── Send comment ────────────────────────────────────────────────────────────
  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = input.trim();
    if (!body) return;

    closeSuggestions();
    setError(null);
    setInput("");

    const optimistic: MarketCommentWithProfile = {
      id: `optimistic-${Date.now()}`,
      market_id: marketId,
      user_id: currentUserId,
      body,
      created_at: new Date().toISOString(),
      profiles: { username: currentUsername, display_name: null, avatar_url: null },
    };
    setComments((prev) => [...prev, optimistic]);

    startTransition(async () => {
      try {
        await postComment(marketId, body);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to post comment.");
        setComments((prev) => prev.filter((c) => c.id !== optimistic.id));
        setInput(body);
      }
    });
  }

  // ── Delete comment ──────────────────────────────────────────────────────────
  function handleDelete(commentId: string) {
    setDeletingId(commentId);
    startTransition(async () => {
      try {
        await deleteComment(commentId, marketId);
        setComments((prev) => prev.filter((c) => c.id !== commentId));
      } catch {
        setError("Failed to delete comment.");
      } finally {
        setDeletingId(null);
      }
    });
  }

  // ── Render helper: highlight @mentions in body ─────────────────────────────
  // On own messages (primary background) mentions must be white; on others use primary color.
  function renderBody(body: string, isMe: boolean) {
    const parts = body.split(/(@\w+)/g);
    return parts.map((part, i) =>
      /^@\w+$/.test(part) ? (
        <span
          key={i}
          className="font-semibold"
          style={{ color: isMe ? "rgba(255,255,255,0.9)" : "var(--color-primary)" }}
        >
          {part}
        </span>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  }

  return (
    <div
      data-realtime-ready={realtimeReady}
      className="rounded-xl overflow-hidden"
      style={{
        backgroundColor: "var(--color-bg-card)",
        border: "1px solid var(--color-border)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center gap-2"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <MessageSquare size={14} style={{ color: "var(--color-ink-tertiary)" }} />
        <h2
          className="font-semibold text-sm"
          style={{ color: "var(--color-ink-primary)" }}
        >
          Comments
        </h2>
        {comments.length > 0 && (
          <span
            className="text-xs px-1.5 py-0.5 rounded-full font-medium"
            style={{
              backgroundColor: "var(--color-bg)",
              color: "var(--color-ink-tertiary)",
              border: "1px solid var(--color-border)",
            }}
          >
            {comments.length}
          </span>
        )}
      </div>

      {/* Comment list */}
      <div
        ref={listRef}
        data-testid="comments-list"
        data-count={comments.length}
        className="overflow-y-auto px-4 py-3 space-y-3"
        style={{ maxHeight: "20rem", scrollBehavior: "smooth" }}
      >
        {comments.length === 0 ? (
          <p
            className="text-xs text-center py-8"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            <span data-testid="comments-empty">No comments yet. Be the first!</span>
          </p>
        ) : (
          comments.map((comment) => {
            const isMe = comment.user_id === currentUserId;
            const name = formatDisplayName(
              comment.profiles?.display_name,
              comment.profiles?.username
            );
            const isDeleting = deletingId === comment.id;

            return (
              <div
                key={comment.id}
                data-testid="comment"
                data-comment-id={comment.id}
                data-mine={isMe}
                className={`flex items-end gap-2 group ${isMe ? "flex-row-reverse" : ""}`}
                style={{ opacity: isDeleting ? 0.5 : 1 }}
              >
                {!isMe && (
                  <Avatar
                    src={comment.profiles?.avatar_url}
                    displayName={comment.profiles?.display_name}
                    username={comment.profiles?.username}
                    size="sm"
                  />
                )}
                <div
                  className={`max-w-[75%] flex flex-col ${isMe ? "items-end" : "items-start"}`}
                >
                  {!isMe && (
                    <span
                      className="text-[10px] font-medium mb-0.5 px-1"
                      style={{ color: "var(--color-ink-tertiary)" }}
                    >
                      {name}
                    </span>
                  )}
                  <div className={`flex items-end gap-1 ${isMe ? "flex-row-reverse" : ""}`}>
                    <div
                      className="px-3 py-2 rounded-xl text-xs leading-snug"
                      style={{
                        backgroundColor: isMe
                          ? "var(--color-primary)"
                          : "var(--color-bg)",
                        color: isMe ? "white" : "var(--color-ink-primary)",
                        border: isMe ? "none" : "1px solid var(--color-border)",
                        wordBreak: "break-word",
                      }}
                    >
                      {renderBody(comment.body, isMe)}
                    </div>
                    {/* Delete button — only on own comments, visible on hover */}
                    {isMe && !comment.id.startsWith("optimistic-") && (
                      <button
                        onClick={() => handleDelete(comment.id)}
                        disabled={isDeleting}
                        className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 p-1 rounded"
                        style={{ color: "var(--color-danger)" }}
                        aria-label="Delete comment"
                        data-testid="comment-delete"
                        title="Delete comment"
                      >
                        <Trash2 size={10} />
                      </button>
                    )}
                  </div>
                  <time
                    className="text-[10px] mt-0.5 px-1"
                    style={{ color: "var(--color-ink-tertiary)" }}
                    dateTime={comment.created_at}
                  >
                    {formatRelativeTime(comment.created_at)}
                  </time>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input area */}
      <div
        className="relative"
        style={{ borderTop: "1px solid var(--color-border)" }}
      >
        {error && (
          <p
            className="text-xs px-4 pt-2"
            style={{ color: "var(--color-danger)" }}
            role="alert"
            data-testid="comment-error"
          >
            {error}
          </p>
        )}

        {/* @mention autocomplete dropdown */}
        {suggestionsOpen && suggestions.length > 0 && (
          <div
            data-testid="mention-dropdown"
            className="absolute bottom-full left-3 right-3 mb-1 rounded-xl overflow-hidden z-10"
            style={{
              backgroundColor: "var(--color-bg-card)",
              border: "1px solid var(--color-border)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            {suggestions.map((s) => (
              <button
                key={s.username}
                data-testid="mention-option"
                data-username={s.username ?? ""}
                type="button"
                onMouseDown={(e) => {
                  // Use mousedown instead of click so it fires before the input's blur
                  e.preventDefault();
                  handleSelectSuggestion(s.username ?? "");
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs transition-colors duration-100"
                style={{ color: "var(--color-ink-primary)" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                    "var(--color-bg)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                    "transparent";
                }}
              >
                <Avatar
                  src={s.avatar_url}
                  displayName={s.display_name}
                  username={s.username}
                  size="xs"
                />
                <span className="font-medium">@{s.username}</span>
                {s.display_name && (
                  <span style={{ color: "var(--color-ink-tertiary)" }}>
                    {s.display_name}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}

        <form onSubmit={handleSend} className="flex items-center gap-2 p-3">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={handleInputChange}
            onBlur={() => {
              // Slight delay so mousedown on suggestion fires first
              setTimeout(closeSuggestions, 150);
            }}
            placeholder="Add a comment… use @username to tag someone"
            data-testid="comment-input"
            maxLength={500}
            className="flex-1 px-3 py-2 rounded-lg text-sm outline-none transition-all duration-150"
            style={{
              backgroundColor: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              color: "var(--color-ink-primary)",
            }}
          />
          <button
            type="submit"
            disabled={!input.trim() || isPending}
            className="flex-shrink-0 p-2 rounded-lg transition-all duration-150"
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
            data-testid="comment-submit"
          >
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );
}
