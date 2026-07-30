import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { admin, getIncident, getMarket } from "./helpers/db";
import { CRON_SECRET } from "./helpers/env";
import {
  castVoteAs,
  createExtraUser,
  createMarket,
  expireVetoDeadline,
  loadSeededUsers,
  submitIncidentAs,
  userId,
} from "./helpers/seed";

/**
 * Community incident reports: submit, vote, threshold, veto, auto-resolution.
 *
 * The threshold in cast_incident_vote is deliberately asymmetric — pass is
 * `agree_rate >= 0.60`, dismissal is `disagree_rate > 0.60` strictly — so a 2/2
 * split at exactly 0.50, and a 3-no/2-yes split at exactly 0.60 disagreement,
 * both stay in `voting`. All three outcomes are asserted.
 */
test.describe("incident reports", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test("a user can submit a report from the market page", async ({ page }) => {
    const marketId = await createMarket({ title: "Incident target" });
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    await page.getByTestId("report-outcome-toggle").click();
    await page.getByTestId("report-outcome-yes").click();
    await page
      .getByTestId("report-description")
      .fill("The event clearly happened; local news covered it.");
    await page.getByTestId("report-submit").click();

    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("incident_reports")
            .select("id")
            .eq("market_id", marketId);
          return data?.length ?? 0;
        },
        { timeout: 15_000 }
      )
      .toBe(1);

    const { data } = await admin
      .from("incident_reports")
      .select("*")
      .eq("market_id", marketId)
      .single();
    expect(data!.status).toBe("voting");
    expect(data!.proposed_outcome).toBe("yes");
    expect(data!.reporter_id).toBe(userId("alice"));
    expect(data!.yes_votes).toBe(0);
    expect(data!.no_votes).toBe(0);
  });

  test("a description under 10 characters is refused", async () => {
    const marketId = await createMarket();
    await expect(
      submitIncidentAs("alice", marketId, "too short", "yes")
    ).rejects.toThrow();
  });

  test("only one active report per market", async () => {
    const marketId = await createMarket();
    await submitIncidentAs("alice", marketId, "First report, plenty long.", "yes");
    await expect(
      submitIncidentAs("bob", marketId, "Second report, also long enough.", "no")
    ).rejects.toThrow(/already exists/);
  });

  test("a report cannot be filed against a resolved market", async () => {
    const marketId = await createMarket({ status: "resolved_yes" });
    await expect(
      submitIncidentAs("alice", marketId, "This market already resolved.", "yes")
    ).rejects.toThrow(/can only be filed for open or closed markets/);
  });

  test("the reporter cannot vote on their own report", async () => {
    const marketId = await createMarket();
    const reportId = await submitIncidentAs(
      "alice",
      marketId,
      "I saw this happen myself.",
      "yes"
    );
    await expect(castVoteAs("alice", reportId, true)).rejects.toThrow(
      /cannot vote on your own incident report/
    );
    expect((await getIncident(reportId)).yes_votes).toBe(0);
  });

  test("the reporter is shown no vote controls at all", async ({ page }) => {
    const marketId = await createMarket();
    await submitIncidentAs("alice", marketId, "Reporter cannot vote here.", "yes");

    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);
    await expect(page.getByTestId("incident-widget")).toBeVisible();
    // IncidentVoteButtons swaps the buttons for a note when isReporter, so the
    // controls are absent rather than disabled. The RPC guard above is what
    // actually enforces it.
    await expect(page.getByText("You reported this")).toBeVisible();
    await expect(page.getByTestId("incident-vote-agree")).toHaveCount(0);
    await expect(page.getByTestId("incident-vote-disagree")).toHaveCount(0);

    // A different user does get the controls, and they are enabled.
    await loginAs(page, "bob");
    await page.goto(`/market/${marketId}`);
    await expect(page.getByTestId("incident-vote-agree")).toBeEnabled();
  });

  test("another user can vote, and the count is recorded", async ({ page }) => {
    const marketId = await createMarket();
    const reportId = await submitIncidentAs(
      "alice",
      marketId,
      "Please vote on this one.",
      "yes"
    );

    await loginAs(page, "bob");
    await page.goto(`/market/${marketId}`);
    await page.getByTestId("incident-vote-agree").click();

    await expect
      .poll(async () => (await getIncident(reportId)).yes_votes, { timeout: 15_000 })
      .toBe(1);
    expect((await getIncident(reportId)).status).toBe("voting");
  });

  test("4 votes at 75% agreement passes the report and sets a veto deadline", async () => {
    const marketId = await createMarket();
    const reportId = await submitIncidentAs("alice", marketId, "Four voters incoming.", "yes");

    // 3 agree, 1 disagree → 0.75 >= 0.60 → passed.
    await castVoteAs("bob", reportId, true);
    await castVoteAs("owner", reportId, true);
    await castVoteAs("admin", reportId, true);
    await castVoteAs("broke", reportId, false);

    const report = await getIncident(reportId);
    expect(report.yes_votes).toBe(3);
    expect(report.no_votes).toBe(1);
    expect(report.status).toBe("passed");
    // 24h admin review window.
    expect(report.veto_deadline).not.toBeNull();
  });

  test("4 votes at 25% agreement dismisses the report", async () => {
    const marketId = await createMarket();
    const reportId = await submitIncidentAs("alice", marketId, "This will be dismissed.", "yes");

    // 1 agree, 3 disagree → disagreement 0.75 > 0.60 → dismissed.
    await castVoteAs("bob", reportId, true);
    await castVoteAs("owner", reportId, false);
    await castVoteAs("admin", reportId, false);
    await castVoteAs("broke", reportId, false);

    const report = await getIncident(reportId);
    expect(report.status).toBe("dismissed");
    // A dismissed report leaves the market alone.
    expect((await getMarket(marketId)).status).toBe("open");
  });

  test("an even 2-2 split stays open for more voting", async () => {
    const marketId = await createMarket();
    const reportId = await submitIncidentAs("alice", marketId, "Deadlocked report here.", "yes");

    await castVoteAs("bob", reportId, true);
    await castVoteAs("owner", reportId, true);
    await castVoteAs("admin", reportId, false);
    await castVoteAs("broke", reportId, false);

    const report = await getIncident(reportId);
    // 0.50 clears neither the >= 0.60 pass bar nor the > 0.60 dismiss bar.
    expect(report.status).toBe("voting");
    expect(report.yes_votes).toBe(2);
    expect(report.no_votes).toBe(2);
  });

  test("fewer than 4 votes never resolves, however unanimous", async () => {
    const marketId = await createMarket();
    const reportId = await submitIncidentAs("alice", marketId, "Only three voters.", "yes");

    await castVoteAs("bob", reportId, true);
    await castVoteAs("owner", reportId, true);
    await castVoteAs("admin", reportId, true);

    const report = await getIncident(reportId);
    expect(report.yes_votes).toBe(3);
    expect(report.status).toBe("voting");
  });

  test("a voter can change their mind without double-counting", async () => {
    const marketId = await createMarket();
    const reportId = await submitIncidentAs("alice", marketId, "Changing minds test.", "yes");

    await castVoteAs("bob", reportId, true);
    expect((await getIncident(reportId)).yes_votes).toBe(1);

    // Upserted on (report_id, user_id).
    await castVoteAs("bob", reportId, false);
    const report = await getIncident(reportId);
    expect(report.yes_votes).toBe(0);
    expect(report.no_votes).toBe(1);
  });

  test("voting on a closed report is refused", async () => {
    const marketId = await createMarket();
    const reportId = await submitIncidentAs("alice", marketId, "Will be dismissed soon.", "yes");
    await castVoteAs("bob", reportId, false);
    await castVoteAs("owner", reportId, false);
    await castVoteAs("admin", reportId, false);
    await castVoteAs("broke", reportId, false);
    expect((await getIncident(reportId)).status).toBe("dismissed");

    const extra = await createExtraUser("latevoter");
    await expect(castVoteAs(extra.id, reportId, true)).rejects.toThrow(
      /no longer open for voting/
    );
  });

  test("an admin can veto a passed report", async ({ page }) => {
    const marketId = await createMarket();
    const reportId = await submitIncidentAs("alice", marketId, "Admin will veto this.", "yes");
    await castVoteAs("bob", reportId, true);
    await castVoteAs("owner", reportId, true);
    await castVoteAs("admin", reportId, true);
    await castVoteAs("broke", reportId, false);
    expect((await getIncident(reportId)).status).toBe("passed");

    await loginAs(page, "admin");
    await page.goto("/admin?tab=incidents");
    const row = page.locator(
      `[data-testid="admin-incident-row"][data-report-id="${reportId}"]`
    );
    await expect(row).toBeVisible();
    await row.getByTestId("admin-veto").click();

    await expect
      .poll(async () => (await getIncident(reportId)).status, { timeout: 15_000 })
      .toBe("vetoed");
    // A veto leaves the market unresolved.
    expect((await getMarket(marketId)).status).toBe("open");
  });

  test("an admin can resolve a market straight from a passed report", async ({ page }) => {
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    const reportId = await submitIncidentAs("alice", marketId, "Resolve this now please.", "yes");
    await castVoteAs("bob", reportId, true);
    await castVoteAs("owner", reportId, true);
    await castVoteAs("admin", reportId, true);
    await castVoteAs("broke", reportId, false);

    await loginAs(page, "admin");
    await page.goto("/admin?tab=incidents");
    const row = page.locator(
      `[data-testid="admin-incident-row"][data-report-id="${reportId}"]`
    );
    await row.getByTestId("admin-resolve-now").click();

    await expect
      .poll(async () => (await getMarket(marketId)).status, { timeout: 15_000 })
      .toBe("resolved_yes");
    expect((await getIncident(reportId)).status).toBe("resolved");
  });

  test("the cron endpoint auto-resolves a passed report past its veto deadline", async ({
    page,
  }) => {
    const marketId = await createMarket({ yesPool: 100, noPool: 100 });
    const reportId = await submitIncidentAs("alice", marketId, "Auto resolve me please.", "yes");
    await castVoteAs("bob", reportId, true);
    await castVoteAs("owner", reportId, true);
    await castVoteAs("admin", reportId, true);
    await castVoteAs("broke", reportId, false);
    expect((await getIncident(reportId)).status).toBe("passed");

    await expireVetoDeadline(reportId);

    // This exercises the real endpoint. It could not work before this change:
    // /api/cron was not in PUBLIC_ROUTES (so a session-less call was redirected
    // to /login), and the handler called requireAdmin()-guarded server actions
    // whose redirect() throw was swallowed as `status: "error"`.
    const res = await page.request.get("/api/cron/resolve-incidents", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.ok()).toBe(true);
    const body = (await res.json()) as {
      processed: number;
      results: { reportId: string; status: string }[];
    };
    expect(body.results.find((r) => r.reportId === reportId)?.status).toBe("resolved");

    expect((await getMarket(marketId)).status).toBe("resolved_yes");
    expect((await getIncident(reportId)).status).toBe("resolved");
  });

  test("the resolve-incidents cron requires its bearer secret", async ({ page }) => {
    const bare = await page.request.get("/api/cron/resolve-incidents");
    expect(bare.status()).toBe(401);
    const wrong = await page.request.get("/api/cron/resolve-incidents", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(wrong.status()).toBe(401);
  });

  test("a non-admin cannot reach the incidents admin tab", async ({ page }) => {
    await loginAs(page, "alice");
    await page.goto("/admin?tab=incidents");
    await expect(page).toHaveURL(/\/dashboard\/trending$/);
  });
});
