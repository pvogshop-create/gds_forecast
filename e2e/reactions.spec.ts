import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { getReactions, waitForReactionCount } from "./helpers/db";
import { createMarket, loadSeededUsers, userId } from "./helpers/seed";

const EMOJIS = ["🔥", "🎯", "🤔", "💰", "✅"] as const;

test.describe("market reactions", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  /**
   * MarketReactions only renders inside MarketCard, which only appears in a
   * feed — so these tests have to go through one.
   *
   * The sports feed orders by `yes_pool DESC` and takes 30, so a fresh 100/100
   * market is NOT guaranteed to appear once the rest of the suite has created
   * markets. Every market here is therefore seeded with a deliberately enormous
   * pool, which pins it to the top of that ordering regardless of what else
   * exists. (The pool size is irrelevant to reactions themselves.)
   */
  const HUGE_POOL = 500_000;

  function reactionMarket() {
    return createMarket({ category: "sports", yesPool: HUGE_POOL, noPool: HUGE_POOL });
  }

  async function openCard(page: import("@playwright/test").Page, marketId: string) {
    await page.goto("/dashboard/sports");
    const card = page
      .locator(`[data-testid="market-card"][data-market-id="${marketId}"]`)
      .first();
    await card.waitFor();
    return card;
  }

  test("all five reactions render and start at zero", async ({ page }) => {
    const marketId = await reactionMarket();
    await loginAs(page, "alice");
    const card = await openCard(page, marketId);

    const buttons = card.getByTestId("reaction-button");
    await expect(buttons).toHaveCount(5);
    for (const emoji of EMOJIS) {
      const button = card.locator(`[data-testid="reaction-button"][data-emoji="${emoji}"]`);
      await expect(button).toHaveAttribute("data-count", "0");
      await expect(button).toHaveAttribute("data-reacted", "false");
    }
  });

  test("reacting increments the count and marks it as yours", async ({ page }) => {
    const marketId = await reactionMarket();
    await loginAs(page, "alice");
    const card = await openCard(page, marketId);

    const fire = card.locator('[data-testid="reaction-button"][data-emoji="🔥"]');
    await fire.click();

    await expect(fire).toHaveAttribute("data-count", "1");
    await expect(fire).toHaveAttribute("data-reacted", "true");
    await expect(fire).toHaveAttribute("aria-pressed", "true");

    const rows = await waitForReactionCount(marketId, 1);
    expect(rows).toEqual([{ user_id: userId("alice"), emoji: "🔥" }]);
  });

  test("reacting again toggles the reaction off", async ({ page }) => {
    const marketId = await reactionMarket();
    await loginAs(page, "alice");
    const card = await openCard(page, marketId);

    const target = card.locator('[data-testid="reaction-button"][data-emoji="🎯"]');
    await target.click();
    await expect(target).toHaveAttribute("data-count", "1");
    // Let the request settle before clicking again — the component drops clicks
    // that arrive while a toggle is still in flight.
    await waitForReactionCount(marketId, 1);

    await target.click();
    await expect(target).toHaveAttribute("data-count", "0");
    await expect(target).toHaveAttribute("data-reacted", "false");

    // The row is deleted, not just zeroed.
    await waitForReactionCount(marketId, 0);
  });

  test("two users' reactions to the same emoji both count", async ({ page }) => {
    const marketId = await reactionMarket();

    await loginAs(page, "alice");
    let card = await openCard(page, marketId);
    await card.locator('[data-testid="reaction-button"][data-emoji="💰"]').click();
    await expect(
      card.locator('[data-testid="reaction-button"][data-emoji="💰"]')
    ).toHaveAttribute("data-count", "1");
    await waitForReactionCount(marketId, 1);

    await loginAs(page, "bob");
    card = await openCard(page, marketId);
    const money = card.locator('[data-testid="reaction-button"][data-emoji="💰"]');
    // Bob sees Alice's reaction but has not reacted himself.
    await expect(money).toHaveAttribute("data-count", "1");
    await expect(money).toHaveAttribute("data-reacted", "false");

    await money.click();
    await expect(money).toHaveAttribute("data-count", "2");
    await expect(money).toHaveAttribute("data-reacted", "true");

    await waitForReactionCount(marketId, 2);
  });

  test("a user can hold several different reactions at once", async ({ page }) => {
    const marketId = await reactionMarket();
    await loginAs(page, "alice");
    const card = await openCard(page, marketId);

    let expected = 0;
    for (const emoji of ["🔥", "✅"]) {
      await card.locator(`[data-testid="reaction-button"][data-emoji="${emoji}"]`).click();
      await expect(
        card.locator(`[data-testid="reaction-button"][data-emoji="${emoji}"]`)
      ).toHaveAttribute("data-count", "1");
      expected += 1;
      // Wait between clicks; a click during an in-flight toggle is dropped.
      await waitForReactionCount(marketId, expected);
    }
    // PK is (market_id, user_id, emoji), so one row per emoji is expected.
    expect(await getReactions(marketId)).toHaveLength(2);
  });

  test("the API rejects an emoji outside the allowed set", async ({ page }) => {
    const marketId = await reactionMarket();
    await loginAs(page, "alice");

    const res = await page.request.post(`/api/markets/${marketId}/react`, {
      data: { emoji: "🚀" },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe("Invalid emoji");
    expect(await getReactions(marketId)).toHaveLength(0);
  });

  test("an unauthenticated reaction never reaches the handler", async ({ page }) => {
    const marketId = await reactionMarket();
    await page.context().clearCookies();
    const res = await page.request.post(`/api/markets/${marketId}/react`, {
      data: { emoji: "🔥" },
    });
    // Middleware redirects to /login before the route's 401 branch.
    expect(res.url()).toContain("/login");
    expect(await getReactions(marketId)).toHaveLength(0);
  });

  test("a user cannot insert a reaction as somebody else", async () => {
    const marketId = await reactionMarket();
    const { anonClientFor } = await import("./helpers/db");
    const { USERS } = await import("./helpers/fixtures");

    // The INSERT policy is `user_id = auth.uid()`. Alice forging Bob's row must
    // be refused at the database, not merely absent from the UI.
    const alice = await anonClientFor(USERS.alice.email);
    const { error } = await alice
      .from("market_reactions")
      .insert({ market_id: marketId, user_id: userId("bob"), emoji: "🔥" });

    expect(error).not.toBeNull();
    expect(await getReactions(marketId)).toHaveLength(0);
  });

  test("the reactions endpoint reports counts and the caller's own state", async ({
    page,
  }) => {
    const marketId = await reactionMarket();
    const { admin } = await import("./helpers/db");
    await admin.from("market_reactions").insert([
      { market_id: marketId, user_id: userId("bob"), emoji: "🔥" },
      { market_id: marketId, user_id: userId("owner"), emoji: "🔥" },
    ]);

    await loginAs(page, "alice");
    const res = await page.request.get(`/api/markets/${marketId}/reactions`);
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as {
      reactions: { emoji: string; count: number; reacted: boolean }[];
    };

    // Always all five, in a fixed order.
    expect(body.reactions.map((r) => r.emoji)).toEqual([...EMOJIS]);
    const fire = body.reactions.find((r) => r.emoji === "🔥")!;
    expect(fire.count).toBe(2);
    // Alice did not react, even though two others did.
    expect(fire.reacted).toBe(false);
  });
});
