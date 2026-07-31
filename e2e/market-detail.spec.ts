import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { getMarket, num } from "./helpers/db";
import {
  createMarket,
  loadSeededUsers,
  placeBetAs,
} from "./helpers/seed";

test.describe("market detail page", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test("header stats reflect the market's exact pools and probability", async ({ page }) => {
    // 320/180 → 64% YES / 36% NO, volume 500.
    const marketId = await createMarket({
      title: "Detail header market",
      yesPool: 320,
      noPool: 180,
    });
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    await expect(page.getByTestId("market-title")).toHaveText(/Detail header market/);
    await expect(page.getByTestId("market-stat-yes")).toHaveText("64%");
    await expect(page.getByTestId("market-volume")).toHaveAttribute("data-volume", "500");
    await expect(page.getByText("Open")).toBeVisible();
  });

  test("the probability chart needs two points and renders once it has them", async ({
    page,
  }) => {
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    await loginAs(page, "alice");

    // Zero bets → zero history rows → empty state.
    await page.goto(`/market/${marketId}`);
    await expect(page.getByTestId("probability-chart-empty")).toBeVisible();
    await expect(page.getByTestId("probability-chart")).toHaveCount(0);

    // Two bets → two history rows → the chart renders.
    await placeBetAs("bob", marketId, "yes", 50);
    await placeBetAs("owner", marketId, "no", 50);
    await page.reload();
    await expect(page.getByTestId("probability-chart")).toBeVisible();
    await expect(page.getByTestId("probability-chart")).toHaveAttribute("data-points", "2");
  });

  test("the activity feed lists bets on this market", async ({ page }) => {
    const marketId = await createMarket({ title: "Detail activity market" });
    await placeBetAs("bob", marketId, "yes", 50);
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    await expect(page.getByRole("heading", { name: "Market Activity" })).toBeVisible();
    await expect(page.getByTestId("activity-feed").getByText(/bet YES/)).toBeVisible();
  });

  test("a resolved market shows no bet form and reports its outcome", async ({ page }) => {
    const marketId = await createMarket({
      title: "Detail resolved market",
      status: "resolved_yes",
    });
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    await expect(page.getByTestId("betting-panel")).toHaveCount(0);
    await expect(page.getByTestId("bet-submit")).toHaveCount(0);
    await expect(page.getByTestId("betting-panel-closed")).toBeVisible();
    await expect(page.getByText("Resolved YES").first()).toBeVisible();
  });

  test("an O/U market shows its line instead of a probability bar", async ({ page }) => {
    const marketId = await createMarket({
      title: "Detail OU market",
      marketType: "over_under",
      ouLine: 3.5,
      ouUnit: "pts",
    });
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    await expect(page.getByText("Over/Under")).toBeVisible();
    await expect(page.getByText(/Opening line: 3.5 pts/)).toBeVisible();
    // Binary-only chart is absent for O/U markets.
    await expect(page.getByTestId("probability-chart")).toHaveCount(0);
    // Side buttons are relabelled.
    await expect(page.getByTestId("bet-side-yes")).toContainText("OVER");
    await expect(page.getByTestId("bet-side-no")).toContainText("UNDER");
  });

  test("suggester attribution links to the suggester's profile", async ({ page }) => {
    const marketId = await createMarket({
      title: "Detail attributed market",
      suggestedBy: "bob",
    });
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);
    await expect(page.getByText(/Suggested by/)).toBeVisible();
    await expect(page.getByText("@e2ebob")).toBeVisible();
  });

  test("a nonexistent market id renders the not-found page", async ({ page }) => {
    await loginAs(page, "alice");
    await page.goto("/market/00000000-0000-0000-0000-000000000000");
    // Asserting on content rather than HTTP status: notFound() streams Next's
    // default 404 page, and the dev server returns 200 for the streamed shell.
    // There is no custom not-found.tsx in this app, so this is Next's own copy.
    await expect(page.getByText(/This page could not be found/i)).toBeVisible();
    await expect(page.getByTestId("market-title")).toHaveCount(0);
  });

  test("market detail requires authentication", async ({ page }) => {
    const marketId = await createMarket();
    await page.context().clearCookies();
    await page.goto(`/market/${marketId}`);
    await expect(page).toHaveURL(/\/login/);
  });

  test("the reaction row renders all five emoji for a signed-in user", async ({ page }) => {
    // Pinned with a large pool for the same reason as reactions.spec.ts: the
    // feeds order by yes_pool DESC and take a limited number, so a default
    // 100/100 market is not guaranteed to be on the page once the rest of the
    // suite has created markets.
    const marketId = await createMarket({ yesPool: 400_000, noPool: 400_000 });
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);
    // Reactions live on the card, which the detail page does not render — assert
    // on the feed instead, where MarketCard (and so MarketReactions) is used.
    await page.goto("/dashboard/trending");
    // Trending renders a market in several algorithmic sections ("✨ New",
    // "🔥 Most Bet On", …), so the same card can appear more than once.
    const card = page
      .locator(`[data-testid="market-card"][data-market-id="${marketId}"]`)
      .first();
    await expect(card.getByTestId("reaction-button")).toHaveCount(5);
  });

  test("pools shown in the UI stay consistent with the database after a bet", async ({
    page,
  }) => {
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    await placeBetAs("alice", marketId, "yes", 100);

    const market = await getMarket(marketId);
    expect(num(market.yes_pool)).toBe(200);
    expect(num(market.no_pool)).toBe(100);

    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);
    // 200/300 = 0.6667 → 67%, volume 300.
    await expect(page.getByTestId("market-stat-yes")).toHaveText("67%");
    await expect(page.getByTestId("market-volume")).toHaveAttribute("data-volume", "300");
  });
});
