-- 0023_fix_league_notification_and_realtime.sql
--
-- Two bug fixes, both of which silently break the league feature.
--
-- 1. `close_league_week()` (0017, redefined 0018) inserts a notification with
--    `type = 'league_win'`, but no migration ever added that value to the
--    `notification_type` enum. Every week-close that HAS a winner therefore
--    aborts with `invalid input value for enum notification_type: "league_win"`
--    and the entire payout transaction rolls back — pool coins are never paid,
--    golf points are never recorded, and the week stays 'active'. Weeks with no
--    winner (the carry-over branch) never reach the INSERT, which is why this
--    went unnoticed. `src/types/database.ts` already lists 'league_win', but
--    that file is hand-written rather than generated, so it did not reflect
--    reality.
--
-- 2. `public.league_messages` (0014) was never added to the `supabase_realtime`
--    publication, so the `LeagueChat` subscription in
--    `src/app/(app)/leagues/[id]/LeagueChat.tsx` never receives an INSERT and
--    league chat only updates on a full page reload. 0016/0019 remembered to add
--    `market_reactions` / `market_comments`; 0014 did not.
--
-- This migration deliberately contains ONLY the enum addition and the
-- publication change, and nothing that USES the new value: Postgres forbids
-- using an enum value in the same transaction that adds it (spec §10.8).
--
-- Reversibility: an enum value cannot be dropped in place (see §3.2's three-step
-- swap), so this migration is NOT cleanly reversible. Manual rollback would be
-- the full enum swap, which is not worth it for an additive value that fixes a
-- crash. The publication change reverses with
-- `ALTER PUBLICATION supabase_realtime DROP TABLE public.league_messages;`.

-- ─── 1. notification_type += 'league_win' ───────────────────────────────────
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'league_win';

-- ─── 2. Realtime for league chat ────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname    = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'league_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.league_messages;
  END IF;
END $$;
