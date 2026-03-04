-- 0003_rls.sql
-- Row Level Security policies for all tables

-- ─── Enable RLS ──────────────────────────────────────────────────────────────
ALTER TABLE public.profiles                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.markets                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positions                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_probability_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.market_suggestions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leagues                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_members            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_feed             ENABLE ROW LEVEL SECURITY;

-- ─── PROFILES ───────────────────────────────────────────────────────────────
-- Anyone authenticated can read profiles (leaderboards, public profile pages)
CREATE POLICY "profiles_select_authenticated"
  ON public.profiles FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can update only their own profile
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Profiles are INSERT-only via trigger (service_role). Block direct client inserts.
CREATE POLICY "profiles_insert_service_role"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- ─── MARKETS ────────────────────────────────────────────────────────────────
-- All authenticated users can read markets
CREATE POLICY "markets_select_authenticated"
  ON public.markets FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only service_role (admin server actions) can create or modify markets
CREATE POLICY "markets_insert_service_role"
  ON public.markets FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "markets_update_service_role"
  ON public.markets FOR UPDATE
  USING (auth.role() = 'service_role');

-- ─── POSITIONS ──────────────────────────────────────────────────────────────
-- All authenticated users can read positions (for market depth, leaderboards)
CREATE POLICY "positions_select_authenticated"
  ON public.positions FOR SELECT
  USING (auth.role() = 'authenticated');

-- Positions can only be inserted via place_bet() SECURITY DEFINER function
-- which uses service_role internally. Block all direct client inserts.
CREATE POLICY "positions_insert_service_role"
  ON public.positions FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "positions_update_service_role"
  ON public.positions FOR UPDATE
  USING (auth.role() = 'service_role');

-- ─── MARKET PROBABILITY HISTORY ─────────────────────────────────────────────
CREATE POLICY "mph_select_authenticated"
  ON public.market_probability_history FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only inserted via place_bet() function
CREATE POLICY "mph_insert_service_role"
  ON public.market_probability_history FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- ─── MARKET SUGGESTIONS ─────────────────────────────────────────────────────
-- Users see only their own suggestions; admin sees all via service_role
CREATE POLICY "suggestions_select_own"
  ON public.market_suggestions FOR SELECT
  USING (auth.uid() = user_id OR auth.role() = 'service_role');

-- Authenticated users can submit suggestions
CREATE POLICY "suggestions_insert_authenticated"
  ON public.market_suggestions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Only admin (service_role) can approve/reject
CREATE POLICY "suggestions_update_service_role"
  ON public.market_suggestions FOR UPDATE
  USING (auth.role() = 'service_role');

-- ─── LEAGUES ────────────────────────────────────────────────────────────────
-- Users can read leagues they belong to, or any public league
CREATE POLICY "leagues_select"
  ON public.leagues FOR SELECT
  USING (
    is_public = TRUE
    OR creator_id = auth.uid()
    OR id IN (
      SELECT league_id FROM public.league_members WHERE user_id = auth.uid()
    )
  );

-- Any authenticated user can create a league
CREATE POLICY "leagues_insert_authenticated"
  ON public.leagues FOR INSERT
  WITH CHECK (auth.uid() = creator_id);

-- Only owner (creator) or service_role can update league settings
CREATE POLICY "leagues_update_owner"
  ON public.leagues FOR UPDATE
  USING (creator_id = auth.uid() OR auth.role() = 'service_role')
  WITH CHECK (creator_id = auth.uid() OR auth.role() = 'service_role');

-- ─── LEAGUE MEMBERS ─────────────────────────────────────────────────────────
-- Members can see membership rows for leagues they belong to
CREATE POLICY "league_members_select"
  ON public.league_members FOR SELECT
  USING (
    user_id = auth.uid()
    OR league_id IN (
      SELECT league_id FROM public.league_members lm2 WHERE lm2.user_id = auth.uid()
    )
    OR (SELECT is_public FROM public.leagues WHERE id = league_id)
  );

-- Users can join leagues (insert their own membership row)
CREATE POLICY "league_members_insert_self"
  ON public.league_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- League owner or service_role can remove members
CREATE POLICY "league_members_delete_owner"
  ON public.league_members FOR DELETE
  USING (
    auth.role() = 'service_role'
    OR user_id = auth.uid()  -- user can leave
    OR (SELECT creator_id FROM public.leagues WHERE id = league_id) = auth.uid()
  );

-- ─── NOTIFICATIONS ──────────────────────────────────────────────────────────
-- Users see only their own notifications
CREATE POLICY "notifications_select_own"
  ON public.notifications FOR SELECT
  USING (auth.uid() = user_id);

-- Users can mark their own notifications as read
CREATE POLICY "notifications_update_own"
  ON public.notifications FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Notifications are inserted by service_role (resolve_market, admin actions)
CREATE POLICY "notifications_insert_service_role"
  ON public.notifications FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- ─── ACTIVITY FEED ──────────────────────────────────────────────────────────
-- All authenticated users can read the social feed
CREATE POLICY "activity_feed_select_authenticated"
  ON public.activity_feed FOR SELECT
  USING (auth.role() = 'authenticated');

-- Inserted only via server-side functions
CREATE POLICY "activity_feed_insert_service_role"
  ON public.activity_feed FOR INSERT
  WITH CHECK (auth.role() = 'service_role');
