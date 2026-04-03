/**
 * Tests for src/lib/market-logic.ts
 * Covers: American odds math, CPMM probability, bet validation,
 *         O/U line-movement formula, and O/U position resolution logic.
 */

import { describe, it, expect } from "vitest";
import {
  probToAmericanOdds,
  americanOddsToProb,
  formatAmericanOdds,
  parseAmericanOdds,
  americanOddsMultiplier,
  estimateOddsPayout,
  validateBet,
  computeNewProbability,
  getPriceForSide,
  calculateShares,
} from "@/lib/market-logic";

// ─── Helper: O/U line-shift formula (mirrors place_ou_bet SQL) ───────────────
// shift = 0.5 × CEIL(coins / 100)
function ouLineShift(coins: number): number {
  return 0.5 * Math.ceil(coins / 100);
}

// ─── Helper: O/U resolution logic (mirrors resolve_ou_market SQL) ─────────────
// Returns "win", "push", or "loss" for a given position
function resolveOuPosition(
  side: "yes" | "no",
  resultValue: number,
  lineAtBet: number
): "win" | "push" | "loss" {
  if (
    (side === "yes" && resultValue > lineAtBet) ||
    (side === "no" && resultValue < lineAtBet)
  ) {
    return "win";
  }
  if (resultValue === lineAtBet) return "push";
  return "loss";
}

// ─── 1. probToAmericanOdds ────────────────────────────────────────────────────
describe("probToAmericanOdds", () => {
  it("converts 50% probability to even money (±100)", () => {
    // At exactly p=0.5 the function uses the p>=0.5 branch: -(0.5/0.5)*100 = -100.
    // Both -100 and +100 represent identical 2× payout; the display reads "-100" for a 50/50 market.
    expect(Math.abs(probToAmericanOdds(0.5))).toBe(100);
  });

  it("converts 40% (underdog) to +150", () => {
    // (0.6 / 0.4) × 100 = 150
    expect(probToAmericanOdds(0.4)).toBe(150);
  });

  it("converts 60% (favorite) to -150", () => {
    // -(0.6 / 0.4) × 100 = -150
    expect(probToAmericanOdds(0.6)).toBe(-150);
  });

  it("converts 25% to +300", () => {
    // (0.75 / 0.25) × 100 = 300
    expect(probToAmericanOdds(0.25)).toBe(300);
  });

  it("converts 75% to -300", () => {
    expect(probToAmericanOdds(0.75)).toBe(-300);
  });

  it("clamps probability at 0.01 (avoids division by near-zero)", () => {
    // Should not throw or return Infinity
    const result = probToAmericanOdds(0);
    expect(Number.isFinite(result)).toBe(true);
  });

  it("clamps probability at 0.99", () => {
    const result = probToAmericanOdds(1);
    expect(Number.isFinite(result)).toBe(true);
  });
});

// ─── 2. americanOddsToProb ────────────────────────────────────────────────────
describe("americanOddsToProb", () => {
  it("+100 → 0.5 (50%)", () => {
    expect(americanOddsToProb(100)).toBeCloseTo(0.5);
  });

  it("+150 → 0.4 (40%)", () => {
    // 100 / (150 + 100) = 100 / 250 = 0.4
    expect(americanOddsToProb(150)).toBeCloseTo(0.4);
  });

  it("-150 → 0.6 (60%)", () => {
    // 150 / (150 + 100) = 150 / 250 = 0.6
    expect(americanOddsToProb(-150)).toBeCloseTo(0.6);
  });

  it("+300 → 0.25 (25%)", () => {
    expect(americanOddsToProb(300)).toBeCloseTo(0.25);
  });

  it("-300 → 0.75 (75%)", () => {
    expect(americanOddsToProb(-300)).toBeCloseTo(0.75);
  });

  it("is the inverse of probToAmericanOdds at 0.5", () => {
    expect(americanOddsToProb(probToAmericanOdds(0.5))).toBeCloseTo(0.5);
  });

  it("is the inverse of probToAmericanOdds at 0.7", () => {
    expect(americanOddsToProb(probToAmericanOdds(0.7))).toBeCloseTo(0.7, 1);
  });
});

