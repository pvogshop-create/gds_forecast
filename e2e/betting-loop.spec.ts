import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import {
  getActivity,
  getMarket,
  getNotifications,
  getPosition,
  getProbabilityHistory,
  getProfile,
  num,
} from "./helpers/db";
import {
  createMarket,
  loadSeededUsers,
  resolveMarketAs,
  setCoins,
  setProfileFields,
  userId,
} from "./helpers/seed";

/**
 * ═══ THE FLAGSHIP CANARY ═══
 *
 * The full core loop, end to end, in one test:
 *
 *   log in → claim daily bonus → place a bet → coins/pools/odds move
 *          → admin resolves → payout + streak + notification land
 *          → leaderboard reflects it
 *
 * CLAUDE.md: "The betting loop must never break." Spec §10.6 requires this to be
 * run after every migration. If this file is red, STOP — do not ship the
 * migration or change that broke it, and do not weaken this test to make it pass
 * (see TESTING.md § Forbidden).
 *
 * Every money assertion is an exact integer, derived from the live SQL:
 *   place_bet   → yes_odds_at_bet = prob_to_american_odds(probability BEFORE the bet)
 *   resolve_market → payout = ROUND(coins_wagered * american_odds_multiplier(side_odds))
 * A fresh 100/100 market sits at p=0.5000 → prob_to_american_odds(0.5) = -100
 * → multiplier (100+100)/100 = 2.0 → a 100-coin YES bet pays exactly 200.
 */

const START_COINS = 1_000;
const STAKE = 100;

// Derived, not guessed — see the header. Kept as named constants so a failure
// message points at which step of the arithmetic broke.
const EXPECTED_LOCKED_ODDS = -100;
const EXPECTED_PAYOUT = 200;
const EXPECTED_YES_POOL_AFTER = 200;
const EXPECTED_NO_POOL_AFTER = 100;
const EXPECTED_PROB_AFTER = 0.6667;

