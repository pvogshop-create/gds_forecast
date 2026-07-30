import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { getCoins, getMarket, getPosition, getPositions, num } from "./helpers/db";
import { USERS } from "./helpers/fixtures";
import {
  createMarket,
  loadSeededUsers,
  placeBetAs,
  setCoins,
  setMarketStatus,
  userId,
} from "./helpers/seed";

/**
 * Binary betting: both sides, every preset, custom amounts, the calibration
 * ramp, and every rejection path.
 *
 * Two structural facts shape these tests:
 *
 *  1. The submit button is `disabled` whenever validateBet fails, so the client
 *     cannot send an invalid bet at all. Server-side rejections
 *     ("You don't have enough coins…", closed market) are therefore asserted by
 *     calling POST /api/markets/:id/bet directly. Per TESTING.md, a button the
 *     UI declines to render is not access control — the endpoint must refuse.
 *
 *  2. `effectiveMax = isCalibrating ? CALIBRATION_STEPS[betCount] : balance`,
 *     and validateBet checks max BEFORE balance. So on a market past
 *     calibration, effectiveMax === balance and an over-balance bet reports
 *     "Maximum bet is N coins." — the "Insufficient coins" copy is only
 *     reachable while balance < effectiveMax, which is what `broke` is for.
 */
