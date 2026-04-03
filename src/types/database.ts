// src/types/database.ts
// Manual TypeScript types matching the Supabase schema defined in migrations.
// Replace with generated types once the Supabase project is set up:
//   npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.ts

export type MarketCategory = "sports" | "social" | "actions" | "trending";
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
  | "league_invite";

export interface Profile {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  coins: number;
  total_bets: number;
  wins: number;
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
  created_at: string;
  updated_at: string;
}

export interface LeagueMember {
  league_id: string;
  user_id: string;
  role: "owner" | "member";
  joined_at: string;
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

// ─── Resolve market function return type ─────────────────────────────────────
export interface ResolveMarketResult {
  market_id: string;
  outcome: string;
  total_pool: number;
  winners_paid: number;
  total_payout: number;
  winning_shares: number;
}
