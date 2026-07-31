import { expect, test } from "@playwright/test";
import { admin, anonClientFor, getMarket, num } from "./helpers/db";
import {
  createMarket,
  loadSeededUsers,
  resetAllProfiles,
  setCoins,
  userId,
} from "./helpers/seed";
import { USERS } from "./helpers/fixtures";

/**
 * `close_expired_markets()` (0015) — the auto-close of past-deadline markets.
 *
 * This function had NO test of any kind. Worse, the suite was structured so its
 * trigger condition could never be reached: `createMarket` defaults
 * `resolutionInDays = 30`, and both seed.ts and feeds.spec.ts carry comments
 * explaining how to keep markets AWAY from it, because a past-dated market would
 * flip itself to `closed` mid-test. Nothing had ever run it against a real clock.
 *
 * The lever is `resolution_date`, not a mocked clock. The function compares
 * against Postgres `NOW()`, so no browser-side time control can reach it — but
 * `resolutionInDays: -1` reaches it exactly.
 *
 * Scope note: the RPC is global, not per-market — it closes every expired market
 * in the database and returns the total ROW_COUNT. So each test drains first,
 * then creates its own fixtures, so the count it asserts is attributable.
 */

/** Close everything already expired, so a later count means only what this test made. */
async function drain(): Promise<void> {
  const { error } = await admin.rpc("close_expired_markets");
  if (error) throw new Error(`drain failed: ${error.message}`);
}

async function closeExpired(): Promise<number> {
  const { data, error } = await admin.rpc("close_expired_markets");
  if (error) throw new Error(`close_expired_markets failed: ${error.message}`);
  return data as number;
}

async function setResolutionDate(marketId: string, value: string | null): Promise<void> {
  const { error } = await admin
    .from("markets")
    .update({ resolution_date: value })
    .eq("id", marketId);
  if (error) throw new Error(`setResolutionDate failed: ${error.message}`);
}

