import { expect, test } from "@playwright/test";
import { admin, anonClientFor, getCoins, getMarket, getPositions, num } from "./helpers/db";
import {
  createMarket,
  loadSeededUsers,
  resetAllProfiles,
  setCoins,
  setProfileFields,
  userId,
} from "./helpers/seed";
import { USERS, type UserKey } from "./helpers/fixtures";
import { americanOddsToProb } from "../src/lib/market-logic";

/**
 * Concurrency safety of the two betting RPCs.
 *
 * The suite runs serially (`fullyParallel: false, workers: 1`) so that exact-value
 * assertions mean something — but that constrains only how tests relate to EACH
 * OTHER. A single test can still fire N simultaneous RPCs through `Promise.all`,
 * and since every `.rpc()` is its own fetch and PostgREST hands each one a
 * separate connection, that is real concurrency inside one Postgres. This file
 * is the whole reason that distinction matters: without it, the entire
 * lost-update class is untested.
 *
 * What is under test is the locking in `place_bet` / `place_ou_bet` (0013):
 *
 *   SELECT * INTO v_market FROM public.markets WHERE id = p_market_id FOR UPDATE;
 *   ...
 *   SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
 *
 * Both functions then write pools back as literals computed from that snapshot
 * (`SET yes_pool = v_new_yes_pool`, not `SET yes_pool = yes_pool + p_coins`).
 * That is textbook read-modify-write and would lose updates on its own; it is
 * correct ONLY because the row lock above is taken first and held to commit.
 * These tests exist to hold that pairing in place — if anyone ever removes the
 * `FOR UPDATE`, the RMW stops being safe and this file is what says so.
 *
 * Note which lock each test actually exercises. Concurrent bets from ONE user
 * serialize on the profile row whether or not the market lock exists, so a
 * single-user test cannot prove the market lock. Only the multi-user test can.
 */

/** Non-throwing `place_bet`, so a rejected bet is data rather than a failure. */
async function tryBet(
  user: UserKey,
  marketId: string,
  side: "yes" | "no",
  coins: number
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await admin.rpc("place_bet", {
    p_market_id: marketId,
    p_user_id: userId(user),
    p_side: side,
    p_coins: coins,
  });
  return { ok: !error, error: error?.message ?? null };
}

/** Non-throwing `place_ou_bet`. */
async function tryOuBet(
  user: UserKey,
  marketId: string,
  side: "yes" | "no",
  coins: number
): Promise<{ ok: boolean; error: string | null }> {
  const { error } = await admin.rpc("place_ou_bet", {
    p_market_id: marketId,
    p_user_id: userId(user),
    p_side: side,
    p_coins: coins,
  });
  return { ok: !error, error: error?.message ?? null };
}

