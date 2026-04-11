-- 0016_market_reactions.sql
-- Emoji reactions on market cards.
-- Each user can react to a market with each emoji at most once (PK enforces toggle).

CREATE TABLE public.market_reactions (
  market_id  UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL CHECK (emoji IN ('🔥','🎯','🤔','💰','✅')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (market_id, user_id, emoji)
);

CREATE INDEX market_reactions_market_idx ON public.market_reactions (market_id);

ALTER TABLE public.market_reactions ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read reactions
CREATE POLICY "reactions_select"
  ON public.market_reactions
  FOR SELECT
  TO authenticated
  USING (true);

-- Users can only insert their own reactions
CREATE POLICY "reactions_insert"
  ON public.market_reactions
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Users can only delete their own reactions
CREATE POLICY "reactions_delete"
  ON public.market_reactions
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
