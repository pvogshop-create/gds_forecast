// src/types/database.ts
// Manual TypeScript types matching the Supabase schema defined in migrations.
//
// ⚠️ DO NOT run `npx supabase gen types typescript` over this file.
// It is hand-written and hand-maintained. The generator emits a completely
// differently-shaped `Database` interface; this file exports app-shaped types
// (`MarketCategory`, `Profile`, `Market`, …) that every import in `src/`
// depends on, so overwriting it would break the app wholesale. An earlier
// version of this header told you to replace it with generated types — that
// was wrong, and it is the trap CLAUDE.md documents. Corrected 2026-08-02.
//
// After a schema change, hand-edit this file to match, then `npm run type-check`
// and `npm run build` must pass clean. If you want generated types as a
// cross-check, write them to `src/types/database.generated.ts` and diff by eye.

export type MarketCategory = "sports" | "social" | "actions";
export type MarketType = "binary" | "over_under";
export type MarketStatus =
  | "open"
  | "closed"
  | "resolved_yes"
  | "resolved_no"
  | "cancelled";
export type PositionSide = "yes" | "no";
export type PositionStatus = "open" | "won" | "lost" | "cancelled";
export type SuggestionStatus = "pending" | "approved" | "rejected";
export type NotificationType =
  | "bet_placed"
  | "market_resolved"
  | "payout_received"
  | "suggestion_approved"
  | "suggestion_rejected"
  | "league_joined"
  | "league_invite"
  | "league_win"
  | "comment_mention";

export type IncidentStatus = "voting" | "passed" | "vetoed" | "resolved" | "dismissed";

