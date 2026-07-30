import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { getCoins, num } from "./helpers/db";
import { USERS } from "./helpers/fixtures";
import { createMarket, loadSeededUsers, setCoins, userId } from "./helpers/seed";

/**
 * Harness self-test. Not a product test — this proves the plumbing works so a
 * failure elsewhere can be trusted to mean a real defect. If this file is red,
 * nothing else in the suite is meaningful.
 */
test.describe("harness", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test("dev server is running against LOCAL supabase, not the hosted project", async ({
    page,
  }) => {
    // The login page is public and renders nothing user-specific, so it is the
    // cheapest proof the server booted with the test env.
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Forecast" })).toBeVisible();
  });

  test("the test-login route 404s without the secret header", async ({ request }) => {
    const res = await request.post("/api/test/login", {
      data: { email: USERS.alice.email, password: "whatever" },
    });
    // 404, not 401 — the route must be indistinguishable from a missing path.
    expect(res.status()).toBe(404);
  });

  test("the test-login route 401s on a wrong secret", async ({ request }) => {
    const res = await request.post("/api/test/login", {
      headers: { "x-e2e-secret": "definitely-not-the-secret" },
      data: { email: USERS.alice.email, password: "whatever" },
    });
    expect(res.status()).toBe(401);
  });

  test("loginAs produces a real session that the middleware accepts", async ({ page }) => {
    const id = await loginAs(page, "alice");
    expect(id).toBe(userId("alice"));

    // An authed user hitting a protected route must NOT be bounced to /login,
    // and must not be bounced to /onboarding (which proves the seeder set
    // profiles.username — requireOnboarding() checks it on every (app) page).
    await page.goto("/dashboard/trending");
    await expect(page).toHaveURL(/\/dashboard\/trending$/);
    await expect(page.getByRole("heading", { name: "Trending", level: 1 })).toBeVisible();
  });

  test("an unauthenticated request to a protected route redirects to /login", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto("/dashboard/trending");
    await expect(page).toHaveURL(/\/login/);
  });

  test("service-role seeding writes real rows with exact values", async () => {
    await setCoins("alice", 777);
    expect(await getCoins(userId("alice"))).toBe(777);

    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    const { getMarket } = await import("./helpers/db");
    const market = await getMarket(marketId);
    expect(num(market.yes_pool)).toBe(100);
    expect(num(market.no_pool)).toBe(100);
    // The market_probability_sync BEFORE trigger derives this from the pools.
    expect(num(market.yes_probability)).toBeCloseTo(0.5, 4);

    await setCoins("alice", USERS.alice.coins);
  });
});
