import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { admin, getMarket, num } from "./helpers/db";
import { createMarket, loadSeededUsers, setMarketStatus } from "./helpers/seed";

test.describe("admin dashboard", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test.beforeEach(async ({ page }) => {
    await loginAs(page, "admin");
  });

  test("the dashboard loads with all five tabs", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Admin Dashboard" })).toBeVisible();
    for (const tab of ["suggestions", "create", "markets", "users", "incidents"]) {
      await expect(
        page.locator(`[data-testid="admin-tab"][data-tab="${tab}"]`)
      ).toBeVisible();
    }
    // Suggestions is the default.
    await expect(
      page.locator('[data-testid="admin-tab"][data-tab="suggestions"]')
    ).toHaveAttribute("data-active", "true");
  });

  test("creating a market puts it live, with the feature pin honoured", async ({ page }) => {
    await page.goto("/admin?tab=create");

    const title = `[E2E] Admin created ${Date.now()}`;
    await page.getByTestId("admin-create-title").fill(title);
    await page
      .getByTestId("admin-create-description")
      .fill("Created through the admin dashboard by the E2E suite.");
    await page
      .locator('[data-testid="admin-create-category"][data-category="sports"]')
      .click();
    // The field is <input type="date">, so it wants YYYY-MM-DD, not a
    // datetime-local value.
    await page
      .getByTestId("admin-create-resolution-date")
      .fill(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
    await page.getByTestId("admin-create-featured").click();
    await page.getByTestId("admin-create-submit").click();

    await expect
      .poll(
        async () => {
          const { data } = await admin.from("markets").select("id").eq("title", title);
          return data?.length ?? 0;
        },
        { timeout: 20_000 }
      )
      .toBe(1);

    const { data: market } = await admin
      .from("markets")
      .select("*")
      .eq("title", title)
      .single();
    expect(market!.category).toBe("sports");
    expect(market!.status).toBe("open");
    expect(market!.is_featured).toBe(true);
    // initial_odds defaults to +100 → even money, pools split 100/100 out of 200.
    expect(num(market!.yes_pool) + num(market!.no_pool)).toBe(200);

    // A featured sports market is rendered as the banner on its dashboard.
    await page.goto("/dashboard/sports");
    await expect(page.getByText("Featured")).toBeVisible();
  });

  test("creating a market without a title is refused", async ({ page }) => {
    await page.goto("/admin?tab=create");
    // `title` is a required input, so the form will not submit.
    await expect(page.getByTestId("admin-create-title")).toHaveAttribute("required", "");
    const { data: before } = await admin.from("markets").select("id");
    await page.getByTestId("admin-create-submit").click();
    const { data: after } = await admin.from("markets").select("id");
    expect(after!.length).toBe(before!.length);
  });

  test("an admin can close and then reopen a market", async ({ page }) => {
    const marketId = await createMarket({ title: "Admin toggle market" });
    await page.goto("/admin?tab=markets");

    const row = page.locator(
      `[data-testid="admin-market-row"][data-market-id="${marketId}"]`
    );
    await expect(row).toBeVisible();

    await row.getByTestId("admin-toggle-status").click();
    await expect
      .poll(async () => (await getMarket(marketId)).status, { timeout: 15_000 })
      .toBe("closed");

    await page.goto("/admin?tab=markets");
    await page
      .locator(`[data-testid="admin-market-row"][data-market-id="${marketId}"]`)
      .getByTestId("admin-toggle-status")
      .click();
    await expect
      .poll(async () => (await getMarket(marketId)).status, { timeout: 15_000 })
      .toBe("open");
  });

  test("resolving requires a second confirming click", async ({ page }) => {
    const marketId = await createMarket({ title: "Admin confirm market" });
    await page.goto("/admin?tab=markets");
    const button = page
      .locator(`[data-testid="admin-market-row"][data-market-id="${marketId}"]`)
      .getByTestId("admin-resolve-yes");

    // First click arms it; the market must still be open.
    await button.click();
    await expect(button).toHaveText(/Confirm YES/);
    expect((await getMarket(marketId)).status).toBe("open");

    await button.click();
    await expect
      .poll(async () => (await getMarket(marketId)).status, { timeout: 15_000 })
      .toBe("resolved_yes");
  });

  test("an admin can resolve NO", async ({ page }) => {
    const marketId = await createMarket({ title: "Admin resolve no market" });
    await page.goto("/admin?tab=markets");
    const button = page
      .locator(`[data-testid="admin-market-row"][data-market-id="${marketId}"]`)
      .getByTestId("admin-resolve-no");
    await button.click();
    await button.click();
    await expect
      .poll(async () => (await getMarket(marketId)).status, { timeout: 15_000 })
      .toBe("resolved_no");
  });

  test("resolved markets drop out of the active admin list", async ({ page }) => {
    const marketId = await createMarket({ title: "Admin gone market" });
    await setMarketStatus(marketId, "resolved_yes");
    await page.goto("/admin?tab=markets");
    await expect(
      page.locator(`[data-testid="admin-market-row"][data-market-id="${marketId}"]`)
    ).toHaveCount(0);
  });

  test("the users tab lists profiles", async ({ page }) => {
    await page.goto("/admin?tab=users");
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    // AdminUsers renders display_name (falling back to username), not the handle.
    await expect(page.getByText("E2E Alice")).toBeVisible();
    await expect(page.getByText("E2E Bob")).toBeVisible();
  });

  test("the incidents tab renders its empty state when nothing is open", async ({ page }) => {
    // Clear any reports left by other specs so the empty state is reachable.
    await admin
      .from("incident_reports")
      .delete()
      .in("status", ["voting", "passed"]);
    await page.goto("/admin?tab=incidents");
    await expect(page.getByText("No active incident reports.")).toBeVisible();
  });
});