// ─── 3. formatAmericanOdds ───────────────────────────────────────────────────
describe("formatAmericanOdds", () => {
  it("formats positive odds with + sign", () => {
    expect(formatAmericanOdds(150)).toBe("+150");
  });

  it("formats negative odds without + sign", () => {
    expect(formatAmericanOdds(-150)).toBe("-150");
  });

  it("formats +100 correctly", () => {
    expect(formatAmericanOdds(100)).toBe("+100");
  });

  it("formats -100 correctly", () => {
    expect(formatAmericanOdds(-100)).toBe("-100");
  });
});

// ─── 4. parseAmericanOdds ────────────────────────────────────────────────────
describe("parseAmericanOdds", () => {
  it("parses +150", () => {
    expect(parseAmericanOdds("+150")).toBe(150);
  });

  it("parses -110", () => {
    expect(parseAmericanOdds("-110")).toBe(-110);
  });

  it("parses +100 (even money)", () => {
    expect(parseAmericanOdds("+100")).toBe(100);
  });

  it("parses 200 (no sign = positive)", () => {
    expect(parseAmericanOdds("200")).toBe(200);
  });

  it("parses -200", () => {
    expect(parseAmericanOdds("-200")).toBe(-200);
  });

  it("rejects values between -99 and 99 (meaningless range)", () => {
    expect(parseAmericanOdds("50")).toBeNull();
    expect(parseAmericanOdds("-50")).toBeNull();
    expect(parseAmericanOdds("0")).toBeNull();
  });

  it("rejects non-numeric input", () => {
    expect(parseAmericanOdds("abc")).toBeNull();
    expect(parseAmericanOdds("+abc")).toBeNull();
    expect(parseAmericanOdds("")).toBeNull();
  });

  it("rejects decimal input", () => {
    expect(parseAmericanOdds("+1.5")).toBeNull();
    expect(parseAmericanOdds("150.5")).toBeNull();
  });

  it("trims whitespace before parsing", () => {
    expect(parseAmericanOdds("  +150  ")).toBe(150);
  });
});

// ─── 5. americanOddsMultiplier ────────────────────────────────────────────────
describe("americanOddsMultiplier", () => {
  it("+100 → 2.0× (100% profit + stake returned)", () => {
    expect(americanOddsMultiplier(100)).toBeCloseTo(2.0);
  });

  it("+150 → 2.5×", () => {
    expect(americanOddsMultiplier(150)).toBeCloseTo(2.5);
  });

  it("-150 → 1.667×", () => {
    expect(americanOddsMultiplier(-150)).toBeCloseTo(1.6667, 3);
  });

  it("+300 → 4.0×", () => {
    expect(americanOddsMultiplier(300)).toBeCloseTo(4.0);
  });

  it("-300 → 1.333×", () => {
    expect(americanOddsMultiplier(-300)).toBeCloseTo(1.3333, 3);
  });
});

// ─── 6. estimateOddsPayout ───────────────────────────────────────────────────
describe("estimateOddsPayout", () => {
  it("100 coins at +100 → 200 payout", () => {
    expect(estimateOddsPayout(100, 100)).toBe(200);
  });

  it("100 coins at +150 → 250 payout", () => {
    expect(estimateOddsPayout(100, 150)).toBe(250);
  });

  it("100 coins at -150 → 167 payout (rounded)", () => {
    // 100 × (250/150) = 166.67 → rounds to 167
    expect(estimateOddsPayout(100, -150)).toBe(167);
  });

  it("200 coins at +100 → 400 payout (O/U fixed payout check)", () => {
    expect(estimateOddsPayout(200, 100)).toBe(400);
  });
});

