"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Coins } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import {
  formatProbability,
  formatCents,
  formatCoins,
  cn,
} from "@/lib/utils";
import {
  estimateBetPayout,
  validateBet,
} from "@/lib/market-logic";
import type { Market, Position, PlaceBetResult, PositionSide } from "@/types/database";

const PRESET_AMOUNTS = [10, 50, 100, 500] as const;

interface BettingPanelProps {
  market: Market;
  userPosition: Position | null;
  userBalance: number;
  initialSide?: PositionSide;
  onBetPlaced?: (result: PlaceBetResult) => void;
}

export function BettingPanel({
  market,
  userPosition,
  userBalance,
  initialSide = "yes",
  onBetPlaced,
}: BettingPanelProps) {
  const router = useRouter();
  const [selectedSide, setSelectedSide] = useState<PositionSide>(initialSide);
  const [coinInput, setCoinInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [successResult, setSuccessResult] = useState<PlaceBetResult | null>(null);

  const coins = parseInt(coinInput, 10) || 0;
  const validation = coins > 0 ? validateBet(coins, userBalance) : null;
  const isOpen = market.status === "open";

  // Preview calculations
  const preview =
    coins > 0 && !validation?.valid === false && isOpen
      ? estimateBetPayout(coins, market.yes_pool, market.no_pool, selectedSide)
      : null;

  const yesProb = market.yes_probability;
  const noProb = 1 - yesProb;

  async function handleBet() {
    const betCoins = parseInt(coinInput, 10);
    const betValidation = validateBet(betCoins, userBalance);
    if (!betValidation.valid) {
      toast.error(betValidation.error ?? "Invalid bet.");
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch(`/api/markets/${market.id}/bet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ side: selectedSide, coins: betCoins }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        result?: PlaceBetResult;
        error?: string;
      };

      if (!res.ok || !data.success) {
        toast.error(data.error ?? "Failed to place bet.");
        return;
      }

      setSuccessResult(data.result ?? null);
      setCoinInput("");
      toast.success(
        `Bet placed! You bought ${data.result?.shares_bought.toFixed(2)} shares.`
      );
      onBetPlaced?.(data.result!);
      router.refresh();
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }

  if (!isOpen) {
    return (
      <div
        className="rounded-xl p-4 text-center"
        style={{
          backgroundColor: "var(--color-bg)",
          border: "1px solid var(--color-border)",
        }}
      >
        <p
          className="text-sm"
          style={{ color: "var(--color-ink-secondary)" }}
        >
          This market is{" "}
          <strong>
            {market.status === "closed"
              ? "closed"
              : market.status.replace("_", " ")}
          </strong>{" "}
          and no longer accepting bets.
        </p>
      </div>
    );
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
        <h3
          className="text-sm font-semibold"
          style={{ color: "var(--color-ink-primary)" }}
        >
          Place Your Bet
        </h3>
        <p
          className="text-xs mt-0.5"
          style={{ color: "var(--color-ink-tertiary)" }}
        >
          Balance:{" "}
          <span style={{ color: "var(--color-coin)" }}>
            {formatCoins(userBalance)} coins
          </span>
        </p>
      </div>

      <div className="p-4 space-y-4">
        {/* YES / NO selector */}
        <div className="grid grid-cols-2 gap-2">
          {(["yes", "no"] as const).map((side) => {
            const prob = side === "yes" ? yesProb : noProb;
            const isSelected = selectedSide === side;
            return (
              <button
                key={side}
                onClick={() => setSelectedSide(side)}
                className={cn(
                  "flex flex-col items-center py-3 rounded-xl font-bold text-sm transition-all duration-150",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                )}
                style={{
                  backgroundColor: isSelected
                    ? side === "yes"
                      ? "var(--color-yes)"
                      : "var(--color-no)"
                    : side === "yes"
                    ? "var(--color-yes-bg)"
                    : "var(--color-no-bg)",
                  color: isSelected
                    ? "white"
                    : side === "yes"
                    ? "var(--color-yes)"
                    : "var(--color-no)",
                  border: `2px solid ${
                    isSelected
                      ? side === "yes"
                        ? "var(--color-yes)"
                        : "var(--color-no)"
                      : "transparent"
                  }`,
                }}
              >
                <span>{side.toUpperCase()}</span>
                <span className="text-xs font-normal opacity-80">
                  {formatCents(prob)} · {formatProbability(prob)}
                </span>
              </button>
            );
          })}
        </div>

        {/* Preset amounts */}
        <div>
          <p
            className="text-xs font-medium mb-2"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            Amount (coins)
          </p>
          <div className="grid grid-cols-4 gap-1.5 mb-2">
            {PRESET_AMOUNTS.map((amount) => (
              <button
                key={amount}
                onClick={() => setCoinInput(amount.toString())}
                disabled={amount > userBalance}
                className={cn(
                  "py-2 rounded-lg text-xs font-semibold transition-all duration-150",
                  "disabled:opacity-40 disabled:cursor-not-allowed"
                )}
                style={{
                  backgroundColor:
                    parseInt(coinInput) === amount
                      ? "var(--color-primary-light)"
                      : "var(--color-bg)",
                  color:
                    parseInt(coinInput) === amount
                      ? "var(--color-primary)"
                      : "var(--color-ink-secondary)",
                  border: `1px solid ${
                    parseInt(coinInput) === amount
                      ? "var(--color-primary)"
                      : "var(--color-border)"
                  }`,
                }}
              >
                {amount}
              </button>
            ))}
          </div>

          {/* Custom input */}
          <div className="relative">
            <Coins
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: "var(--color-coin)" }}
            />
            <input
              type="number"
              value={coinInput}
              onChange={(e) => setCoinInput(e.target.value)}
              placeholder="Custom amount…"
              min={10}
              max={Math.min(500, userBalance)}
              className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none transition-all duration-150"
              style={{
                backgroundColor: "var(--color-bg)",
                border: `1px solid ${
                  validation && !validation.valid
                    ? "var(--color-danger)"
                    : "var(--color-border)"
                }`,
                color: "var(--color-ink-primary)",
              }}
              aria-label="Bet amount in coins"
              aria-describedby={
                validation && !validation.valid ? "bet-error" : undefined
              }
            />
          </div>

          {validation && !validation.valid && (
            <p
              id="bet-error"
              className="text-xs mt-1"
              style={{ color: "var(--color-danger)" }}
              role="alert"
            >
              {validation.error}
            </p>
          )}
        </div>

        {/* Payout preview */}
        {preview && coins > 0 && (!validation || validation.valid) && (
          <div
            className="rounded-lg px-3 py-2.5 space-y-1"
            style={{ backgroundColor: "var(--color-bg)" }}
          >
            <div className="flex justify-between text-xs">
              <span style={{ color: "var(--color-ink-tertiary)" }}>
                Shares to receive
              </span>
              <span
                className="font-medium"
                style={{ color: "var(--color-ink-primary)" }}
              >
                {preview.shares.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span style={{ color: "var(--color-ink-tertiary)" }}>
                New probability
              </span>
              <span
                className="font-medium"
                style={{ color: "var(--color-ink-primary)" }}
              >
                {formatProbability(preview.newProbability)}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span style={{ color: "var(--color-ink-tertiary)" }}>
                Est. payout if {selectedSide.toUpperCase()} wins
              </span>
              <span
                className="font-semibold"
                style={{ color: "var(--color-primary)" }}
              >
                ~{formatCoins(preview.estimatedPayout)} coins
              </span>
            </div>
          </div>
        )}

        {/* Success state */}
        {successResult && (
          <div
            className="rounded-lg px-3 py-2.5 text-sm font-medium text-center"
            style={{
              backgroundColor: "var(--color-yes-bg)",
              color: "var(--color-yes)",
            }}
            role="status"
          >
            ✓ Bet placed! {successResult.shares_bought.toFixed(2)} shares
            received.
          </div>
        )}

        {/* Submit button */}
        <Button
          variant={selectedSide === "yes" ? "yes" : "no"}
          size="lg"
          className="w-full"
          onClick={handleBet}
          isLoading={isLoading}
          disabled={!coinInput || (!!validation && !validation.valid)}
        >
          Bet {selectedSide.toUpperCase()}{" "}
          {coins > 0 ? `· ${formatCoins(coins)} coins` : ""}
        </Button>

        {/* Existing position notice */}
        {userPosition && (
          <p
            className="text-xs text-center"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            You have an existing{" "}
            <strong>{userPosition.side.toUpperCase()}</strong> position (
            {formatCoins(userPosition.coins_wagered)} coins).
          </p>
        )}

        <p
          className="text-xs text-center play-money-badge"
          style={{ color: "var(--color-ink-tertiary)" }}
        >
          🎮 Play Money — No real currency
        </p>
      </div>
    </div>
  );
}
