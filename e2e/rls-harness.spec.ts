import { expect, test } from "@playwright/test";
import { admin, anonClientFor } from "./helpers/db";
import { USERS } from "./helpers/fixtures";
import { expectCanRead, expectCannotRead, expectCannotWrite } from "./helpers/rls";
import { createMarket, loadSeededUsers, userId } from "./helpers/seed";

/**
 * Tests for the RLS assertions themselves.
 *
 * The tier matrix (step 10) is built entirely out of these three helpers, so a
 * helper that cannot fail would make that whole matrix decorative. Each one is
 * therefore exercised in BOTH directions here — it passes on a boundary that
 * genuinely holds, and it throws when the boundary is absent.
 *
 * The boundaries used are Phase-0 policies that exist today
 * (`notifications_select_own` from 0003, `mc_insert` from 0019), so this file
 * stays green before, during, and after the tier migrations.
 */

/** Run an assertion expected to FAIL, and return the message it failed with. */
async function captureFailure(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(
    "Expected this assertion to fail, but it passed. The helper is not falsifiable, " +
      "which means every test built on it is meaningless."
  );
}

test.describe("RLS assertion helpers", () => {
  let aliceNotificationId: string;
  // One market for both write cases, torn down afterwards. The suite shares a
  // single database on one worker, so a spec that leaves markets behind widens
  // the state every later spec has to tolerate.
  let marketId: string;

  test.beforeAll(async () => {
    await loadSeededUsers();
    marketId = await createMarket();

    const { data, error } = await admin
      .from("notifications")
      .insert({
        user_id: userId("alice"),
        type: "market_resolved",
        title: "[E2E] Harness fixture",
        body: "Private to Alice. Used to prove the RLS helpers can see a boundary.",
      })
      .select("id")
      .single();
    if (error || !data) {
      throw new Error(`Could not seed the harness notification: ${error?.message}`);
    }
    aliceNotificationId = (data as { id: string }).id;
  });

  test.afterAll(async () => {
    if (aliceNotificationId) {
      await admin.from("notifications").delete().eq("id", aliceNotificationId);
    }
    if (marketId) {
      // Cascades to the comments the permitted-write case left behind.
      await admin.from("markets").delete().eq("id", marketId);
    }
  });

  test("expectCannotRead passes when a direct-by-id read is filtered away", async () => {
    const bob = await anonClientFor(USERS.bob.email);
    // notifications_select_own (0003_rls.sql:140) — Bob knows the exact UUID and
    // still gets nothing.
    await expectCannotRead(bob, "notifications", aliceNotificationId, "bob→alice notification");
  });

  test("expectCanRead passes for the row's owner", async () => {
    const alice = await anonClientFor(USERS.alice.email);
    const row = await expectCanRead(
      alice,
      "notifications",
      aliceNotificationId,
      "alice→own notification"
    );
    expect(row.title).toBe("[E2E] Harness fixture");
  });

  test("expectCannotRead FAILS when the row is actually readable", async () => {
    const alice = await anonClientFor(USERS.alice.email);
    const message = await captureFailure(() =>
      expectCannotRead(alice, "notifications", aliceNotificationId)
    );
    expect(message).toContain("LEAK");
  });

  test("expectCannotRead refuses to pass vacuously against a row that does not exist", async () => {
    const bob = await anonClientFor(USERS.bob.email);
    const message = await captureFailure(() =>
      // A denied read and an absent row are identical from the client side, so
      // this must be an error, never a pass.
      expectCannotRead(bob, "notifications", "00000000-0000-0000-0000-000000000000")
    );
    expect(message).toContain("does not exist");
  });

  test("expectCannotWrite passes when a WITH CHECK violation is rejected", async () => {
    const bob = await anonClientFor(USERS.bob.email);
    // mc_insert (0019) checks authorship only — Bob writing as Alice is refused.
    await expectCannotWrite(
      bob,
      "market_comments",
      {
        market_id: marketId,
        user_id: userId("alice"),
        body: "[E2E] harness forged comment",
      },
      "bob writing as alice"
    );
  });

  test("expectCannotWrite FAILS when the write is actually permitted", async () => {
    const bob = await anonClientFor(USERS.bob.email);
    const message = await captureFailure(() =>
      // Bob writing as Bob is allowed, so the negative assertion must not hold.
      expectCannotWrite(bob, "market_comments", {
        market_id: marketId,
        user_id: userId("bob"),
        body: "[E2E] harness forged permitted comment",
      })
    );
    expect(message).toContain("the insert SUCCEEDED");
  });
});