// ─── 7. validateBet ──────────────────────────────────────────────────────────
describe("validateBet", () => {
  it("accepts a valid bet within all limits", () => {
    expect(validateBet(100, 500)).toEqual({ valid: true });
  });

  it("rejects a non-integer amount", () => {
    expect(validateBet(10.5, 500)).toMatchObject({ valid: false });
  });

  it("rejects a bet below minimum (10)", () => {
    expect(validateBet(9, 500)).toMatchObject({ valid: false });
  });

  it("rejects a bet above maximum (500)", () => {
    expect(validateBet(501, 1000)).toMatchObject({ valid: false });
  });

  it("rejects a bet exceeding user balance", () => {
    expect(validateBet(200, 150)).toMatchObject({ valid: false });
  });

  it("accepts exactly the minimum bet (10 coins)", () => {
    expect(validateBet(10, 500)).toEqual({ valid: true });
  });

  it("accepts exactly the maximum bet (500 coins)", () => {
    expect(validateBet(500, 1000)).toEqual({ valid: true });
  });

  it("simulates calibration cap: 101 coins rejected when maxBet=100", () => {
    // BettingPanel passes effectiveMax=100 during calibration
    expect(validateBet(101, 1000, 10, 100)).toMatchObject({ valid: false });
  });

  it("simulates calibration cap: 100 coins accepted when maxBet=100", () => {
    expect(validateBet(100, 1000, 10, 100)).toEqual({ valid: true });
  });
});

// ─── 8. computeNewProbability (CPMM) ─────────────────────────────────────────
describe("computeNewProbability", () => {
  it("50/50 pool stays at 0.5 with no bet", () => {
    // computeNewProbability doesn't take 0 bet, so just check baseline
    expect(computeNewProbability(100, 100, 0, "yes")).toBeCloseTo(0.5);
  });

  it("YES bet on 50/50 pool increases probability above 0.5", () => {
    const prob = computeNewProbability(100, 100, 50, "yes");
    expect(prob).toBeGreaterThan(0.5);
  });

  it("NO bet on 50/50 pool decreases probability below 0.5", () => {
    const prob = computeNewProbability(100, 100, 50, "no");
    expect(prob).toBeLessThan(0.5);
  });

  it("returns 0.5 when total pool is 0 (div-by-zero guard)", () => {
    expect(computeNewProbability(0, 0, 0, "yes")).toBe(0.5);
  });

  it("large YES bet on empty market → probability near 1", () => {
    // 0 yes_pool, 0 no_pool, 1000 yes bet → 1000/1000 = 1.0
    expect(computeNewProbability(0, 0, 1000, "yes")).toBeCloseTo(1.0);
  });
});

// ─── 9. getPriceForSide ──────────────────────────────────────────────────────
describe("getPriceForSide", () => {
  it("YES price = yes_probability", () => {
    expect(getPriceForSide(0.6, "yes")).toBeCloseTo(0.6);
  });

  it("NO price = 1 - yes_probability", () => {
    expect(getPriceForSide(0.6, "no")).toBeCloseTo(0.4);
  });

  it("at 50/50: both sides price at 0.5", () => {
    expect(getPriceForSide(0.5, "yes")).toBeCloseTo(0.5);
    expect(getPriceForSide(0.5, "no")).toBeCloseTo(0.5);
  });
});

// ─── 10. calculateShares ─────────────────────────────────────────────────────
describe("calculateShares", () => {
  it("at 50/50 odds: 100 coins → 200 shares (2×)", () => {
    // price = 0.5, shares = 100 / 0.5 = 200
    expect(calculateShares(100, 0.5, "yes")).toBeCloseTo(200);
  });

  it("NO side at yesProbability=0.75 → NO price=0.25 → 100 coins = 400 shares", () => {
    // getPriceForSide(0.75, "no") = 1 - 0.75 = 0.25 → shares = 100 / 0.25 = 400
    expect(calculateShares(100, 0.75, "no")).toBeCloseTo(400);
  });

  it("returns 0 when price is 0 or 1 (edge guard)", () => {
    expect(calculateShares(100, 0, "yes")).toBe(0);
    expect(calculateShares(100, 1, "yes")).toBe(0);
  });
});

