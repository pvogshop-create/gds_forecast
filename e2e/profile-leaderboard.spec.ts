import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { admin, getPosition, getProfile } from "./helpers/db";
import { USERS } from "./helpers/fixtures";
import {
  createMarket,
  loadSeededUsers,
  placeBetAs,
  resolveMarketAs,
  setCoins,
  setProfileFields,
  userId,
} from "./helpers/seed";

test.describe("profile pages", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test("your own profile shows your exact stats", async ({ page }) => {
    await setCoins("alice", 1_234);
    await setProfileFields("alice", { wins: 3, total_bets: 4 });

    await loginAs(page, "alice");
    await page.goto(`/profile/${USERS.alice.username}`);

    await expect(page.getByTestId("profile-username")).toHaveText(`@${USERS.alice.username}`);
    await expect(page.getByTestId("profile-stat-coins")).toContainText("1,234");
    // 3 of 4 → 75%.
    await expect(page.getByTestId("profile-stat-winrate")).toContainText("75%");
    await expect(page.getByTestId("profile-stat-bets")).toContainText("4");
  });

  test("a user with no bets shows an em dash rather than 0%", async ({ page }) => {
    await setProfileFields("bob", { wins: 0, total_bets: 0 });
    await loginAs(page, "bob");
    await page.goto(`/profile/${USERS.bob.username}`);
    await expect(page.getByTestId("profile-stat-winrate")).toContainText("—");
  });

  test("another user's profile loads and is read-only", async ({ page }) => {
    await loginAs(page, "alice");
    await page.goto(`/profile/${USERS.bob.username}`);

    await expect(page.getByTestId("profile-username")).toHaveText(`@${USERS.bob.username}`);
    // The edit affordance is only offered on your own profile.
    await expect(page.getByText("Edit profile")).toHaveCount(0);
  });

  test("your own profile offers an edit link", async ({ page }) => {
    await loginAs(page, "alice");
    await page.goto(`/profile/${USERS.alice.username}`);
    await expect(page.getByText("Edit profile")).toBeVisible();
  });

  test("recent positions appear on the profile", async ({ page }) => {
    await setCoins("alice", 1_000);
    const marketId = await createMarket({ title: "Profile position market" });
    await placeBetAs("alice", marketId, "yes", 50);

    await loginAs(page, "alice");
    await page.goto(`/profile/${USERS.alice.username}`);
    await expect(page.getByRole("heading", { name: "Recent Positions" })).toBeVisible();
    await expect(page.getByText(/Profile position market/).first()).toBeVisible();
  });

  test("an unknown username renders the not-found page", async ({ page }) => {
    await loginAs(page, "alice");
    await page.goto("/profile/definitelynotarealuser");
    await expect(page.getByText(/This page could not be found/i)).toBeVisible();
  });

  test("a user cannot edit another user's profile", async () => {
    const { anonClientFor } = await import("./helpers/db");
    const before = await getProfile(userId("bob"));

    // profiles_update_own is `auth.uid() = id`, so this must change nothing.
    const alice = await anonClientFor(USERS.alice.email);
    await alice
      .from("profiles")
      .update({ display_name: "Hacked By Alice" })
      .eq("id", userId("bob"));

    expect((await getProfile(userId("bob"))).display_name).toBe(before.display_name);
  });

  test("a user cannot raise their own coin balance", async () => {
    await setCoins("alice", 500);
    const { anonClientFor } = await import("./helpers/db");
    const alice = await anonClientFor(USERS.alice.email);

    // The prevent_coin_manipulation trigger blocks authenticated writes to
    // coins/wins/total_bets even on your own row.
    const { error } = await alice
      .from("profiles")
      .update({ coins: 999_999 })
      .eq("id", userId("alice"));

    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/Cannot directly modify coins/);
    expect(await (await getProfile(userId("alice"))).coins).toBe(500);
  });

  test.fixme("a user can edit their own profile", async () => {
    // not built yet — /profile/[username]/edit does not exist. The profile page
    // links to it, so the link currently 404s. No display-name or avatar
    // mutation exists anywhere in the codebase.
  });
});

