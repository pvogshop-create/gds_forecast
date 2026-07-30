import { ADMIN_EMAIL, TEST_EMAIL_DOMAIN } from "./env";

/**
 * The five seeded users, created once by global setup and reused for the whole
 * run. Their identities are stable; their coin balances are NOT — specs reset
 * balances per test via `setCoins()`, because balance is shared mutable state
 * and the exact-value assertions depend on knowing it precisely.
 *
 * `admin` is an admin because its email is in ADMIN_EMAIL, which
 * playwright.config.ts feeds to the dev server. There is no is_admin column and
 * no DB role — admin identity is entirely app-layer (src/lib/auth.ts,
 * src/proxy.ts). See TESTING.md.
 */
export interface TestUser {
  key: UserKey;
  email: string;
  username: string;
  displayName: string;
  /** Balance global setup establishes; specs may override per test. */
  coins: number;
}

export type UserKey = "admin" | "owner" | "alice" | "bob" | "broke";

export const USERS: Record<UserKey, TestUser> = {
  // Must match ADMIN_EMAIL exactly or every /admin test fails at the middleware.
  admin: {
    key: "admin",
    email: ADMIN_EMAIL,
    username: "e2eadmin",
    displayName: "E2E Admin",
    coins: 10_000,
  },
  owner: {
    key: "owner",
    email: `e2e-owner@${TEST_EMAIL_DOMAIN}`,
    username: "e2eowner",
    displayName: "E2E Owner",
    coins: 5_000,
  },
  // Primary actor for most flows.
  alice: {
    key: "alice",
    email: `e2e-alice@${TEST_EMAIL_DOMAIN}`,
    username: "e2ealice",
    displayName: "E2E Alice",
    coins: 1_000,
  },
  // Second actor: the two-browser realtime test, @-mention targets, and the
  // fourth/opposing vote in incident threshold tests.
  bob: {
    key: "bob",
    email: `e2e-bob@${TEST_EMAIL_DOMAIN}`,
    username: "e2ebob",
    displayName: "E2E Bob",
    coins: 1_000,
  },
  // Exists so the CLIENT-side "Insufficient coins. You have N coins." branch is
  // reachable at all. BettingPanel calls validateBet(coins, balance, 10,
  // effectiveMax); once a market is past calibration effectiveMax === balance,
  // and validateBet checks max before balance, so an over-balance bet reports
  // "Maximum bet is N coins." instead. Only balance < effectiveMax surfaces the
  // insufficient message — hence a deliberately tiny balance.
  broke: {
    key: "broke",
    email: `e2e-broke@${TEST_EMAIL_DOMAIN}`,
    username: "e2ebroke",
    displayName: "E2E Broke",
    coins: 25,
  },
};

export const ALL_USER_KEYS = Object.keys(USERS) as UserKey[];

export const ALL_TEST_EMAILS = ALL_USER_KEYS.map((k) => USERS[k].email);