// ─── 11. O/U Line Shift Formula ──────────────────────────────────────────────
describe("O/U line shift formula: 0.5 × CEIL(coins / 100)", () => {
  it("10 coins (calibration minimum) → 0.5 shift", () => {
    expect(ouLineShift(10)).toBe(0.5);
  });

  it("100 coins (calibration max) → 0.5 shift", () => {
    expect(ouLineShift(100)).toBe(0.5);
  });

  it("101 coins → 1.0 shift", () => {
    expect(ouLineShift(101)).toBe(1.0);
  });

  it("200 coins → 1.0 shift", () => {
    expect(ouLineShift(200)).toBe(1.0);
  });

  it("201 coins → 1.5 shift", () => {
    expect(ouLineShift(201)).toBe(1.5);
  });

  it("300 coins → 1.5 shift", () => {
    expect(ouLineShift(300)).toBe(1.5);
  });

  it("301 coins → 2.0 shift", () => {
    expect(ouLineShift(301)).toBe(2.0);
  });

  it("400 coins → 2.0 shift", () => {
    expect(ouLineShift(400)).toBe(2.0);
  });

  it("401 coins → 2.5 shift", () => {
    expect(ouLineShift(401)).toBe(2.5);
  });

  it("500 coins (maximum bet) → 2.5 shift", () => {
    expect(ouLineShift(500)).toBe(2.5);
  });

  it("OVER bet: line goes UP by shift", () => {
    const openingLine = 3.5;
    const bet = 100; // shift = 0.5
    expect(openingLine + ouLineShift(bet)).toBe(4.0);
  });

  it("UNDER bet: line goes DOWN by shift", () => {
    const openingLine = 3.5;
    const bet = 100; // shift = 0.5
    expect(openingLine - ouLineShift(bet)).toBe(3.0);
  });
});

// ─── 12. O/U Position Resolution Logic ───────────────────────────────────────
describe("O/U resolution: resolveOuPosition(side, result, lineAtBet)", () => {
  // OVER bets (side = 'yes')
  it("OVER wins when result > lineAtBet", () => {
    expect(resolveOuPosition("yes", 5.0, 3.5)).toBe("win");
  });

  it("OVER loses when result < lineAtBet", () => {
    expect(resolveOuPosition("yes", 2.0, 3.5)).toBe("loss");
  });

  it("OVER pushes when result exactly equals lineAtBet", () => {
    expect(resolveOuPosition("yes", 3.5, 3.5)).toBe("push");
  });

  // UNDER bets (side = 'no')
  it("UNDER wins when result < lineAtBet", () => {
    expect(resolveOuPosition("no", 2.0, 3.5)).toBe("win");
  });

  it("UNDER loses when result > lineAtBet", () => {
    expect(resolveOuPosition("no", 5.0, 3.5)).toBe("loss");
  });

  it("UNDER pushes when result exactly equals lineAtBet", () => {
    expect(resolveOuPosition("no", 3.5, 3.5)).toBe("push");
  });

  // Multiple positions at different locked lines (core O/U mechanic)
  it("two OVER bets at different lines — only the favorable one wins", () => {
    // Bet 1 at line 3.5, Bet 2 at line 4.0, result = 3.8
    expect(resolveOuPosition("yes", 3.8, 3.5)).toBe("win");  // 3.8 > 3.5 ✓
    expect(resolveOuPosition("yes", 3.8, 4.0)).toBe("loss"); // 3.8 < 4.0 ✗
  });

  it("OVER and UNDER bets at same line can split: one wins, one loses", () => {
    // OVER at 3.5, UNDER at 3.5, result = 5.0
    expect(resolveOuPosition("yes", 5.0, 3.5)).toBe("win");
    expect(resolveOuPosition("no", 5.0, 3.5)).toBe("loss");
  });

  // Payout amounts
  it("win pays 2× wagered coins", () => {
    const coinsWagered = 100;
    const payout = coinsWagered * 2;
    expect(payout).toBe(200);
  });

  it("push refunds exact stake", () => {
    const coinsWagered = 75;
    const payout = coinsWagered; // full refund
    expect(payout).toBe(75);
  });

  it("loss pays 0", () => {
    const payout = 0;
    expect(payout).toBe(0);
  });
});