test.describe("leaderboard and stat leaders", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test("the leaderboard orders by coins descending with medals for the top three", async ({
    page,
  }) => {
    // Distinct balances so the ordering is unambiguous.
    await setCoins("admin", 9_000);
    await setCoins("owner", 8_000);
    await setCoins("alice", 7_000);
    await setCoins("bob", 6_000);
    await setCoins("broke", 10);

    await loginAs(page, "alice");
    await page.goto("/notifications");

    const rows = page.getByTestId("leaderboard-row");
    await expect(rows.first()).toBeVisible();

    const ordered = await rows.evaluateAll((els) =>
      els.map((e) => ({
        rank: Number(e.getAttribute("data-rank")),
        coins: Number(e.getAttribute("data-coins")),
      }))
    );
    // Monotonically non-increasing coins, ranks ascending from 1.
    expect(ordered[0]!.rank).toBe(1);
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i]!.coins).toBeLessThanOrEqual(ordered[i - 1]!.coins);
      expect(ordered[i]!.rank).toBe(i + 1);
    }

    // 🥇🥈🥉 for the first three.
    for (const [index, medal] of ["🥇", "🥈", "🥉"].entries()) {
      await expect(rows.nth(index)).toContainText(medal);
    }
  });

  test("the last place row gets the 💩 marker once there are more than three", async ({
    page,
  }) => {
    await loginAs(page, "alice");
    await page.goto("/notifications");
    const rows = page.getByTestId("leaderboard-row");
    const count = await rows.count();
    expect(count).toBeGreaterThan(3);
    await expect(rows.nth(count - 1)).toContainText("💩");
  });

  test("a leaderboard row links to that user's profile", async ({ page }) => {
    await loginAs(page, "alice");
    await page.goto("/notifications");
    const row = page.locator(
      `[data-testid="leaderboard-row"][data-username="${USERS.bob.username}"]`
    );
    await row.getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/profile/${USERS.bob.username}$`));
  });

  test("Stat Leaders shows hot streak, cold streak and the week's best earner", async ({
    page,
  }) => {
    // All three tiles are conditionally rendered, so each needs real data:
    // a win streak, a loss streak, and a payout resolved within the last 7 days.
    await setProfileFields("bob", { win_streak: 5, loss_streak: 0 });
    await setProfileFields("broke", { win_streak: 0, loss_streak: 4 });

    await setCoins("owner", 2_000);
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    await placeBetAs("owner", marketId, "yes", 100);
    await resolveMarketAs(marketId, "yes");

    await loginAs(page, "alice");
    await page.goto("/dashboard/trending");

    await expect(page.getByText("Stat Leaders")).toBeVisible();
    await expect(page.getByTestId("stat-leader-hot")).toContainText("5 wins in a row");
    await expect(page.getByTestId("stat-leader-cold")).toContainText("4 losses in a row");

    // Assert the tile names whoever the RPC actually ranks first, rather than
    // assuming it is this test's better. By the time the whole suite has run,
    // several users have weekly earnings and the genuine top earner may be any
    // of them — but the UI must agree with the RPC, which is the real contract.
    const { data: earner } = await admin.rpc("get_weekly_top_earner");
    const top = Array.isArray(earner) ? earner[0] : earner;
    expect(top).toBeTruthy();

    const week = page.getByTestId("stat-leader-week");
    await expect(week).toContainText("this week");
    await expect(week).toContainText(top.display_name ?? top.username);

    // Reset so later specs are not surprised by the streaks.
    await setProfileFields("bob", { win_streak: 0, loss_streak: 0 });
    await setProfileFields("broke", { win_streak: 0, loss_streak: 0 });
  });

  test("the weekly top earner RPC reports net earnings for the biggest winner", async () => {
    // Deliberately does NOT clear the positions table. An earlier version ran
    // `delete().neq("id", <zero-uuid>)`, which wipes EVERY position row in the
    // database — including rows other specs were relying on. Instead this gives
    // one user an unmistakably large win and asserts the RPC ranks them first,
    // which is the actual behaviour under test and is robust to other history.
    await setCoins("bob", 60_000);
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });

    // Four warm-up bets clear the calibration ramp, which caps the first three
    // bets on any market at 200/300/400 coins — without them bob's 50,000 is
    // rejected outright. They are placed in matched YES/NO pairs so the pools
    // stay symmetrical (120/120) and the probability is still exactly 0.5 when
    // bob bets: his odds must lock at -100 for the payout assertion below.
    for (const better of ["alice", "owner", "admin"] as const) {
      await setCoins(better, 1_000);
    }
    await placeBetAs("alice", marketId, "yes", 10);
    await placeBetAs("owner", marketId, "no", 10);
    await placeBetAs("admin", marketId, "yes", 10);
    await placeBetAs("alice", marketId, "no", 10);

    // 50,000 at even money (locked -100) → 100,000 payout → 50,000 net. Chosen
    // to dwarf anything else the suite accumulates, so bob is unambiguously the
    // top earner regardless of what ran before.
    await placeBetAs("bob", marketId, "yes", 50_000);
    await resolveMarketAs(marketId, "yes");

    expect((await getPosition(marketId, userId("bob"))).payout).toBe(100_000);

    const { data, error } = await admin.rpc("get_weekly_top_earner");
    expect(error).toBeNull();
    const top = Array.isArray(data) ? data[0] : data;
    expect(top.user_id).toBe(userId("bob"));
    // NET earnings, not gross payout: the RPC subtracts the stake, so a 100,000
    // payout on a 50,000 stake contributes 50,000 (a floor, since bob may have
    // won earlier in the same 7-day window).
    expect(Number(top.weekly_earned)).toBeGreaterThanOrEqual(50_000);
  });
});
