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

export type UserKey =
  | "admin"
  | "owner"
  | "alice"
  | "bob"
  | "broke"
  // The tier-visibility matrix (see TIER_MATRIX below). These four exist only
  // to make the Circle/League boundaries adversarial.
  | "carol"
  | "dave"
  | "erin"
  | "mod";

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
  // ── Tier matrix users ────────────────────────────────────────────────────
  // In Alice's circle but NOT her league.
  carol: {
    key: "carol",
    email: `e2e-carol@${TEST_EMAIL_DOMAIN}`,
    username: "e2ecarol",
    displayName: "E2E Carol",
    coins: 1_000,
  },
  // Isolated from Alice entirely: different league AND different circle. The
  // strongest negative case — Dave must not see anything of Alice's.
  dave: {
    key: "dave",
    email: `e2e-dave@${TEST_EMAIL_DOMAIN}`,
    username: "e2edave",
    displayName: "E2E Dave",
    coins: 1_000,
  },
  // In nothing at all. The public-only floor: whatever Erin can see is what an
  // unaffiliated user sees, which is the definition of the public tier.
  erin: {
    key: "erin",
    email: `e2e-erin@${TEST_EMAIL_DOMAIN}`,
    username: "e2eerin",
    displayName: "E2E Erin",
    coins: 1_000,
  },
  // Moderator of Circle X — distinct from its creator, so creator/moderator/
  // member is a three-way distinction the tests can assert on rather than two.
  // Approves Circle X market suggestions once step 14 lands.
  mod: {
    key: "mod",
    email: `e2e-mod@${TEST_EMAIL_DOMAIN}`,
    username: "e2emod",
    displayName: "E2E Mod",
    coins: 1_000,
  },
};

export const ALL_USER_KEYS = Object.keys(USERS) as UserKey[];

export const ALL_TEST_EMAILS = ALL_USER_KEYS.map((k) => USERS[k].email);

/**
 * The seven-user tier matrix (plan.md step 4 / spec §10.3).
 *
 * These fixtures exist so that tier boundaries can be tested *adversarially*.
 * Membership is what makes a boundary real, so each user is defined by what
 * they are NOT in as much as what they are in:
 *
 * | User  | League A | League B | Circle X    | Circle Y | Proves                                |
 * |-------|----------|----------|-------------|----------|---------------------------------------|
 * | owner |          |          | creator     | creator  | creator ≠ moderator ≠ member           |
 * | alice | ✓        |          | member      |          | sees public + League A + Circle X       |
 * | bob   | ✓        |          |             |          | same league as Alice, NOT her circle    |
 * | carol |          |          | member      |          | same circle as Alice, NOT her league    |
 * | dave  |          | ✓        |             | member   | fully isolated from Alice               |
 * | erin  |          |          |             |          | public-only floor                       |
 * | mod   |          |          | moderator   |          | moderator powers, not creator powers    |
 *
 * `owner` doubles as both circles' creator rather than adding a tenth seeded
 * user. It sits outside the alice/bob/carol/dave/erin matrix, so it never
 * pollutes a negative assertion.
 *
 * The circle rows land in 0029; the LEAGUE rows are seeded by whichever spec
 * needs them, since leagues are per-test fixtures rather than global ones.
 */
export const CIRCLES = {
  x: {
    key: "x" as const,
    name: "E2E Circle X",
    slug: "e2e-circle-x",
    joiningPolicy: "invite_code" as const,
    /** creator is `owner`; alice + carol are members; mod is a moderator. */
    members: [
      { user: "alice" as UserKey, role: "member" as const },
      { user: "carol" as UserKey, role: "member" as const },
      { user: "mod" as UserKey, role: "moderator" as const },
    ],
  },
  y: {
    key: "y" as const,
    name: "E2E Circle Y",
    slug: "e2e-circle-y",
    joiningPolicy: "invite_code" as const,
    members: [{ user: "dave" as UserKey, role: "member" as const }],
  },
  /** Open-join circle, so the `joining_policy = 'open'` branch of
   *  circles_select and join_circle() has something to test against. */
  open: {
    key: "open" as const,
    name: "E2E Circle Open",
    slug: "e2e-circle-open",
    joiningPolicy: "open" as const,
    members: [],
  },
} as const;

export type CircleKey = keyof typeof CIRCLES;

export const ALL_CIRCLE_KEYS = Object.keys(CIRCLES) as CircleKey[];

/** Every circle is created by `owner` — see the note on CIRCLES above. */
export const CIRCLE_CREATOR: UserKey = "owner";
