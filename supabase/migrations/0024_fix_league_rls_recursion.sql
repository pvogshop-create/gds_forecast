-- 0024_fix_league_rls_recursion.sql
--
-- Fixes a total outage of the leagues feature, and the invite-code join flow.
--
-- ─── Bug 1: infinite recursion in league_members_select ─────────────────────
--
-- 0003 defined:
--
--   CREATE POLICY "league_members_select" ON public.league_members FOR SELECT
--     USING (
--       user_id = auth.uid()
--       OR league_id IN (SELECT lm2.league_id FROM public.league_members lm2
--                         WHERE lm2.user_id = auth.uid())        -- <<< same table
--       OR (SELECT is_public FROM public.leagues WHERE id = league_id)
--     );
--
-- The middle clause queries `league_members` from inside `league_members`' own
-- SELECT policy, so evaluating the policy re-evaluates the policy. Postgres
-- detects the cycle and aborts:
--
--   ERROR 42P17: infinite recursion detected in policy for relation "league_members"
--
-- And because `leagues_select` contains a subquery over `league_members`, the
-- failure spreads: EVERY authenticated read of `leagues`, `league_members`,
-- `league_messages`, `league_weeks`, `league_week_participants` and `league_bets`
-- errors out. In practice the whole feature has been dead for every user since
-- 0003 — `/leagues/[id]` returns 404 to the league's own owner, because the
-- page's `.single()` lookup errors and the route falls through to notFound().
-- Only service_role paths worked, which is why seeding and the cron RPCs behaved
-- and nothing surfaced in local clicking-around as the admin.
--
-- The fix is the standard remedy: do the membership lookup inside a
-- SECURITY DEFINER function, which runs with the definer's rights and therefore
-- does NOT re-enter the caller's policies. `auth.uid()` still resolves to the
-- calling user, so the check remains per-user and no privilege is granted.
--
-- ─── Bug 2: you cannot join a private league by invite code ─────────────────
--
-- `leagues_select` is `is_public OR creator_id = auth.uid() OR <is a member>`.
-- A prospective member is none of those, so `JoinLeagueButton`'s lookup
-- (`select id, name, max_members ... eq('invite_code', code)`) returns no row
-- and the UI reports "Invalid invite code" for every *valid* code. Leagues are
-- created private (`is_public` defaults FALSE), so invite codes have never
-- worked — even though CLAUDE.md treats invite codes as the membership
-- mechanism.
--
-- Rather than widening `leagues_select` (which would expose every private
-- league's row to anyone), this adds a narrow SECURITY DEFINER lookup that
-- returns only the three fields the join flow needs, and only for an exact
-- invite-code match. Knowing the code is the authorization.
--
-- Reversible: yes — see the down notes at the bottom.

-- ─── Membership helper ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_league_member(
  p_league_id UUID,
  p_user_id   UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.league_members
    WHERE league_id = p_league_id
      AND user_id   = p_user_id
  );
$$;

COMMENT ON FUNCTION public.is_league_member(UUID, UUID) IS
  'Membership test for RLS policies. SECURITY DEFINER so that policies on '
  'league_members can call it without re-entering their own policy (see 0024).';

GRANT EXECUTE ON FUNCTION public.is_league_member(UUID, UUID) TO authenticated, service_role;

-- ─── Rewritten policies ─────────────────────────────────────────────────────

-- league_members: your own rows, rows of leagues you belong to, or public leagues.
DROP POLICY IF EXISTS "league_members_select" ON public.league_members;
CREATE POLICY "league_members_select" ON public.league_members
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_league_member(league_id)
    OR COALESCE(
         (SELECT l.is_public FROM public.leagues l WHERE l.id = league_id),
         FALSE
       )
  );

-- leagues: public, yours, or one you belong to. Same shape as before, but the
-- membership clause no longer drags in league_members' recursive policy.
DROP POLICY IF EXISTS "leagues_select" ON public.leagues;
CREATE POLICY "leagues_select" ON public.leagues
  FOR SELECT
  USING (
    is_public = TRUE
    OR creator_id = auth.uid()
    OR public.is_league_member(id)
  );

