import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { anonClientFor, getMarket, admin } from "./helpers/db";
import { CRON_SECRET } from "./helpers/env";
import { USERS } from "./helpers/fixtures";
import { createMarket, loadSeededUsers, userId } from "./helpers/seed";

/**
 * Cross-cutting authorization.
 *
 * The rule from TESTING.md: a control the UI declines to render is not access
 * control. Every boundary here is proven by a direct API/RPC call in addition to
 * whatever the UI does or does not show.
 *
 * Note that admin identity is an app-layer email allowlist (ADMIN_EMAIL), not a
 * DB column or role — so /admin is guarded by middleware + requireAdmin(), while
 * the DATABASE only knows `service_role`. Both layers are tested.
 */
test.describe("authorization", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  // ─── /admin ───────────────────────────────────────────────────────────────

  for (const tab of ["", "?tab=create", "?tab=markets", "?tab=users", "?tab=incidents"]) {
    test(`a non-admin is redirected away from /admin${tab}`, async ({ page }) => {
      await loginAs(page, "alice");
      await page.goto(`/admin${tab}`);
      await expect(page).toHaveURL(/\/dashboard\/trending$/);
      await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toHaveCount(0);
    });
  }

  test("an unauthenticated visitor is sent to /login, not /admin", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
  });

  test("the admin fixture does reach /admin (the allowlist works both ways)", async ({
    page,
  }) => {
    await loginAs(page, "admin");
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible();
  });

  test("a non-admin sees no Admin link in the sidebar", async ({ page }) => {
    await loginAs(page, "alice");
    await page.goto("/dashboard/trending");
    await expect(
      page.getByTestId("sidebar-nav-secondary").getByText("Admin")
    ).toHaveCount(0);
  });

  test("an admin does see the Admin link", async ({ page }) => {
    await loginAs(page, "admin");
    await page.goto("/dashboard/trending");
    await expect(
      page.getByTestId("sidebar-nav-secondary").getByText("Admin")
    ).toBeVisible();
  });

  // ─── Direct RPC / API attempts ─────────────────────────────────────────────

  test("a normal user cannot resolve a market via a direct RPC call", async () => {
    const marketId = await createMarket();
    const alice = await anonClientFor(USERS.alice.email);

    const { error } = await alice.rpc("resolve_market", {
      p_market_id: marketId,
      p_outcome: "yes",
      p_admin_id: userId("alice"),
      p_note: "trying it on",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/may only be called by admin/);
    expect((await getMarket(marketId)).status).toBe("open");
  });

  test("a normal user cannot resolve a market they created", async () => {
    // Ownership grants nothing today: resolution is service_role-only, full stop.
    const marketId = await createMarket({ creator: "alice" });
    const alice = await anonClientFor(USERS.alice.email);
    const { error } = await alice.rpc("resolve_market", {
      p_market_id: marketId,
      p_outcome: "yes",
      p_admin_id: userId("alice"),
      p_note: null,
    });
    expect(error).not.toBeNull();
    expect((await getMarket(marketId)).status).toBe("open");
  });

  test("a normal user cannot adjust anybody's balance", async () => {
    const alice = await anonClientFor(USERS.alice.email);
    const { error } = await alice.rpc("admin_adjust_balance", {
      p_user_id: userId("alice"),
      p_amount: 10_000,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/may only be called by service_role/);
  });

  test("a normal user cannot create a market by direct insert", async () => {
    const alice = await anonClientFor(USERS.alice.email);
    const { error } = await alice.from("markets").insert({
      title: "[E2E] Forged market",
      description: "Should never exist.",
      category: "sports",
      creator_id: userId("alice"),
    });
    // markets INSERT is service_role-only.
    expect(error).not.toBeNull();
    const { data } = await admin
      .from("markets")
      .select("id")
      .eq("title", "[E2E] Forged market");
    expect(data ?? []).toHaveLength(0);
  });

  test("a normal user cannot write a position directly", async () => {
    const marketId = await createMarket();
    const alice = await anonClientFor(USERS.alice.email);
    const { error } = await alice.from("positions").insert({
      market_id: marketId,
      user_id: userId("alice"),
      side: "yes",
      coins_wagered: 100,
      shares_bought: 200,
      price_at_bet: 0.5,
      yes_odds_at_bet: -100,
    });
    // Betting must go through place_bet; positions is service_role-write only.
    expect(error).not.toBeNull();
  });

  test("a normal user cannot mark another user's notification as read", async () => {
    const { data: notif } = await admin
      .from("notifications")
      .insert({
        user_id: userId("bob"),
        type: "payout_received",
        title: "bob's",
        body: "bob's",
      })
      .select("id")
      .single();

    const alice = await anonClientFor(USERS.alice.email);
    await alice.from("notifications").update({ is_read: true }).eq("id", notif!.id);

    const { data: after } = await admin
      .from("notifications")
      .select("is_read")
      .eq("id", notif!.id)
      .single();
    // notifications_update_own is `auth.uid() = user_id`, so nothing changed.
    expect(after!.is_read).toBe(false);
  });

  test("the cron endpoints are not reachable with a session instead of the secret", async ({
    page,
  }) => {
    // Being logged in — even as the admin — is not the cron credential.
    await loginAs(page, "admin");
    for (const path of ["/api/cron/league-weeks", "/api/cron/resolve-incidents"]) {
      const res = await page.request.get(path);
      expect(res.status()).toBe(401);
    }
  });

  test("the test-login route cannot mint a session for a non-fixture address", async ({
    page,
  }) => {
    const { E2E_TEST_SECRET } = await import("./helpers/env");
    const res = await page.request.post("/api/test/login", {
      headers: { "x-e2e-secret": E2E_TEST_SECRET },
      data: { email: "attacker@example.com", password: "whatever" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toContain("@forecast.test");
  });

  // ─── Play-money guardrail ────────────────────────────────────────────────

  test("no page offers a real-money affordance", async ({ page }) => {
    const marketId = await createMarket({ category: "sports" });
    await loginAs(page, "alice");

    const forbidden = [
      /deposit/i,
      /withdraw/i,
      /cash\s*out/i,
      /credit card/i,
      /payment/i,
      /checkout/i,
      /buy coins/i,
      /\$\d/,
    ];

    for (const path of [
      "/dashboard/trending",
      "/dashboard/sports",
      `/market/${marketId}`,
      "/more?tab=bets",
      "/leagues",
      "/notifications",
      "/suggest",
    ]) {
      await page.goto(path);
      const body = await page.locator("body").innerText();
      for (const pattern of forbidden) {
        expect(
          body,
          `"${pattern}" must not appear on ${path} — this is a play-money platform`
        ).not.toMatch(pattern);
      }
    }
  });

  test("the play-money disclaimer is present in the app shell", async ({ page }) => {
    await loginAs(page, "alice");
    await page.goto("/dashboard/trending");
    await expect(
      page.getByText("🎮 Play Money — No real currency").first()
    ).toBeVisible();
  });

  test("the cron secret alone is enough for the cron routes", async ({ page }) => {
    await page.context().clearCookies();
    const res = await page.request.get("/api/cron/league-weeks", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.ok()).toBe(true);
  });
});