test.describe("expired market auto-close", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test.beforeEach(async () => {
    await setCoins("alice", 1_000);
    await drain();
  });

  test.afterAll(async () => {
    await resetAllProfiles();
  });

  test("a past-dated open market closes, and the call reports it", async () => {
    const marketId = await createMarket({ resolutionInDays: -1 });
    expect((await getMarket(marketId)).status).toBe("open");

    expect(await closeExpired()).toBe(1);
    expect((await getMarket(marketId)).status).toBe("closed");
  });

  test("a future-dated open market is left alone", async () => {
    const marketId = await createMarket({ resolutionInDays: 30 });

    expect(await closeExpired()).toBe(0);
    expect((await getMarket(marketId)).status).toBe("open");
  });

  test("a market with no resolution date never auto-closes", async () => {
    // The `resolution_date IS NOT NULL` guard. A market with no deadline is a
    // legitimate state — it simply has no automatic close, and must not be swept
    // up by a NULL comparison.
    const marketId = await createMarket({ resolutionInDays: -1 });
    await setResolutionDate(marketId, null);

    expect(await closeExpired()).toBe(0);
    expect((await getMarket(marketId)).status).toBe("open");
  });

  test("closing is idempotent: a second call re-closes nothing", async () => {
    // This runs on every dashboard render, so the repeat call is the normal case,
    // not the edge case. A non-zero second count would mean it was rewriting rows
    // (and bumping updated_at) on every page load for every user, forever.
    const marketId = await createMarket({ resolutionInDays: -1 });

    expect(await closeExpired()).toBe(1);
    expect(await closeExpired()).toBe(0);
    expect(await closeExpired()).toBe(0);
    expect((await getMarket(marketId)).status).toBe("closed");
  });

  test("an already-resolved past-dated market is not dragged back to closed", async () => {
    // The `status = 'open'` filter. Resolution is terminal; a resolved market
    // whose date has passed must not be reopened-then-closed, which would strand
    // it out of the Completed feed and make it look unresolved.
    const resolved = await createMarket({ status: "resolved_yes", resolutionInDays: -1 });
    const cancelled = await createMarket({ status: "cancelled", resolutionInDays: -1 });

    expect(await closeExpired()).toBe(0);
    expect((await getMarket(resolved)).status).toBe("resolved_yes");
    expect((await getMarket(cancelled)).status).toBe("cancelled");
  });

  test("over/under markets close on the same rule as binary ones", async () => {
    // There is no `market_type` filter in the function — 0015 predates 0010's
    // over/under work and was never revisited. Asserting the current behaviour
    // deliberately: O/U markets DO auto-close, which is what you want, but it is
    // incidental rather than intended, so pin it.
    const ou = await createMarket({
      marketType: "over_under",
      ouLine: 3.5,
      resolutionInDays: -1,
    });
    const binary = await createMarket({ resolutionInDays: -1 });

    expect(await closeExpired()).toBe(2);
    expect((await getMarket(ou)).status).toBe("closed");
    expect((await getMarket(binary)).status).toBe("closed");
  });

  test("a market with no bets closes rather than cancelling, and keeps its pools", async () => {
    // A market nobody bet on is `closed`, not `cancelled` — so it waits for an
    // admin resolution like any other. Nothing is refunded (there is nothing to
    // refund) and the opening pools are left exactly as seeded, which matters
    // because the probability trigger fires on pool writes.
    const marketId = await createMarket({ yesPool: 100, noPool: 100, resolutionInDays: -1 });

    expect(await closeExpired()).toBe(1);

    const market = await getMarket(marketId);
    expect(market.status).toBe("closed");
    expect(num(market.yes_pool)).toBe(100);
    expect(num(market.no_pool)).toBe(100);
    expect(num(market.yes_probability)).toBe(0.5);
  });

  test("the betting window does not depend on this function having run", async () => {
    // The seam, and the reason this function's failure modes are not a money bug.
    //
    // Nothing schedules close_expired_markets — vercel.json has crons only for
    // resolve-incidents and league-weeks, and the four dashboard pages call it on
    // render with the result discarded and `{ data, error }` never checked. So it
    // can silently never run at all.
    //
    // That does not open a betting window on an expired market, because place_bet
    // re-checks expiry itself, under its own lock:
    //   IF v_market.resolution_date IS NOT NULL AND v_market.resolution_date < NOW()
    // The blast radius of this function failing is therefore feed placement and a
    // stale-looking status — not lost or duplicated money.
    const marketId = await createMarket({ yesPool: 100, noPool: 100, resolutionInDays: -1 });

    // Deliberately do NOT close it. Status is still 'open'.
    expect((await getMarket(marketId)).status).toBe("open");

    const { error } = await admin.rpc("place_bet", {
      p_market_id: marketId,
      p_user_id: userId("alice"),
      p_side: "yes",
      p_coins: 100,
    });
    expect(error?.message).toMatch(/Market has expired/);

    const { error: ouError } = await admin.rpc("place_ou_bet", {
      p_market_id: await createMarket({
        marketType: "over_under",
        ouLine: 3.5,
        resolutionInDays: -1,
      }),
      p_user_id: userId("alice"),
      p_side: "yes",
      p_coins: 100,
    });
    expect(ouError?.message).toMatch(/Market has expired/);
  });

  test("any authenticated user may call it, and it still only moves expired rows", async () => {
    // The function is SECURITY DEFINER with `GRANT EXECUTE ... TO authenticated`,
    // which it needs: the only UPDATE policy on markets is service-role-only, and
    // the four callers use the visitor's own cookie-bound session. So a normal
    // logged-in user really is writing market status here.
    //
    // That grant is safe only because the WHERE clause is the whole authorization
    // story. This asserts the boundary directly: Alice can run it, and running it
    // cannot touch a market that is not genuinely past its date.
    const expired = await createMarket({ resolutionInDays: -1 });
    const future = await createMarket({ resolutionInDays: 30 });

    const alice = await anonClientFor(USERS.alice.email);
    const { data, error } = await alice.rpc("close_expired_markets");

    expect(error).toBeNull();
    expect(data).toBe(1);
    expect((await getMarket(expired)).status).toBe("closed");
    expect((await getMarket(future)).status).toBe("open");
  });

  test("an authenticated user cannot write market status directly", async () => {
    // The counterpart to the test above: the RPC is the only door. If a user could
    // just UPDATE markets, the SECURITY DEFINER grant would be irrelevant and any
    // user could close or reopen anything.
    const marketId = await createMarket({ resolutionInDays: 30 });

    const alice = await anonClientFor(USERS.alice.email);
    const { error } = await alice.from("markets").update({ status: "closed" }).eq("id", marketId);

    // RLS filters rather than erroring, so the tell is the unchanged row.
    expect(error).toBeNull();
    expect((await getMarket(marketId)).status).toBe("open");
  });
});
