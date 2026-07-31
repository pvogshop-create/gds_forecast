import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { admin, getCoins, getNotifications, getSuggestions, num } from "./helpers/db";
import {
  createSuggestionAs,
  loadSeededUsers,
  setCoins,
  userId,
} from "./helpers/seed";

test.describe("suggestions: submit, approve, reject", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test.beforeEach(async () => {
    await setCoins("bob", 1_000);

    // The admin queue renders `.limit(50)` pending suggestions. Once the suite
    // has been running a while there can be more than that, and the row this
    // test needs falls off the page — a failure that looks like "approve is
    // broken". Clear the fixtures' other pending suggestions so ours is visible.
    // Scoped to fixture users, never a blanket delete.
    const ids = (["admin", "owner", "alice", "bob", "broke"] as const).map((k) =>
      userId(k)
    );
    const { error } = await admin
      .from("market_suggestions")
      .delete()
      .eq("status", "pending")
      .in("user_id", ids);
    if (error) throw new Error(`clearing pending suggestions failed: ${error.message}`);
  });

  test("a user can submit a suggestion and see it listed as pending", async ({ page }) => {
    await loginAs(page, "bob");
    await page.goto("/suggest");
    await expect(page.getByRole("heading", { name: "Suggest a Market" })).toBeVisible();

    await page.getByTestId("suggest-title").fill("Will the E2E suite stay green?");
    await page
      .getByTestId("suggest-description")
      .fill("Resolves YES if the whole Playwright suite passes on main.");
    await page
      .locator('[data-testid="suggest-category"][data-category="sports"]')
      .click();
    await page.getByTestId("suggest-line").fill("+150");
    await page.getByTestId("suggest-submit").click();

    await expect
      .poll(async () => (await getSuggestions(userId("bob"))).length, { timeout: 15_000 })
      .toBeGreaterThan(0);

    const suggestions = await getSuggestions(userId("bob"));
    const mine = suggestions.find((s) =>
      s.title.includes("Will the E2E suite stay green?")
    )!;
    expect(mine.status).toBe("pending");
  });

  test("an admin approves a suggestion: market goes live, suggester is credited", async ({
    page,
  }) => {
    const suggestionId = await createSuggestionAs("bob", {
      title: "Approve me",
      suggestedYesOdds: 100,
    });
    const coinsBefore = await getCoins(userId("bob"));

    await loginAs(page, "admin");
    await page.goto("/admin?tab=suggestions");
    const row = page.locator(
      `[data-testid="admin-suggestion-row"][data-suggestion-id="${suggestionId}"]`
    );
    await expect(row).toBeVisible();
    await row.getByTestId("admin-approve").click();

    // The suggestion flips to approved…
    await expect
      .poll(
        async () =>
          (await getSuggestions(userId("bob"))).find((s) => s.id === suggestionId)?.status,
        { timeout: 15_000 }
      )
      .toBe("approved");

    // …a real market exists, attributed to the suggester…
    const { data: market } = await admin
      .from("markets")
      .select("*")
      .eq("suggested_by", userId("bob"))
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    expect(market!.title).toContain("Approve me");
    expect(market!.status).toBe("open");

    // …the suggester is paid exactly 100 coins…
    expect(await getCoins(userId("bob"))).toBe(coinsBefore + 100);

    // …and told about it.
    const notifs = await getNotifications(userId("bob"), "suggestion_approved");
    expect(notifs.length).toBeGreaterThan(0);
    expect(notifs[0]!.title).toBe("Your suggestion was approved! 🎉");
    expect(notifs[0]!.body).toContain("You earned 100 coins");
  });

  test("an admin's odds override sets the opening line, not the suggested one", async ({
    page,
  }) => {
    const suggestionId = await createSuggestionAs("bob", {
      title: "Override my line",
      suggestedYesOdds: 100, // suggester wanted even money
    });

    await loginAs(page, "admin");
    await page.goto("/admin?tab=suggestions");
    const row = page.locator(
      `[data-testid="admin-suggestion-row"][data-suggestion-id="${suggestionId}"]`
    );
    // Override to -300 → implied probability 300/400 = 0.75.
    await row.locator('input[type="text"]').first().fill("-300");
    await row.getByTestId("admin-approve").click();

    await expect
      .poll(
        async () =>
          (await getSuggestions(userId("bob"))).find((s) => s.id === suggestionId)?.status,
        { timeout: 15_000 }
      )
      .toBe("approved");

    const { data: market } = await admin
      .from("markets")
      .select("*")
      .ilike("title", "%Override my line%")
      .single();
    // The admin's number won, not the suggester's.
    expect(num(market!.yes_probability)).toBeCloseTo(0.75, 2);
  });

  test("an admin rejects a suggestion with a note and the suggester is told", async ({
    page,
  }) => {
    const suggestionId = await createSuggestionAs("bob", { title: "Reject me" });
    const coinsBefore = await getCoins(userId("bob"));

    await loginAs(page, "admin");
    await page.goto("/admin?tab=suggestions");
    const row = page.locator(
      `[data-testid="admin-suggestion-row"][data-suggestion-id="${suggestionId}"]`
    );
    await row.getByRole("button", { name: /Reject/i }).first().click();
    await row.getByTestId("admin-reject-note").fill("Not age-appropriate.");
    await row.getByRole("button", { name: /Confirm|Reject/i }).last().click();

    await expect
      .poll(
        async () =>
          (await getSuggestions(userId("bob"))).find((s) => s.id === suggestionId)?.status,
        { timeout: 15_000 }
      )
      .toBe("rejected");

    const rejected = (await getSuggestions(userId("bob"))).find(
      (s) => s.id === suggestionId
    )!;
    expect(rejected.admin_note).toBe("Not age-appropriate.");

    // Rejection pays nothing.
    expect(await getCoins(userId("bob"))).toBe(coinsBefore);

    const notifs = await getNotifications(userId("bob"), "suggestion_rejected");
    expect(notifs.length).toBeGreaterThan(0);
    expect(notifs[0]!.title).toBe("Suggestion not approved");

    // No market was created from a rejected suggestion.
    const { data: markets } = await admin
      .from("markets")
      .select("id")
      .ilike("title", "%Reject me%");
    expect(markets ?? []).toHaveLength(0);
  });

  test("a user sees only their own suggestions", async ({ page }) => {
    await createSuggestionAs("bob", { title: "Bobs private idea" });

    // RLS on market_suggestions SELECT is `user_id = auth.uid()`, so Alice must
    // not be able to read Bob's row even by asking for it directly.
    const { anonClientFor } = await import("./helpers/db");
    const { USERS } = await import("./helpers/fixtures");
    const alice = await anonClientFor(USERS.alice.email);
    const { data, error } = await alice
      .from("market_suggestions")
      .select("*")
      .eq("user_id", userId("bob"));
    expect(error).toBeNull();
    expect(data).toEqual([]);

    await loginAs(page, "alice");
    await page.goto("/suggest");
    await expect(page.getByText("Bobs private idea")).toHaveCount(0);
  });

  test("a non-admin cannot reach the suggestions queue", async ({ page }) => {
    await loginAs(page, "bob");
    await page.goto("/admin?tab=suggestions");
    await expect(page).toHaveURL(/\/dashboard\/trending$/);
  });
});
