"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { CategoryBadge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { approveSuggestion, rejectSuggestion } from "./actions";
import { toast } from "@/components/ui/Toast";
import { ToastContainer } from "@/components/ui/Toast";
import type { MarketSuggestion, Profile } from "@/types/database";

type SuggestionWithProfile = MarketSuggestion & {
  profiles: Pick<Profile, "username" | "avatar_url"> | null;
};

interface AdminSuggestionsProps {
  suggestions: SuggestionWithProfile[];
}

export function AdminSuggestions({ suggestions }: AdminSuggestionsProps) {
  const [isPending, startTransition] = useTransition();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  function handleApprove(id: string) {
    startTransition(async () => {
      try {
        await approveSuggestion(id);
        toast.success("Suggestion approved and market created!");
      } catch {
        toast.error("Failed to approve suggestion.");
      }
    });
  }

  function handleReject(id: string) {
    if (rejectingId === id) {
      startTransition(async () => {
        try {
          await rejectSuggestion(id, rejectNote || undefined);
          toast.success("Suggestion rejected.");
          setRejectingId(null);
          setRejectNote("");
        } catch {
          toast.error("Failed to reject suggestion.");
        }
      });
    } else {
      setRejectingId(id);
      setRejectNote("");
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
          Pending Suggestions{" "}
          {suggestions.length > 0 && (
            <span
              className="ml-1 px-1.5 py-0.5 rounded-full text-xs"
              style={{
                backgroundColor: "var(--color-warning)",
                color: "white",
              }}
            >
              {suggestions.length}
            </span>
          )}
        </h2>

        {suggestions.length === 0 ? (
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
              No pending suggestions. 🎉
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {suggestions.map((s) => (
              <div
                key={s.id}
                className="rounded-xl p-4"
                style={{
                  backgroundColor: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                  boxShadow: "var(--shadow-card)",
                }}
              >
                <div className="flex items-start gap-3 mb-3">
                  <Avatar
                    src={s.profiles?.avatar_url}
                    username={s.profiles?.username}
                    size="xs"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <CategoryBadge category={s.category} />
                      <span
                        className="text-xs"
                        style={{ color: "var(--color-ink-tertiary)" }}
                      >
                        @{s.profiles?.username ?? "unknown"}
                      </span>
                    </div>
                    <p
                      className="text-sm font-semibold"
                      style={{ color: "var(--color-ink-primary)" }}
                    >
                      {s.title}
                    </p>
                    <p
                      className="text-xs mt-0.5"
                      style={{ color: "var(--color-ink-secondary)" }}
                    >
                      {s.description}
                    </p>
                  </div>
                </div>

                {rejectingId === s.id && (
                  <div className="mb-3">
                    <input
                      type="text"
                      value={rejectNote}
                      onChange={(e) => setRejectNote(e.target.value)}
                      placeholder="Rejection note (optional)"
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{
                        backgroundColor: "var(--color-bg)",
                        border: "1px solid var(--color-border)",
                        color: "var(--color-ink-primary)",
                      }}
                    />
                  </div>
                )}

                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleApprove(s.id)}
                    isLoading={isPending}
                  >
                    ✓ Approve
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleReject(s.id)}
                    isLoading={isPending && rejectingId === s.id}
                  >
                    {rejectingId === s.id ? "Confirm Reject" : "✕ Reject"}
                  </Button>
                  {rejectingId === s.id && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRejectingId(null)}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
