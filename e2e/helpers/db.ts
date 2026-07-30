import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  SERVICE_ROLE_KEY,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  TEST_PASSWORD,
  assertLocalSupabase,
} from "./env";

assertLocalSupabase();

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Legitimate uses: seeding, teardown, and READING state to assert against.
 * Illegitimate use: proving a policy works. A policy test run through this
 * client passes unconditionally and proves nothing — see TESTING.md. For that,
 * use `anonClientFor()` below.
 */
export const admin: SupabaseClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/**
 * An anon-key client authenticated as a specific user, so queries run under that
 * user's `auth.uid()` and RLS applies. This is the only correct way to test a
 * policy, and the harness pattern spec §10.4 prescribes.
 */
export async function anonClientFor(email: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (error) {
    throw new Error(`anonClientFor(${email}) failed to sign in: ${error.message}`);
  }
  return client;
}

// ─── Readers ────────────────────────────────────────────────────────────────
// Thin, typed, and throwing: a helper that silently returns null turns a seeding
// bug into a confusing assertion failure three lines later.

export interface ProfileRow {
  id: string;
  username: string | null;
  display_name: string | null;
  coins: number;
  total_bets: number;
  wins: number;
  win_streak: number;
  loss_streak: number;
  last_daily_claim: string | null;
  referral_code: string | null;
  referral_count: number;
  referred_by: string | null;
}

export async function getProfile(userId: string): Promise<ProfileRow> {
  const { data, error } = await admin
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();
  if (error) throw new Error(`getProfile(${userId}): ${error.message}`);
  return data as ProfileRow;
}

export async function getCoins(userId: string): Promise<number> {
  return (await getProfile(userId)).coins;
}

export interface MarketRow {
  id: string;
  title: string;
  description: string;
  category: string;
  status: string;
  market_type: string;
  yes_pool: string | number;
  no_pool: string | number;
  yes_probability: string | number;
  ou_line: string | number | null;
  ou_opening_line: string | number | null;
  ou_unit: string | null;
  resolution_value: string | number | null;
  resolution_date: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  creator_id: string;
  suggested_by: string | null;
  is_featured: boolean;
  created_at: string;
}

export async function getMarket(marketId: string): Promise<MarketRow> {
  const { data, error } = await admin
    .from("markets")
    .select("*")
    .eq("id", marketId)
    .single();
  if (error) throw new Error(`getMarket(${marketId}): ${error.message}`);
  return data as MarketRow;
}

export interface PositionRow {
  id: string;
  market_id: string;
  user_id: string;
  side: "yes" | "no";
  coins_wagered: number;
  shares_bought: string | number;
  price_at_bet: string | number;
  status: string;
  payout: number | null;
  yes_odds_at_bet: number;
  ou_line_at_bet: string | number | null;
  created_at: string;
}

export async function getPositions(
  marketId: string,
  userId?: string
): Promise<PositionRow[]> {
  let q = admin.from("positions").select("*").eq("market_id", marketId);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q.order("created_at", { ascending: true });
  if (error) throw new Error(`getPositions(${marketId}): ${error.message}`);
  return (data ?? []) as PositionRow[];
}

export async function getPosition(
  marketId: string,
  userId: string
): Promise<PositionRow> {
  const rows = await getPositions(marketId, userId);
  const last = rows[rows.length - 1];
  if (!last) {
    throw new Error(`No position for user ${userId} on market ${marketId}`);
  }
  return last;
}

export interface NotificationRow {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

export async function getNotifications(
  userId: string,
  type?: string
): Promise<NotificationRow[]> {
  let q = admin.from("notifications").select("*").eq("user_id", userId);
  if (type) q = q.eq("type", type);
  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) throw new Error(`getNotifications(${userId}): ${error.message}`);
  return (data ?? []) as NotificationRow[];
}

export async function getProbabilityHistory(
  marketId: string
): Promise<{ yes_probability: string | number; recorded_at: string }[]> {
  const { data, error } = await admin
    .from("market_probability_history")
    .select("yes_probability, recorded_at")
    .eq("market_id", marketId)
    .order("recorded_at", { ascending: true });
  if (error) throw new Error(`getProbabilityHistory(${marketId}): ${error.message}`);
  return data ?? [];
}

