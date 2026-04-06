-- 0014_league_chat.sql
-- Adds a league_messages table for per-league chat.
-- Members can read and write messages only for leagues they belong to.

CREATE TABLE public.league_messages (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id  UUID        NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body       TEXT        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX league_messages_league_created_idx
  ON public.league_messages (league_id, created_at DESC);

ALTER TABLE public.league_messages ENABLE ROW LEVEL SECURITY;

-- League members can read messages for their leagues
CREATE POLICY league_messages_select ON public.league_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = league_messages.league_id
        AND lm.user_id   = auth.uid()
    )
  );

-- League members can insert their own messages
CREATE POLICY league_messages_insert ON public.league_messages
  FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.league_members lm
      WHERE lm.league_id = league_messages.league_id
        AND lm.user_id   = auth.uid()
    )
  );
