// src/types/database.ts
// Manual TypeScript types matching the Supabase schema defined in migrations.
// Replace with generated types once the Supabase project is set up:
//   npx supabase gen types typescript --project-id YOUR_PROJECT_ID > src/types/database.ts

export type MarketCategory = "sports" | "social" | "actions" | "trending";
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
  yes_pool: number;
  no_pool: number;
  yes_probability: number; // 0.0–1.0
  resolution_date: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
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
    "id" | "title" | "category" | "status" | "yes_probability"
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

// ─── Resolve market function return type ─────────────────────────────────────
export interface ResolveMarketResult {
  market_id: string;
  outcome: string;
  total_pool: number;
  winners_paid: number;
  total_payout: number;
  winning_shares: number;
}