export interface Profile {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  coins: number;
  total_bets: number;
  wins: number;
  win_streak: number;
  loss_streak: number;
  last_daily_claim: string | null;
  referral_code: string | null;
  referral_count: number;
  referred_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Market {
  id: string;
  title: string;
  description: string;
  category: MarketCategory;
  status: MarketStatus;
  market_type: MarketType;
  yes_pool: number;
  no_pool: number;
  yes_probability: number; // 0.0–1.0
  ou_line: number | null;          // current live line (O/U markets only)
  ou_opening_line: number | null;  // original line set at creation
  ou_unit: string | null;          // display unit, e.g. "pts", "goals"
  resolution_date: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  resolution_value: number | null; // actual numeric result (O/U markets)
  creator_id: string;
  suggested_by: string | null;  // profile id of the user who suggested this market; null = admin-created
  suggested_by_profile?: { username: string | null; display_name: string | null } | null;
  is_featured: boolean;
  created_at: string;
  updated_at: string;
}

export interface Position {
  id: string;
  market_id: string;
  user_id: string;
  side: PositionSide;
  coins_wagered: number;
  shares_bought: number;
  price_at_bet: number; // 0.0–1.0
  yes_odds_at_bet: number; // American odds for YES side locked at bet time
  ou_line_at_bet: number | null; // O/U line locked at bet time (null for binary)
  status: PositionStatus;
  payout: number | null;
  created_at: string;
}

export interface MarketProbabilityHistory {
  id: string;
  market_id: string;
  yes_probability: number; // 0.0–1.0
  recorded_at: string;
}

export interface MarketSuggestion {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: MarketCategory;
  status: SuggestionStatus;
  admin_note: string | null;
  suggested_yes_odds: number | null; // American odds for YES side; null = default +100
  market_type: MarketType;
  ou_opening_line: number | null;    // suggested line for O/U markets
  ou_unit: string | null;            // display unit, e.g. "pts"
  created_at: string;
  updated_at: string;
}

export interface League {
  id: string;
  name: string;
  description: string | null;
  creator_id: string;
  invite_code: string;
  is_public: boolean;
  max_members: number;
  buy_in_coins: number;
  week_start_date: string | null;
  carry_over_pool: number;
  created_at: string;
  updated_at: string;
}

export interface LeagueMember {
  league_id: string;
  user_id: string;
  role: "owner" | "member";
  joined_at: string;
  total_points: number;
  weeks_played: number;
}

export interface LeagueWeek {
  id: string;
  league_id: string;
  week_number: number;
  week_start: string;
  week_end: string;
  pool_coins: number;
  status: "active" | "completed" | "rolled_over";
  created_at: string;
}

export interface LeagueWeekParticipant {
  week_id: string;
  user_id: string;
  league_id: string;
  buy_in_paid: number;
  gross_payout: number;
  points: number | null;
}

export interface LeagueBet {
  position_id: string;
  league_id: string;
  week_id: string;
  user_id: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

export interface ActivityFeedEntry {
  id: string;
  user_id: string;
  action_type: string;
  market_id: string | null;
  league_id: string | null;
  data: Record<string, unknown> | null;
  created_at: string;
}

// ─── Enriched / joined types used in the UI ──────────────────────────────────

export interface MarketWithStats extends Market {
  total_pool: number; // yes_pool + no_pool
  position_count?: number;
  bet_count_24h?: number;
}

export interface ActivityFeedEntryWithProfile extends ActivityFeedEntry {
  profiles: Pick<Profile, "username" | "display_name" | "avatar_url">;
  markets?: Pick<Market, "title" | "category" | "yes_probability"> | null;
}

export interface PositionWithMarket extends Position {
  markets: Pick<
    Market,
    | "id"
    | "title"
    | "category"
    | "status"
    | "yes_probability"
    | "market_type"
    | "ou_line"
    | "ou_unit"
    | "resolution_date"
  >;
}

export interface LeagueMemberWithProfile extends LeagueMember {
  profiles: Pick<
    Profile,
    "username" | "display_name" | "avatar_url" | "coins"
  >;
}

export interface LeagueMessage {
  id: string;
  league_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

// ─── Circles (0029) ─────────────────────────────────────────────────────────
// The tier between a user and the public: a school, chapter, camp or team.
// Circle-scoped markets do not exist yet — `markets.circle_id` arrives in 0030
// and tier-aware visibility in 0031.

/** Three roles, unlike leagues' two: circles need moderators distinct from the
 *  single creator (they approve circle market suggestions and set lines). */
export type CircleRole = "creator" | "moderator" | "member";

/** `request_approval` is accepted by the CHECK constraint but rejected by
 *  `join_circle()` — `circle_join_requests` (spec §2.3) is deferred. */
export type CircleJoiningPolicy = "open" | "invite_code" | "request_approval";

export interface Circle {
  id: string;
  name: string;
  /** URL segment for /circles/[slug]. Constrained to ^[a-z0-9-]{3,40}$. */
  slug: string;
  description: string | null;
  creator_id: string;
  joining_policy: CircleJoiningPolicy;
  /** Null when read by a member who is not a moderator — see the detail page. */
  invite_code: string | null;
  /** Denormalized; kept in sync by the circle_member_count_sync trigger. */
  member_count: number;
  max_members: number;
  created_at: string;
  updated_at: string;
}

export interface CircleMember {
  circle_id: string;
  user_id: string;
  role: CircleRole;
  joined_at: string;
}

export interface CircleMemberWithProfile extends CircleMember {
  profiles: Pick<Profile, "username" | "display_name" | "avatar_url">;
}

/** Return shape of the `find_circle_by_invite_code` RPC. Deliberately narrow:
 *  a prospective member can resolve a circle from its code without being able
 *  to read private circles generally. */
export interface FindCircleByCodeResult {
  id: string;
  name: string;
  slug: string;
  member_count: number;
  max_members: number;
  is_member: boolean;
}

export interface LeagueMessageWithProfile extends LeagueMessage {
  profiles: Pick<Profile, "username" | "display_name" | "avatar_url">;
}

export interface MarketComment {
  id: string;
  market_id: string;
  user_id: string;
  body: string;
  created_at: string;
}

export interface MarketCommentWithProfile extends MarketComment {
  profiles: Pick<Profile, "username" | "display_name" | "avatar_url"> | null;
}

export interface MarketSuggestionWithProfile extends MarketSuggestion {
  profiles: Pick<Profile, "username" | "avatar_url">;
}

// ─── Place bet function return type ──────────────────────────────────────────
export interface PlaceBetResult {
  position_id: string;
  shares_bought: number;
  price_at_bet: number;
  yes_odds_at_bet: number; // American odds for YES side locked at bet time
  coins_spent: number;
  coins_remaining: number;
  new_probability: number;
}

// ─── Place O/U bet function return type ──────────────────────────────────────
export interface PlaceOuBetResult {
  position_id: string;
  ou_line_at_bet: number;  // line locked at the moment of bet
  new_line: number;        // line after this bet moved it
  coins_spent: number;
  coins_remaining: number;
  potential_payout: number; // always coins_spent × 2
}

// ─── Incident Reports ─────────────────────────────────────────────────────────

export interface IncidentReport {
  id: string;
  market_id: string;
  reporter_id: string;
  description: string;
  proposed_outcome: string; // 'yes' | 'no' | numeric string for O/U
  status: IncidentStatus;
  yes_votes: number;
  no_votes: number;
  veto_deadline: string | null;
  created_at: string;
  updated_at: string;
}

export interface IncidentVote {
  report_id: string;
  user_id: string;
  agrees: boolean;
  created_at: string;
}

export interface IncidentReportWithMarket extends IncidentReport {
  markets: Pick<Market, "id" | "title" | "category" | "status" | "market_type">;
  incident_votes: Pick<IncidentVote, "user_id" | "agrees">[];
}

// ─── Resolve market function return type ─────────────────────────────────────
export interface ResolveMarketResult {
  market_id: string;
  outcome: string;
  total_pool: number;
  winners_paid: number;
  total_payout: number;
  winning_shares: number;
}
