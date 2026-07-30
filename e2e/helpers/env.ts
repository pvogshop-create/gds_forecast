import dotenv from "dotenv";
import path from "path";

// Helpers are imported both by globalSetup (which Playwright runs before the
// config's dotenv call has necessarily reached this module's scope) and by
// specs. Loading .env.test here too is idempotent and makes each helper usable
// standalone, e.g. from `npx tsx`.
dotenv.config({
  path: path.resolve(__dirname, "../../.env.test"),
  quiet: true,
});

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing ${name}. The E2E suite reads it from .env.test — run \`npx supabase status\` ` +
        `and confirm the local URL and keys are filled in.`
    );
  }
  return value;
}

export const SUPABASE_URL = required("NEXT_PUBLIC_SUPABASE_URL");
export const SUPABASE_ANON_KEY = required("NEXT_PUBLIC_SUPABASE_ANON_KEY");
export const SERVICE_ROLE_KEY = required("SUPABASE_SERVICE_ROLE_KEY");
export const ADMIN_EMAIL = required("ADMIN_EMAIL");
export const E2E_TEST_SECRET = required("E2E_TEST_SECRET");
export const CRON_SECRET = required("CRON_SECRET");

/**
 * Hard safety rail. Seeding and cleanup delete auth users and markets outright.
 * If the suite were ever pointed at the hosted project it would destroy real
 * data with no confirmation step, so refuse to proceed unless Supabase is
 * demonstrably the local Docker instance.
 */
export function assertLocalSupabase(): void {
  let host: string;
  try {
    host = new URL(SUPABASE_URL).hostname;
  } catch {
    throw new Error(`NEXT_PUBLIC_SUPABASE_URL is not a valid URL: ${SUPABASE_URL}`);
  }

  const isLocal =
    host === "127.0.0.1" || host === "localhost" || host === "0.0.0.0" || host === "::1";

  if (!isLocal) {
    throw new Error(
      `REFUSING TO RUN: the E2E suite seeds and DELETES users and markets, but ` +
        `NEXT_PUBLIC_SUPABASE_URL points at "${host}", not local Supabase. ` +
        `Start local Supabase (\`npx supabase start\`) and check .env.test. ` +
        `Never run this suite against a hosted project.`
    );
  }
}

// The fixed password every seeded fixture shares. Local-only; these accounts
// exist solely inside the throwaway Docker Postgres.
export const TEST_PASSWORD = "e2e-forecast-test-password";

// All fixture emails live on the reserved .test TLD (RFC 2606) so they can never
// collide with, or send mail to, a real address. The test-login route also
// refuses any address outside this domain.
export const TEST_EMAIL_DOMAIN = "forecast.test";
