import type { APIRequestContext, Page } from "@playwright/test";
import { E2E_TEST_SECRET, TEST_PASSWORD } from "./env";
import { USERS, type UserKey } from "./fixtures";

/**
 * Sign a page in as a seeded fixture via POST /api/test/login.
 *
 * The route uses the app's own server Supabase factory, so the `sb-*` SSR
 * cookies it writes are byte-identical to a real magic-link session — the
 * middleware and every Server Component treat this as an ordinary login.
 * The page's own request context is used, so the Set-Cookie lands in the
 * browser context that `page` belongs to.
 */
export async function loginAs(page: Page, key: UserKey): Promise<string> {
  const user = USERS[key];
  const response = await page.request.post("/api/test/login", {
    headers: { "x-e2e-secret": E2E_TEST_SECRET },
    data: { email: user.email, password: TEST_PASSWORD },
  });

  if (!response.ok()) {
    throw new Error(
      `loginAs(${key}) failed: ${response.status()} ${await response.text()}`
    );
  }
  const body = (await response.json()) as { userId: string };
  return body.userId;
}

/** Same, for a standalone APIRequestContext (no page/browser involved). */
export async function loginApi(
  request: APIRequestContext,
  key: UserKey
): Promise<string> {
  const user = USERS[key];
  const response = await request.post("/api/test/login", {
    headers: { "x-e2e-secret": E2E_TEST_SECRET },
    data: { email: user.email, password: TEST_PASSWORD },
  });
  if (!response.ok()) {
    throw new Error(
      `loginApi(${key}) failed: ${response.status()} ${await response.text()}`
    );
  }
  const body = (await response.json()) as { userId: string };
  return body.userId;
}

/** Log in an arbitrary seeded address (e.g. one from `createExtraUser`). */
export async function loginAsEmail(page: Page, email: string): Promise<string> {
  const response = await page.request.post("/api/test/login", {
    headers: { "x-e2e-secret": E2E_TEST_SECRET },
    data: { email, password: TEST_PASSWORD },
  });
  if (!response.ok()) {
    throw new Error(
      `loginAsEmail(${email}) failed: ${response.status()} ${await response.text()}`
    );
  }
  return ((await response.json()) as { userId: string }).userId;
}

/** Drop the session cookies for the page's context. */
export async function logout(page: Page): Promise<void> {
  await page.context().clearCookies();
}

/**
 * Mint a real magic-link token for an address.
 *
 * This is what lets the auth spec drive `/api/auth/callback` for real —
 * verifyOtp, the new-vs-returning-user branch, referral recording, and the
 * onboarding redirect all execute exactly as they do in production, rather than
 * being simulated. `generateLink` does not send an email.
 */
export async function magicLinkTokenFor(email: string): Promise<string> {
  const { admin } = await import("./db");
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error || !data.properties?.hashed_token) {
    throw new Error(`generateLink(${email}) failed: ${error?.message}`);
  }
  return data.properties.hashed_token;
}