test.describe("betting: binary markets", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test.beforeEach(async () => {
    await setCoins("alice", 1_000);
    await setCoins("broke", 25);
  });

  test("a YES bet moves coins, pools, probability, and locks the odds", async ({ page }) => {
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    await page.getByTestId("bet-side-yes").click();
    await page.getByTestId("bet-amount-input").fill("100");
    await page.getByTestId("bet-submit").click();
    await expect(page.getByTestId("bet-success")).toBeVisible();

    const position = await getPosition(marketId, userId("alice"));
    expect(position.side).toBe("yes");
    expect(position.coins_wagered).toBe(100);
    // Locked from the probability BEFORE this bet: prob_to_american_odds(0.5) = -100.
    expect(position.yes_odds_at_bet).toBe(-100);
    expect(num(position.price_at_bet)).toBeCloseTo(0.5, 4);
    expect(num(position.shares_bought)).toBeCloseTo(200, 6);

    const market = await getMarket(marketId);
    // Coins are only ADDED to the bet side; the other pool is untouched.
    expect(num(market.yes_pool)).toBe(200);
    expect(num(market.no_pool)).toBe(100);
    expect(num(market.yes_probability)).toBeCloseTo(0.6667, 4);

    expect(await getCoins(userId("alice"))).toBe(900);
  });

  test("a NO bet on a skewed market locks the exact negated odds", async ({ page }) => {
    // 320/180 → p = 0.6400 → prob_to_american_odds(0.64) = ROUND(-(0.64/0.36)*100) = -178
    const marketId = await createMarket({ yesPool: 320, noPool: 180 });
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    await page.getByTestId("bet-side-no").click();
    await page.getByTestId("bet-amount-input").fill("100");
    // NO's displayed payout uses the negated odds: +178 → multiplier 2.78 → 278.
    await expect(page.getByTestId("bet-preview-payout")).toHaveAttribute(
      "data-payout",
      "278"
    );
    await page.getByTestId("bet-submit").click();
    await expect(page.getByTestId("bet-success")).toBeVisible();

    const position = await getPosition(marketId, userId("alice"));
    expect(position.side).toBe("no");
    // Stored as the YES odds even for a NO bet; resolution negates it.
    expect(position.yes_odds_at_bet).toBe(-178);
    expect(num(position.price_at_bet)).toBeCloseTo(0.36, 4);

    const market = await getMarket(marketId);
    expect(num(market.yes_pool)).toBe(320);
    expect(num(market.no_pool)).toBe(280);
    expect(num(market.yes_probability)).toBeCloseTo(0.5333, 4);
  });

  test("every preset amount fills the input, and 500 is blocked during calibration", async ({
    page,
  }) => {
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    // 0 bets placed → effectiveMax 200, so 10/50/100 are usable and 500 is not.
    await expect(page.getByTestId("calibration-banner")).toHaveAttribute(
      "data-effective-max",
      "200"
    );
    for (const amount of [10, 50, 100]) {
      const preset = page.locator(`[data-testid="bet-preset"][data-amount="${amount}"]`);
      await expect(preset).toBeEnabled();
      await preset.click();
      await expect(page.getByTestId("bet-amount-input")).toHaveValue(String(amount));
    }
    await expect(
      page.locator('[data-testid="bet-preset"][data-amount="500"]')
    ).toBeDisabled();
  });

  test("the 500 preset unlocks once the market is past calibration", async ({ page }) => {
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    // Three prior bets by other users end the calibration ramp.
    await placeBetAs("bob", marketId, "yes", 10);
    await placeBetAs("owner", marketId, "no", 10);
    await placeBetAs("admin", marketId, "yes", 10);

    await setCoins("alice", 1_000);
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    await expect(page.getByTestId("calibration-banner")).toHaveCount(0);
    await expect(
      page.locator('[data-testid="bet-preset"][data-amount="500"]')
    ).toBeEnabled();
  });

  test("a custom amount below the minimum is rejected client-side", async ({ page }) => {
    const marketId = await createMarket();
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    await page.getByTestId("bet-amount-input").fill("5");
    await expect(page.getByTestId("bet-error")).toHaveText("Minimum bet is 10 coins.");
    await expect(page.getByTestId("bet-submit")).toBeDisabled();
  });

  test("a custom amount over the calibration cap is rejected client-side", async ({
    page,
  }) => {
    const marketId = await createMarket();
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    await page.getByTestId("bet-amount-input").fill("250");
    await expect(page.getByTestId("bet-error")).toHaveText("Maximum bet is 200 coins.");
    await expect(page.getByTestId("bet-submit")).toBeDisabled();
  });

  test("a user with too few coins sees the insufficient-coins message", async ({ page }) => {
    const marketId = await createMarket();
    await loginAs(page, "broke");
    await page.goto(`/market/${marketId}`);

    // balance 25 < effectiveMax 200, so the balance branch is the one that fires.
    await page.getByTestId("bet-amount-input").fill("100");
    await expect(page.getByTestId("bet-error")).toHaveText(
      "Insufficient coins. You have 25 coins."
    );
    await expect(page.getByTestId("bet-submit")).toBeDisabled();
  });

  test("the server refuses an over-balance bet sent directly to the API", async ({
    page,
  }) => {
    const marketId = await createMarket();
    await loginAs(page, "broke");

    // Bypasses the disabled button entirely — this is the real enforcement test.
    const res = await page.request.post(`/api/markets/${marketId}/bet`, {
      data: { side: "yes", coins: 100 },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("You don't have enough coins for this bet.");

    // And nothing moved.
    expect(await getCoins(userId("broke"))).toBe(25);
    expect(await getPositions(marketId)).toHaveLength(0);
  });

  test("the server enforces the minimum bet", async ({ page }) => {
    const marketId = await createMarket();
    await loginAs(page, "alice");
    const res = await page.request.post(`/api/markets/${marketId}/bet`, {
      data: { side: "yes", coins: 5 },
    });
    expect(res.status()).toBe(400);
    // zod rejects coins < 10 before the RPC is reached.
    expect((await res.json()).error).toBe("Invalid request");
    expect(await getPositions(marketId)).toHaveLength(0);
  });

  test("the server enforces the calibration cap", async ({ page }) => {
    const marketId = await createMarket();
    await loginAs(page, "alice");
    const res = await page.request.post(`/api/markets/${marketId}/bet`, {
      data: { side: "yes", coins: 250 },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("Calibration period: max 200 coins on this bet.");
    expect(await getPositions(marketId)).toHaveLength(0);
  });

  test("betting on a closed market is refused in the UI and by the API", async ({ page }) => {
    const marketId = await createMarket({ status: "closed" });
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    // No bet form at all — BettingPanel early-returns.
    await expect(page.getByTestId("betting-panel-closed")).toBeVisible();
    await expect(page.getByTestId("betting-panel")).toHaveCount(0);
    await expect(page.getByTestId("bet-submit")).toHaveCount(0);
    await expect(
      page.getByText("This market is closed and no longer accepting bets.")
    ).toBeVisible();

    const res = await page.request.post(`/api/markets/${marketId}/bet`, {
      data: { side: "yes", coins: 50 },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("This market is not currently accepting bets.");
    expect(await getPositions(marketId)).toHaveLength(0);
  });

  test("betting on a resolved market is refused in the UI and by the API", async ({
    page,
  }) => {
    const marketId = await createMarket({ status: "resolved_yes" });
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);
    await expect(page.getByTestId("betting-panel-closed")).toBeVisible();

    const res = await page.request.post(`/api/markets/${marketId}/bet`, {
      data: { side: "yes", coins: 50 },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("This market is not currently accepting bets.");
  });

  test("an unauthenticated bet never reaches the handler", async ({ page }) => {
    const marketId = await createMarket();
    await page.context().clearCookies();
    const res = await page.request.post(`/api/markets/${marketId}/bet`, {
      data: { side: "yes", coins: 50 },
    });
    // The middleware redirects session-less non-public requests to /login, so
    // this never gets as far as the route's own 401 branch.
    expect(res.url()).toContain("/login");
    expect(await getPositions(marketId)).toHaveLength(0);
  });

  test("a malformed market id is rejected", async ({ page }) => {
    await loginAs(page, "alice");
    const res = await page.request.post("/api/markets/not-a-uuid/bet", {
      data: { side: "yes", coins: 50 },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("Invalid market ID");
  });

  test("a second bet locks fresh odds at the new price", async ({ page }) => {
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    await loginAs(page, "alice");

    // First bet at p=0.5 → -100.
    await page.goto(`/market/${marketId}`);
    await page.getByTestId("bet-amount-input").fill("100");
    await page.getByTestId("bet-submit").click();
    await expect(page.getByTestId("bet-success")).toBeVisible();

    // Market is now 200/100 → p=0.6667 → prob_to_american_odds(0.6667) = -200.
    await page.reload();
    await page.getByTestId("bet-amount-input").fill("100");
    await page.getByTestId("bet-submit").click();
    await expect(page.getByTestId("bet-success")).toBeVisible();

    const positions = await getPositions(marketId, userId("alice"));
    expect(positions).toHaveLength(2);
    expect(positions[0]!.yes_odds_at_bet).toBe(-100);
    expect(positions[1]!.yes_odds_at_bet).toBe(-200);
    // Each bet keeps its own locked odds — that's the whole point of the model.
    expect(positions[0]!.yes_odds_at_bet).not.toBe(positions[1]!.yes_odds_at_bet);

    expect(await getCoins(userId("alice"))).toBe(800);
  });

  test("an existing position is surfaced on the panel", async ({ page }) => {
    const marketId = await createMarket();
    await placeBetAs("alice", marketId, "yes", 50);
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);
    const panel = page.getByTestId("betting-panel");
    await expect(panel.getByText(/You have an existing/)).toBeVisible();
    await expect(panel.getByText(/position \(50 coins\)/)).toBeVisible();
  });

  test("the panel shows the play-money disclaimer and no real-currency affordance", async ({
    page,
  }) => {
    const marketId = await createMarket();
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);
    // The string appears both in the sidebar and on the panel; assert at least one.
    await expect(page.getByText("🎮 Play Money — No real currency").first()).toBeVisible();
    // Guardrail: nothing anywhere may imply real money.
    await expect(page.getByText(/\$\d/)).toHaveCount(0);
    for (const word of [/deposit/i, /withdraw/i, /cash out/i, /credit card/i]) {
      await expect(page.getByText(word)).toHaveCount(0);
    }
  });

  test("balance shown on the panel matches the database exactly", async ({ page }) => {
    await setCoins("alice", 742);
    const marketId = await createMarket();
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);
    await expect(page.getByTestId("bet-balance")).toHaveAttribute("data-coins", "742");
    await setCoins("alice", USERS.alice.coins);
  });
});