test.describe("concurrent betting", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test.beforeEach(async () => {
    for (const key of ["alice", "bob", "owner", "admin"] as const) {
      await setCoins(key, 1_000);
      await setProfileFields(key, { total_bets: 0 });
    }
  });

  // These tests place tens of bets in bursts, so they leave `total_bets`, `wins`
  // and the streak counters far from where the fixtures declare them. Later specs
  // assert those to the exact integer (profile stats, the leaderboard, the
  // flagship loop), so restoring the declared state is this file's responsibility
  // rather than theirs — the suite's contract is "identity is shared, mutable
  // state is not."
  test.afterAll(async () => {
    await resetAllProfiles();
  });

  test("the market lock holds: four users betting at once lose no pool contribution", async () => {
    // The market-lock test. Four DISTINCT users means no contention on any
    // profile row, so the only thing serializing these is the market's own
    // `FOR UPDATE`. Drop that lock and all four read yes_pool = 100, each
    // computes 200, and the last writer wins — leaving a 200 pool that swallowed
    // 300 coins while all four users stay debited.
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    const bettors: UserKey[] = ["alice", "bob", "owner", "admin"];

    const results = await Promise.all(
      bettors.map((user) => tryBet(user, marketId, "yes", 100))
    );

    expect(results.filter((r) => r.ok)).toHaveLength(4);

    const market = await getMarket(marketId);
    // 100 opening + 4 × 100. Every coin taken from a user is present in the pool.
    expect(num(market.yes_pool)).toBe(500);
    expect(num(market.no_pool)).toBe(100);
    expect(await getPositions(marketId)).toHaveLength(4);

    for (const user of bettors) {
      expect(await getCoins(userId(user))).toBe(900);
    }
  });

  test("the profile lock holds: ten bets at once from one user debit exactly once each", async () => {
    // The profile-lock test. One user, so every call contends for the same
    // profile row. Without `FOR UPDATE` on profiles, several bets read
    // coins = 1000 and each writes 900 — the user bets 1000 coins and is charged
    // 100. (The deduction itself is `coins = coins - p_coins`, in place, so the
    // arithmetic survives; it is the balance CHECK that needs the lock, which is
    // what the overdraft test below pins down.)
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => tryBet("alice", marketId, "yes", 100))
    );

    expect(results.filter((r) => r.ok)).toHaveLength(10);
    expect(await getCoins(userId("alice"))).toBe(0);

    const market = await getMarket(marketId);
    expect(num(market.yes_pool)).toBe(1_100);
    expect(num(market.no_pool)).toBe(100);
    expect(await getPositions(marketId)).toHaveLength(10);
  });

  test("a user cannot overdraft by betting their whole balance simultaneously", async () => {
    // The money test, and the one that would have caught the bug this file was
    // written to look for. The balance guard is read-then-check:
    //
    //   SELECT * INTO v_profile ... FOR UPDATE;
    //   IF v_profile.coins < p_coins THEN RAISE EXCEPTION 'Insufficient coins...'
    //
    // Read-then-check is a TOCTOU hole unless the read is locked. It is locked,
    // so exactly one of these five can pass. Unlocked, all five read 100, all
    // five pass the check, and the balance lands at -400 — which nothing would
    // catch, because `profiles.coins` has no CHECK (coins >= 0) constraint.
    await setCoins("alice", 100);
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => tryBet("alice", marketId, "yes", 100))
    );

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const rejected = results.filter((r) => !r.ok);
    expect(rejected).toHaveLength(4);
    for (const r of rejected) {
      expect(r.error).toMatch(/Insufficient coins/);
    }

    const coins = await getCoins(userId("alice"));
    expect(coins).toBe(0);
    expect(coins).toBeGreaterThanOrEqual(0); // never negative, not merely "small"

    expect(await getPositions(marketId)).toHaveLength(1);
    expect(num((await getMarket(marketId)).yes_pool)).toBe(200);
  });

  test("the O/U line absorbs every simultaneous shift", async () => {
    // place_ou_bet writes `ou_line = v_new_line` — the same snapshot RMW, on the
    // column that IS the price for an over/under market. Shift per bet is
    // 0.5 × CEIL(coins / 100), so four 100-coin OVER bets move 3.5 → 5.5.
    // A lost update here silently under-prices the market for everyone after it.
    const marketId = await createMarket({
      marketType: "over_under",
      ouLine: 3.5,
      ouUnit: "pts",
    });

    const results = await Promise.all(
      Array.from({ length: 4 }, () => tryOuBet("alice", marketId, "yes", 100))
    );

    expect(results.filter((r) => r.ok)).toHaveLength(4);

    const market = await getMarket(marketId);
    expect(num(market.ou_line)).toBe(5.5);
    expect(num(market.yes_pool)).toBe(400);
    expect(await getCoins(userId("alice"))).toBe(600);

    // Each position locks the line as it stood before its own shift, so the four
    // together must be exactly the opening line and the three steps after it.
    const lines = (await getPositions(marketId))
      .map((p) => num(p.ou_line_at_bet))
      .sort((a, b) => a - b);
    expect(lines).toEqual([3.5, 4, 4.5, 5]);
  });

  test("flooding a virgin market cannot walk past the calibration ramp", async () => {
    // The calibration caps (200 / 300 / 400 for bets 1–3) are read-then-check:
    // `SELECT COUNT(*) INTO v_bet_count FROM positions WHERE market_id = ...`.
    // This particular property holds for a reason that has nothing to do with
    // locking — a rejected bet inserts no row, so the count never advances on a
    // failure — and six simultaneous 400s therefore all see count 0, all get cap
    // 200, and all fail, in every interleaving.
    //
    // Stated plainly because it was measured: stripping both `FOR UPDATE`s leaves
    // this test GREEN while the other five go red. It is a real regression test
    // for the ramp, and it is not evidence about the locks. The test below is
    // the one that watches the count/lock pairing.
    await setCoins("alice", 10_000);
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });

    const results = await Promise.all(
      Array.from({ length: 6 }, () => tryBet("alice", marketId, "yes", 400))
    );

    expect(results.filter((r) => r.ok)).toHaveLength(0);
    for (const r of results) {
      expect(r.error).toMatch(/calibration period \(bet 1 of 3\)/);
    }

    // The market is untouched: no position, no pool movement, no coins taken.
    expect(await getPositions(marketId)).toHaveLength(0);
    const market = await getMarket(marketId);
    expect(num(market.yes_pool)).toBe(100);
    expect(num(market.no_pool)).toBe(100);
    expect(await getCoins(userId("alice"))).toBe(10_000);
  });

  test("a mixed simultaneous burst reconciles exactly against pool and balance", async () => {
    // A burst of DIFFERENT stake sizes, where which bets survive is legitimately
    // non-deterministic: the 400 is legal only if it interleaves as the third bet
    // (caps run 200 / 300 / 400), so the outcome depends on the order the market
    // lock hands out. What must hold in every ordering is conservation — the pool
    // grew by exactly what the bettor was charged, and every surviving position is
    // accounted for on both sides of the ledger.
    //
    // An earlier version of this test tried to assert the stronger per-ordinal
    // claim — "position 1 never exceeds 200, position 2 never 300" — by ordering
    // positions on `created_at`. That is unsound, and it flaked about one run in
    // five before being caught: `created_at` defaults to NOW(), which in Postgres
    // is TRANSACTION START time, not statement or commit time. A transaction that
    // begins earlier and commits later carries the earlier timestamp, so
    // `created_at` order does not recover the serialization order the lock
    // actually imposed. There is no column that does. The per-ordinal invariant is
    // real, it is simply not observable after the fact — so this asserts what is
    // observable instead of dressing up a guess.
    await setCoins("alice", 10_000);
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });

    await Promise.all([
      tryBet("alice", marketId, "yes", 100),
      tryBet("alice", marketId, "yes", 400),
      tryBet("alice", marketId, "yes", 100),
      tryBet("alice", marketId, "yes", 300),
    ]);

    const stakes = (await getPositions(marketId)).map((p) => p.coins_wagered);

    // Nothing may ever exceed the highest cap the ramp grants any slot.
    for (const stake of stakes) expect(stake).toBeLessThanOrEqual(400);

    // Conservation, exact, in whichever ordering happened. This is the part that
    // detects a lost update.
    const staked = stakes.reduce((sum, s) => sum + s, 0);
    expect(num((await getMarket(marketId)).yes_pool)).toBe(100 + staked);
    expect(await getCoins(userId("alice"))).toBe(10_000 - staked);
  });
});