export async function getActivity(
  marketId: string
): Promise<{ id: string; user_id: string; action_type: string }[]> {
  const { data, error } = await admin
    .from("activity_feed")
    .select("id, user_id, action_type")
    .eq("market_id", marketId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getActivity(${marketId}): ${error.message}`);
  return data ?? [];
}

export async function getComments(
  marketId: string
): Promise<{ id: string; user_id: string; body: string }[]> {
  const { data, error } = await admin
    .from("market_comments")
    .select("id, user_id, body")
    .eq("market_id", marketId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`getComments(${marketId}): ${error.message}`);
  return data ?? [];
}

export async function getReactions(
  marketId: string
): Promise<{ user_id: string; emoji: string }[]> {
  const { data, error } = await admin
    .from("market_reactions")
    .select("user_id, emoji")
    .eq("market_id", marketId);
  if (error) throw new Error(`getReactions(${marketId}): ${error.message}`);
  return data ?? [];
}

export interface IncidentReportRow {
  id: string;
  market_id: string;
  reporter_id: string;
  description: string;
  proposed_outcome: string;
  status: string;
  yes_votes: number;
  no_votes: number;
  veto_deadline: string | null;
}

export async function getIncident(reportId: string): Promise<IncidentReportRow> {
  const { data, error } = await admin
    .from("incident_reports")
    .select("*")
    .eq("id", reportId)
    .single();
  if (error) throw new Error(`getIncident(${reportId}): ${error.message}`);
  return data as IncidentReportRow;
}

export interface LeagueWeekRow {
  id: string;
  league_id: string;
  week_number: number;
  week_start: string;
  week_end: string;
  pool_coins: number;
  status: string;
}

export async function getActiveWeek(leagueId: string): Promise<LeagueWeekRow | null> {
  const { data, error } = await admin
    .from("league_weeks")
    .select("*")
    .eq("league_id", leagueId)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`getActiveWeek(${leagueId}): ${error.message}`);
  return (data as LeagueWeekRow) ?? null;
}

export async function getWeek(weekId: string): Promise<LeagueWeekRow> {
  const { data, error } = await admin
    .from("league_weeks")
    .select("*")
    .eq("id", weekId)
    .single();
  if (error) throw new Error(`getWeek(${weekId}): ${error.message}`);
  return data as LeagueWeekRow;
}

export async function getWeekParticipants(weekId: string): Promise<
  { user_id: string; buy_in_paid: number; gross_payout: number; points: number | null }[]
> {
  const { data, error } = await admin
    .from("league_week_participants")
    .select("user_id, buy_in_paid, gross_payout, points")
    .eq("week_id", weekId);
  if (error) throw new Error(`getWeekParticipants(${weekId}): ${error.message}`);
  return data ?? [];
}

export async function getLeagueBets(
  weekId: string
): Promise<{ position_id: string; league_id: string; user_id: string }[]> {
  const { data, error } = await admin
    .from("league_bets")
    .select("position_id, league_id, user_id")
    .eq("week_id", weekId);
  if (error) throw new Error(`getLeagueBets(${weekId}): ${error.message}`);
  return data ?? [];
}

export async function getLeague(leagueId: string): Promise<{
  id: string;
  name: string;
  invite_code: string | null;
  max_members: number;
  buy_in_coins: number;
  carry_over_pool: number;
  week_start_date: string | null;
  creator_id: string;
}> {
  const { data, error } = await admin
    .from("leagues")
    .select("*")
    .eq("id", leagueId)
    .single();
  if (error) throw new Error(`getLeague(${leagueId}): ${error.message}`);
  return data;
}

export async function getLeagueMembers(
  leagueId: string
): Promise<{ user_id: string; role: string; total_points: number; weeks_played: number }[]> {
  const { data, error } = await admin
    .from("league_members")
    .select("user_id, role, total_points, weeks_played")
    .eq("league_id", leagueId);
  if (error) throw new Error(`getLeagueMembers(${leagueId}): ${error.message}`);
  return data ?? [];
}

export async function getSuggestions(
  userId: string
): Promise<{ id: string; title: string; status: string; admin_note: string | null }[]> {
  const { data, error } = await admin
    .from("market_suggestions")
    .select("id, title, status, admin_note")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`getSuggestions(${userId}): ${error.message}`);
  return data ?? [];
}

/**
 * NUMERIC columns arrive from PostgREST as strings to preserve precision
 * (yes_pool, yes_probability, shares_bought, ou_line...). Every exact-value
 * assertion on those must go through this, or `expect(pool).toBe(200)` fails
 * against the string "200.00".
 */
export function num(value: string | number | null): number {
  if (value === null) throw new Error("num(): unexpected null");
  return typeof value === "number" ? value : Number(value);
}

/**
 * Poll until a market has exactly `count` comments.
 *
 * MarketComments renders optimistically — the bubble appears before the
 * `postComment` server action has finished — so a single read of the table right
 * after clicking Submit races the write. Everything asserting on persisted
 * comments must go through this.
 */
export async function waitForCommentCount(
  marketId: string,
  count: number,
  timeoutMs = 15_000
): Promise<{ id: string; user_id: string; body: string }[]> {
  const deadline = Date.now() + timeoutMs;
  let rows = await getComments(marketId);
  while (rows.length !== count && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
    rows = await getComments(marketId);
  }
  if (rows.length !== count) {
    throw new Error(
      `Expected ${count} comment(s) on ${marketId} within ${timeoutMs}ms, found ${rows.length}`
    );
  }
  return rows;
}

/**
 * Poll until a market has exactly `count` reaction rows.
 *
 * MarketReactions is optimistic too: the count in the DOM changes before
 * POST /api/markets/:id/react returns. It also ignores clicks while a toggle is
 * in flight (`if (!currentUserId || toggling) return`), so a test that clicks two
 * emoji back to back silently loses the second unless it waits here in between.
 */
export async function waitForReactionCount(
  marketId: string,
  count: number,
  timeoutMs = 15_000
): Promise<{ user_id: string; emoji: string }[]> {
  const deadline = Date.now() + timeoutMs;
  let rows = await getReactions(marketId);
  while (rows.length !== count && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 150));
    rows = await getReactions(marketId);
  }
  if (rows.length !== count) {
    throw new Error(
      `Expected ${count} reaction(s) on ${marketId} within ${timeoutMs}ms, found ${rows.length}`
    );
  }
  return rows;
}
