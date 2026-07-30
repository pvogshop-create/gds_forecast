import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";
import path from "path";

// Load .env.test explicitly. Next only auto-loads it when NODE_ENV=test, and
// `next dev` runs as development — so without this the dev server would fall
// through to .env.local, which points at the hosted Supabase project.
dotenv.config({ path: path.resolve(__dirname, ".env.test"), quiet: true });

const REQUIRED_ENV = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "ADMIN_EMAIL",
  "E2E_TEST_SECRET",
  "CRON_SECRET",
] as const;

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  throw new Error(
    `.env.test is missing required keys: ${missing.join(", ")}. ` +
      `Run \`npx supabase status\` and copy the local URL/keys in.`
  );
}

// Deliberately NOT 3000. A dev server you started by hand runs on 3000 with
// `.env.local`, which points at the hosted Supabase project — and global setup
// deletes users. Binding the test server to its own port means
// `reuseExistingServer` can never latch onto that process. (e2e/helpers/db.ts
// additionally refuses to run against a non-local Supabase URL.)
export const E2E_PORT = 3100;

// `localhost`, NOT `127.0.0.1`, and this matters.
//
// /api/auth/callback builds its redirect with `new URL(path, origin)` where
// origin comes from `request.url` — and Next's dev server reports that as
// `http://localhost:<port>` regardless of the Host header the request arrived
// on. So driving the app at 127.0.0.1 makes the callback redirect to localhost,
// a DIFFERENT origin: the `sb-*` session cookies it just set are not sent, the
// middleware sees no user, and the browser lands on /login having silently lost
// the session. Keeping the whole suite on one origin avoids it.
export const BASE_URL = `http://localhost:${E2E_PORT}`;

/**
 * The env handed to the dev server. Passing these through `webServer.env` is
 * what makes them win over `.env.local`: `@next/env` only assigns a key from a
 * dotenv file when `process.env[key]` is undefined or empty, so anything set
 * here is authoritative for the whole dev-server process.
 */
const webServerEnv: Record<string, string> = {
  ...(process.env as Record<string, string>),
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ADMIN_EMAIL: process.env.ADMIN_EMAIL!,
  E2E_TEST_SECRET: process.env.E2E_TEST_SECRET!,
  CRON_SECRET: process.env.CRON_SECRET!,
};

export default defineConfig({
  testDir: "./e2e",

  // Serial, single worker, no retries. The suite shares one seeded Postgres and
  // asserts exact coin/pool values; concurrency or a silent retry would make
  // those assertions meaningless (a retry can pass only because the first
  // attempt already moved the balance). See TESTING.md.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,

  timeout: 60_000,
  expect: { timeout: 10_000 },

  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",

  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    // Deterministic clock-adjacent formatting (formatRelativeTime,
    // formatTimeRemaining) across machines.
    timezoneId: "UTC",
    locale: "en-US",
  },

  projects: [
    {
      // 1280x720 — above Tailwind's `lg` (1024px), so Sidebar is the visible nav
      // and BottomTabBar is hidden. Runs everything except the mobile spec.
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 720 } },
      testIgnore: "**/mobile-nav.spec.ts",
    },
    {
      // 412x915 — below `lg`, so BottomTabBar is the visible nav. Deliberately
      // scoped to one spec: the rest of the suite is viewport-independent and
      // running it twice would double the runtime for no coverage.
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: "**/mobile-nav.spec.ts",
    },
  ],

  webServer: {
    command: `npm run dev -- --port ${E2E_PORT}`,
    url: BASE_URL,
    env: webServerEnv,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
    timeout: 180_000,
  },
});
