-- Migration 0019: Market comments, @-mention notifications, suggestion attribution
-- Adds per-market comment threads, comment_mention notification type,
-- and suggested_by attribution on markets.

-- ── 1. market_comments table ─────────────────────────────────────────────────
CREATE TABLE public.market_comments (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id  UUID        NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body       TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX mc_market_created_idx ON public.market_comments (market_id, created_at ASC);
CREATE INDEX mc_user_idx           ON public.market_comments (user_id);

ALTER TABLE public.market_comments ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read comments on any market
CREATE POLICY "mc_select" ON public.market_comments
  FOR SELECT TO authenticated
  USING (true);

-- Users can insert only their own comments
CREATE POLICY "mc_insert" ON public.market_comments
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can delete only their own comments
CREATE POLICY "mc_delete" ON public.market_comments
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- Enable Supabase Realtime so the client can subscribe to new comment inserts
ALTER PUBLICATION supabase_realtime ADD TABLE public.market_comments;

-- ── 2. comment_mention notification type ──────────────────────────────────────
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'comment_mention';

-- ── 3. suggested_by on markets ────────────────────────────────────────────────
-- Tracks which profile originally suggested this market (NULL = admin-created).
ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS suggested_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
