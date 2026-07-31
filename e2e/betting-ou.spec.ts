import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import {
  getCoins,
  getMarket,
  getNotifications,
  getPosition,
  getPositions,
  getProfile,
  num,
} from "./helpers/db";
import {
  createMarket,
  loadSeededUsers,
  placeOuBetAs,
  resolveOuMarketAs,
  setCoins,
  setProfileFields,
  userId,
} from "./helpers/seed";

/**
 * Over/Under betting, plus the admin's binary line-setting control.
 *
 * O/U economics differ from binary entirely (place_ou_bet, 0013):
 *   price_at_bet    = 0.5 always
 *   yes_odds_at_bet = 100 always  (both sides +100 → 2× payout)
 *   shares_bought   = coins * 2
 *   line shift      = 0.5 * CEIL(coins / 100), up for OVER, down for UNDER
 *   payout          = coins * 2 on a win; an exact tie is a PUSH
 * No probability-history row is written, so the chart never appears.
 */
test.describe("betting: over/under markets", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test.beforeEach(async () => {
    // Both actors, not just alice: one test stakes 250 as bob, and bob's balance
    // is otherwise whatever earlier specs left it at. Resetting only the primary
    // actor is how this file acquired an intermittent "Insufficient coins".
    await setCoins("alice", 1_000);
    await setCoins("bob", 1_000);
  });

  test("an OVER bet pays 2x, locks the line, and pushes the line up", async ({ page }) => {
    const marketId = await createMarket({
      marketType: "over_under",
      ouLine: 3.5,
      ouUnit: "pts",
    });
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    await page.getByTestId("bet-side-yes").click(); // OVER
    await page.getByTestId("bet-amount-input").fill("100");

    // 100 coins → shift 0.5*ceil(1) = 0.5 → new line 4.0; payout 200.
    await expect(page.getByTestId("bet-preview-payout")).toHaveAttribute(
      "data-payout",
      "200"
    );
    await expect(page.getByTestId("bet-preview-new-line")).toHaveAttribute("data-line", "4");

    await page.getByTestId("bet-submit").click();
    await expect(page.getByTestId("bet-success")).toBeVisible();

    const position = await getPosition(marketId, userId("alice"));
    expect(position.side).toBe("yes");
    expect(position.coins_wagered).toBe(100);
    expect(position.yes_odds_at_bet).toBe(100);
    expect(num(position.price_at_bet)).toBeCloseTo(0.5, 4);
    expect(num(position.shares_bought)).toBeCloseTo(200, 6);
    // The line the bet was graded against is frozen on the position.
    expect(num(position.ou_line_at_bet!)).toBeCloseTo(3.5, 2);

    expect(num((await getMarket(marketId)).ou_line!)).toBeCloseTo(4.0, 2);
    expect(await getCoins(userId("alice"))).toBe(900);
  });

  test("an UNDER bet pushes the line down", async ({ page }) => {
    const marketId = await createMarket({
      marketType: "over_under",
      ouLine: 3.5,
      ouUnit: "pts",
    });
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    await page.getByTestId("bet-side-no").click(); // UNDER
    await page.getByTestId("bet-amount-input").fill("100");
    await expect(page.getByTestId("bet-preview-new-line")).toHaveAttribute("data-line", "3");
    await page.getByTestId("bet-submit").click();
    await expect(page.getByTestId("bet-success")).toBeVisible();

    expect(num((await getMarket(marketId)).ou_line!)).toBeCloseTo(3.0, 2);
    const position = await getPosition(marketId, userId("alice"));
    expect(position.side).toBe("no");
    expect(num(position.ou_line_at_bet!)).toBeCloseTo(3.5, 2);
  });

  test("the line shift scales with stake size", async () => {
    const marketId = await createMarket({
      marketType: "over_under",
      ouLine: 10,
      ouUnit: "pts",
    });
    // 150 coins → 0.5 * ceil(1.5) = 1.0 → line 11.
    await placeOuBetAs("alice", marketId, "yes", 150);
    expect(num((await getMarket(marketId)).ou_line!)).toBeCloseTo(11.0, 2);

    // 250 more → 0.5 * ceil(2.5) = 1.5 → line 12.5.
    await placeOuBetAs("bob", marketId, "yes", 250);
    expect(num((await getMarket(marketId)).ou_line!)).toBeCloseTo(12.5, 2);
  });

  test("resolution above the line pays OVER exactly 2x and pays UNDER nothing", async () => {
    const marketId = await createMarket({
      marketType: "over_under",
      ouLine: 3.5,
      ouUnit: "pts",
    });
    await setCoins("alice", 1_000);
    await setCoins("bob", 1_000);

    // Both graded against the line as it stood for each of them.
    await placeOuBetAs("alice", marketId, "yes", 100); // OVER @ 3.5 → line becomes 4.0
    await placeOuBetAs("bob", marketId, "no", 100); //   UNDER @ 4.0 → line becomes 3.5

    // Result 5 → above both locked lines → OVER wins, UNDER loses.
    await resolveOuMarketAs(marketId, 5);

    const alicePos = await getPosition(marketId, userId("alice"));
    expect(alicePos.status).toBe("won");
    expect(alicePos.payout).toBe(200); // coins * 2, exactly
    expect(await getCoins(userId("alice"))).toBe(1_000 - 100 + 200);

    const bobPos = await getPosition(marketId, userId("bob"));
    expect(bobPos.status).toBe("lost");
    expect(bobPos.payout).toBe(0);
    expect(await getCoins(userId("bob"))).toBe(900); // stake gone, nothing back

    const market = await getMarket(marketId);
    expect(market.status).toBe("resolved_yes");
    expect(num(market.resolution_value!)).toBeCloseTo(5, 2);
  });

  test("an O/U winner and an O/U loser are each notified", async () => {
    // Before 0026 only the WIN branch of resolve_ou_market inserted anything, so
    // an O/U loser was told nothing — the same gap as the binary path.
    const marketId = await createMarket({
      marketType: "over_under",
      ouLine: 3.5,
      ouUnit: "pts",
    });
    await placeOuBetAs("alice", marketId, "yes", 100); // OVER @ 3.5
    await placeOuBetAs("bob", marketId, "no", 100); //   UNDER @ 4.0

    await resolveOuMarketAs(marketId, 5); // above both → alice wins, bob loses

    const aliceNotifs = (await getNotifications(userId("alice"))).filter(
      (n) => (n.data as { market_id?: string } | null)?.market_id === marketId
    );
    expect(aliceNotifs).toHaveLength(1);
    expect(aliceNotifs[0]!.type).toBe("payout_received");
    // 0026 widened this payload to match the binary path, which already carried
    // market_title; the O/U version had only market_id and payout.
    expect(aliceNotifs[0]!.data).toMatchObject({ payout: 200 });
    expect(aliceNotifs[0]!.data).toHaveProperty("market_title");

    const bobNotifs = (await getNotifications(userId("bob"))).filter(
      (n) => (n.data as { market_id?: string } | null)?.market_id === marketId
    );
    expect(bobNotifs).toHaveLength(1);
    expect(bobNotifs[0]!.type).toBe("market_resolved");
    expect(bobNotifs[0]!.title).toBe("Market resolved");
    // Single losing position → the side is named.
    expect(bobNotifs[0]!.body).toContain("Your UNDER bet (100 coins)");
    expect(bobNotifs[0]!.data).toMatchObject({ coins_wagered: 100, positions: 1 });
  });

  test("a push is announced rather than silently refunded", async () => {
    // The sneakiest of the three gaps 0026 closed: a push moved coins back into
    // the balance and said nothing at all, so the only evidence a user had that
    // their bet was a tie was the number changing.
    const marketId = await createMarket({
      marketType: "over_under",
      ouLine: 4,
      ouUnit: "pts",
    });
    await placeOuBetAs("alice", marketId, "yes", 100); // OVER @ line 4
    await resolveOuMarketAs(marketId, 4); // exactly the line → push

    const notifs = (await getNotifications(userId("alice"))).filter(
      (n) => (n.data as { market_id?: string } | null)?.market_id === marketId
    );
    expect(notifs).toHaveLength(1);
    expect(notifs[0]!.type).toBe("market_resolved");
    expect(notifs[0]!.title).toBe("Market pushed");
    expect(notifs[0]!.body).toContain("a push");
    expect(notifs[0]!.body).toContain("100 coins were refunded");
    expect(notifs[0]!.data).toMatchObject({ refunded: 100, positions: 1, push: true });

    // The push is a push: net zero, and no payout notification claiming a win.
    expect(await getCoins(userId("alice"))).toBe(1_000);
    expect(notifs.filter((n) => n.type === "payout_received")).toHaveLength(0);
  });

  test("an exact tie is a push: stake returned, but it does not count as a win", async () => {
    const marketId = await createMarket({
      marketType: "over_under",
      ouLine: 4,
      ouUnit: "pts",
    });
    await setCoins("alice", 1_000);
    await setProfileFields("alice", { wins: 0, win_streak: 0, loss_streak: 0 });

    await placeOuBetAs("alice", marketId, "yes", 100); // OVER @ line 4
    await resolveOuMarketAs(marketId, 4); // exactly the line

    const position = await getPosition(marketId, userId("alice"));
    // resolve_ou_market marks a push as 'won' with payout == stake…
    expect(position.status).toBe("won");
    expect(position.payout).toBe(100);
    // …so the balance is exactly restored, net zero.
    expect(await getCoins(userId("alice"))).toBe(1_000);

    const after = await getProfile(userId("alice"));
    // `resolve_ou_market` deliberately does NOT increment `wins` for a push.
    expect(after.wins).toBe(0);

    // …but it DOES extend the win streak, and that is a bug (spec §12.4).
    // `update_user_streaks` (0020) keys off a position's status becoming 'won',
    // and a push is stored as 'won' with payout == stake because there is no
    // 'push' value in the position_status enum. So a tie — where the user won
    // nothing — inflates their 🔥 Hot Streak and can put them on the Stat
    // Leaders board.
    //
    // Pinned rather than asserted-as-correct: fixing it needs a migration and a
    // design call (add a 'push' status, or have the trigger compare payout to
    // stake). When that lands, this assertion fails and must be flipped to 0.
    expect(after.win_streak).toBe(1);
    expect(after.loss_streak).toBe(0);
  });

  test("O/U markets have no probability chart and no pools", async ({ page }) => {
    const marketId = await createMarket({
      marketType: "over_under",
      ouLine: 2.5,
      ouUnit: "goals",
    });
    await placeOuBetAs("alice", marketId, "yes", 100);

    const market = await getMarket(marketId);
    // Pools DO accumulate for O/U — place_ou_bet adds the stake to the bet
    // side's pool just like place_bet, so the pools act as a volume tally. What
    // makes O/U different is that price comes from the LINE, not the pool ratio:
    // yes_probability is meaningless here and no history row is written.
    expect(num(market.yes_pool)).toBe(100);
    expect(num(market.no_pool)).toBe(0);

    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);
    await expect(page.getByTestId("probability-chart")).toHaveCount(0);
  });

  test("the API routes O/U bets to place_ou_bet, not place_bet", async ({ page }) => {
    const marketId = await createMarket({
      marketType: "over_under",
      ouLine: 3.5,
      ouUnit: "pts",
    });
    await loginAs(page, "alice");
    const res = await page.request.post(`/api/markets/${marketId}/bet`, {
      data: { side: "yes", coins: 100 },
    });
    expect(res.ok()).toBe(true);
    // place_ou_bet's signature is the tell: fixed +100 odds and 2x shares.
    const position = await getPosition(marketId, userId("alice"));
    expect(position.yes_odds_at_bet).toBe(100);
    expect(num(position.shares_bought)).toBeCloseTo(200, 6);
  });

  test("an O/U market with no line set refuses bets", async ({ page }) => {
    // Built by hand so ou_line is null — createMarket always sets one.
    const { admin } = await import("./helpers/db");
    const { data, error: insertError } = await admin
      .from("markets")
      .insert({
        title: "[E2E] OU no line",
        description: "No line set.",
        category: "sports",
        status: "open",
        market_type: "over_under",
        yes_pool: 0,
        no_pool: 0,
        creator_id: userId("admin"),
        resolution_date: new Date(Date.now() + 86_400_000).toISOString(),
      })
      .select("id")
      .single();
    // Explicit, so a failed insert reports itself rather than surfacing as
    // "Cannot read properties of null" three lines later.
    if (insertError || !data) {
      throw new Error(`seeding a line-less O/U market failed: ${insertError?.message}`);
    }

    await loginAs(page, "alice");
    const res = await page.request.post(`/api/markets/${data.id}/bet`, {
      data: { side: "yes", coins: 50 },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("This market does not have a line set yet.");
    expect(await getPositions(data.id as string)).toHaveLength(0);
  });

  test("O/U bets obey the same calibration ramp as binary bets", async ({ page }) => {
    // place_ou_bet carries its own copy of the 200/300/400 ramp (0013). It had
    // no coverage at all, so a regression there would have been invisible —
    // 0010's older flat 100-coin cap could have been reinstated unnoticed.
    const marketId = await createMarket({
      marketType: "over_under",
      ouLine: 3.5,
      ouUnit: "pts",
    });
    await setCoins("alice", 5_000);
    await loginAs(page, "alice");

    for (const [index, cap] of [200, 300, 400].entries()) {
      const tooBig = await page.request.post(`/api/markets/${marketId}/bet`, {
        data: { side: "yes", coins: cap + 1 },
      });
      expect(tooBig.status()).toBe(400);
      expect((await tooBig.json()).error).toBe(
        `Calibration period: max ${cap} coins on this bet.`
      );
      expect(await getPositions(marketId)).toHaveLength(index);

      const atCap = await page.request.post(`/api/markets/${marketId}/bet`, {
        data: { side: "yes", coins: cap },
      });
      expect(atCap.ok()).toBe(true);
      expect(await getPositions(marketId)).toHaveLength(index + 1);
    }

    // Past the ramp, a stake far above the last cap is accepted.
    const big = await page.request.post(`/api/markets/${marketId}/bet`, {
      data: { side: "yes", coins: 1_000 },
    });
    expect(big.ok()).toBe(true);
  });

  // ─── Admin line-setting (binary) ──────────────────────────────────────────

  test("an admin can reset a binary market's line, preserving total volume", async ({
    page,
  }) => {
    // 100/100 → p 0.5. setMarketLine rewrites the pools to hit a target odds
    // while holding yes_pool + no_pool constant.
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });

    await loginAs(page, "admin");
    await page.goto("/admin?tab=markets");
    const row = page.locator(
      `[data-testid="admin-market-row"][data-market-id="${marketId}"]`
    );
    await expect(row).toBeVisible();

    // The odds input only mounts after the "Set Line" toggle is pressed.
    await row.getByTestId("admin-set-line-open").click();
    // Set the line to -300 → implied probability 300/400 = 0.75.
    await row.getByTestId("admin-set-line-input").fill("-300");
    await row.getByTestId("admin-set-line-confirm").click();

    await expect
      .poll(async () => num((await getMarket(marketId)).yes_probability), {
        timeout: 15_000,
      })
      .toBeCloseTo(0.75, 2);

    const market = await getMarket(marketId);
    // Total volume unchanged at 200 — the line moves, the money does not.
    expect(num(market.yes_pool) + num(market.no_pool)).toBe(200);
    expect(num(market.yes_pool)).toBe(150);
    expect(num(market.no_pool)).toBe(50);
  });

  test("a non-admin cannot reach the admin markets tab", async ({ page }) => {
    await loginAs(page, "alice");
    await page.goto("/admin?tab=markets");
    await expect(page).toHaveURL(/\/dashboard\/trending$/);
  });
});
