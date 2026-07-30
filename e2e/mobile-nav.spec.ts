import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { loadSeededUsers } from "./helpers/seed";

/**
 * Mobile navigation. This file runs ONLY under the `mobile` Playwright project
 * (Pixel 7, 412x915) — see playwright.config.ts. AppShell renders both navs
 * into the DOM and hides one with Tailwind's `lg:` breakpoint at 1024px, so
 * which nav is *visible* is purely a viewport question and needs a real mobile
 * viewport to test.
 */
test.describe("mobile navigation", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test.beforeEach(async ({ page }) => {
    await loginAs(page, "alice");
  });

  test("the bottom tab bar is visible and the sidebar is not", async ({ page }) => {
    await page.goto("/dashboard/trending");
    await expect(page.getByTestId("bottom-tab-bar")).toBeVisible();
    // Present in the DOM but hidden below `lg`.
    await expect(page.getByTestId("sidebar-nav-main")).toBeHidden();
  });

  test("all five tabs are present in order", async ({ page }) => {
    await page.goto("/dashboard/trending");
    const bar = page.getByTestId("bottom-tab-bar");
    for (const label of ["Trending", "Sports", "Actions", "Social", "More"]) {
      await expect(bar.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("each tab navigates to its dashboard", async ({ page }) => {
    const bar = page.getByTestId("bottom-tab-bar");
    for (const [label, path] of [
      ["Sports", "/dashboard/sports"],
      ["Actions", "/dashboard/actions"],
      ["Social", "/dashboard/social"],
      ["Trending", "/dashboard/trending"],
    ] as const) {
      await page.goto("/dashboard/trending");
      await bar.getByText(label, { exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    }
  });

  test("the active tab is marked for assistive tech", async ({ page }) => {
    await page.goto("/dashboard/sports");
    const bar = page.getByTestId("bottom-tab-bar");
    // aria-current is what a screen reader announces, so assert on that rather
    // than on styling.
    await expect(bar.locator('[aria-current="page"]')).toHaveText(/Sports/);
  });

  test("the More tab reaches the /more hub", async ({ page }) => {
    await page.goto("/dashboard/trending");
    await page.getByTestId("bottom-tab-bar").getByText("More", { exact: true }).click();
    await expect(page).toHaveURL(/\/more$/);
    // The /more sub-tabs render there.
    await expect(page.locator('[data-testid="more-tab"][data-tab="bets"]')).toBeVisible();
  });

  test("More stays highlighted on the pages it owns", async ({ page }) => {
    // BottomTabBar treats /notifications, /leagues, /suggest and /profile as More.
    for (const path of ["/notifications", "/leagues", "/suggest"]) {
      await page.goto(path);
      await expect(
        page.getByTestId("bottom-tab-bar").locator('[aria-current="page"]')
      ).toHaveText(/More/);
    }
  });

  test("the /more sub-tabs switch panels", async ({ page }) => {
    await page.goto("/more?tab=bets");
    await expect(page.locator('[data-testid="more-tab"][data-tab="bets"]')).toHaveAttribute(
      "data-active",
      "true"
    );

    await page.locator('[data-testid="more-tab"][data-tab="suggest"]').click();
    await expect(page).toHaveURL(/tab=suggest/);
    await expect(
      page.locator('[data-testid="more-tab"][data-tab="suggest"]')
    ).toHaveAttribute("data-active", "true");
    await expect(page.getByRole("heading", { name: "Suggest a Market" })).toBeVisible();
  });

  test("a market card is usable at mobile width", async ({ page }) => {
    const { createMarket } = await import("./helpers/seed");
    // Huge pools so this market sorts to the top of the sports feed's
    // `yes_pool DESC` / limit-30 ordering no matter what else the suite created.
    const marketId = await createMarket({
      category: "sports",
      title: "Mobile card",
      yesPool: 500_000,
      noPool: 500_000,
    });
    await page.goto("/dashboard/sports");

    const card = page
      .locator(`[data-testid="market-card"][data-market-id="${marketId}"]`)
      .first();
    await expect(card).toBeVisible();
    await card.getByTestId("market-card-bet-yes").click();
    await expect(page).toHaveURL(new RegExp(`/market/${marketId}\\?side=yes$`));
    await expect(page.getByTestId("betting-panel")).toBeVisible();
  });

  test("the page never scrolls horizontally at 412px", async ({ page }) => {
    await page.goto("/dashboard/trending");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    // A couple of pixels of rounding is tolerable; a real horizontal scrollbar
    // is a layout bug on the primary form factor for this audience.
    expect(overflow).toBeLessThanOrEqual(2);
  });
});
