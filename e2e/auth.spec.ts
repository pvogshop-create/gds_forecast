import { expect, test } from "@playwright/test";
import { loginAs, loginAsEmail, magicLinkTokenFor } from "./helpers/auth";
import { admin, getProfile } from "./helpers/db";
import { USERS } from "./helpers/fixtures";
import {
  createExtraUser,
  loadSeededUsers,
  setProfileFields,
  userId,
} from "./helpers/seed";

test.describe("auth: login, onboarding, referral attribution", () => {
  test.beforeAll(async () => {
    await loadSeededUsers();
  });

  // ─── Login page ───────────────────────────────────────────────────────────

  test("the login page renders and is reachable unauthenticated", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "Forecast" })).toBeVisible();
    await expect(page.getByText("Sign in to your account")).toBeVisible();
    // Play-money framing must be present on the entry page (guardrail).
    await expect(page.getByText("🎮 Play Money — No real currency involved")).toBeVisible();
  });

  test("submitting an email sends a magic link and shows the sent state", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByTestId("login-email").fill(USERS.alice.email);
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-sent")).toBeVisible();
    await expect(page.getByText("Check your email")).toBeVisible();
  });

  test("client-side validation rejects a malformed email without calling Supabase", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    // "a@b" is deliberate: the input is type="email" in a form without
    // noValidate, so the browser's own validation swallows anything without an
    // "@" before the component's handler runs. "a@b" is HTML5-valid but fails
    // the component's `.includes(".")` check, which is the branch under test.
    await page.getByTestId("login-email").fill("a@b");
    await page.getByTestId("login-submit").click();
    await expect(page.getByTestId("login-error")).toHaveText(
      "Please enter a valid email address."
    );
    await expect(page.getByTestId("login-sent")).toHaveCount(0);
  });

  test("an empty email is refused", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByTestId("login-submit").click();
    // Native required-field validation stops submission; nothing is sent.
    await expect(page.getByTestId("login-sent")).toHaveCount(0);
  });

  test("an already-authenticated user visiting /login is redirected into the app", async ({
    page,
  }) => {
    await loginAs(page, "alice");
    await page.goto("/login");
    await expect(page).toHaveURL(/\/dashboard\/trending$/);
  });

  test("the root path routes by session state", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);

    await loginAs(page, "alice");
    await page.goto("/");
    await expect(page).toHaveURL(/\/dashboard\/trending$/);
  });

  // ─── The real callback ────────────────────────────────────────────────────

  test("the magic-link callback signs a returning user in and lands on the feed", async ({
    page,
  }) => {
    await page.context().clearCookies();
    const token = await magicLinkTokenFor(USERS.alice.email);
    await page.goto(`/api/auth/callback?token_hash=${token}&type=magiclink`);
    // Returning user (username already set) → straight to the feed.
    await expect(page).toHaveURL(/\/dashboard\/trending$/);
    await expect(page.getByRole("heading", { name: "Trending", level: 1 })).toBeVisible();
  });

  test("the callback rejects a bad token with ?error=auth_failed", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/api/auth/callback?token_hash=not-a-real-token&type=magiclink");
    await expect(page).toHaveURL(/\/login\?error=auth_failed/);
    await expect(page.getByText("Sign-in failed. Please try again.")).toBeVisible();
  });

  test("the callback with neither code nor token_hash reports missing_code", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto("/api/auth/callback");
    await expect(page).toHaveURL(/\/login\?error=missing_code/);
    await expect(page.getByText("Authentication error. Please try again.")).toBeVisible();
  });

  test("the callback refuses an off-site `next` (open-redirect guard)", async ({ page }) => {
    await page.context().clearCookies();
    const token = await magicLinkTokenFor(USERS.alice.email);
    await page.goto(
      `/api/auth/callback?token_hash=${token}&type=magiclink&next=${encodeURIComponent("//evil.example.com")}`
    );
    // Must fall back to the default, not navigate off-origin.
    await expect(page).toHaveURL(/localhost:\d+\/dashboard\/trending$/);
  });

  // ─── Onboarding ───────────────────────────────────────────────────────────

  test("a user with no username is forced through onboarding, and setting one releases them", async ({
    page,
  }) => {
    const fresh = await createExtraUser("onboard1");
    // A brand-new user's profile has username = null (set by handle_new_user).
    await setProfileFields(fresh.id, { username: null });

    await loginAsEmail(page, fresh.email);

    // requireOnboarding() in (app)/layout.tsx bounces every app page.
    await page.goto("/dashboard/trending");
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByText("Welcome to Forecast")).toBeVisible();
    await expect(page.getByText("1,000 coins credited!")).toBeVisible();

    const username = "onboardok";
    await page.getByTestId("onboarding-username").fill(username);
    await page.getByTestId("onboarding-submit").click();

    await expect(page).toHaveURL(/\/dashboard\/trending$/);
    // Stored lowercased.
    expect((await getProfile(fresh.id)).username).toBe(username);
  });

  test("onboarding rejects an invalid username and a taken one", async ({ page }) => {
    const fresh = await createExtraUser("onboard2");
    await setProfileFields(fresh.id, { username: null });
    await loginAsEmail(page, fresh.email);
    await page.goto("/onboarding");

    // An illegal username cannot be submitted at all: the button is
    // `disabled={!isValid || isLoading}` and isValid runs the same
    // /^[a-zA-Z0-9_]{3,20}$/ regex, so the disabled state IS the enforcement
    // here rather than an error message.
    await page.getByTestId("onboarding-username").fill("a!");
    await expect(page.getByTestId("onboarding-submit")).toBeDisabled();
    await page.getByTestId("onboarding-username").fill("ab");
    await expect(page.getByTestId("onboarding-submit")).toBeDisabled();

    // Already taken by a fixture — valid format, so it reaches the server-side
    // uniqueness pre-check and surfaces a real error.
    await page.getByTestId("onboarding-username").fill(USERS.alice.username);
    await page.getByTestId("onboarding-submit").click();
    await expect(page.getByTestId("onboarding-error")).toHaveText(
      "This username is already taken. Please choose another."
    );

    // Still not onboarded — the failed attempts changed nothing.
    expect((await getProfile(fresh.id)).username).toBeNull();
  });

  test("an onboarded user visiting /onboarding is redirected away", async ({ page }) => {
    await loginAs(page, "alice");
    await page.goto("/onboarding");
    await expect(page).toHaveURL(/\/dashboard\/trending$/);
  });

  // ─── Referral attribution ─────────────────────────────────────────────────

  test("a referral code on the login link credits the referrer 500 coins exactly", async ({
    page,
  }) => {
    const referrer = await getProfile(userId("bob"));
    expect(referrer.referral_code).not.toBeNull();
    const coinsBefore = referrer.coins;
    const countBefore = referrer.referral_count;

    // A genuinely new user: no username, so the callback treats them as new and
    // record_referral runs.
    const invitee = await createExtraUser("ref1");
    await setProfileFields(invitee.id, { username: null, referred_by: null });

    const token = await magicLinkTokenFor(invitee.email);
    await page.context().clearCookies();
    await page.goto(
      `/api/auth/callback?token_hash=${token}&type=magiclink&ref=${referrer.referral_code}`
    );
    // New user → onboarding.
    await expect(page).toHaveURL(/\/onboarding$/);

    // Flat +500 per referral (record_referral, 0011). Exact, not a range.
    const after = await getProfile(userId("bob"));
    expect(after.coins).toBe(coinsBefore + 500);
    expect(after.referral_count).toBe(countBefore + 1);
    expect((await getProfile(invitee.id)).referred_by).toBe(userId("bob"));
  });

  test("an unknown referral code is ignored silently and credits nobody", async ({
    page,
  }) => {
    const invitee = await createExtraUser("ref2");
    await setProfileFields(invitee.id, { username: null, referred_by: null });

    const { data: before } = await admin
      .from("profiles")
      .select("id, coins")
      .order("id");

    const token = await magicLinkTokenFor(invitee.email);
    await page.context().clearCookies();
    await page.goto(
      `/api/auth/callback?token_hash=${token}&type=magiclink&ref=NOSUCHCODE`
    );
    // Sign-in must still succeed — a bad ref is non-fatal by design.
    await expect(page).toHaveURL(/\/onboarding$/);

    // record_referral RETURNs silently rather than raising, so assert on data:
    // nobody's balance moved.
    const { data: after } = await admin.from("profiles").select("id, coins").order("id");
    expect(after).toEqual(before);
    expect((await getProfile(invitee.id)).referred_by).toBeNull();
  });

  test("a referral is recorded at most once per user", async ({ page }) => {
    const referrer = await getProfile(userId("owner"));
    const invitee = await createExtraUser("ref3");
    await setProfileFields(invitee.id, { username: null, referred_by: null });

    const coinsBefore = referrer.coins;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await magicLinkTokenFor(invitee.email);
      await page.context().clearCookies();
      await page.goto(
        `/api/auth/callback?token_hash=${token}&type=magiclink&ref=${referrer.referral_code}`
      );
    }

    // Credited once, not twice — record_referral is idempotent on referred_by.
    expect((await getProfile(userId("owner"))).coins).toBe(coinsBefore + 500);
    expect((await getProfile(userId("owner"))).referral_count).toBe(
      referrer.referral_count + 1
    );
  });

  // ─── Sign out ─────────────────────────────────────────────────────────────

  test("signing out from the sidebar ends the session", async ({ page }) => {
    await loginAs(page, "alice");
    await page.goto("/dashboard/trending");
    await page.getByTestId("sidebar-signout").click();
    await expect(page).toHaveURL(/\/login/);

    // And the session is genuinely gone, not just navigated away from.
    await page.goto("/dashboard/trending");
    await expect(page).toHaveURL(/\/login/);
  });
});
