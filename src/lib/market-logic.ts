// src/lib/market-logic.ts
// Pure CPMM math functions — no Supabase calls, fully testable.
// Used for UI-side previews (the actual bet is executed server-side via place_bet()).

import type { PositionSide } from "@/types/database";

// Calculate the price per share for the given side at the current probability.
// YES price = yes_probability; NO price = 1 - yes_probability
export function getPriceForSide(
  yesProbability: number,
  side: PositionSide
): number {
  return side === "yes" ? yesProbability : 1 - yesProbability;
}

// Calculate shares received for a bet (client-side preview, mirrors place_bet())
export function calculateShares(
  coins: number,
  yesProbability: number,
  side: PositionSide
): number {
  const price = getPriceForSide(yesProbability, side);
  if (price <= 0 || price >= 1) return 0;
  return coins / price;
}

// Compute the new probability after a hypothetical bet (for preview)
export function computeNewProbability(
  yesPool: number,
  noPool: number,
  coins: number,
  side: PositionSide
): number {
  const newYes = side === "yes" ? yesPool + coins : yesPool;
  const newNo = side === "no" ? noPool + coins : noPool;
  const total = newYes + newNo;
  if (total <= 0) return 0.5;
  return newYes / total;
}

// Estimate potential payout given shares and current total pool.
// This is an approximation — actual payout depends on final pool at resolution.
export function estimatePayout(
  shares: number,
  totalPool: number,
  estimatedWinningShares: number
): number {
  if (estimatedWinningShares <= 0) return 0;
  return Math.round(shares * (totalPool / estimatedWinningShares));
}

// Estimate payout for a new bet using current market state
export function estimateBetPayout(
  coins: number,
  yesPool: number,
  noPool: number,
  side: PositionSide,
  existingWinningShares?: number
): { shares: number; estimatedPayout: number; newProbability: number } {
  const yesProbability = yesPool / (yesPool + noPool);
  const shares = calculateShares(coins, yesProbability, side);
  const newProbability = computeNewProbability(yesPool, noPool, coins, side);
  const newTotalPool = yesPool + noPool + coins;

  // Simple payout estimate: assume user is the only winner
  const winningShares = existingWinningShares
    ? existingWinningShares + shares
    : shares;
  const estimatedPayout = estimatePayout(shares, newTotalPool, winningShares);

  return { shares, estimatedPayout, newProbability };
}

// Calculate the implied return multiplier (e.g., 1.5× means 50% return)
export function calculateReturnMultiplier(
  coins: number,
  estimatedPayout: number
): number {
  if (coins <= 0) return 0;
  return estimatedPayout / coins;
}

// Validate a bet amount against limits
export interface BetValidation {
  valid: boolean;
  error?: string;
}

export function validateBet(
  coins: number,
  userBalance: number,
  minBet = 10,
  maxBet = 500
): BetValidation {
  if (!Number.isInteger(coins)) {
    return { valid: false, error: "Bet amount must be a whole number." };
  }
  if (coins < minBet) {
    return { valid: false, error: `Minimum bet is ${minBet} coins.` };
  }
  if (coins > maxBet) {
    return { valid: false, error: `Maximum bet is ${maxBet} coins.` };
  }
  if (coins > userBalance) {
    return {
      valid: false,
      error: `Insufficient coins. You have ${userBalance} coins.`,
    };
  }
  return { valid: true };
}

// ─── American Odds Utilities ──────────────────────────────────────────────────

// Convert implied probability (0.0–1.0) to American odds integer.
// P ≥ 0.5 → negative (favorite):  -(P / (1-P)) × 100
// P < 0.5 → positive (underdog):  ((1-P) / P) × 100
export function probToAmericanOdds(probability: number): number {
  const p = Math.max(0.01, Math.min(0.99, probability));
  if (p >= 0.5) {
    return Math.round(-(p / (1 - p)) * 100);
  }
  return Math.round(((1 - p) / p) * 100);
}

// Convert American odds to implied probability.
// +100 → 0.5  | +150 → 0.4  | -150 → 0.6
export function americanOddsToProb(odds: number): number {
  if (odds >= 0) {
    return 100 / (odds + 100);
  }
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

// Format American odds for display: "+150", "-110", "+100"
export function formatAmericanOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

// Total payout multiplier (includes original stake).
// +100 → 2.0×  | +150 → 2.5×  | -150 → 1.667×
export function americanOddsMultiplier(odds: number): number {
  if (odds >= 0) {
    return (100 + odds) / 100;
  }
  return (Math.abs(odds) + 100) / Math.abs(odds);
}

// Estimate total payout (stake + profit) from coins wagered and locked-in odds.
export function estimateOddsPayout(coins: number, odds: number): number {
  return Math.round(coins * americanOddsMultiplier(odds));
}

// Parse user-entered American odds string: "+150", "-110", "200", "-200"
// Returns integer or null if invalid.
export function parseAmericanOdds(input: string): number | null {
  const match = input.trim().match(/^([+-]?\d+)$/);
  if (!match || !match[1]) return null;
  const val = parseInt(match[1], 10);
  // Valid range: ≤ -100 or ≥ +100 (values between -99 and 99 are meaningless)
  if (val > -100 && val < 100) return null;
  return val;
}
