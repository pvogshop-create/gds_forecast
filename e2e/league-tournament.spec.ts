import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import {
  getActiveWeek,
  getCoins,
  getLeague,
  getLeagueBets,
  getLeagueMembers,
  getNotifications,
  getPosition,
  getWeek,
  getWeekParticipants,
} from "./helpers/db";
import {
  closeWeek,
  createLeague,
  createMarket,
  loadSeededUsers,
  placeBetAs,
  resolveMarketAs,
  setCoins,
  startWeek,
  tagBetToLeague,
  userId,
  widenWeekWindow,
} from "./helpers/seed";

/**
 * The weekly league tournament.
 *
 * There is NO user interface for the week lifecycle — no start-week or
 * close-week control exists anywhere in the app; weeks move only via the
 * `start_league_week` / `close_league_week` RPCs, which the Vercel cron calls.
 * So these tests drive those RPCs directly and then assert that the UI reflects
 * the result, which is the honest shape of the feature as built.
 *
 * These tests also depend on migration 0023: `close_league_week` inserts a
 * `league_win` notification, and before that enum value existed the whole payout
 * transaction aborted whenever a week had a winner.
 */
test.describe("league tournament: weeks, buy-ins, scoring, payout", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test("starting a week collects the buy-in from every member who can afford it", async () => {
    await setCoins("owner", 1_000);
    await setCoins("alice", 1_000);
    await setCoins("broke", 25); // cannot afford a 100-coin buy-in

    const { id } = await createLeague({
      creator: "owner",
      members: ["alice", "broke"],
      buyInCoins: 100,
    });

    const week = await startWeek(id);
    expect(week.week_number).toBe(1);
    // Only the two who could pay.
    expect(week.participants).toBe(2);
    expect(week.pool_coins).toBe(200);

    expect(await getCoins(userId("owner"))).toBe(900);
    expect(await getCoins(userId("alice"))).toBe(900);
    // Skipped, not charged, not a participant.
    expect(await getCoins(userId("broke"))).toBe(25);

    const participants = await getWeekParticipants(week.week_id);
    expect(participants).toHaveLength(2);
    expect(participants.every((p) => p.buy_in_paid === 100)).toBe(true);
    expect(participants.map((p) => p.user_id)).not.toContain(userId("broke"));
  });

  test("a league with no week_start_date cannot start a week", async () => {
    const { id } = await createLeague({ creator: "owner" });
    const { admin } = await import("./helpers/db");
    await admin.from("leagues").update({ week_start_date: null }).eq("id", id);

    await expect(startWeek(id)).rejects.toThrow(/has no week_start_date set/);
  });

  test("the active week and pool are shown on the league page", async ({ page }) => {
    await setCoins("owner", 1_000);
    await setCoins("alice", 1_000);
    const { id } = await createLeague({
      creator: "owner",
      members: ["alice"],
      buyInCoins: 100,
    });
    const week = await startWeek(id);

    await loginAs(page, "owner");
    await page.goto(`/leagues/${id}`);
    await expect(page.getByTestId("league-pool")).toHaveAttribute(
      "data-pool",
      String(week.pool_coins)
    );
    await expect(page.getByText(/Week 1/).first()).toBeVisible();
  });

  test("a tagged bet counts toward the week and shows in live scores", async ({ page }) => {
    await setCoins("owner", 2_000);
    await setCoins("alice", 2_000);
    const { id } = await createLeague({
      creator: "owner",
      members: ["alice"],
      buyInCoins: 100,
    });
    const week = await startWeek(id);

    const marketId = await createMarket({ yesPool: 100, noPool: 100 });

    // Tag through the real bet API, which is where league_bets is written.
    await loginAs(page, "alice");
    const res = await page.request.post(`/api/markets/${marketId}/bet`, {
      data: { side: "yes", coins: 100, league_id: id },
    });
    expect(res.ok()).toBe(true);

    const bets = await getLeagueBets(week.week_id);
    expect(bets).toHaveLength(1);
    expect(bets[0]!.user_id).toBe(userId("alice"));

    // The league page lists the bettor in this week's live standings, sourced
    // from get_live_week_scores.
    await page.goto(`/leagues/${id}`);
    const row = page.locator(
      `[data-testid="weekly-standings-row"][data-user-id="${userId("alice")}"]`
    );
    await expect(row).toBeVisible();
  });

  test("an untagged bet counts toward no league", async ({ page }) => {
    await setCoins("owner", 2_000);
    await setCoins("alice", 2_000);
    const { id } = await createLeague({
      creator: "owner",
      members: ["alice"],
      buyInCoins: 100,
    });
    const week = await startWeek(id);
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });

    await loginAs(page, "alice");
    // No league_id in the body — the deliberate opt-in model.
    const res = await page.request.post(`/api/markets/${marketId}/bet`, {
      data: { side: "yes", coins: 100 },
    });
    expect(res.ok()).toBe(true);

    expect(await getLeagueBets(week.week_id)).toHaveLength(0);
  });

  test("closing a week pays the pool to the top earner and awards golf points", async () => {
    await setCoins("owner", 2_000);
    await setCoins("alice", 2_000);
    const { id } = await createLeague({
      creator: "owner",
      members: ["alice"],
      buyInCoins: 100,
    });
    const week = await startWeek(id);
    expect(week.pool_coins).toBe(200);

    // Alice wins her tagged bet; the owner tags nothing.
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    const bet = await placeBetAs("alice", marketId, "yes", 100);
    await tagBetToLeague(bet.position_id, id, week.week_id, "alice");
    await resolveMarketAs(marketId, "yes");
    expect((await getPosition(marketId, userId("alice"))).payout).toBe(200);

    // close_league_week only counts payouts with
    // markets.resolved_at BETWEEN week_start AND week_end.
    await widenWeekWindow(week.week_id);

    const coinsBeforeClose = await getCoins(userId("alice"));
    const result = await closeWeek(week.week_id);

    expect(result.status).toBe("completed");
    expect(result.winner_count).toBe(1);
    expect(result.payout_per_winner).toBe(200);

    // Winner receives the whole pool, exactly.
    expect(await getCoins(userId("alice"))).toBe(coinsBeforeClose + 200);

    // Golf ranks: winner 1, the other participant 2.
    const participants = await getWeekParticipants(week.week_id);
    const alicePart = participants.find((p) => p.user_id === userId("alice"))!;
    const ownerPart = participants.find((p) => p.user_id === userId("owner"))!;
    expect(alicePart.gross_payout).toBe(200);
    expect(alicePart.points).toBe(1);
    expect(ownerPart.gross_payout).toBe(0);
    expect(ownerPart.points).toBe(2);

    // Cumulative totals accrue on the membership row.
    const members = await getLeagueMembers(id);
    expect(members.find((m) => m.user_id === userId("alice"))!.total_points).toBe(1);
    expect(members.find((m) => m.user_id === userId("alice"))!.weeks_played).toBe(1);

    expect((await getWeek(week.week_id)).status).toBe("completed");

    // The league_win notification — the exact insert that used to abort the
    // whole transaction before migration 0023 added the enum value.
    const notifs = await getNotifications(userId("alice"), "league_win");
    expect(notifs.length).toBeGreaterThan(0);
  });

  test("a week with no winning bets rolls the pool over instead of paying out", async () => {
    await setCoins("owner", 2_000);
    await setCoins("alice", 2_000);
    const { id } = await createLeague({
      creator: "owner",
      members: ["alice"],
      buyInCoins: 100,
    });
    const week = await startWeek(id);
    expect(week.pool_coins).toBe(200);

    // Nobody tags a winning bet, so every gross_payout is 0.
    const result = await closeWeek(week.week_id);
    expect(result.status).toBe("rolled_over");
    expect(result.pool_coins).toBe(200);

    expect((await getWeek(week.week_id)).status).toBe("rolled_over");
    // The pool is banked on the league for the next week.
    expect((await getLeague(id)).carry_over_pool).toBe(200);
  });

  test("a carried-over pool seeds the following week", async () => {
    await setCoins("owner", 2_000);
    await setCoins("alice", 2_000);
    const { id } = await createLeague({
      creator: "owner",
      members: ["alice"],
      buyInCoins: 100,
      carryOverPool: 500,
    });

    const week = await startWeek(id);
    // 500 carried + 2 x 100 buy-in.
    expect(week.pool_coins).toBe(700);
    // And the carry-over is consumed, not double-counted.
    expect((await getLeague(id)).carry_over_pool).toBe(0);
  });

  test("an already-closed week cannot be closed twice", async () => {
    await setCoins("owner", 2_000);
    const { id } = await createLeague({ creator: "owner", buyInCoins: 100 });
    const week = await startWeek(id);
    await closeWeek(week.week_id);
    await expect(closeWeek(week.week_id)).rejects.toThrow(/is not active/);
  });

  test("week numbers increment and only one week is active at a time", async () => {
    await setCoins("owner", 2_000);
    const { id } = await createLeague({ creator: "owner", buyInCoins: 100 });

    const first = await startWeek(id);
    expect(first.week_number).toBe(1);
    await closeWeek(first.week_id);
    expect(await getActiveWeek(id)).toBeNull();

    const second = await startWeek(id);
    expect(second.week_number).toBe(2);
    expect((await getActiveWeek(id))!.id).toBe(second.week_id);
  });

  // The /api/cron/* auth boundary (missing secret, wrong secret, session-instead
  // -of-secret, and the valid-secret happy path) is asserted once in
  // authorization.spec.ts rather than duplicated here.
});
