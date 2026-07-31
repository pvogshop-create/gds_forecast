import { expect, test } from "@playwright/test";
import {
  getCoins,
  getMarket,
  getNotifications,
  getPosition,
  getPositions,
  getProfile,
} from "./helpers/db";
import {
  createMarket,
  loadSeededUsers,
  placeBetAs,
  resolveMarketAs,
  setCoins,
  setProfileFields,
  userId,
} from "./helpers/seed";

/**
 * Resolution and payouts, asserted to the exact coin.
 *
 * payout = ROUND(coins_wagered * american_odds_multiplier(side_odds)) where
 *   side_odds = yes_odds_at_bet          for a YES position
 *             = -yes_odds_at_bet         for a NO position
 * and american_odds_multiplier(o) = (100+o)/100 for o >= 0, (|o|+100)/|o| otherwise.
 *
 * The payout is fully decoupled from the pool: nothing is scaled to available
 * money, so these numbers depend only on the stake and the locked odds.
 */
test.describe("resolution and payouts", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test.beforeEach(async () => {
    for (const key of ["alice", "bob"] as const) {
      await setCoins(key, 1_000);
      await setProfileFields(key, { wins: 0, total_bets: 0, win_streak: 0, loss_streak: 0 });
    }
  });

  test("winners are paid at their own locked odds; losers get exactly nothing", async () => {
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });

    // Alice bets YES at p=0.5 → locked -100 → multiplier 2.0 → 200 on a win.
    await placeBetAs("alice", marketId, "yes", 100);
    // Bob then bets NO. Market is 200/100 → p=0.6667 → locked yes odds -200,
    // so Bob's NO side odds are +200 → multiplier 3.0 → 300 on a win.
    await placeBetAs("bob", marketId, "no", 100);

    await resolveMarketAs(marketId, "yes", "E2E resolution");

    const alicePos = await getPosition(marketId, userId("alice"));
    expect(alicePos.status).toBe("won");
    expect(alicePos.payout).toBe(200);
    expect(await getCoins(userId("alice"))).toBe(1_000 - 100 + 200);

    const bobPos = await getPosition(marketId, userId("bob"));
    expect(bobPos.status).toBe("lost");
    expect(bobPos.payout).toBe(0);
    // Loser's stake is gone and nothing is returned. Exactly 900, not "less".
    expect(await getCoins(userId("bob"))).toBe(900);

    const market = await getMarket(marketId);
    expect(market.status).toBe("resolved_yes");
    expect(market.resolution_note).toBe("E2E resolution");
    expect(market.resolved_at).not.toBeNull();
  });

  test("a NO winner is paid at the negated locked odds", async () => {
    // 320/180 → p=0.64 → locked yes odds -178 → NO side odds +178
    // → multiplier 2.78 → 100 * 2.78 = 278.
    const marketId = await createMarket({ yesPool: 320, noPool: 180 });
    await placeBetAs("alice", marketId, "no", 100);
    await resolveMarketAs(marketId, "no");

    const position = await getPosition(marketId, userId("alice"));
    expect(position.yes_odds_at_bet).toBe(-178);
    expect(position.status).toBe("won");
    expect(position.payout).toBe(278);
    expect(await getCoins(userId("alice"))).toBe(1_000 - 100 + 278);
  });

  test("wins and streaks update, and a loss resets the win streak", async () => {
    // Win first.
    const winMarket = await createMarket({ yesPool: 100, noPool: 100 });
    await placeBetAs("alice", winMarket, "yes", 50);
    await resolveMarketAs(winMarket, "yes");

    let profile = await getProfile(userId("alice"));
    expect(profile.wins).toBe(1);
    expect(profile.win_streak).toBe(1);
    expect(profile.loss_streak).toBe(0);

    // Second win → streak 2.
    const winMarket2 = await createMarket({ yesPool: 100, noPool: 100 });
    await placeBetAs("alice", winMarket2, "yes", 50);
    await resolveMarketAs(winMarket2, "yes");
    profile = await getProfile(userId("alice"));
    expect(profile.wins).toBe(2);
    expect(profile.win_streak).toBe(2);

    // Then a loss → win streak resets to 0, loss streak becomes 1.
    const lossMarket = await createMarket({ yesPool: 100, noPool: 100 });
    await placeBetAs("alice", lossMarket, "yes", 50);
    await resolveMarketAs(lossMarket, "no");
    profile = await getProfile(userId("alice"));
    expect(profile.wins).toBe(2); // unchanged
    expect(profile.win_streak).toBe(0);
    expect(profile.loss_streak).toBe(1);
  });

  test("both the winner and the loser are told the market resolved", async () => {
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    await placeBetAs("alice", marketId, "yes", 100);
    await placeBetAs("bob", marketId, "no", 100);
    await resolveMarketAs(marketId, "yes");

    // Scoped to this market: earlier tests in this file also resolve markets for
    // alice, so an unscoped count would be order-dependent.
    const aliceNotifs = (
      await getNotifications(userId("alice"), "payout_received")
    ).filter((n) => (n.data as { market_id?: string } | null)?.market_id === marketId);
    expect(aliceNotifs).toHaveLength(1);
    expect(aliceNotifs[0]!.title).toBe("You won! 🎉");
    expect(aliceNotifs[0]!.body).toContain("paid out 200 coins");

    // Until 0026 this asserted `toHaveLength(0)` — losers were told nothing at
    // all, and the only signal that a market you bet on had resolved was your own
    // balance moving. `market_resolved` had been sitting unused in the enum since
    // 0002. The gap was pinned here deliberately so that closing it would fail
    // this test rather than pass silently; this is that update.
    const bobNotifs = (await getNotifications(userId("bob"))).filter(
      (n) => (n.data as { market_id?: string } | null)?.market_id === marketId
    );
    expect(bobNotifs).toHaveLength(1);
    expect(bobNotifs[0]!.type).toBe("market_resolved");
    expect(bobNotifs[0]!.title).toBe("Market resolved");
    // Names the outcome, the side they were on, and what it cost them.
    expect(bobNotifs[0]!.body).toContain("resolved YES");
    expect(bobNotifs[0]!.body).toContain("Your NO position (100 coins)");
    expect(bobNotifs[0]!.data).toMatchObject({
      market_id: marketId,
      outcome: "yes",
      coins_wagered: 100,
      positions: 1,
    });

    // The loser is told, and is still paid nothing.
    expect(await getCoins(userId("bob"))).toBe(900);
  });

  test("several losing positions collapse into one notification with the summed stake", async () => {
    // `positions` has no UNIQUE (market_id, user_id), so a user can lose three
    // separate bets on one market. Winners get one notification per position
    // (each pays at its own locked odds); losers get one per MARKET, because
    // three consecutive "you lost" messages is a worse experience than three
    // "you won" ones and there is no per-position number worth separating.
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    await placeBetAs("alice", marketId, "yes", 100);
    await placeBetAs("bob", marketId, "no", 50);
    await placeBetAs("bob", marketId, "no", 30);
    await placeBetAs("bob", marketId, "no", 20);

    await resolveMarketAs(marketId, "yes");

    const bobNotifs = (await getNotifications(userId("bob"))).filter(
      (n) => (n.data as { market_id?: string } | null)?.market_id === marketId
    );
    expect(bobNotifs).toHaveLength(1);
    expect(bobNotifs[0]!.body).toContain("Your NO position (100 coins)");
    expect(bobNotifs[0]!.data).toMatchObject({ coins_wagered: 100, positions: 3 });

    // All three positions really were resolved, not just the one that was named.
    const bobPositions = await getPositions(marketId, userId("bob"));
    expect(bobPositions).toHaveLength(3);
    expect(bobPositions.every((p) => p.status === "lost")).toBe(true);
    expect(bobPositions.every((p) => p.payout === 0)).toBe(true);
  });

  test("a market where nobody lost writes no resolution notification", async () => {
    // The GROUP BY runs over a data-modifying CTE, so an empty losing set must
    // produce zero rows rather than one aggregate row for nobody.
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    await placeBetAs("alice", marketId, "yes", 100);

    await resolveMarketAs(marketId, "yes");

    const resolved = (await getNotifications(userId("alice"), "market_resolved")).filter(
      (n) => (n.data as { market_id?: string } | null)?.market_id === marketId
    );
    expect(resolved).toHaveLength(0);
  });

  test("resolution records the resolving admin and appends a won activity entry", async () => {
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    await placeBetAs("alice", marketId, "yes", 100);
    await resolveMarketAs(marketId, "yes");

    expect((await getMarket(marketId)).resolved_by).toBe(userId("admin"));

    const { getActivity } = await import("./helpers/db");
    const activity = await getActivity(marketId);
    expect(activity.some((a) => a.action_type === "market_won")).toBe(true);
  });

  test("an already-resolved market cannot be resolved again", async () => {
    const marketId = await createMarket({ status: "resolved_yes" });
    await expect(resolveMarketAs(marketId, "no")).rejects.toThrow(
      /Market cannot be resolved/
    );
  });

  test("an invalid outcome is rejected", async () => {
    const marketId = await createMarket();
    // Deliberately bypasses the typed helper to hit the RPC's own guard.
    const { admin } = await import("./helpers/db");
    const { error } = await admin.rpc("resolve_market", {
      p_market_id: marketId,
      p_outcome: "maybe",
      p_admin_id: userId("admin"),
      p_note: null,
    });
    expect(error?.message).toMatch(/Invalid outcome/);
    expect((await getMarket(marketId)).status).toBe("open");
  });

  test("resolving a closed (not just open) market still pays out", async () => {
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    await placeBetAs("alice", marketId, "yes", 100);
    const { setMarketStatus } = await import("./helpers/seed");
    await setMarketStatus(marketId, "closed");

    await resolveMarketAs(marketId, "yes");
    expect((await getPosition(marketId, userId("alice"))).payout).toBe(200);
  });

  test("an authenticated (non-service-role) caller cannot resolve a market", async () => {
    const marketId = await createMarket();
    const { anonClientFor } = await import("./helpers/db");
    const { USERS } = await import("./helpers/fixtures");

    // Signed in as a normal user, calling the RPC directly — the real
    // authorization boundary, not a hidden button.
    const alice = await anonClientFor(USERS.alice.email);
    const { error } = await alice.rpc("resolve_market", {
      p_market_id: marketId,
      p_outcome: "yes",
      p_admin_id: userId("alice"),
      p_note: null,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/may only be called by admin/);
    expect((await getMarket(marketId)).status).toBe("open");
  });

  test("even the admin fixture cannot resolve through an authenticated client", async () => {
    // Admin-ness is an app-layer email allowlist, not a DB role: the RPC gates on
    // auth.role() = 'service_role', which no browser session ever has.
    const marketId = await createMarket();
    const { anonClientFor } = await import("./helpers/db");
    const { USERS } = await import("./helpers/fixtures");

    const adminClient = await anonClientFor(USERS.admin.email);
    const { error } = await adminClient.rpc("resolve_market", {
      p_market_id: marketId,
      p_outcome: "yes",
      p_admin_id: userId("admin"),
      p_note: null,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/may only be called by admin/);
  });

  test("multiple winners are each paid at their own odds independently", async () => {
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    await setCoins("owner", 5_000);

    await placeBetAs("alice", marketId, "yes", 100); // locked -100 → 200
    // Market now 200/100 → p 0.6667 → locked -200 → multiplier 1.5 → 150.
    await placeBetAs("owner", marketId, "yes", 100);

    await resolveMarketAs(marketId, "yes");

    expect((await getPosition(marketId, userId("alice"))).payout).toBe(200);
    expect((await getPosition(marketId, userId("owner"))).payout).toBe(150);
    // Different payouts from identical stakes — the locked-odds model in one line.
  });
});
