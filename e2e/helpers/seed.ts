import { admin } from "./db";
import { TEST_PASSWORD } from "./env";
import {
  ALL_CIRCLE_KEYS,
  ALL_TEST_EMAILS,
  CIRCLE_CREATOR,
  CIRCLES,
  USERS,
  type CircleKey,
  type UserKey,
} from "./fixtures";

/**
 * Seeding and teardown. Everything here runs as service_role, which is required
 * rather than merely convenient: `profiles.coins`, `markets`, `positions`,
 * `market_probability_history`, `activity_feed`, and `notifications` are all
 * service_role-write-only under RLS (0003), and the `prevent_coin_manipulation`
 * trigger rejects any authenticated-role write to coins/wins/total_bets.
 */

// Every market/league created by the suite is titled with this prefix so cleanup
// can find them even if a spec crashes before its own teardown runs.
export const E2E_PREFIX = "[E2E]";

export interface SeededUser {
  key: UserKey;
  id: string;
  email: string;
  username: string;
  displayName: string;
}

/** userId lookup, populated by seedUsers() and read by specs via `userId()`. */
const seededIds = new Map<UserKey, string>();

export function userId(key: UserKey): string {
  const id = seededIds.get(key);
  if (!id) {
    throw new Error(
      `User "${key}" has no id cached. Call loadSeededUsers() in the spec's ` +
        `beforeAll, or check that global setup ran.`
    );
  }
  return id;
}

export function tryUserId(key: UserKey): string | undefined {
  return seededIds.get(key);
}

/**
 * Several helpers accept either a fixture key or a raw uuid. Resolve by testing
 * membership in the known key set — an earlier version sniffed for a hyphen,
 * which would silently mis-resolve the moment any UserKey contained one
 * ("league-owner", "super-admin").
 */
function resolveUserId(user: UserKey | string): string {
  return (Object.keys(USERS) as string[]).includes(user)
    ? userId(user as UserKey)
    : user;
}

async function findAuthUserByEmail(email: string): Promise<string | null> {
  // listUsers is paginated; the local DB only ever holds the fixtures plus
  // whatever a spec created, so one generous page is enough.
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  return data.users.find((u) => u.email === email)?.id ?? null;
}

/**
 * Create (or adopt) the five fixture users and put their profiles into a known
 * state. Idempotent: safe to run against a DB that already has them.
 */
export async function seedUsers(): Promise<SeededUser[]> {
  const out: SeededUser[] = [];

  for (const key of Object.keys(USERS) as UserKey[]) {
    const spec = USERS[key];

    let id = await findAuthUserByEmail(spec.email);

    if (!id) {
      const { data, error } = await admin.auth.admin.createUser({
        email: spec.email,
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: spec.displayName },
      });
      if (error || !data.user) {
        throw new Error(`createUser(${spec.email}) failed: ${error?.message}`);
      }
      id = data.user.id;
    } else {
      // Adopting an existing user: force the password so signInWithPassword and
      // anonClientFor() both work regardless of how it was created.
      const { error } = await admin.auth.admin.updateUserById(id, {
        password: TEST_PASSWORD,
        email_confirm: true,
      });
      if (error) throw new Error(`updateUserById(${spec.email}) failed: ${error.message}`);
    }

    // The handle_new_user trigger creates the profile row. `username` is
    // mandatory: (app)/layout.tsx calls requireOnboarding(), which redirects to
    // /onboarding whenever username is null — every page test would bounce.
    const { error: profileError } = await admin
      .from("profiles")
      .update({
        username: spec.username,
        display_name: spec.displayName,
        coins: spec.coins,
        total_bets: 0,
        wins: 0,
        win_streak: 0,
        loss_streak: 0,
        last_daily_claim: null,
        referral_count: 0,
        referred_by: null,
      })
      .eq("id", id);
    if (profileError) {
      throw new Error(`Seeding profile for ${spec.email} failed: ${profileError.message}`);
    }

    seededIds.set(key, id);
    out.push({
      key,
      id,
      email: spec.email,
      username: spec.username,
      displayName: spec.displayName,
    });
  }

  return out;
}

