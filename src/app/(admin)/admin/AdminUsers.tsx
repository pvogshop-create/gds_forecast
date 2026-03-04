"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/Button";
import { Avatar } from "@/components/ui/Avatar";
import { adjustUserBalance } from "./actions";
import { toast } from "@/components/ui/Toast";
import { ToastContainer } from "@/components/ui/Toast";
import { formatCoins, formatWinRate } from "@/lib/utils";
import type { Profile } from "@/types/database";

type UserRow = Pick<
  Profile,
  "id" | "username" | "display_name" | "avatar_url" | "coins" | "total_bets" | "wins"
>;

interface AdminUsersProps {
  users: UserRow[];
}

export function AdminUsers({ users }: AdminUsersProps) {
  const [isPending, startTransition] = useTransition();
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  function handleAdjust(userId: string) {
    if (adjustingId === userId) {
      const parsed = parseInt(amount, 10);
      if (isNaN(parsed) || parsed === 0) {
        toast.error("Enter a non-zero integer amount (negative to deduct).");
        return;
      }
      if (!reason.trim()) {
        toast.error("A reason is required.");
        return;
      }
      startTransition(async () => {
        try {
          await adjustUserBalance(userId, parsed, reason.trim());
          toast.success(
            `${parsed > 0 ? "Added" : "Deducted"} ${formatCoins(Math.abs(parsed))} coins.`
          );
          setAdjustingId(null);
          setAmount("");
          setReason("");
        } catch {
          toast.error("Failed to adjust balance.");
        }
      });
    } else {
      setAdjustingId(userId);
      setAmount("");
      setReason("");
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
          Users{" "}
          <span
            className="ml-1 px-1.5 py-0.5 rounded-full text-xs"
            style={{
              backgroundColor: "var(--color-bg-subtle)",
              color: "var(--color-ink-secondary)",
            }}
          >
            {users.length}
          </span>
        </h2>

        {users.length === 0 ? (
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
              No users yet.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {users.map((u, i) => (
              <div
                key={u.id}
                className="rounded-xl p-4"
                style={{
                  backgroundColor: "var(--color-bg-card)",
                  border: "1px solid var(--color-border)",
                  boxShadow: "var(--shadow-card)",
                }}
              >
                <div className="flex items-center gap-3">
                  {/* Rank */}
                  <span
                    className="text-xs font-bold w-5 text-center shrink-0"
                    style={{ color: "var(--color-ink-tertiary)" }}
                  >
                    {i + 1}
                  </span>

                  <Avatar
                    src={u.avatar_url}
                    username={u.username}
                    size="xs"
                  />

                  <div className="flex-1 min-w-0">
                    <p
                      className="text-sm font-semibold truncate"
                      style={{ color: "var(--color-ink-primary)" }}
                    >
                      {u.display_name ?? u.username ?? "Unknown"}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className="text-xs"
                        style={{ color: "var(--color-coin)" }}
                      >
                        {formatCoins(u.coins)}
                      </span>
                      <span
                        className="text-xs"
                        style={{ color: "var(--color-ink-tertiary)" }}
                      >
                        · {u.total_bets} bets · {formatWinRate(u.wins, u.total_bets)} win rate
                      </span>
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleAdjust(u.id)}
                  >
                    {adjustingId === u.id ? "Cancel" : "Adjust"}
                  </Button>
                </div>

                {adjustingId === u.id && (
                  <div className="mt-3 space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="Amount (e.g. 100 or -50)"
                        className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                        style={{
                          backgroundColor: "var(--color-bg)",
                          border: "1px solid var(--color-border)",
                          color: "var(--color-ink-primary)",
                        }}
                      />
                      <input
                        type="text"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder="Reason *"
                        className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
                        style={{
                          backgroundColor: "var(--color-bg)",
                          border: "1px solid var(--color-border)",
                          color: "var(--color-ink-primary)",
                        }}
                      />
                    </div>
                    <Button
                      variant="primary"
                      size="sm"
                      className="w-full"
                      onClick={() => handleAdjust(u.id)}
                      isLoading={isPending}
                    >
                      Confirm Adjustment
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