test.describe("flagship: the core betting loop", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test("claim bonus → bet → resolve → payout, streak, notification, leaderboard", async ({
    page,
  }) => {
    const alice = userId("alice");

    // Deterministic starting point: exact balance, no prior claim, no streak.
    await setCoins("alice", START_COINS);
    await setProfileFields("alice", {
      last_daily_claim: null,
      win_streak: 0,
      loss_streak: 0,
      wins: 0,
      total_bets: 0,
    });

    const marketId = await createMarket({
      title: "Flagship loop market",
      category: "sports",
      yesPool: 100,
      noPool: 100,
    });

    // ── 1. Log in ───────────────────────────────────────────────────────────
    await loginAs(page, "alice");
    await page.goto("/dashboard/trending");
    await expect(page.getByRole("heading", { name: "Trending", level: 1 })).toBeVisible();

    // ── 2. Claim the daily bonus ────────────────────────────────────────────
    // The award is random 50–150 (place_bet's sibling `claim_daily_bonus` uses
    // 50 + FLOOR(RANDOM()*101)), so the amount is asserted as a range but the
    // resulting BALANCE is asserted exactly against the returned award.
    await page.goto("/more?tab=bets");
    const claim = page.getByTestId("earn-coins-claim");
    await expect(claim).toBeEnabled();

    const bonusResponse = await page.request.post("/api/daily-bonus");
    expect(bonusResponse.ok()).toBe(true);
    const bonus = (await bonusResponse.json()) as { award: number; coins_after: number };

    expect(bonus.award).toBeGreaterThanOrEqual(50);
    expect(bonus.award).toBeLessThanOrEqual(150);
    expect(bonus.coins_after).toBe(START_COINS + bonus.award);

    const afterBonus = await getProfile(alice);
    expect(afterBonus.coins).toBe(START_COINS + bonus.award);
    expect(afterBonus.last_daily_claim).not.toBeNull();

    // A second claim the same day must be rejected. The UI button is disabled
    // once claimed, so this can only be proven by calling the endpoint directly
    // — a hidden button is not enforcement (TESTING.md).
    const secondClaim = await page.request.post("/api/daily-bonus");
    expect(secondClaim.status()).toBe(400);
    expect((await secondClaim.json()).error).toBe(
      "Daily bonus already claimed. Try again later."
    );
    expect((await getProfile(alice)).coins).toBe(START_COINS + bonus.award);

    // Normalise back to a round number so the bet arithmetic below is exact
    // regardless of the random bonus.
    await setCoins("alice", START_COINS);

    // ── 3. Place a bet through the real UI ──────────────────────────────────
    await page.goto(`/market/${marketId}`);
    await expect(page.getByTestId("market-title")).toHaveText(/Flagship loop market/);

    // Fresh market → 0.5 probability shown on both the panel and the header.
    await expect(page.getByTestId("market-stat-yes")).toHaveText("50%");
    await expect(page.getByTestId("bet-balance")).toHaveAttribute(
      "data-coins",
      String(START_COINS)
    );

    await page.getByTestId("bet-side-yes").click();
    await page.getByTestId("bet-amount-input").fill(String(STAKE));

    // The preview must predict the payout the DB will actually produce.
    await expect(page.getByTestId("bet-preview-payout")).toHaveAttribute(
      "data-payout",
      String(EXPECTED_PAYOUT)
    );

    await page.getByTestId("bet-submit").click();
    await expect(page.getByTestId("bet-success")).toBeVisible();
    await expect(page.getByTestId("toast").first()).toContainText("Bet placed at -100!");

    // ── 4. Coins, pools, probability, odds lock, history, activity ──────────
    const position = await getPosition(marketId, alice);
    expect(position.coins_wagered).toBe(STAKE);
    expect(position.side).toBe("yes");
    expect(position.status).toBe("open");
    // The whole payout model hangs off this being locked at bet time.
    expect(position.yes_odds_at_bet).toBe(EXPECTED_LOCKED_ODDS);
    expect(num(position.price_at_bet)).toBeCloseTo(0.5, 4);
    expect(num(position.shares_bought)).toBeCloseTo(200, 6);

    const betProfile = await getProfile(alice);
    expect(betProfile.coins).toBe(START_COINS - STAKE);
    expect(betProfile.total_bets).toBe(1);

    const betMarket = await getMarket(marketId);
    expect(num(betMarket.yes_pool)).toBe(EXPECTED_YES_POOL_AFTER);
    expect(num(betMarket.no_pool)).toBe(EXPECTED_NO_POOL_AFTER);
    expect(num(betMarket.yes_probability)).toBeCloseTo(EXPECTED_PROB_AFTER, 4);

    // sync_market_probability appends a history point; the chart needs >= 2 to render.
    const history = await getProbabilityHistory(marketId);
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(num(history[history.length - 1]!.yes_probability)).toBeCloseTo(
      EXPECTED_PROB_AFTER,
      4
    );

    const activity = await getActivity(marketId);
    expect(activity.some((a) => a.user_id === alice && a.action_type === "bet_yes")).toBe(
      true
    );

    // The moved price must be reflected back in the UI.
    await page.reload();
    await expect(page.getByTestId("market-stat-yes")).toHaveText("67%");
    await expect(page.getByTestId("bet-balance")).toHaveAttribute(
      "data-coins",
      String(START_COINS - STAKE)
    );

    // ── 5. Admin resolves YES through the admin dashboard ───────────────────
    await loginAs(page, "admin");
    await page.goto("/admin?tab=markets");
    await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible();

    const row = page.getByTestId("admin-market-row").filter({
      has: page.locator(`[data-market-id="${marketId}"]`),
    });
    const marketRow = (await row.count())
      ? row
      : page.locator(`[data-testid="admin-market-row"][data-market-id="${marketId}"]`);
    await expect(marketRow).toBeVisible();

    // AdminMarkets uses a two-click confirm: "Resolve YES" → "Confirm YES".
    const resolveYes = marketRow.getByTestId("admin-resolve-yes");
    await resolveYes.click();
    await expect(resolveYes).toHaveText(/Confirm YES/);
    await resolveYes.click();

    await expect
      .poll(async () => (await getMarket(marketId)).status, { timeout: 15_000 })
      .toBe("resolved_yes");

    // ── 6. Payout, streak, notifications ───────────────────────────────────
    const resolved = await getMarket(marketId);
    expect(resolved.resolved_at).not.toBeNull();
    expect(resolved.resolved_by).toBe(userId("admin"));

    const wonPosition = await getPosition(marketId, alice);
    expect(wonPosition.status).toBe("won");
    expect(wonPosition.payout).toBe(EXPECTED_PAYOUT);

    const paidProfile = await getProfile(alice);
    // 1000 - 100 stake + 200 payout = 1100. Exact, not "more than before".
    expect(paidProfile.coins).toBe(START_COINS - STAKE + EXPECTED_PAYOUT);
    expect(paidProfile.wins).toBe(1);
    // update_user_streaks trigger fires on the position status change.
    expect(paidProfile.win_streak).toBe(1);
    expect(paidProfile.loss_streak).toBe(0);

    const notifications = await getNotifications(alice);
    const types = notifications.map((n) => n.type);
    expect(types).toContain("payout_received");

    // Asserting CURRENT behaviour deliberately: `resolve_market` (0007) emits
    // exactly one notification, `payout_received`, and only to winners. The
    // `market_resolved` enum value is declared in 0002 but is never inserted by
    // any migration or any code path — so losers are told nothing at all when a
    // market they bet on resolves. Spec §10.6 claimed both notifications fire;
    // that was aspirational and has been corrected.
    //
    // This assertion pins the gap rather than papering over it: if someone adds
    // the missing notification, this line fails and forces a deliberate update.
    expect(types).not.toContain("market_resolved");

    const payout = notifications.find((n) => n.type === "payout_received")!;
    expect(payout.title).toBe("You won! 🎉");
    expect(payout.body).toContain(`paid out ${EXPECTED_PAYOUT} coins`);

    // ── 7. Leaderboard reflects the new balance ────────────────────────────
    await loginAs(page, "alice");
    await page.goto("/notifications");

    const aliceRow = page
      .getByTestId("leaderboard-row")
      .filter({ has: page.locator('[data-username="e2ealice"]') });
    const leaderboardRow = (await aliceRow.count())
      ? aliceRow
      : page.locator('[data-testid="leaderboard-row"][data-username="e2ealice"]');
    await expect(leaderboardRow).toHaveAttribute(
      "data-coins",
      String(START_COINS - STAKE + EXPECTED_PAYOUT)
    );

    // The resolution notification renders in the notification list.
    await expect(
      page.locator('[data-testid="notification-item"][data-type="payout_received"]').first()
    ).toBeVisible();
  });
});
