import { assertLocalSupabase } from "./helpers/env";
import { admin } from "./helpers/db";
import { cleanupAll, seedUsers } from "./helpers/seed";

/**
 * Runs once before the suite. Establishes a known-empty, known-seeded database
 * so exact-value assertions have a fixed starting point.
 *
 * Individual markets and leagues are NOT created here — specs create their own
 * in `beforeAll` so one spec's pool movements can never invalidate another's
 * arithmetic. All this guarantees is: local Supabase, migrations applied, five
 * fixture users present with declared balances, no leftovers.
 */
export default async function globalSetup(): Promise<void> {
  assertLocalSupabase();

  // Fail loudly and early if the DB is unreachable or unmigrated, rather than
  // letting every spec fail with its own confusing error.
  const { error: reachError } = await admin.from("profiles").select("id").limit(1);
  if (reachError) {
    // 42501 = insufficient_privilege. On a fresh local instance this is the
    // missing-GRANTs problem, not a missing table or a bad key — a fresh
    // Supabase image gives anon/authenticated/service_role only Dxtm on public,
    // so even the service key gets "permission denied". Point straight at the
    // fix instead of at supabase start.
    if (reachError.code === "42501") {
      throw new Error(
        `Local Postgres denied the service-role key ("${reachError.message}").\n` +
          `A fresh local Supabase grants the API roles no SELECT/INSERT/UPDATE/DELETE on\n` +
          `schema public, unlike the hosted project. Fix it with:\n\n` +
          `    npm run db:local:bootstrap\n\n` +
          `See supabase/local-bootstrap.sql for the full explanation.`
      );
    }
    throw new Error(
      `Cannot reach local Supabase: ${reachError.message}\n` +
        `Start it with \`npx supabase start\` and apply migrations with ` +
        `\`npx supabase migration up --local\`.`
    );
  }

  // Migration 0023 is a hard prerequisite: without 'league_win' in the
  // notification_type enum, close_league_week() aborts its whole transaction,
  // and the tournament specs would fail for a reason that has nothing to do with
  // the code under test.
  const { error: enumError } = await admin
    .from("notifications")
    .select("id")
    .eq("type", "league_win")
    .limit(1);
  if (enumError) {
    throw new Error(
      `The notification_type enum is missing 'league_win' (migration 0023). ` +
        `Run \`npx supabase migration up --local\`. Underlying error: ${enumError.message}`
    );
  }

  console.log("[e2e] cleaning previous test data…");
  await cleanupAll();

  console.log("[e2e] seeding fixture users…");
  const users = await seedUsers();
  console.log(
    `[e2e] ready — ${users.length} users: ${users.map((u) => u.username).join(", ")}`
  );
}
