import { expect } from "@playwright/test";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { admin } from "./db";

/**
 * Assertions for Row-Level-Security boundaries.
 *
 * These exist because denied reads and denied writes fail in OPPOSITE ways, and
 * confusing the two is how a policy test passes while data leaks:
 *
 *   - A denied SELECT does not error. RLS is a filter, not a gate: the row is
 *     silently omitted and you get `error: null, data: []`. Asserting on a
 *     thrown error is the classic false-green — that assertion can never fire,
 *     so the test passes whether or not the policy exists.
 *   - A denied INSERT DOES error (`42501 new row violates row-level security
 *     policy`), because a failed WITH CHECK aborts the statement.
 *
 * Every helper verifies its fixture through `admin` (service_role, which
 * bypasses RLS), because the costliest failure mode is a test that passes
 * vacuously: `expectCannotRead` against an id that was never seeded is green
 * forever and proves nothing.
 *
 * See TESTING.md ("The RLS methodology") and spec §10.4.
 */

/** Shape shared by every PostgREST response asserted on here. */
interface ReadResult {
  data: Record<string, unknown>[] | null;
  error: PostgrestError | null;
}

function describeError(error: PostgrestError): string {
  return `${error.code ?? "?"} ${error.message}`;
}

/**
 * Confirm through service_role that `id` really is a row in `table`. Without
 * this, a negative read assertion is one typo away from being unfalsifiable.
 */
async function assertRowExists(table: string, id: string, label: string): Promise<void> {
  const { data, error } = await admin.from(table).select("id").eq("id", id);
  if (error) {
    throw new Error(
      `${label}: could not verify ${table}/${id} exists (service_role read failed: ` +
        `${describeError(error)}). Fix the fixture before trusting this assertion.`
    );
  }
  if ((data ?? []).length !== 1) {
    throw new Error(
      `${label}: ${table}/${id} does not exist, so this assertion proves nothing — ` +
        `a denied read and an absent row look identical from the client. Check the seed.`
    );
  }
}

/**
 * The single most important RLS assertion: a direct-by-ID read returns empty.
 *
 * Hiding a row from a LIST is not access control. It must be unreadable even
 * when the caller knows its exact UUID and asks for it by name — exactly what
 * someone who scraped an id out of a shared link would do.
 *
 * `client` MUST come from `anonClientFor()`. Passing `admin` is meaningless:
 * service_role bypasses RLS, so the read succeeds and the test fails for the
 * wrong reason.
 */
export async function expectCannotRead(
  client: SupabaseClient,
  table: string,
  id: string,
  label = `${table}/${id}`
): Promise<void> {
  await assertRowExists(table, id, `expectCannotRead(${label})`);

  const { data, error } = (await client
    .from(table)
    .select("*")
    .eq("id", id)) as unknown as ReadResult;

  // An error here is NOT a pass. It means something else broke — a recursive
  // policy (42P17, the 0024 bug), a missing column, a dropped relation — and
  // reading that as "access denied" hides a real defect behind a green test.
  // Denial looks like success-with-no-rows, nothing else.
  expect(
    error,
    `expectCannotRead(${label}): expected a filtered (empty) read, got error ${
      error ? describeError(error) : ""
    }. RLS denies by filtering, so an error means a different failure.`
  ).toBeNull();

  expect(
    data ?? [],
    `LEAK: expectCannotRead(${label}) returned a row. This user must not be able to ` +
      `read that record by id.`
  ).toEqual([]);
}

/**
 * The positive half of the matrix: this user CAN read that row by id.
 *
 * Needed as often as the negative — a policy that denies everyone is as broken
 * as one that permits everyone, and only this direction catches it.
 */
export async function expectCanRead(
  client: SupabaseClient,
  table: string,
  id: string,
  label = `${table}/${id}`
): Promise<Record<string, unknown>> {
  await assertRowExists(table, id, `expectCanRead(${label})`);

  const { data, error } = (await client
    .from(table)
    .select("*")
    .eq("id", id)) as unknown as ReadResult;

  expect(
    error,
    `expectCanRead(${label}): read failed with ${error ? describeError(error) : ""}`
  ).toBeNull();

  const rows = data ?? [];
  expect(
    rows.length,
    `expectCanRead(${label}): expected exactly 1 row, got ${rows.length}. Empty means ` +
      `the policy is over-restrictive and has locked out a user who should have access.`
  ).toBe(1);

  const row = rows[0];
  if (!row) {
    // Unreachable given the assertion above; present because the index access
    // is genuinely optional under noUncheckedIndexedAccess.
    throw new Error(`expectCanRead(${label}): row count asserted but no row returned.`);
  }
  return row;
}

/**
 * A write this user is not allowed to make is rejected — and leaves nothing
 * behind.
 *
 * Both halves matter: a policy can reject the statement the client sent while a
 * trigger or a permissive sibling policy still persists something, so absence
 * is verified through service_role rather than inferred from the error.
 *
 * This covers the gap the tier work opens: scoping SELECT while leaving INSERT
 * as `user_id = auth.uid()` lets an outsider who knows a private market's UUID
 * inject a comment or reaction into it. A read-only suite passes that hole in
 * silence.
 */
export async function expectCannotWrite(
  client: SupabaseClient,
  table: string,
  row: Record<string, unknown>,
  label = table
): Promise<void> {
  const { error } = await client.from(table).insert(row);

  expect(
    error,
    `expectCannotWrite(${label}): the insert SUCCEEDED. This user must not be able to ` +
      `write that row — payload: ${JSON.stringify(row)}`
  ).not.toBeNull();

  // Belt and braces: prove the row is genuinely absent, not merely reported as
  // rejected. Match on the payload's own scalar columns; nulls and nested
  // values are skipped because PostgREST cannot filter them by equality.
  let query = admin.from(table).select("id");
  let filtered = false;
  for (const [column, value] of Object.entries(row)) {
    if (value === null || value === undefined || typeof value === "object") continue;
    query = query.eq(column, value as string | number | boolean);
    filtered = true;
  }
  if (!filtered) return;

  const { data, error: readError } = await query;
  if (readError) {
    throw new Error(
      `expectCannotWrite(${label}): the rejection looked right, but the service_role ` +
        `follow-up read failed (${describeError(readError)}), so "nothing landed" is unproven.`
    );
  }
  expect(
    data ?? [],
    `LEAK: expectCannotWrite(${label}) reported an error but a matching row exists anyway.`
  ).toEqual([]);
}
