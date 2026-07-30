"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { Send } from "lucide-react";
import { sendLeagueMessage } from "./actions";
import { formatRelativeTime, formatDisplayName } from "@/lib/utils";
import { Avatar } from "@/components/ui/Avatar";
import { createClient } from "@/lib/supabase/client";
import type { LeagueMessageWithProfile } from "@/types/database";

interface LeagueChatProps {
  leagueId: string;
  currentUserId: string;
  initialMessages: LeagueMessageWithProfile[];
}

export function LeagueChat({
  leagueId,
  currentUserId,
  initialMessages,
}: LeagueChatProps) {
  const [messages, setMessages] =
    useState<LeagueMessageWithProfile[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Scroll to bottom whenever messages change
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  // Realtime subscription — receive messages from other members live
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`league-chat-${leagueId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "league_messages",
          filter: `league_id=eq.${leagueId}`,
        },
        async (payload) => {
          // Skip messages sent by the current user (already added optimistically)
          if (payload.new.user_id === currentUserId) return;

          // Fetch the sender's profile so we can display their name/avatar
          const { data: profile } = await supabase
            .from("profiles")
            .select("username, display_name, avatar_url")
            .eq("id", payload.new.user_id)
            .single();

          const incoming: LeagueMessageWithProfile = {
            id: payload.new.id,
            league_id: payload.new.league_id,
            user_id: payload.new.user_id,
            body: payload.new.body,
            created_at: payload.new.created_at,
            profiles: profile ?? { username: null, display_name: null, avatar_url: null },
          };
          setMessages((prev) => [...prev, incoming]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, currentUserId]);

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const body = input.trim();
    if (!body) return;

    setError(null);
    setInput("");

    // Optimistic update
    const optimistic: LeagueMessageWithProfile = {
      id: `optimistic-${Date.now()}`,
      league_id: leagueId,
      user_id: currentUserId,
      body,
      created_at: new Date().toISOString(),
      profiles: { username: null, display_name: null, avatar_url: null },
    };
    setMessages((prev) => [...prev, optimistic]);

    startTransition(async () => {
      try {
        await sendLeagueMessage(leagueId, body);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send.");
        // Remove the optimistic message on failure
        setMessages((prev) =>
          prev.filter((m) => m.id !== optimistic.id)
        );
        setInput(body);
      }
    });
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
      {/* Header */}
      <div
        className="px-4 py-3"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <h2
          className="font-semibold text-sm"
          style={{ color: "var(--color-ink-primary)" }}
        >
          League Chat
        </h2>
      </div>

      {/* Message list */}
      <div
        ref={listRef}
        className="h-64 overflow-y-auto px-4 py-3 space-y-3"
        style={{ scrollBehavior: "smooth" }}
      >
        {messages.length === 0 ? (
          <p
            className="text-xs text-center py-8"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            No messages yet. Say something!
          </p>
        ) : (
          messages.map((msg) => {
            const isMe = msg.user_id === currentUserId;
            const name = formatDisplayName(
              msg.profiles?.display_name,
              msg.profiles?.username
            );
            return (
              <div
                key={msg.id}
                data-testid="league-chat-message"
                className={`flex items-end gap-2 ${isMe ? "flex-row-reverse" : ""}`}
              >
                {!isMe && (
                  <Avatar
                    src={msg.profiles?.avatar_url}
                    displayName={msg.profiles?.display_name}
                    username={msg.profiles?.username}
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
                  <div
                    className="px-3 py-2 rounded-xl text-xs leading-snug"
                    style={{
                      backgroundColor: isMe
                        ? "var(--color-primary)"
                        : "var(--color-bg)",
                      color: isMe ? "white" : "var(--color-ink-primary)",
                      border: isMe
                        ? "none"
                        : "1px solid var(--color-border)",
                    }}
                  >
                    {msg.body}
                  </div>
                  <time
                    className="text-[10px] mt-0.5 px-1"
                    style={{ color: "var(--color-ink-tertiary)" }}
                    dateTime={msg.created_at}
                  >
                    {formatRelativeTime(msg.created_at)}
                  </time>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Input */}
      <div style={{ borderTop: "1px solid var(--color-border)" }}>
        {error && (
          <p
            className="text-xs px-4 pt-2"
            style={{ color: "var(--color-danger)" }}
            role="alert"
          >
            {error}
          </p>
        )}
        <form onSubmit={handleSend} className="flex items-center gap-2 p-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send a message…"
            data-testid="league-chat-input"
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
              cursor:
                !input.trim() || isPending ? "not-allowed" : "pointer",
            }}
            aria-label="Send message"
            data-testid="league-chat-send"
          >
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );
}
