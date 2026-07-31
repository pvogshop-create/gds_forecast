/**
 * Tests for src/lib/utils.ts
 * Covers: formatCoins, formatProbability, formatCents, formatTimeRemaining,
 *         formatRelativeTime, isNewMarket, getInitials, formatWinRate,
 *         isClosingSoon, feedTimeWindows, vetoTimeRemaining
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatCoins,
  formatProbability,
  formatCents,
  formatTimeRemaining,
  formatRelativeTime,
  isNewMarket,
  getInitials,
  formatWinRate,
  isClosingSoon,
  feedTimeWindows,
  vetoTimeRemaining,
} from "@/lib/utils";

// ─── 1. formatCoins ───────────────────────────────────────────────────────────
describe("formatCoins", () => {
  it("formats small numbers without separator", () => {
    expect(formatCoins(100)).toBe("100");
  });

  it("formats thousands with comma separator", () => {
    expect(formatCoins(1000)).toBe("1,000");
  });

  it("formats tens of thousands", () => {
    expect(formatCoins(12500)).toBe("12,500");
  });

  it("formats zero", () => {
    expect(formatCoins(0)).toBe("0");
  });

  it("formats large amounts (100k+)", () => {
    expect(formatCoins(100000)).toBe("100,000");
  });
});

// ─── 2. formatProbability ────────────────────────────────────────────────────
describe("formatProbability", () => {
  it("formats 0 as 0%", () => {
    expect(formatProbability(0)).toBe("0%");
  });

  it("formats 0.5 as 50%", () => {
    expect(formatProbability(0.5)).toBe("50%");
  });

  it("formats 1.0 as 100%", () => {
    expect(formatProbability(1)).toBe("100%");
  });

  it("rounds to nearest whole percent", () => {
    expect(formatProbability(0.654)).toBe("65%");
    expect(formatProbability(0.655)).toBe("66%");
  });

  it("formats a typical market probability", () => {
    expect(formatProbability(0.73)).toBe("73%");
  });
});

// ─── 3. formatCents ──────────────────────────────────────────────────────────
describe("formatCents", () => {
  it("formats 0.65 as 65¢", () => {
    expect(formatCents(0.65)).toBe("65¢");
  });

  it("formats 0.5 as 50¢ (even money)", () => {
    expect(formatCents(0.5)).toBe("50¢");
  });

  it("formats 1.0 as 100¢", () => {
    expect(formatCents(1)).toBe("100¢");
  });

  it("rounds fractional cents", () => {
    expect(formatCents(0.333)).toBe("33¢");
    expect(formatCents(0.667)).toBe("67¢");
  });
});

// ─── 4. formatTimeRemaining ──────────────────────────────────────────────────
describe("formatTimeRemaining", () => {
  it("returns 'No expiry' for null", () => {
    expect(formatTimeRemaining(null)).toBe("No expiry");
  });

  it("returns 'Expired' for a past date", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(formatTimeRemaining(yesterday)).toBe("Expired");
  });

  it("returns hours for < 1 day remaining", () => {
    const inSixHours = new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString();
    expect(formatTimeRemaining(inSixHours)).toBe("6h");
  });

  it("returns days + hours for 1–29 days remaining", () => {
    // Use 5 days + 2 hours buffer to avoid Date.now() timing drift
    const inFiveDays = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString();
    const result = formatTimeRemaining(inFiveDays);
    expect(result).toMatch(/^5d/);
  });

  it("returns months for 30+ days remaining", () => {
    const inTwoMonths = new Date(Date.now() + 62 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatTimeRemaining(inTwoMonths)).toBe("2mo");
  });
});

// ─── 5. formatRelativeTime ───────────────────────────────────────────────────
describe("formatRelativeTime", () => {
  it("returns 'just now' for very recent timestamps", () => {
    const fiveSecondsAgo = new Date(Date.now() - 5000).toISOString();
    expect(formatRelativeTime(fiveSecondsAgo)).toBe("just now");
  });

  it("returns minutes for timestamps < 1 hour ago", () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    expect(formatRelativeTime(thirtyMinutesAgo)).toBe("30m ago");
  });

  it("returns hours for timestamps < 1 day ago", () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(threeHoursAgo)).toBe("3h ago");
  });

  it("returns days for timestamps 1+ days ago", () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatRelativeTime(twoDaysAgo)).toBe("2d ago");
  });

  it("returns '1m ago' for exactly 60 seconds ago", () => {
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    expect(formatRelativeTime(oneMinuteAgo)).toBe("1m ago");
  });
});

// ─── 6. isNewMarket ──────────────────────────────────────────────────────────
describe("isNewMarket", () => {
  it("returns true for a market created just now", () => {
    const justNow = new Date().toISOString();
    expect(isNewMarket(justNow)).toBe(true);
  });

  it("returns true for a market created 5 hours ago (within 6h window)", () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    expect(isNewMarket(fiveHoursAgo)).toBe(true);
  });

  it("returns false for a market created 7 hours ago (outside 6h window)", () => {
    const sevenHoursAgo = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    expect(isNewMarket(sevenHoursAgo)).toBe(false);
  });

  it("returns false for a market created yesterday", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(isNewMarket(yesterday)).toBe(false);
  });
});

// ─── 7. getInitials ──────────────────────────────────────────────────────────
describe("getInitials", () => {
  it("uses display_name when provided", () => {
    expect(getInitials("Parker Vogelstein", "parker")).toBe("PV");
  });

  it("falls back to username when display_name is null", () => {
    expect(getInitials(null, "parker")).toBe("P");
  });

  it("returns '?' when both are null", () => {
    expect(getInitials(null, null)).toBe("?");
  });

  it("uppercases initials", () => {
    expect(getInitials("john doe", null)).toBe("JD");
  });

  it("truncates to 2 characters max", () => {
    expect(getInitials("John Michael Smith", null)).toBe("JM");
  });

  it("handles single-word display name", () => {
    expect(getInitials("Parker", null)).toBe("P");
  });
});

// ─── 8. formatWinRate ────────────────────────────────────────────────────────
describe("formatWinRate", () => {
  it("returns '—' when total bets is 0 (avoids division by zero)", () => {
    expect(formatWinRate(0, 0)).toBe("—");
  });

  it("returns 0% for 0 wins out of 10 bets", () => {
    expect(formatWinRate(0, 10)).toBe("0%");
  });

  it("returns 100% for 10 wins out of 10 bets", () => {
    expect(formatWinRate(10, 10)).toBe("100%");
  });

  it("rounds to nearest whole percent", () => {
    // 1/3 = 33.33% → rounds to 33%
    expect(formatWinRate(1, 3)).toBe("33%");
    // 2/3 = 66.67% → rounds to 67%
    expect(formatWinRate(2, 3)).toBe("67%");
  });

  it("handles a typical win rate", () => {
    expect(formatWinRate(7, 10)).toBe("70%");
  });
});

// ─── 9. isClosingSoon ────────────────────────────────────────────────────────
// These three read the clock, so they pin it. Without fake timers a boundary
// case like "exactly 24h out" is decided by however long the suite took to get
// here, which is the kind of test that fails once a month and gets re-run.
describe("isClosingSoon", () => {
  const NOW = new Date("2026-07-31T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  // Without this the pinned clock leaks into every test declared after these
  // blocks, which would fail in ways that point nowhere near the cause.
  afterEach(() => {
    vi.useRealTimers();
  });

  const hoursFromNow = (h: number) =>
    new Date(NOW.getTime() + h * 60 * 60 * 1000).toISOString();

  it("returns false when the market has no resolution date", () => {
    expect(isClosingSoon(null)).toBe(false);
  });

  it("returns true for a market resolving in 1 hour", () => {
    expect(isClosingSoon(hoursFromNow(1))).toBe(true);
  });

  it("returns true just inside the 24h window", () => {
    expect(isClosingSoon(hoursFromNow(23.9))).toBe(true);
  });

  it("returns false exactly 24 hours out (window is exclusive)", () => {
    expect(isClosingSoon(hoursFromNow(24))).toBe(false);
  });

  it("returns false for a market resolving in 3 days", () => {
    expect(isClosingSoon(hoursFromNow(72))).toBe(false);
  });

  it("returns false once the resolution date has passed", () => {
    expect(isClosingSoon(hoursFromNow(-1))).toBe(false);
  });
});

// ─── 10. feedTimeWindows ─────────────────────────────────────────────────────
describe("feedTimeWindows", () => {
  const NOW = new Date("2026-07-31T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  // Without this the pinned clock leaks into every test declared after these
  // blocks, which would fail in ways that point nowhere near the cause.
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the three bounds relative to one instant", () => {
    const { nowIso, threeDaysAgo, in48h } = feedTimeWindows();
    expect(nowIso).toBe("2026-07-31T12:00:00.000Z");
    expect(threeDaysAgo).toBe("2026-07-28T12:00:00.000Z");
    expect(in48h).toBe("2026-08-02T12:00:00.000Z");
  });

  it("orders the bounds so the feed's filters cannot overlap", () => {
    const { nowIso, threeDaysAgo, in48h } = feedTimeWindows();
    expect(threeDaysAgo < nowIso).toBe(true);
    expect(nowIso < in48h).toBe(true);
  });
});

// ─── 11. vetoTimeRemaining ───────────────────────────────────────────────────
describe("vetoTimeRemaining", () => {
  const NOW = new Date("2026-07-31T12:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  // Without this the pinned clock leaks into every test declared after these
  // blocks, which would fail in ways that point nowhere near the cause.
  afterEach(() => {
    vi.useRealTimers();
  });

  const minutesFromNow = (m: number) =>
    new Date(NOW.getTime() + m * 60 * 1000).toISOString();

  it("returns null when there is no deadline", () => {
    expect(vetoTimeRemaining(null)).toBeNull();
  });

  it("splits the remaining time into hours and minutes", () => {
    expect(vetoTimeRemaining(minutesFromNow(150))).toEqual({
      hours: 2,
      minutes: 30,
    });
  });

  it("reports zero hours when under an hour remains", () => {
    expect(vetoTimeRemaining(minutesFromNow(45))).toEqual({
      hours: 0,
      minutes: 45,
    });
  });

  it("returns null exactly at the deadline", () => {
    expect(vetoTimeRemaining(minutesFromNow(0))).toBeNull();
  });

  it("returns null once the deadline has passed", () => {
    expect(vetoTimeRemaining(minutesFromNow(-30))).toBeNull();
  });
});
