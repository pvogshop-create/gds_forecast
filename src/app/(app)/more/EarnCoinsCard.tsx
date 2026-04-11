"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Copy, Check, Gift, Users } from "lucide-react";
import { formatCoins } from "@/lib/utils";

interface EarnCoinsCardProps {
  lastDailyClaim: string | null;
  referralCode: string | null;
  referralCount: number;
}

const REFERRAL_MILESTONES = [
  { friends: 1, coins: 500 },
  { friends: 2, coins: 1000 },
  { friends: 5, coins: 2500 },
  { friends: 10, coins: 5000 },
];

export function EarnCoinsCard({
  lastDailyClaim,
  referralCode,
  referralCount,
}: EarnCoinsCardProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [claimAward, setClaimAward] = useState<number | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Client-side check: is the bonus available?
  const msRemaining = lastDailyClaim
    ? 24 * 60 * 60 * 1000 - (Date.now() - new Date(lastDailyClaim).getTime())
    : -1;
  const canClaim = msRemaining < 0;
  const hoursLeft = canClaim ? 0 : Math.ceil(msRemaining / (1000 * 60 * 60));

  async function handleClaim() {
    setClaimError(null);
    setIsPending(true);
    try {
      const res = await fetch("/api/daily-bonus", { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error ?? "Could not claim bonus. Try again.");
      }
      setClaimAward((json as { award: number }).award);
      router.refresh();
    } catch (err) {
      setClaimError(
        err instanceof Error ? err.message : "Could not claim bonus. Try again."
      );
    } finally {
      setIsPending(false);
    }
  }

  function handleCopy() {
    if (!referralCode) return;
    const url = `${window.location.origin}/login?ref=${referralCode}`;
    navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  }

  const nextMilestone = REFERRAL_MILESTONES.find(
    (m) => m.friends > referralCount
  );

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
          Earn Coins
        </h2>
      </div>

      {/* Daily Bonus Row */}
      <div
        className="px-4 py-3 flex items-center gap-3"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <div
          className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
          style={{ backgroundColor: "var(--color-primary-light)" }}
        >
          <Gift size={16} style={{ color: "var(--color-primary)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-medium"
            style={{ color: "var(--color-ink-primary)" }}
          >
            Daily Bonus
          </p>
          <p
            className="text-xs"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            {claimAward !== null
              ? `+${formatCoins(claimAward)} coins added to your balance!`
              : canClaim
              ? "50–150 random coins, available now"
              : `Next claim in ${hoursLeft}h`}
          </p>
          {claimError && (
            <p className="text-xs mt-0.5" style={{ color: "var(--color-danger)" }}>
              {claimError}
            </p>
          )}
        </div>
        {claimAward === null && (
          <button
            onClick={handleClaim}
            disabled={!canClaim || isPending}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150"
            style={{
              backgroundColor: canClaim
                ? "var(--color-primary)"
                : "var(--color-bg)",
              color: canClaim ? "white" : "var(--color-ink-tertiary)",
              border: canClaim
                ? "none"
                : "1px solid var(--color-border)",
              opacity: isPending ? 0.7 : 1,
              cursor: canClaim && !isPending ? "pointer" : "not-allowed",
            }}
          >
            {isPending ? "Claiming…" : canClaim ? "Claim" : "Claimed"}
          </button>
        )}
      </div>

      {/* Referral Row */}
      {referralCode && (
        <div className="px-4 py-3">
          <div className="flex items-start gap-3">
            <div
              className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: "var(--color-coin-bg, var(--color-primary-light))" }}
            >
              <Users size={16} style={{ color: "var(--color-coin)" }} />
            </div>
            <div className="flex-1 min-w-0">
              <p
                className="text-sm font-medium"
                style={{ color: "var(--color-ink-primary)" }}
              >
                Invite Friends
              </p>
              <p
                className="text-xs mb-2"
                style={{ color: "var(--color-ink-tertiary)" }}
              >
                {referralCount > 0
                  ? `${referralCount} friend${referralCount !== 1 ? "s" : ""} joined · ${nextMilestone ? `${nextMilestone.friends - referralCount} more for +${formatCoins(nextMilestone.coins)} coins` : "All milestones unlocked!"}`
                  : `+500 coins for every friend who joins`}
              </p>

              {/* Referral link */}
              <div
                className="flex items-center gap-1.5 rounded-lg px-3 py-2"
                style={{
                  backgroundColor: "var(--color-bg)",
                  border: "1px solid var(--color-border)",
                }}
              >
                <span
                  className="flex-1 text-xs truncate font-mono"
                  style={{ color: "var(--color-ink-secondary)" }}
                >
                  /login?ref={referralCode}
                </span>
                <button
                  onClick={handleCopy}
                  className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all duration-150"
                  style={{
                    backgroundColor: copied
                      ? "var(--color-yes-bg)"
                      : "var(--color-primary-light)",
                    color: copied
                      ? "var(--color-yes)"
                      : "var(--color-primary)",
                  }}
                  aria-label="Copy referral link"
                >
                  {copied ? (
                    <>
                      <Check size={11} />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy size={11} />
                      Copy
                    </>
                  )}
                </button>
              </div>

              {/* Milestone indicators */}
              <div className="flex gap-2 mt-2 flex-wrap">
                {REFERRAL_MILESTONES.map((m) => (
                  <span
                    key={m.friends}
                    className="text-[10px] px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor:
                        referralCount >= m.friends
                          ? "var(--color-yes-bg)"
                          : "var(--color-bg)",
                      color:
                        referralCount >= m.friends
                          ? "var(--color-yes)"
                          : "var(--color-ink-tertiary)",
                      border: "1px solid var(--color-border)",
                    }}
                  >
                    {referralCount >= m.friends ? "✓ " : ""}
                    {m.friends} friend{m.friends !== 1 ? "s" : ""} = +{formatCoins(m.coins)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
