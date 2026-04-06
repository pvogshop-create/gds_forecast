"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Coins } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import {
  formatCoins,
  formatProbability,
  cn,
} from "@/lib/utils";
import {
  validateBet,
  probToAmericanOdds,
  formatAmericanOdds,
  estimateOddsPayout,
  computeNewProbability,
} from "@/lib/market-logic";
import type {
  Market,
  Position,
  PlaceBetResult,
  PlaceOuBetResult,
  PositionSide,
} from "@/types/database";

const PRESET_AMOUNTS = [10, 50, 100, 500] as const;

// Calibration: first 3 bets on a new market have stepped max bets.
// After 3 bets, no cap (enforced by user balance only).
const CALIBRATION_STEPS = [200, 300, 400] as const;

interface BettingPanelProps {
  market: Market;
  userPosition: Position | null;
  userBalance: number;
  marketBetCount: number;
  initialSide?: PositionSide;
  onBetPlaced?: (result: PlaceBetResult) => void;
}

export function BettingPanel({
  market,
  userPosition,
  userBalance,
  marketBetCount,
  initialSide = "yes",
  onBetPlaced,
}: BettingPanelProps) {
  const router = useRouter();
  const isOU = market.market_type === "over_under";

  const [selectedSide, setSelectedSide] = useState<PositionSide>(initialSide);
  const [coinInput, setCoinInput] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [successResult, setSuccessResult] = useState<
    PlaceBetResult | PlaceOuBetResult | null
  >(null);
  const [balance, setBalance] = useState(userBalance);

  const isCalibrating = marketBetCount < CALIBRATION_STEPS.length;
  const effectiveMax = isCalibrating
    ? (CALIBRATION_STEPS[marketBetCount] ?? balance)
    : balance;
  const betsRemaining = Math.max(0, CALIBRATION_STEPS.length - marketBetCount);

  const coins = parseInt(coinInput, 10) || 0;
  const validation = coins > 0 ? validateBet(coins, balance, 10, effectiveMax) : null;
  const isOpen = market.status === "open";

  // Binary market helpers
  const yesProb = market.yes_probability;
  const noProb = 1 - yesProb;
  const yesOdds = probToAmericanOdds(yesProb);
  const noOdds = probToAmericanOdds(noProb);
  const sideOdds = selectedSide === "yes" ? yesOdds : noOdds;

  // Binary preview
  const canPreview = coins > 0 && (!validation || validation.valid) && isOpen;
  const previewPayout = canPreview && !isOU
    ? estimateOddsPayout(coins, sideOdds)
    : null;
  const previewNewProb = canPreview && !isOU
    ? computeNewProbability(market.yes_pool, market.no_pool, coins, selectedSide)
    : null;

  // O/U preview
  const ouPreviewPayout = canPreview && isOU ? coins * 2 : null;
  const ouLineShift = canPreview && isOU
    ? 0.5 * Math.ceil(coins / 100)
    : null;
  const ouNewLine =
    canPreview && isOU && market.ou_line !== null && ouLineShift !== null
      ? selectedSide === "yes"
        ? market.ou_line + ouLineShift
        : market.ou_line - ouLineShift
      : null;

  const sideLabel = isOU
    ? selectedSide === "yes"
      ? "OVER"
      : "UNDER"
    : selectedSide.toUpperCase();

  async function handleBet() {
    const betCoins = parseInt(coinInput, 10);
    const betValidation = validateBet(betCoins, balance, 10, effectiveMax);
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
        result?: PlaceBetResult | PlaceOuBetResult;
        error?: string;
      };

      if (!res.ok || !data.success) {
        toast.error(data.error ?? "Failed to place bet.");
        return;
      }

      setSuccessResult(data.result ?? null);
      setCoinInput("");

      if (data.result) {
        setBalance(data.result.coins_remaining);

        if (isOU) {
          const ouResult = data.result as PlaceOuBetResult;
          toast.success(
            `Bet placed ${sideLabel} ${ouResult.ou_line_at_bet}! Potential payout: ${formatCoins(ouResult.potential_payout)} coins.`
          );
        } else {
          const binResult = data.result as PlaceBetResult;
          onBetPlaced?.(binResult);
          const lockedOdds =
            selectedSide === "yes"
              ? binResult.yes_odds_at_bet
              : -binResult.yes_odds_at_bet;
          const potentialPayout = estimateOddsPayout(betCoins, lockedOdds);
          toast.success(
            `Bet placed at ${formatAmericanOdds(lockedOdds)}! Potential payout: ${formatCoins(potentialPayout)} coins.`
          );
        }
      } else {
        toast.success("Bet placed!");
      }

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
            {formatCoins(balance)} coins
          </span>
          {isOU && market.ou_line !== null && (
            <span>
              {" · "}
              <span
                className="font-semibold"
                style={{ color: "var(--color-primary)" }}
              >
                O/U {market.ou_line} {market.ou_unit}
              </span>
            </span>
          )}
        </p>
      </div>

      <div className="p-4 space-y-4">
        {/* Calibration period notice */}
        {isCalibrating && (
          <div
            className="rounded-lg px-3 py-2 text-xs"
            style={{
              backgroundColor: "rgba(245,158,11,0.1)",
              border: "1px solid rgba(245,158,11,0.3)",
              color: "var(--color-warning)",
            }}
          >
            ⏳ Calibration period — max {effectiveMax} coins ·{" "}
            {betsRemaining} bet{betsRemaining !== 1 ? "s" : ""} left to unlock
            full limits
          </div>
        )}

        {/* Side selector */}
        <div className="grid grid-cols-2 gap-2">
          {(["yes", "no"] as const).map((side) => {
            const isSelected = selectedSide === side;
            const label = isOU
              ? side === "yes"
                ? "OVER"
                : "UNDER"
              : side.toUpperCase();
            const sublabel = isOU
              ? "+100"
              : formatAmericanOdds(side === "yes" ? yesOdds : noOdds) +
                " · " +
                formatProbability(side === "yes" ? yesProb : noProb);

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
                <span>{label}</span>
                <span className="text-xs font-normal opacity-80">
                  {sublabel}
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
                disabled={amount > balance || amount > effectiveMax}
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
              max={Math.min(effectiveMax, balance)}
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

        {/* Payout preview — Binary */}
        {!isOU &&
          canPreview &&
          previewPayout !== null &&
          previewNewProb !== null && (
            <div
              className="rounded-lg px-3 py-2.5 space-y-1"
              style={{ backgroundColor: "var(--color-bg)" }}
            >
              <div className="flex justify-between text-xs">
                <span style={{ color: "var(--color-ink-tertiary)" }}>
                  Current {selectedSide.toUpperCase()} odds
                </span>
                <span
                  className="font-medium"
                  style={{ color: "var(--color-ink-primary)" }}
                >
                  {formatAmericanOdds(sideOdds)}
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
                  {formatProbability(previewNewProb)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span style={{ color: "var(--color-ink-tertiary)" }}>
                  Payout if {selectedSide.toUpperCase()} wins
                </span>
                <span
                  className="font-semibold"
                  style={{ color: "var(--color-primary)" }}
                >
                  {formatCoins(previewPayout)} coins
                </span>
              </div>
            </div>
          )}

        {/* Payout preview — O/U */}
        {isOU && canPreview && ouPreviewPayout !== null && (
          <div
            className="rounded-lg px-3 py-2.5 space-y-1"
            style={{ backgroundColor: "var(--color-bg)" }}
          >
            <div className="flex justify-between text-xs">
              <span style={{ color: "var(--color-ink-tertiary)" }}>
                Betting {sideLabel} at line
              </span>
              <span
                className="font-medium"
                style={{ color: "var(--color-ink-primary)" }}
              >
                {market.ou_line} {market.ou_unit}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span style={{ color: "var(--color-ink-tertiary)" }}>
                Line after this bet
              </span>
              <span
                className="font-medium"
                style={{ color: "var(--color-ink-primary)" }}
              >
                {ouNewLine} {market.ou_unit}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span style={{ color: "var(--color-ink-tertiary)" }}>
                Payout if {sideLabel} wins
              </span>
              <span
                className="font-semibold"
                style={{ color: "var(--color-primary)" }}
              >
                {formatCoins(ouPreviewPayout)} coins
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
            {isOU
              ? `✓ Bet placed ${sideLabel} ${(successResult as PlaceOuBetResult).ou_line_at_bet}! New line: ${(successResult as PlaceOuBetResult).new_line} ${market.ou_unit}`
              : `✓ Bet placed at ${formatAmericanOdds(
                  selectedSide === "yes"
                    ? (successResult as PlaceBetResult).yes_odds_at_bet
                    : -(successResult as PlaceBetResult).yes_odds_at_bet
                )}!`}
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
          Bet {sideLabel}{coins > 0 ? ` · ${formatCoins(coins)} coins` : ""}
        </Button>

        {/* Existing position notice */}
        {userPosition && (
          <p
            className="text-xs text-center"
            style={{ color: "var(--color-ink-tertiary)" }}
          >
            You have an existing{" "}
            <strong>
              {isOU
                ? userPosition.side === "yes"
                  ? "OVER"
                  : "UNDER"
                : userPosition.side.toUpperCase()}
            </strong>{" "}
            position ({formatCoins(userPosition.coins_wagered)} coins
            {isOU && userPosition.ou_line_at_bet !== null
              ? ` @ ${userPosition.ou_line_at_bet}`
              : ""}
            ).
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
