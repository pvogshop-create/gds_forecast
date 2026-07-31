import type { APIRequestContext, Page } from "@playwright/test";
import { E2E_TEST_SECRET, TEST_PASSWORD } from "./env";
import { USERS, type UserKey } from "./fixtures";

/**
 * One implementation, three entry points. Keeping the request shape in a single
 * place means the secret header name and the response contract cannot drift
 * between the page-based and context-based callers.
 */
async function postTestLogin(
  requester: Pick<APIRequestContext, "post">,
  email: string,
  label: string
): Promise<string> {
  const response = await requester.post("/api/test/login", {
    headers: { "x-e2e-secret": E2E_TEST_SECRET },
    data: { email, password: TEST_PASSWORD },
  });
  if (!response.ok()) {
    throw new Error(`${label} failed: ${response.status()} ${await response.text()}`);
  }
  return ((await response.json()) as { userId: string }).userId;
}

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
  return postTestLogin(page.request, USERS[key].email, `loginAs(${key})`);
}

/** Same, for a standalone APIRequestContext (no page/browser involved). */
export async function loginApi(
  request: APIRequestContext,
  key: UserKey
): Promise<string> {
  return postTestLogin(request, USERS[key].email, `loginApi(${key})`);
}

/** Log in an arbitrary seeded address (e.g. one from `createExtraUser`). */
export async function loginAsEmail(page: Page, email: string): Promise<string> {
  return postTestLogin(page.request, email, `loginAsEmail(${email})`);
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