/**
 * Repopulate the id cache for this worker, re-seeding anything that has gone
 * missing.
 *
 * Called from every spec's `beforeAll`. It must be self-healing rather than
 * strict, for two reasons:
 *
 *  - Playwright starts a FRESH WORKER after a test failure, so module state
 *    (including this cache) is discarded and rebuilt mid-run. A `beforeAll` that
 *    throws in that situation converts one real failure into a cascade of
 *    unrelated ones across every remaining file, burying the actual defect.
 *  - The fixtures live in a database the whole suite shares. Anything that
 *    removes an auth user — a crashed run's teardown, a manual reset, an
 *    interrupted `supabase db reset` — leaves the rest of the suite unable to
 *    log in at all.
 *
 * `seedUsers()` is idempotent (it adopts an existing user and resets its
 * profile), so recovering costs one round trip and yields exactly the state the
 * specs expect.
 */
export async function loadSeededUsers(): Promise<void> {
  if (seededIds.size === Object.keys(USERS).length) return;

  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(`listUsers failed: ${error.message}`);

  const missing: UserKey[] = [];
  for (const key of Object.keys(USERS) as UserKey[]) {
    const found = data.users.find((u) => u.email === USERS[key].email);
    if (found) {
      seededIds.set(key, found.id);
    } else {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    console.warn(
      `[e2e] re-seeding missing fixture(s): ${missing.join(", ")} — ` +
        `something removed them mid-run.`
    );
    await seedUsers();
  }
}

// ─── Profile state ──────────────────────────────────────────────────────────

/**
 * Set a balance to an exact value. Specs call this in beforeEach so exact-value
 * money assertions do not depend on what a previous test spent.
 */
export async function setCoins(user: UserKey | string, coins: number): Promise<void> {
  const id = resolveUserId(user);
  const { error } = await admin.from("profiles").update({ coins }).eq("id", id);
  if (error) throw new Error(`setCoins failed: ${error.message}`);
}

export async function setProfileFields(
  user: UserKey | string,
  fields: Record<string, unknown>
): Promise<void> {
  const id = resolveUserId(user);
  const { error } = await admin.from("profiles").update(fields).eq("id", id);
  if (error) throw new Error(`setProfileFields failed: ${error.message}`);
}

/** Reset all five fixtures to their declared starting state. */
export async function resetAllProfiles(): Promise<void> {
  for (const key of Object.keys(USERS) as UserKey[]) {
    const id = tryUserId(key);
    if (!id) continue;
    const { error } = await admin
      .from("profiles")
      .update({
        coins: USERS[key].coins,
        total_bets: 0,
        wins: 0,
        win_streak: 0,
        loss_streak: 0,
        last_daily_claim: null,
      })
      .eq("id", id);
    // Unchecked, a failed reset leaves the wrong starting balance and the next
    // exact-value money assertion fails as if the app were broken.
    if (error) throw new Error(`resetAllProfiles(${key}) failed: ${error.message}`);
  }
}

// ─── Markets ────────────────────────────────────────────────────────────────

export interface CreateMarketOptions {
  title?: string;
  description?: string;
  category?: "sports" | "social" | "actions";
  status?: "open" | "closed" | "resolved_yes" | "resolved_no" | "cancelled";
  /** Binary pools. Defaults 100/100 → yes_probability 0.5000. */
  yesPool?: number;
  noPool?: number;
  marketType?: "binary" | "over_under";
  ouLine?: number;
  ouUnit?: string;
  /**
   * Days from now. MUST stay positive for markets a test expects to find in an
   * "Active" feed: /dashboard/* calls close_expired_markets() on every render,
   * which flips any past-dated open market to `closed`.
   */
  resolutionInDays?: number;
  isFeatured?: boolean;
  creator?: UserKey;
  suggestedBy?: UserKey;
}

let marketCounter = 0;

export async function createMarket(opts: CreateMarketOptions = {}): Promise<string> {
  marketCounter += 1;
  const {
    title = `${E2E_PREFIX} Market ${marketCounter} ${Date.now()}`,
    description = "Seeded by the E2E suite. Play money only.",
    category = "sports",
    status = "open",
    marketType = "binary",
    resolutionInDays = 30,
    isFeatured = false,
    creator = "admin",
    suggestedBy,
  } = opts;

  const isOu = marketType === "over_under";
  // O/U markets open with empty pools; place_ou_bet then adds each stake to the
  // bet side's pool (so pools tally volume) *and* moves the line, which is what
  // actually prices the market.
  const yesPool = opts.yesPool ?? (isOu ? 0 : 100);
  const noPool = opts.noPool ?? (isOu ? 0 : 100);

  const row: Record<string, unknown> = {
    title: title.startsWith(E2E_PREFIX) ? title : `${E2E_PREFIX} ${title}`,
    description,
    category,
    status,
    market_type: marketType,
    yes_pool: yesPool,
    no_pool: noPool,
    creator_id: userId(creator),
    is_featured: isFeatured,
    resolution_date: new Date(
      Date.now() + resolutionInDays * 24 * 60 * 60 * 1000
    ).toISOString(),
  };

  if (isOu) {
    const line = opts.ouLine ?? 3.5;
    row.ou_line = line;
    row.ou_opening_line = line;
    row.ou_unit = opts.ouUnit ?? "pts";
  }
  if (suggestedBy) row.suggested_by = userId(suggestedBy);
  if (status === "resolved_yes" || status === "resolved_no") {
    row.resolved_at = new Date().toISOString();
    row.resolved_by = userId("admin");
  }

  const { data, error } = await admin.from("markets").insert(row).select("id").single();
  if (error || !data) throw new Error(`createMarket failed: ${error?.message}`);
  return data.id as string;
}

/** Force a market's status directly (e.g. to close one mid-test). */
export async function setMarketStatus(marketId: string, status: string): Promise<void> {
  const { error } = await admin.from("markets").update({ status }).eq("id", marketId);
  if (error) throw new Error(`setMarketStatus failed: ${error.message}`);
}

/**
 * Push a market's deadline into the past WITHOUT touching its status.
 *
 * Prefer this over `setMarketStatus(id, "closed")` when what you actually mean is
 * "this market has expired": it leaves the market genuinely open-but-past-due, so
 * the real `close_expired_markets()` path is what flips it — either on the next
 * dashboard render or on an explicit RPC call. `setMarketStatus` jumps straight
 * to the end state and skips the mechanism entirely.
 */
export async function expireMarket(marketId: string, daysAgo = 1): Promise<void> {
  const { error } = await admin
    .from("markets")
    .update({
      resolution_date: new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString(),
    })
    .eq("id", marketId);
  if (error) throw new Error(`expireMarket failed: ${error.message}`);
}

// ─── Bets and resolution ────────────────────────────────────────────────────

export interface PlaceBetResult {
  position_id: string;
  coins_remaining: number;
  yes_odds_at_bet: number;
  new_probability: number;
  shares: number;
}

/**
 * Place a bet as a user, through the real `place_bet` RPC so all the triggers,
 * pool math, and probability history behave exactly as in the app.
 *
 * Called with service_role, where auth.uid() is NULL — so place_bet's
 * "cannot place bet for another user" guard is skipped and the seeder can bet on
 * anyone's behalf. Going through an authenticated client instead would trip
 * prevent_coin_manipulation.
 */
export async function placeBetAs(
  user: UserKey,
  marketId: string,
  side: "yes" | "no",
  coins: number
): Promise<PlaceBetResult> {
  const { data, error } = await admin.rpc("place_bet", {
    p_market_id: marketId,
    p_user_id: userId(user),
    p_side: side,
    p_coins: coins,
  });
  if (error) throw new Error(`placeBetAs(${user}) failed: ${error.message}`);
  return data as PlaceBetResult;
}

export async function placeOuBetAs(
  user: UserKey,
  marketId: string,
  side: "yes" | "no",
  coins: number
): Promise<Record<string, unknown>> {
  const { data, error } = await admin.rpc("place_ou_bet", {
    p_market_id: marketId,
    p_user_id: userId(user),
    p_side: side,
    p_coins: coins,
  });
  if (error) throw new Error(`placeOuBetAs(${user}) failed: ${error.message}`);
  return data as Record<string, unknown>;
}

export async function resolveMarketAs(
  marketId: string,
  outcome: "yes" | "no",
  note?: string
): Promise<void> {
  const { error } = await admin.rpc("resolve_market", {
    p_market_id: marketId,
    p_outcome: outcome,
    p_admin_id: userId("admin"),
    p_note: note ?? null,
  });
  if (error) throw new Error(`resolveMarketAs failed: ${error.message}`);
}

export async function resolveOuMarketAs(
  marketId: string,
  resultValue: number,
  note?: string
): Promise<void> {
  const { error } = await admin.rpc("resolve_ou_market", {
    p_market_id: marketId,
    p_result_value: resultValue,
    p_admin_id: userId("admin"),
    p_note: note ?? null,
  });
  if (error) throw new Error(`resolveOuMarketAs failed: ${error.message}`);
}

// ─── Leagues ────────────────────────────────────────────────────────────────

export interface CreateLeagueOptions {
  name?: string;
  creator?: UserKey;
  members?: UserKey[];
  buyInCoins?: number;
  maxMembers?: number;
  /** Days offset for week_start_date; negative means the first week may start now. */
  weekStartOffsetDays?: number;
  carryOverPool?: number;
}

let leagueCounter = 0;

export async function createLeague(
  opts: CreateLeagueOptions = {}
): Promise<{ id: string; inviteCode: string }> {
  leagueCounter += 1;
  const {
    name = `${E2E_PREFIX} League ${leagueCounter} ${Date.now()}`,
    creator = "owner",
    members = [],
    buyInCoins = 100,
    maxMembers = 20,
    weekStartOffsetDays = 0,
    carryOverPool = 0,
  } = opts;

  const { data, error } = await admin
    .from("leagues")
    .insert({
      name: name.startsWith(E2E_PREFIX) ? name : `${E2E_PREFIX} ${name}`,
      description: "Seeded by the E2E suite.",
      creator_id: userId(creator),
      buy_in_coins: buyInCoins,
      max_members: maxMembers,
      carry_over_pool: carryOverPool,
      week_start_date: new Date(
        Date.now() + weekStartOffsetDays * 24 * 60 * 60 * 1000
      ).toISOString(),
    })
    .select("id, invite_code")
    .single();
  if (error || !data) throw new Error(`createLeague failed: ${error?.message}`);

  // Creator is 'owner'; the app's CreateLeagueButton does the same second insert.
  const rows = [{ league_id: data.id, user_id: userId(creator), role: "owner" }];
  for (const m of members) {
    if (m === creator) continue;
    rows.push({ league_id: data.id, user_id: userId(m), role: "member" });
  }
  const { error: memberError } = await admin.from("league_members").insert(rows);
  if (memberError) throw new Error(`createLeague members failed: ${memberError.message}`);

  return { id: data.id, inviteCode: data.invite_code as string };
}

export async function startWeek(leagueId: string): Promise<{
  week_id: string;
  week_number: number;
  participants: number;
  pool_coins: number;
}> {
  const { data, error } = await admin.rpc("start_league_week", {
    p_league_id: leagueId,
  });
  if (error) throw new Error(`startWeek failed: ${error.message}`);
  return data as { week_id: string; week_number: number; participants: number; pool_coins: number };
}

export async function closeWeek(weekId: string): Promise<Record<string, unknown>> {
  const { data, error } = await admin.rpc("close_league_week", { p_week_id: weekId });
  if (error) throw new Error(`closeWeek failed: ${error.message}`);
  return data as Record<string, unknown>;
}

/** Tag a position into a league week, mirroring what the bet API route does. */
export async function tagBetToLeague(
  positionId: string,
  leagueId: string,
  weekId: string,
  user: UserKey
): Promise<void> {
  const { error } = await admin.from("league_bets").insert({
    position_id: positionId,
    league_id: leagueId,
    week_id: weekId,
    user_id: userId(user),
  });
  if (error) throw new Error(`tagBetToLeague failed: ${error.message}`);
}

/**
 * Widen a week's window so a just-resolved market falls inside it.
 * close_league_week only counts payouts where
 * `markets.resolved_at BETWEEN week_start AND week_end`, and a week started
 * "now" ends seven days from now — fine — but a week whose start_date was
 * backdated can exclude a market resolved a moment ago.
 */
export async function widenWeekWindow(weekId: string): Promise<void> {
  const { error } = await admin
    .from("league_weeks")
    .update({
      week_start: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      week_end: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    .eq("id", weekId);
  if (error) throw new Error(`widenWeekWindow failed: ${error.message}`);
}

// ─── Incidents / suggestions ────────────────────────────────────────────────

export async function submitIncidentAs(
  user: UserKey,
  marketId: string,
  description: string,
  proposedOutcome: string
): Promise<string> {
  const { data, error } = await admin.rpc("submit_incident_report", {
    p_market_id: marketId,
    p_reporter_id: userId(user),
    p_description: description,
    p_proposed_outcome: proposedOutcome,
  });
  if (error) throw new Error(`submitIncidentAs failed: ${error.message}`);
  return data as string;
}

export async function castVoteAs(
  user: UserKey | string,
  reportId: string,
  agrees: boolean
): Promise<Record<string, unknown>> {
  const id = resolveUserId(user);
  const { data, error } = await admin.rpc("cast_incident_vote", {
    p_report_id: reportId,
    p_user_id: id,
    p_agrees: agrees,
  });
  if (error) throw new Error(`castVoteAs failed: ${error.message}`);
  return data as Record<string, unknown>;
}

/** Backdate a passed report's veto deadline so the cron considers it due. */
export async function expireVetoDeadline(reportId: string): Promise<void> {
  const { error } = await admin
    .from("incident_reports")
    .update({ veto_deadline: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
    .eq("id", reportId);
  if (error) throw new Error(`expireVetoDeadline failed: ${error.message}`);
}

export async function createSuggestionAs(
  user: UserKey,
  opts: {
    title?: string;
    description?: string;
    category?: string;
    suggestedYesOdds?: number;
    marketType?: "binary" | "over_under";
    ouOpeningLine?: number;
    ouUnit?: string;
  } = {}
): Promise<string> {
  const row: Record<string, unknown> = {
    user_id: userId(user),
    title: `${E2E_PREFIX} ${opts.title ?? `Suggestion ${Date.now()}`}`,
    description: opts.description ?? "Seeded suggestion for the E2E suite.",
    category: opts.category ?? "sports",
    suggested_yes_odds: opts.suggestedYesOdds ?? 100,
    market_type: opts.marketType ?? "binary",
  };
  if (opts.marketType === "over_under") {
    row.ou_opening_line = opts.ouOpeningLine ?? 3.5;
    row.ou_unit = opts.ouUnit ?? "pts";
  }
  const { data, error } = await admin
    .from("market_suggestions")
    .insert(row)
    .select("id")
    .single();
  if (error || !data) throw new Error(`createSuggestionAs failed: ${error?.message}`);
  return data.id as string;
}

// ─── Extra users (for capacity tests) ───────────────────────────────────────

/**
 * Create a one-off throwaway user outside the five fixtures. Used where a test
 * needs N bodies (filling a league to max_members, reaching a 4-vote incident
 * threshold without reusing a voter). Cleaned up by email prefix.
 */
export async function createExtraUser(
  label: string,
  coins = 1_000
): Promise<{ id: string; email: string; username: string }> {
  const email = `e2e-extra-${label}@forecast.test`;
  const username = `e2ex${label}`.slice(0, 20).toLowerCase();

  let id = await findAuthUserByEmail(email);
  if (!id) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: TEST_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: `E2E Extra ${label}` },
    });
    if (error || !data.user) {
      throw new Error(`createExtraUser(${label}) failed: ${error?.message}`);
    }
    id = data.user.id;
  } else {
    await admin.auth.admin.updateUserById(id, {
      password: TEST_PASSWORD,
      email_confirm: true,
    });
  }

  const { error: profileError } = await admin
    .from("profiles")
    .update({ username, display_name: `E2E Extra ${label}`, coins })
    .eq("id", id);
  if (profileError) {
    throw new Error(`createExtraUser profile(${label}) failed: ${profileError.message}`);
  }

  return { id, email, username };
}

export async function addLeagueMember(
  leagueId: string,
  memberUserId: string,
  role = "member"
): Promise<void> {
  const { error } = await admin
    .from("league_members")
    .insert({ league_id: leagueId, user_id: memberUserId, role });
  if (error) throw new Error(`addLeagueMember failed: ${error.message}`);
}

// ─── Circles (0029) ─────────────────────────────────────────────────────────

export interface CreateCircleOptions {
  name?: string;
  slug?: string;
  creator?: UserKey;
  description?: string;
  joiningPolicy?: "open" | "invite_code" | "request_approval";
  members?: { user: UserKey | string; role?: "moderator" | "member" }[];
}

export interface SeededCircle {
  id: string;
  slug: string;
  inviteCode: string;
}

let circleCounter = 0;

/**
 * Creates a circle through the `create_circle` RPC rather than a raw insert,
 * so the seed exercises the same path the admin dashboard uses — including the
 * creator's role='creator' member row, which the RPC writes in the same
 * transaction.
 *
 * Members are added by DIRECT INSERT, not through `join_circle()`. That is not
 * a shortcut: `join_circle` derives the joining user from `auth.uid()`, and the
 * service-role client has no uid, so the RPC correctly refuses it. Seeding a
 * membership *for* someone else is a service_role operation by design.
 */
export async function createCircle(
  opts: CreateCircleOptions = {}
): Promise<SeededCircle> {
  circleCounter += 1;
  const stamp = `${circleCounter}-${Date.now()}`;
  const {
    name = `${E2E_PREFIX} Circle ${stamp}`,
    // Slug has a ^[a-z0-9-]{3,40}$ CHECK, so it cannot carry the "[E2E] "
    // prefix the other fixtures use. Cleanup keys on the name instead.
    slug = `e2e-circle-${stamp}`.slice(0, 40).replace(/-$/, ""),
    creator = "owner",
    description = "Seeded by the E2E suite.",
    joiningPolicy = "invite_code",
    members = [],
  } = opts;

  const { data, error } = await admin.rpc("create_circle", {
    p_name: name.startsWith(E2E_PREFIX) ? name : `${E2E_PREFIX} ${name}`,
    p_slug: slug,
    p_creator_id: resolveUserId(creator),
    p_description: description,
    p_joining_policy: joiningPolicy,
  });
  if (error || !data) throw new Error(`createCircle failed: ${error?.message}`);

  const circle = (Array.isArray(data) ? data[0] : data) as {
    id: string;
    slug: string;
    invite_code: string;
  };

  for (const m of members) {
    await addCircleMember(circle.id, resolveUserId(m.user), m.role ?? "member");
  }

  return { id: circle.id, slug: circle.slug, inviteCode: circle.invite_code };
}

export async function addCircleMember(
  circleId: string,
  memberUserId: string,
  role: "creator" | "moderator" | "member" = "member"
): Promise<void> {
  const { error } = await admin
    .from("circle_members")
    .insert({ circle_id: circleId, user_id: memberUserId, role });
  if (error) throw new Error(`addCircleMember failed: ${error.message}`);
}

/**
 * Seeds the three matrix circles from `fixtures.ts` idempotently: an existing
 * one is adopted (and its roster re-synced) rather than duplicated, because the
 * slug is UNIQUE and a second run would otherwise fail on it.
 */
export async function seedMatrixCircles(): Promise<Record<CircleKey, SeededCircle>> {
  const out = {} as Record<CircleKey, SeededCircle>;

  for (const key of ALL_CIRCLE_KEYS) {
    const spec = CIRCLES[key];

    const { data: existing, error: readError } = await admin
      .from("circles")
      .select("id, slug, invite_code")
      .eq("slug", spec.slug)
      .maybeSingle();
    if (readError) {
      throw new Error(`seedMatrixCircles read(${spec.slug}) failed: ${readError.message}`);
    }

    if (existing) {
      // Adopt. Re-point the creator in case a previous run's users were purged,
      // then rebuild the roster so role changes in fixtures.ts actually take.
      await admin
        .from("circles")
        .update({ creator_id: userId(CIRCLE_CREATOR) })
        .eq("id", existing.id);
      await admin.from("circle_members").delete().eq("circle_id", existing.id);
      await addCircleMember(existing.id, userId(CIRCLE_CREATOR), "creator");
      for (const m of spec.members) {
        await addCircleMember(existing.id, userId(m.user), m.role);
      }
      out[key] = {
        id: existing.id,
        slug: existing.slug as string,
        inviteCode: existing.invite_code as string,
      };
      continue;
    }

    out[key] = await createCircle({
      name: spec.name,
      slug: spec.slug,
      creator: CIRCLE_CREATOR,
      joiningPolicy: spec.joiningPolicy,
      members: spec.members.map((m) => ({ user: m.user, role: m.role })),
    });
  }

  return out;
}

/** Resolve a seeded matrix circle by slug. Used by specs that need its id. */
export async function getCircleBySlug(slug: string): Promise<SeededCircle> {
  const { data, error } = await admin
    .from("circles")
    .select("id, slug, invite_code")
    .eq("slug", slug)
    .single();
  if (error || !data) throw new Error(`getCircleBySlug(${slug}) failed: ${error?.message}`);
  return {
    id: data.id,
    slug: data.slug as string,
    inviteCode: data.invite_code as string,
  };
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

/**
 * Remove everything the suite created. Deliberately keyed on the fixture emails
 * and the [E2E] title prefix rather than "delete all rows", so a stray run can
 * never wipe unrelated local data.
 *
 * Order matters only where cascades don't cover it: deleting a market cascades
 * to positions → comments → reactions → probability history, and deleting an
 * auth user cascades to its profile and everything keyed on it.
 */
export async function cleanupAll(): Promise<void> {
  const { data: authList, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listError) throw new Error(`cleanup listUsers failed: ${listError.message}`);

  const testUsers = authList.users.filter(
    (u) =>
      u.email &&
      (ALL_TEST_EMAILS.includes(u.email) || u.email.endsWith("@forecast.test"))
  );
  const testUserIds = testUsers.map((u) => u.id);

  // Every delete is checked. A cleanup that fails quietly is worse than one that
  // crashes: the next run starts on stale data and fails somewhere unrelated,
  // which is exactly the confusing-failure mode the readers in db.ts avoid.
  async function purge(
    label: string,
    run: () => PromiseLike<{ error: { message: string } | null }>
  ): Promise<void> {
    const { error } = await run();
    if (error) throw new Error(`cleanup ${label} failed: ${error.message}`);
  }

  // Markets by title prefix — catches any created before a crash, and any whose
  // creator was already removed.
  await purge("markets by prefix", () =>
    admin.from("markets").delete().like("title", `${E2E_PREFIX}%`)
  );
  await purge("leagues by prefix", () =>
    admin.from("leagues").delete().like("name", `${E2E_PREFIX}%`)
  );
  // Circles cascade to circle_members, so this is the only circle delete needed.
  // Keyed on name, not slug: the slug CHECK (^[a-z0-9-]{3,40}$) forbids the
  // "[E2E] " prefix the other fixtures carry.
  await purge("circles by prefix", () =>
    admin.from("circles").delete().like("name", `${E2E_PREFIX}%`)
  );
  await purge("suggestions by prefix", () =>
    admin.from("market_suggestions").delete().like("title", `${E2E_PREFIX}%`)
  );

  if (testUserIds.length > 0) {
    // Markets/leagues owned by a fixture but somehow unprefixed.
    await purge("markets by creator", () =>
      admin.from("markets").delete().in("creator_id", testUserIds)
    );
    await purge("leagues by creator", () =>
      admin.from("leagues").delete().in("creator_id", testUserIds)
    );
    await purge("circles by creator", () =>
      admin.from("circles").delete().in("creator_id", testUserIds)
    );
    await purge("notifications", () =>
      admin.from("notifications").delete().in("user_id", testUserIds)
    );
    await purge("activity_feed", () =>
      admin.from("activity_feed").delete().in("user_id", testUserIds)
    );
    await purge("suggestions by user", () =>
      admin.from("market_suggestions").delete().in("user_id", testUserIds)
    );
    await purge("incident_reports", () =>
      admin.from("incident_reports").delete().in("reporter_id", testUserIds)
    );
  }

  for (const u of testUsers) {
    const { error } = await admin.auth.admin.deleteUser(u.id);
    if (error) {
      // Not fatal — a leftover user is adopted and reset by the next seedUsers().
      console.warn(`[cleanup] could not delete ${u.email}: ${error.message}`);
    }
  }

  seededIds.clear();
}

