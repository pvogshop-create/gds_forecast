import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { createMarket, loadSeededUsers, setMarketStatus } from "./helpers/seed";

/**
 * The four dashboard feeds, category scoping, and the Active/Completed toggle.
 *
 * Note every seeded market here gets a FUTURE resolution_date. Each dashboard
 * calls `close_expired_markets()` on render, so a past-dated open market would
 * silently flip to `closed` and move itself to the Completed tab mid-test.
 */
test.describe("feeds: dashboards, categories, active/completed", () => {
  let sportsId: string;
  let socialId: string;
  let actionsId: string;
  let completedId: string;

  // The category feeds order by `yes_pool DESC` and take 30. By the time the
  // whole suite has run, plenty of markets exist, so a default 100/100 market is
  // not guaranteed to make the cut. Seeding these with large pools pins them to
  // the top of that ordering so "is my market on this feed?" stays deterministic
  // no matter what else has been created.
  const PINNED_POOL = 400_000;

  test.beforeAll(async () => {
    await loadSeededUsers();
    sportsId = await createMarket({
      title: "Feed sports market",
      category: "sports",
      yesPool: PINNED_POOL,
      noPool: PINNED_POOL,
    });
    socialId = await createMarket({
      title: "Feed social market",
      category: "social",
      yesPool: PINNED_POOL,
      noPool: PINNED_POOL,
    });
    actionsId = await createMarket({
      title: "Feed actions market",
      category: "actions",
      yesPool: PINNED_POOL,
      noPool: PINNED_POOL,
    });
    completedId = await createMarket({
      title: "Feed completed market",
      category: "sports",
      status: "resolved_yes",
    });
  });

  test.beforeEach(async ({ page }) => {
    await loginAs(page, "alice");
  });

  test("trending shows open markets and the Active/Completed toggle", async ({ page }) => {
    await page.goto("/dashboard/trending");
    await expect(page.getByRole("heading", { name: "Trending", level: 1 })).toBeVisible();
    await expect(page.getByTestId("market-tab-active")).toHaveAttribute(
      "data-selected",
      "true"
    );
    await expect(page.getByTestId("market-tab-completed")).toHaveAttribute(
      "data-selected",
      "false"
    );
    // Trending aggregates across categories, so all three open markets appear.
    await expect(
      page.locator(`[data-testid="market-card"][data-market-id="${sportsId}"]`).first()
    ).toBeVisible();
  });

  // `marketId` is a thunk, not a value: this array is built at collection time,
  // when the beforeAll hook has not yet run and the ids are still undefined.
  for (const { path, heading, category, marketId } of [
    { path: "/dashboard/sports", heading: "🏆 Sports", category: "sports", marketId: () => sportsId },
    { path: "/dashboard/social", heading: "💬 Social", category: "social", marketId: () => socialId },
    { path: "/dashboard/actions", heading: "⚡ Actions", category: "actions", marketId: () => actionsId },
  ]) {
    test(`${path} shows only ${category} markets`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();

      // The target market is present…
      await expect(
        page.locator(`[data-testid="market-card"][data-market-id="${marketId()}"]`)
      ).toBeVisible();

      // …and every rendered card is in this category. This is the assertion that
      // actually proves filtering, rather than just "the one I wanted is here".
      const categories = await page
        .getByTestId("market-card")
        .evaluateAll((els) => els.map((e) => e.getAttribute("data-market-category")));
      expect(categories.length).toBeGreaterThan(0);
      expect(new Set(categories)).toEqual(new Set([category]));
    });
  }

  test("a sports market does not leak into the social or actions feed", async ({ page }) => {
    for (const path of ["/dashboard/social", "/dashboard/actions"]) {
      await page.goto(path);
      await expect(
        page.locator(`[data-testid="market-card"][data-market-id="${sportsId}"]`)
      ).toHaveCount(0);
    }
  });

  test("Completed shows resolved markets and hides open ones, and vice versa", async ({
    page,
  }) => {
    // Active tab: open market present, resolved absent.
    await page.goto("/dashboard/sports");
    await expect(
      page.locator(`[data-testid="market-card"][data-market-id="${sportsId}"]`)
    ).toBeVisible();
    await expect(
      page.locator(`[data-testid="market-card"][data-market-id="${completedId}"]`)
    ).toHaveCount(0);

    // Completed tab: the inverse.
    await page.getByTestId("market-tab-completed").click();
    await expect(page).toHaveURL(/view=completed/);
    await expect(page.getByTestId("market-tab-completed")).toHaveAttribute(
      "data-selected",
      "true"
    );
    await expect(
      page.locator(`[data-testid="market-card"][data-market-id="${completedId}"]`)
    ).toBeVisible();
    await expect(
      page.locator(`[data-testid="market-card"][data-market-id="${sportsId}"]`)
    ).toHaveCount(0);
  });

  test("a market card links through to its detail page", async ({ page }) => {
    await page.goto("/dashboard/sports");
    await page
      .locator(`[data-testid="market-card"][data-market-id="${sportsId}"]`)
      .getByTestId("market-card-link")
      .click();
    await expect(page).toHaveURL(new RegExp(`/market/${sportsId}$`));
    await expect(page.getByTestId("market-title")).toHaveText(/Feed sports market/);
  });

  test("the quick-bet chips preselect a side on the detail page", async ({ page }) => {
    await page.goto("/dashboard/sports");
    await page
      .locator(`[data-testid="market-card"][data-market-id="${sportsId}"]`)
      .getByTestId("market-card-bet-no")
      .click();
    await expect(page).toHaveURL(new RegExp(`/market/${sportsId}\\?side=no$`));
    await expect(page.getByTestId("bet-side-no")).toHaveAttribute("data-selected", "true");
    await expect(page.getByTestId("bet-side-yes")).toHaveAttribute("data-selected", "false");
  });

  test("a resolved market card offers no bet chips, only View details", async ({ page }) => {
    await page.goto("/dashboard/sports?view=completed");
    const card = page.locator(
      `[data-testid="market-card"][data-market-id="${completedId}"]`
    );
    await expect(card.getByTestId("market-card-bet-yes")).toHaveCount(0);
    await expect(card.getByTestId("market-card-bet-no")).toHaveCount(0);
    await expect(card.getByText("View details →")).toBeVisible();
  });

  test("an empty completed feed renders the empty state, not a blank page", async ({
    page,
  }) => {
    // Social has no completed markets in this run.
    await page.goto("/dashboard/social?view=completed");
    await expect(page.getByTestId("market-list-empty")).toBeVisible();
    await expect(page.getByText("No completed social markets yet.")).toBeVisible();
  });

  test("a closed market moves from Active to Completed", async ({ page }) => {
    const id = await createMarket({
      title: "Feed closing market",
      category: "actions",
      yesPool: PINNED_POOL,
      noPool: PINNED_POOL,
    });
    await page.goto("/dashboard/actions");
    await expect(
      page.locator(`[data-testid="market-card"][data-market-id="${id}"]`)
    ).toBeVisible();

    await setMarketStatus(id, "closed");

    await page.goto("/dashboard/actions");
    await expect(
      page.locator(`[data-testid="market-card"][data-market-id="${id}"]`)
    ).toHaveCount(0);
    await page.goto("/dashboard/actions?view=completed");
    await expect(
      page.locator(`[data-testid="market-card"][data-market-id="${id}"]`)
    ).toBeVisible();
  });

  test("feeds require authentication", async ({ page }) => {
    await page.context().clearCookies();
    for (const path of [
      "/dashboard/trending",
      "/dashboard/sports",
      "/dashboard/social",
      "/dashboard/actions",
    ]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login/);
    }
  });
});
