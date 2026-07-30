import { cleanupAll } from "./helpers/seed";

/**
 * Runs once after the suite. Leaves the local DB as it was found.
 *
 * Set E2E_KEEP_DATA=1 to skip this when you want to poke at the resulting state
 * in Supabase Studio (http://127.0.0.1:54323) after a failure.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.E2E_KEEP_DATA) {
    console.log("[e2e] E2E_KEEP_DATA set — leaving test data in place.");
    return;
  }
  console.log("[e2e] cleaning up test data…");
  await cleanupAll();
}