-- Every other league-scoped table gated on membership. Each of these already
-- meant "members only"; they were just unusable through the recursive path.
--
-- NOTE ON THE POLICY NAMES BELOW: 0017 named these `lw_select`, `lwp_select`,
-- `lb_select` and `lb_insert` — NOT the longer `<table>_<cmd>` form. Dropping
-- only the long names would be a silent no-op that leaves the originals in
-- place, and because permissive policies are OR'd together the old ones would
-- keep granting access alongside the new ones. That is not merely untidy:
-- `lb_insert` is `(user_id = auth.uid())` with no membership test at all, so
-- leaving it would mean the membership requirement added here is never actually
-- enforced. Both spellings are therefore dropped.
DROP POLICY IF EXISTS "lw_select"  ON public.league_weeks;
DROP POLICY IF EXISTS "lwp_select" ON public.league_week_participants;
DROP POLICY IF EXISTS "lb_select"  ON public.league_bets;
DROP POLICY IF EXISTS "lb_insert"  ON public.league_bets;

DROP POLICY IF EXISTS "league_messages_select" ON public.league_messages;
CREATE POLICY "league_messages_select" ON public.league_messages
  FOR SELECT
  USING (public.is_league_member(league_id));

DROP POLICY IF EXISTS "league_messages_insert" ON public.league_messages;
CREATE POLICY "league_messages_insert" ON public.league_messages
  FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.is_league_member(league_id));

DROP POLICY IF EXISTS "league_weeks_select" ON public.league_weeks;
CREATE POLICY "league_weeks_select" ON public.league_weeks
  FOR SELECT
  USING (public.is_league_member(league_id));

DROP POLICY IF EXISTS "league_week_participants_select" ON public.league_week_participants;
CREATE POLICY "league_week_participants_select" ON public.league_week_participants
  FOR SELECT
  USING (public.is_league_member(league_id));

DROP POLICY IF EXISTS "league_bets_select" ON public.league_bets;
CREATE POLICY "league_bets_select" ON public.league_bets
  FOR SELECT
  USING (public.is_league_member(league_id));

DROP POLICY IF EXISTS "league_bets_insert" ON public.league_bets;
CREATE POLICY "league_bets_insert" ON public.league_bets
  FOR INSERT
  WITH CHECK (user_id = auth.uid() AND public.is_league_member(league_id));

-- The DELETE policy referenced `leagues` (not itself), so it never recursed —
-- but restate it against the helper for consistency and so a future edit to
-- leagues_select cannot reintroduce a cycle here.
DROP POLICY IF EXISTS "league_members_delete_owner" ON public.league_members;
CREATE POLICY "league_members_delete_owner" ON public.league_members
  FOR DELETE
  USING (
    auth.role() = 'service_role'
    OR user_id = auth.uid()                                   -- leave a league
    OR (SELECT l.creator_id FROM public.leagues l WHERE l.id = league_id) = auth.uid()
  );

-- ─── Invite-code lookup ─────────────────────────────────────────────────────
-- Returns only what the join flow needs, only on an exact code match. Knowing
-- the invite code is the authorization; nothing else about the league leaks.
CREATE OR REPLACE FUNCTION public.find_league_by_invite_code(p_code TEXT)
RETURNS TABLE (
  id           UUID,
  name         TEXT,
  max_members  INTEGER,
  member_count BIGINT,
  is_member    BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    l.id,
    l.name,
    l.max_members,
    (SELECT COUNT(*) FROM public.league_members m WHERE m.league_id = l.id),
    EXISTS (
      SELECT 1 FROM public.league_members m
      WHERE m.league_id = l.id AND m.user_id = auth.uid()
    )
  FROM public.leagues l
  WHERE l.invite_code = UPPER(TRIM(p_code))
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.find_league_by_invite_code(TEXT) IS
  'Narrow SECURITY DEFINER lookup so a prospective member can resolve a league '
  'from its invite code without being able to read private leagues generally.';

GRANT EXECUTE ON FUNCTION public.find_league_by_invite_code(TEXT) TO authenticated, service_role;

-- ─── Rollback notes ─────────────────────────────────────────────────────────
-- To revert: restore the 0003 definitions of league_members_select /
-- leagues_select (and the 0014/0017/0019 league_* policies), then
--   DROP FUNCTION public.find_league_by_invite_code(TEXT);
--   DROP FUNCTION public.is_league_member(UUID, UUID);
-- Reverting reinstates the recursion bug, so only do so to diagnose.
