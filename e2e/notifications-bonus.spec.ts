import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { admin, getNotifications, getProfile } from "./helpers/db";
import {
  createMarket,
  loadSeededUsers,
  placeBetAs,
  resolveMarketAs,
  setCoins,
  setProfileFields,
  userId,
} from "./helpers/seed";

test.describe("notifications", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test.beforeEach(async () => {
    // Clear alice's notifications so counts are exact rather than cumulative.
    await admin.from("notifications").delete().eq("user_id", userId("alice"));
  });

  test("the empty state renders when there is nothing to show", async ({ page }) => {
    await loginAs(page, "alice");
    await page.goto("/notifications");
    await expect(page.getByRole("heading", { name: "Notifications", level: 1 })).toBeVisible();
    await expect(page.getByText("No notifications yet.")).toBeVisible();
    await expect(page.getByTestId("alerts-unread-badge")).toHaveCount(0);
    // Nothing to mark read, so no control is offered.
    await expect(page.getByTestId("mark-all-read")).toHaveCount(0);
  });

  test("each notification type renders, and the unread badge is exact", async ({ page }) => {
    const types = [
      "payout_received",
      "suggestion_approved",
      "suggestion_rejected",
      "league_joined",
      "comment_mention",
      "league_win",
      "bet_placed",
      "league_invite",
    ] as const;

    await admin.from("notifications").insert(
      types.map((type) => ({
        user_id: userId("alice"),
        type,
        title: `Title for ${type}`,
        body: `Body for ${type}`,
      }))
    );

    await loginAs(page, "alice");
    await page.goto("/notifications");

    for (const type of types) {
      await expect(
        page.locator(`[data-testid="notification-item"][data-type="${type}"]`)
      ).toHaveCount(1);
    }
    // All 8 unread.
    await expect(page.getByTestId("alerts-unread-badge")).toHaveAttribute(
      "data-unread",
      String(types.length)
    );
  });

  test("the unread badge counts only unread rows", async ({ page }) => {
    await admin.from("notifications").insert([
      { user_id: userId("alice"), type: "payout_received", title: "a", body: "a", is_read: true },
      { user_id: userId("alice"), type: "payout_received", title: "b", body: "b", is_read: false },
      { user_id: userId("alice"), type: "payout_received", title: "c", body: "c", is_read: false },
    ]);

    await loginAs(page, "alice");
    await page.goto("/notifications");
    await expect(page.getByTestId("alerts-unread-badge")).toHaveAttribute("data-unread", "2");
    await expect(page.getByTestId("notification-item")).toHaveCount(3);
  });

  test("mark-all-read clears the badge and persists", async ({ page }) => {
    await admin.from("notifications").insert([
      { user_id: userId("alice"), type: "payout_received", title: "x", body: "x" },
      { user_id: userId("alice"), type: "comment_mention", title: "y", body: "y" },
    ]);

    await loginAs(page, "alice");
    await page.goto("/notifications");
    await expect(page.getByTestId("alerts-unread-badge")).toHaveAttribute("data-unread", "2");

    await page.getByTestId("mark-all-read").click();

    await expect
      .poll(
        async () => (await getNotifications(userId("alice"))).filter((n) => !n.is_read).length,
        { timeout: 15_000 }
      )
      .toBe(0);

    await page.reload();
    await expect(page.getByTestId("alerts-unread-badge")).toHaveCount(0);
    // The rows are still there, just read.
    await expect(page.getByTestId("notification-item")).toHaveCount(2);
  });

  test("a user sees only their own notifications", async () => {
    await admin
      .from("notifications")
      .insert({ user_id: userId("bob"), type: "payout_received", title: "bob only", body: "b" });

    const { anonClientFor } = await import("./helpers/db");
    const { USERS } = await import("./helpers/fixtures");
    const alice = await anonClientFor(USERS.alice.email);

    // notifications_select_own is `auth.uid() = user_id`. Asking for Bob's rows
    // by user_id directly must still come back empty.
    const { data, error } = await alice
      .from("notifications")
      .select("*")
      .eq("user_id", userId("bob"));
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  test("a user cannot forge a notification for themselves or anyone else", async () => {
    const { anonClientFor } = await import("./helpers/db");
    const { USERS } = await import("./helpers/fixtures");
    const alice = await anonClientFor(USERS.alice.email);

    // INSERT is service_role-only, so even a self-addressed row is refused.
    const { error } = await alice.from("notifications").insert({
      user_id: userId("alice"),
      type: "payout_received",
      title: "free coins",
      body: "nope",
    });
    expect(error).not.toBeNull();
  });

  test("a real payout produces a notification that renders in the list", async ({ page }) => {
    await setCoins("alice", 1_000);
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    await placeBetAs("alice", marketId, "yes", 100);
    await resolveMarketAs(marketId, "yes");

    await loginAs(page, "alice");
    await page.goto("/notifications");
    const item = page.locator('[data-testid="notification-item"][data-type="payout_received"]');
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("You won!");
    await expect(item).toContainText("200 coins");
  });
});

test.describe("daily bonus and referrals", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test("claiming the bonus credits a random 50-150 coins exactly once", async ({ page }) => {
    await setCoins("alice", 1_000);
    await setProfileFields("alice", { last_daily_claim: null });

    await loginAs(page, "alice");
    await page.goto("/more?tab=bets");

    await expect(page.getByTestId("daily-bonus-status")).toHaveAttribute(
      "data-can-claim",
      "true"
    );
    await expect(page.getByTestId("earn-coins-claim")).toBeEnabled();
    await expect(page.getByTestId("earn-coins-claim")).toHaveText("Claim");

    const res = await page.request.post("/api/daily-bonus");
    expect(res.ok()).toBe(true);
    const { award, coins_after } = (await res.json()) as {
      award: number;
      coins_after: number;
    };

    // The award is randomised (50 + FLOOR(RANDOM()*101)), so the range is
    // asserted — but the resulting balance is asserted exactly against it.
    expect(award).toBeGreaterThanOrEqual(50);
    expect(award).toBeLessThanOrEqual(150);
    expect(coins_after).toBe(1_000 + award);

    const profile = await getProfile(userId("alice"));
    expect(profile.coins).toBe(1_000 + award);
    expect(profile.last_daily_claim).not.toBeNull();
  });

  test("a second claim is refused and changes no balance", async ({ page }) => {
    await setCoins("alice", 1_000);
    await setProfileFields("alice", { last_daily_claim: new Date().toISOString() });

    await loginAs(page, "alice");
    await page.goto("/more?tab=bets");

    // The UI disables the button and relabels it, so the only way to prove the
    // server refuses is to call the endpoint directly.
    await expect(page.getByTestId("earn-coins-claim")).toBeDisabled();
    await expect(page.getByTestId("earn-coins-claim")).toHaveText("Claimed");
    await expect(page.getByTestId("daily-bonus-status")).toHaveAttribute(
      "data-can-claim",
      "false"
    );

    const res = await page.request.post("/api/daily-bonus");
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("Daily bonus already claimed. Try again later.");
    expect(await (await getProfile(userId("alice"))).coins).toBe(1_000);
  });

  test("the cooldown is a rolling 24 hours, not a calendar day", async ({ page }) => {
    await setCoins("alice", 1_000);
    // 25 hours ago → claimable again even though it may be the "same day".
    await setProfileFields("alice", {
      last_daily_claim: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });

    await loginAs(page, "alice");
    const res = await page.request.post("/api/daily-bonus");
    expect(res.ok()).toBe(true);

    // And 23 hours is still too soon.
    await setProfileFields("alice", {
      last_daily_claim: new Date(Date.now() - 23 * 60 * 60 * 1000).toISOString(),
    });
    const tooSoon = await page.request.post("/api/daily-bonus");
    expect(tooSoon.status()).toBe(400);
  });

  test("an unauthenticated claim never reaches the handler", async ({ page }) => {
    await page.context().clearCookies();
    const res = await page.request.post("/api/daily-bonus");
    expect(res.url()).toContain("/login");
  });

  test("the referral link and milestone tiers are shown", async ({ page }) => {
    await setProfileFields("alice", { referral_count: 0 });
    await loginAs(page, "alice");
    await page.goto("/more?tab=bets");

    const profile = await getProfile(userId("alice"));
    await expect(page.getByTestId("referral-link")).toHaveAttribute(
      "data-code",
      profile.referral_code!
    );
    await expect(page.getByText("+500 coins for every friend who joins")).toBeVisible();

    // The four milestone chips are cumulative multiples of the flat +500 the
    // record_referral RPC actually pays (1→500, 2→1,000, 5→2,500, 10→5,000).
    for (const label of [
      "1 friend = +500",
      "2 friends = +1,000",
      "5 friends = +2,500",
      "10 friends = +5,000",
    ]) {
      await expect(page.getByText(label)).toBeVisible();
    }
  });

  test("referral progress reflects the count", async ({ page }) => {
    await setProfileFields("alice", { referral_count: 2 });
    await loginAs(page, "alice");
    await page.goto("/more?tab=bets");
    await expect(page.getByText(/2 friends joined/)).toBeVisible();
    // Next unclaimed milestone is 5.
    await expect(page.getByText(/3 more for \+2,500 coins/)).toBeVisible();
    await setProfileFields("alice", { referral_count: 0 });
  });
});