/**
 * The writers that sit OUTSIDE place_bet and broke the same invariant (0026).
 *
 * "Everyone who writes pools holds the market lock" was true of the two betting
 * RPCs and false of `setMarketLine`, which read pools over PostgREST, computed in
 * TypeScript, and wrote back — two transactions, no lock. `record_referral` had
 * the same shape around a coin award: an unlocked EXISTS guard in front of a
 * +500.
 */
test.describe("concurrent writes outside place_bet", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test.beforeEach(async () => {
    for (const key of ["alice", "bob"] as const) {
      await setCoins(key, 10_000);
    }
  });

  test.afterAll(async () => {
    // Same contract as the block above, plus the referral pointer: the
    // double-fire test deliberately sets alice.referred_by, and auth.spec.ts
    // asserts referral attribution from a clean slate.
    await setProfileFields("alice", { referred_by: null });
    await setProfileFields("bob", { referral_count: 0 });
    await resetAllProfiles();
  });

  test("the SQL and TypeScript odds conversions agree exactly", async () => {
    // `set_market_line` moved this arithmetic from TS into SQL, so there are now
    // two implementations of the same formula in two languages. Nothing structural
    // keeps them in step, and a drift would not throw — it would silently reprice
    // every market an admin re-lines. Hence a value table rather than trust.
    const cases = [100, -100, 110, -110, 150, -150, 200, -200, 500, -500, 1, -1];

    for (const odds of cases) {
      const { data, error } = await admin.rpc("american_odds_to_prob", { p_odds: odds });
      expect(error).toBeNull();
      // Both are float64 by the time they are compared; 12 places is far tighter
      // than the 4-decimal NUMERIC the probability column actually stores.
      expect(Number(data)).toBeCloseTo(americanOddsToProb(odds), 12);
    }
  });

  test("re-lining a market concurrently with a bet never loses the bet's stake", async () => {
    // The regression this migration exists for. Under the old TS read-modify-write
    // the admin's UPDATE could land after a bet had already grown the pool, and it
    // wrote back a total computed from the PRE-bet snapshot — so the stake left
    // the pool while staying debited from the bettor.
    //
    // Either ordering is legitimate and both conserve volume: bet-then-reline
    // rebalances a 300 pool, reline-then-bet rebalances 200 and then adds 100.
    // Total must be 300 every time, whoever wins the race.
    //
    // This deliberately GENERATES the race rather than hiding one, which is the
    // opposite of the sleep-to-mask-a-race that TESTING.md forbids. It is honestly
    // probabilistic: it caught the old code within a few iterations rather than
    // deterministically on the first.
    for (let i = 0; i < 15; i++) {
      const marketId = await createMarket({ yesPool: 100, noPool: 100 });

      await Promise.all([
        tryBet("alice", marketId, "yes", 100),
        admin.rpc("set_market_line", { p_market_id: marketId, p_yes_odds: -110 }),
      ]);

      const market = await getMarket(marketId);
      const total = num(market.yes_pool) + num(market.no_pool);
      expect(total, `iteration ${i}: pool total drifted`).toBe(300);
    }
  });

  test("re-lining holds total volume constant and moves the probability", async () => {
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });

    const { error } = await admin.rpc("set_market_line", {
      p_market_id: marketId,
      p_yes_odds: -200, // implies p = 200/300 = 0.6667
    });
    expect(error).toBeNull();

    const market = await getMarket(marketId);
    // ROUND(200 × 0.6667) = 133, and the other side takes the remainder so the
    // two always re-sum to the original total exactly.
    expect(num(market.yes_pool)).toBe(133);
    expect(num(market.no_pool)).toBe(67);
    expect(num(market.yes_pool) + num(market.no_pool)).toBe(200);
    // Written by the market_probability_sync trigger, not by the RPC.
    expect(num(market.yes_probability)).toBeCloseTo(133 / 200, 4);
  });

  test("set_market_line refuses a settled market and an over/under market", async () => {
    const resolved = await createMarket({ status: "resolved_yes" });
    const { error: settledError } = await admin.rpc("set_market_line", {
      p_market_id: resolved,
      p_yes_odds: -110,
    });
    expect(settledError?.message).toMatch(/Cannot re-line a settled market/);

    const ou = await createMarket({ marketType: "over_under", ouLine: 3.5 });
    const { error: ouError } = await admin.rpc("set_market_line", {
      p_market_id: ou,
      p_yes_odds: -110,
    });
    expect(ouError?.message).toMatch(/binary markets only/);
  });

  test("an authenticated caller cannot re-line a market", async () => {
    // Admin identity is an app-layer email allowlist, so the database's only
    // usable check is that the call arrived through a service_role path. Mirrors
    // the resolve_market authorization test.
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    const alice = await anonClientFor(USERS.alice.email);

    const { error } = await alice.rpc("set_market_line", {
      p_market_id: marketId,
      p_yes_odds: -500,
    });
    expect(error?.message).toMatch(/Unauthorized/);

    const market = await getMarket(marketId);
    expect(num(market.yes_pool)).toBe(100);
    expect(num(market.no_pool)).toBe(100);
  });

  test("a double-fired referral awards the bonus exactly once", async () => {
    // record_referral's idempotency guard was a bare EXISTS with no lock, so two
    // simultaneous calls for the same new user both saw referred_by IS NULL and
    // both paid out. The increment is in place, so nothing is lost — 500 coins
    // are MINTED twice, which in a play-money economy is the same problem
    // pointed the other way. A double-fired auth callback is the plausible path.
    await setProfileFields("alice", { referred_by: null });
    await setProfileFields("bob", { referral_count: 0 });
    const bobBefore = await getCoins(userId("bob"));

    const { data: bobProfile } = await admin
      .from("profiles")
      .select("referral_code")
      .eq("id", userId("bob"))
      .single();
    const code = (bobProfile as { referral_code: string }).referral_code;

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        admin.rpc("record_referral", {
          p_new_user_id: userId("alice"),
          p_referral_code: code,
        })
      )
    );
    // Every call succeeds; the later ones are no-ops rather than errors.
    for (const r of results) expect(r.error).toBeNull();

    expect(await getCoins(userId("bob"))).toBe(bobBefore + 500);

    const { data: after } = await admin
      .from("profiles")
      .select("referral_count")
      .eq("id", userId("bob"))
      .single();
    expect((after as { referral_count: number }).referral_count).toBe(1);
  });
});
