import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers/auth";
import { getComments, getNotifications, waitForCommentCount } from "./helpers/db";
import { USERS } from "./helpers/fixtures";
import { createMarket, loadSeededUsers, userId } from "./helpers/seed";

test.describe("comments: posting, deleting, mentions, realtime", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  test("posting a comment persists it and renders it", async ({ page }) => {
    const marketId = await createMarket();
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    await expect(page.getByTestId("comments-empty")).toBeVisible();

    await page.getByTestId("comment-input").fill("First take on this market");
    await page.getByTestId("comment-submit").click();

    await expect(page.getByTestId("comment")).toHaveCount(1);
    await expect(page.getByTestId("comment")).toContainText("First take on this market");

    // Poll, don't read once: the bubble is optimistic, so the server action may
    // not have committed yet at the moment the UI says it has.
    const rows = await waitForCommentCount(marketId, 1);
    expect(rows[0]!.body).toBe("First take on this market");
    expect(rows[0]!.user_id).toBe(userId("alice"));
  });

  test("an empty comment cannot be submitted", async ({ page }) => {
    const marketId = await createMarket();
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);
    await expect(page.getByTestId("comment-submit")).toBeDisabled();
    expect(await getComments(marketId)).toHaveLength(0);
  });

  test("the comment input caps length at 500 characters", async ({ page }) => {
    const marketId = await createMarket();
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    // maxLength=500 on the input is the reachable enforcement: typing more is
    // simply not accepted, so a 501-character body can never leave the browser.
    // postComment's own 1..500 guard and the market_comments CHECK constraint
    // are defence in depth behind it and are not reachable from this UI, which
    // is why this asserts the cap rather than the server error.
    await page.getByTestId("comment-input").fill("y".repeat(600));
    await expect(page.getByTestId("comment-input")).toHaveValue("y".repeat(500));

    await page.getByTestId("comment-submit").click();
    const rows = await waitForCommentCount(marketId, 1);
    expect(rows[0]!.body).toHaveLength(500);
  });

  test("a user can delete their own comment", async ({ page }) => {
    const marketId = await createMarket();
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    await page.getByTestId("comment-input").fill("Delete me");
    await page.getByTestId("comment-submit").click();
    await waitForCommentCount(marketId, 1);

    // Reload before deleting. MarketComments renders the delete control only
    // when `!comment.id.startsWith("optimistic-")` — a deliberate guard, since
    // postComment returns void and the client never learns the real row id. So
    // a just-posted comment is not deletable until the component remounts with
    // the persisted id. That is current behaviour, not a defect.
    await page.reload();
    const comment = page.getByTestId("comment").first();
    await expect(comment).not.toHaveAttribute("data-comment-id", /^optimistic-/);

    await comment.getByTestId("comment-delete").click();
    await expect(page.getByTestId("comment")).toHaveCount(0);
    await waitForCommentCount(marketId, 0);
  });

  test("a user is offered no delete control on someone else's comment", async ({ page }) => {
    const marketId = await createMarket();

    // Bob comments…
    await loginAs(page, "bob");
    await page.goto(`/market/${marketId}`);
    await page.getByTestId("comment-input").fill("Bob's comment");
    await page.getByTestId("comment-submit").click();
    await waitForCommentCount(marketId, 1);

    // …Alice sees it but gets no delete affordance.
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);
    const comment = page.getByTestId("comment");
    await expect(comment).toHaveCount(1);
    await expect(comment).toHaveAttribute("data-mine", "false");
    await expect(comment.getByTestId("comment-delete")).toHaveCount(0);
  });

  test("deleting another user's comment is refused by RLS, not just hidden", async () => {
    const marketId = await createMarket();
    const { admin, anonClientFor } = await import("./helpers/db");

    const { data: comment } = await admin
      .from("market_comments")
      .insert({ market_id: marketId, user_id: userId("bob"), body: "Bob owns this" })
      .select("id")
      .single();

    // Alice, authenticated, attempts the delete directly. The RLS DELETE policy
    // is `user_id = auth.uid()`, so this must affect zero rows.
    const alice = await anonClientFor(USERS.alice.email);
    await alice.from("market_comments").delete().eq("id", comment!.id);

    expect(await getComments(marketId)).toHaveLength(1);
  });

  test("@-mentioning a user notifies them", async ({ page }) => {
    const marketId = await createMarket();
    const before = (await getNotifications(userId("bob"), "comment_mention")).length;

    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);
    await page.getByTestId("comment-input").fill(`Hey @${USERS.bob.username} look at this`);
    await page.getByTestId("comment-submit").click();
    await waitForCommentCount(marketId, 1);

    await expect
      .poll(async () => (await getNotifications(userId("bob"), "comment_mention")).length, {
        timeout: 10_000,
      })
      .toBe(before + 1);

    const notif = (await getNotifications(userId("bob"), "comment_mention"))[0]!;
    expect(notif.title).toBe(`@${USERS.alice.username} mentioned you in a comment`);
    expect(notif.data).toMatchObject({ market_id: marketId });
  });

  test("mentioning yourself does not notify you", async ({ page }) => {
    const marketId = await createMarket();
    const before = (await getNotifications(userId("alice"), "comment_mention")).length;

    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);
    await page.getByTestId("comment-input").fill(`Talking to @${USERS.alice.username}`);
    await page.getByTestId("comment-submit").click();
    await waitForCommentCount(marketId, 1);

    expect((await getNotifications(userId("alice"), "comment_mention")).length).toBe(before);
  });

  test("the @-mention autocomplete suggests real usernames", async ({ page }) => {
    const marketId = await createMarket();
    await loginAs(page, "alice");
    await page.goto(`/market/${marketId}`);

    await page.getByTestId("comment-input").fill("hi @e2eb");
    // 300ms debounce then GET /api/users/search.
    await expect(page.getByTestId("mention-dropdown")).toBeVisible();
    const option = page.locator(
      `[data-testid="mention-option"][data-username="${USERS.bob.username}"]`
    );
    await expect(option).toBeVisible();

    // Selection fires on mousedown so the input's blur doesn't cancel it.
    await option.dispatchEvent("mousedown");
    await expect(page.getByTestId("comment-input")).toHaveValue(
      `hi @${USERS.bob.username} `
    );
  });

  test("a comment posted by one user appears live in another user's browser", async ({
    browser,
  }) => {
    const marketId = await createMarket();

    // Two independent browser contexts = two real sessions. They must be
    // DIFFERENT users: MarketComments' realtime handler early-returns when
    // payload.new.user_id === currentUserId, because the author already has the
    // comment optimistically.
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    try {
      const alicePage = await aliceContext.newPage();
      const bobPage = await bobContext.newPage();

      await loginAs(alicePage, "alice");
      await loginAs(bobPage, "bob");
      await alicePage.goto(`/market/${marketId}`);
      await bobPage.goto(`/market/${marketId}`);

      // Both subscribed; Bob starts with no comments visible.
      await expect(bobPage.getByTestId("comments-empty")).toBeVisible();

      await alicePage.getByTestId("comment-input").fill("Realtime hello");
      await alicePage.getByTestId("comment-submit").click();
      await waitForCommentCount(marketId, 1);

      // Bob's page must update WITHOUT a reload — this is the postgres_changes
      // subscription on market_comments doing its job.
      await expect(bobPage.getByTestId("comment")).toHaveCount(1, { timeout: 20_000 });
      await expect(bobPage.getByTestId("comment")).toContainText("Realtime hello");
    } finally {
      await aliceContext.close();
      await bobContext.close();
    }
  });

  test("comments are visible to every authenticated user", async ({ page }) => {
    const marketId = await createMarket();
    const { admin } = await import("./helpers/db");
    await admin
      .from("market_comments")
      .insert({ market_id: marketId, user_id: userId("owner"), body: "Owner comment" });

    await loginAs(page, "broke");
    await page.goto(`/market/${marketId}`);
    await expect(page.getByTestId("comment")).toContainText("Owner comment");
  });
});
