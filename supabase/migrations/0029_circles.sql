-- 0029_circles.sql
--
-- Circles: the layer between a user and the public — a school, a chapter, a
-- camp, a team. Spec §2.1–2.2. This is the first of three tier-foundation
-- migrations (0029 circles → 0030 market tier columns → 0031 tier-aware RLS).
--
-- Deliberately inert with respect to market visibility. No market can point at
-- a circle until 0030 adds `markets.circle_id`, and nothing is hidden from
-- anyone until 0031 ships `can_view_market()`. This migration only adds tables,
-- so every existing query keeps its current plan and result.
--
-- ─── Numbering ──────────────────────────────────────────────────────────────
-- plan.md and spec §7 both still call this migration 0028. That number was
-- taken by 0028_ou_push_streak.sql on 2026-07-31. This is 0029, which is what
-- CLAUDE.md's list already says; everything downstream shifts +1 and profiles
-- lands at 0037. The docs are corrected alongside this file.
--
-- ─── The 0024 trap, restated ────────────────────────────────────────────────
-- `circle_members` is structurally identical to `league_members`, whose SELECT
-- policy (written in 0003) subqueried its own table and made every authenticated
-- read of every league table fail with 42P17. That killed the entire leagues
-- feature for months and was invisible because service_role bypasses RLS.
--
-- The remedy is the same one 0024 applied: do every membership lookup inside a
-- SECURITY DEFINER function, which runs with the definer's rights and therefore
-- does NOT re-enter the caller's policies. auth.uid() still resolves to the
-- calling user, so the check stays per-user and no privilege is granted.
--
-- **No policy on circle_members may subquery circle_members directly.**
--
-- ─── Creation model ─────────────────────────────────────────────────────────
-- Circles are admin-created for now: a circle is an institution, not a friend
-- group, and users are minors, so unbounded creation is a moderation surface.
-- Leagues remain the user-created layer. The `role` column already carries
-- 'creator' | 'moderator' | 'member', so delegating creation to circle admins
-- later needs a policy change, not a migration.
--
-- Reversible: yes — see the down notes at the bottom.

-- ─── Tables ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.circles (
  -- `gen_random_uuid()`, NOT `uuid_generate_v4()`. The latter comes from the
  -- uuid-ossp extension, which Supabase installs into the `extensions` schema,
  -- and it therefore only resolves when `extensions` is on the search_path.
  -- Local Supabase sets `search_path = "$user", public, extensions`, so it works
  -- there; the connection `supabase db push` uses against the hosted project
  -- does not, and this exact line failed there with "function
  -- uuid_generate_v4() does not exist".
  --
  -- 0002/0014/0017/0019 all use uuid_generate_v4() and are fine, because every
  -- migration up to 0021 was hand-applied through the dashboard SQL editor,
  -- whose session does have `extensions` on the path. 0029 is the first
  -- migration to create a table via `db push`, which is why it surfaced here.
  --
  -- `gen_random_uuid()` lives in pg_catalog (core Postgres since 13), so it
  -- resolves under any search_path and needs no extension at all.
  -- **Use it for every new table from here on.**
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           TEXT NOT NULL,
  -- URL-friendly, e.g. 'lincoln-high'. The CHECK exists because the slug is a
  -- route segment (/circles/[slug]); without it an admin typo could mint a
  -- circle that is unreachable or that collides with a sibling route.
  slug           TEXT UNIQUE NOT NULL CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  description    TEXT,
  creator_id     UUID NOT NULL REFERENCES public.profiles(id),
  joining_policy TEXT NOT NULL DEFAULT 'invite_code'
                 CHECK (joining_policy IN ('open', 'invite_code', 'request_approval')),
  invite_code    TEXT UNIQUE DEFAULT upper(substr(md5(random()::text), 1, 8)),
  -- Denormalized so browse/list pages don't aggregate on every render. Kept in
  -- sync by circle_member_count_sync below.
  member_count   INTEGER NOT NULL DEFAULT 0,
  -- Not in spec §2.1. A circle is a whole school, so the cap is high, but an
  -- uncapped join path is a griefing surface on a product for minors.
  max_members    INTEGER NOT NULL DEFAULT 500 CHECK (max_members > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS circles_slug_idx    ON public.circles(slug);
CREATE INDEX IF NOT EXISTS circles_creator_idx ON public.circles(creator_id);

-- Mirrors league_members, with three roles instead of two: circles need
-- moderators distinct from the single creator (they approve circle market
-- suggestions and set lines — spec §2.1, wired up in step 14).
CREATE TABLE IF NOT EXISTS public.circle_members (
  circle_id  UUID NOT NULL REFERENCES public.circles(id)  ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member'
             CHECK (role IN ('creator', 'moderator', 'member')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (circle_id, user_id)
);

CREATE INDEX IF NOT EXISTS circle_members_user_idx ON public.circle_members(user_id);

-- ─── Member-count trigger ───────────────────────────────────────────────────
-- Spec §2.2. AFTER INSERT OR DELETE only: role changes don't move the count,
-- and circle_id is part of the primary key so a row never migrates between
-- circles.
CREATE OR REPLACE FUNCTION public.sync_circle_member_count()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.circles
      SET member_count = member_count + 1
      WHERE id = NEW.circle_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.circles
      SET member_count = member_count - 1
      WHERE id = OLD.circle_id;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS circle_member_count_sync ON public.circle_members;

CREATE TRIGGER circle_member_count_sync
  AFTER INSERT OR DELETE ON public.circle_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_circle_member_count();

-- ─── Membership helpers ─────────────────────────────────────────────────────
-- SECURITY DEFINER so that policies on circle_members can call them without
-- re-entering their own policy. See the 0024 note at the top of this file.

CREATE OR REPLACE FUNCTION public.is_circle_member(
  p_circle_id UUID,
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
    FROM public.circle_members
    WHERE circle_id = p_circle_id
      AND user_id   = p_user_id
  );
$$;

COMMENT ON FUNCTION public.is_circle_member(UUID, UUID) IS
  'Membership test for RLS policies. SECURITY DEFINER so that policies on '
  'circle_members can call it without re-entering their own policy (see 0024).';

CREATE OR REPLACE FUNCTION public.is_circle_moderator(
  p_circle_id UUID,
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
    FROM public.circle_members
    WHERE circle_id = p_circle_id
      AND user_id   = p_user_id
      AND role IN ('creator', 'moderator')
  );
$$;

COMMENT ON FUNCTION public.is_circle_moderator(UUID, UUID) IS
  'True for the circle creator and its moderators. Same SECURITY DEFINER '
  'reasoning as is_circle_member.';

GRANT EXECUTE ON FUNCTION public.is_circle_member(UUID, UUID)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_circle_moderator(UUID, UUID) TO authenticated, service_role;

-- ─── RLS ────────────────────────────────────────────────────────────────────
-- A tier-scoped table ships WITH its policies, never without (CLAUDE.md).

ALTER TABLE public.circles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.circle_members ENABLE ROW LEVEL SECURITY;

-- circles: you can see a circle you belong to, or any circle that is open to
-- anyone. Invite-code and request-approval circles stay invisible to outsiders;
-- find_circle_by_invite_code() below is the narrow door in. Same shape as
-- leagues_select (is_public OR creator OR member), except membership already
-- covers the creator because create_circle() always writes their member row.
DROP POLICY IF EXISTS "circles_select" ON public.circles;
CREATE POLICY "circles_select" ON public.circles
  FOR SELECT
  USING (
    public.is_circle_member(id)
    OR joining_policy = 'open'
  );

-- Creation is admin-only, so the table policy is service_role and create_circle()
-- does the work. Nothing else can insert a circle.
DROP POLICY IF EXISTS "circles_insert" ON public.circles;
CREATE POLICY "circles_insert" ON public.circles
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "circles_update" ON public.circles;
CREATE POLICY "circles_update" ON public.circles
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR public.is_circle_moderator(id)
  );

DROP POLICY IF EXISTS "circles_delete" ON public.circles;
CREATE POLICY "circles_delete" ON public.circles
  FOR DELETE
  USING (auth.role() = 'service_role');

-- circle_members: your own rows, or the roster of a circle you belong to.
-- The membership clause goes through the helper — writing it as a subquery over
-- circle_members is exactly the 42P17 bug 0024 had to undo.
DROP POLICY IF EXISTS "circle_members_select" ON public.circle_members;
CREATE POLICY "circle_members_select" ON public.circle_members
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_circle_member(circle_id)
  );

-- No direct client insert at all — not even for yourself. Every join goes
-- through join_circle(), which is the only place the member cap and the
-- joining_policy are enforced under a row lock. A self-insert policy here would
-- be a way around both.
DROP POLICY IF EXISTS "circle_members_insert" ON public.circle_members;
CREATE POLICY "circle_members_insert" ON public.circle_members
  FOR INSERT
  WITH CHECK (auth.role() = 'service_role');

-- Role changes (promote to moderator, demote) are a moderator action.
DROP POLICY IF EXISTS "circle_members_update" ON public.circle_members;
CREATE POLICY "circle_members_update" ON public.circle_members
  FOR UPDATE
  USING (
    auth.role() = 'service_role'
    OR public.is_circle_moderator(circle_id)
  );

-- Leave, or be removed by a moderator. The creator's row is protected in both
-- directions: a circle whose creator row is gone has no owner, and because
-- is_circle_moderator() is true for the creator, an unprotected policy would
-- also let one moderator remove the creator.
DROP POLICY IF EXISTS "circle_members_delete" ON public.circle_members;
CREATE POLICY "circle_members_delete" ON public.circle_members
  FOR DELETE
  USING (
    auth.role() = 'service_role'
    OR (
      circle_members.role <> 'creator'
      AND (
        user_id = auth.uid()                             -- leave
        OR public.is_circle_moderator(circle_id)         -- remove someone
      )
    )
  );

-- ─── create_circle ──────────────────────────────────────────────────────────
-- Circle row + the creator's 'creator' member row in ONE transaction. Splitting
-- these across two client writes is the read-modify-write shape 0027 was written
-- to eliminate; here the failure mode would be an ownerless circle that nobody
-- can moderate and that circles_select hides from everyone.
CREATE OR REPLACE FUNCTION public.create_circle(
  p_name           TEXT,
  p_slug           TEXT,
  p_creator_id     UUID,
  p_description    TEXT DEFAULT NULL,
  p_joining_policy TEXT DEFAULT 'invite_code'
)
RETURNS public.circles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_circle public.circles;
BEGIN
  -- Same gate shape as set_market_line (0027) and resolve_market: admin identity
  -- is app-layer (an email allowlist), so the database's only usable check is
  -- that the caller arrived through a service_role path rather than a session.
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: create_circle may only be called by admin.';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'Circle name is required.';
  END IF;

  INSERT INTO public.circles (name, slug, description, creator_id, joining_policy)
  VALUES (
    btrim(p_name),
    lower(btrim(p_slug)),
    NULLIF(btrim(COALESCE(p_description, '')), ''),
    p_creator_id,
    p_joining_policy
  )
  RETURNING * INTO v_circle;

  INSERT INTO public.circle_members (circle_id, user_id, role)
  VALUES (v_circle.id, p_creator_id, 'creator');

  -- The trigger fired after the row above landed, so re-read the count rather
  -- than returning the pre-trigger snapshot captured by RETURNING.
  SELECT * INTO v_circle FROM public.circles WHERE id = v_circle.id;

  RETURN v_circle;
END;
$$;

COMMENT ON FUNCTION public.create_circle(TEXT, TEXT, UUID, TEXT, TEXT) IS
  'Admin-only circle creation. Writes the circle and its creator membership in '
  'one transaction so an ownerless circle cannot exist.';

REVOKE ALL ON FUNCTION public.create_circle(TEXT, TEXT, UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_circle(TEXT, TEXT, UUID, TEXT, TEXT) TO service_role;

-- ─── find_circle_by_invite_code ─────────────────────────────────────────────
-- Direct analogue of find_league_by_invite_code (0024). A prospective member is
-- not yet a member, so circles_select hides the row from them and a plain
-- `.eq('invite_code', …)` would report every VALID code as invalid — which is
-- precisely the bug leagues shipped with for months. Returns only what the join
-- flow needs, only on an exact match. Knowing the code is the authorization.
CREATE OR REPLACE FUNCTION public.find_circle_by_invite_code(p_code TEXT)
RETURNS TABLE (
  id           UUID,
  name         TEXT,
  slug         TEXT,
  member_count INTEGER,
  max_members  INTEGER,
  is_member    BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    c.id,
    c.name,
    c.slug,
    c.member_count,
    c.max_members,
    public.is_circle_member(c.id)
  FROM public.circles c
  WHERE c.invite_code = UPPER(TRIM(p_code))
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.find_circle_by_invite_code(TEXT) IS
  'Narrow SECURITY DEFINER lookup so a prospective member can resolve a circle '
  'from its invite code without being able to read private circles generally.';

GRANT EXECUTE ON FUNCTION public.find_circle_by_invite_code(TEXT) TO authenticated, service_role;

-- ─── join_circle ────────────────────────────────────────────────────────────
-- The only path into circle_members for a normal user. Three things have to be
-- true at once and they are all checked under the circle's row lock:
--
--   1. The joining_policy admits this caller.
--   2. member_count is below max_members.
--   3. The caller is not already a member.
--
-- The lock is not decorative. Reading member_count and then inserting without
-- one is a textbook lost update: N concurrent joins all read the same count,
-- all pass the cap check, and all insert. That is the same class of bug as
-- record_referral() minting 500 coins twice (0027), pointed at the member cap
-- instead of the coin balance.
CREATE OR REPLACE FUNCTION public.join_circle(
  p_circle_id   UUID,
  p_invite_code TEXT DEFAULT NULL
)
RETURNS public.circles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_circle public.circles;
  v_user   UUID := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to join a circle.';
  END IF;

  SELECT * INTO v_circle
  FROM public.circles
  WHERE id = p_circle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Circle not found.';
  END IF;

  -- Already in: return success rather than raising, so a double-clicked Join
  -- button is idempotent instead of showing the user an error for a state they
  -- wanted anyway.
  IF EXISTS (
    SELECT 1 FROM public.circle_members
    WHERE circle_id = p_circle_id AND user_id = v_user
  ) THEN
    RETURN v_circle;
  END IF;

  IF v_circle.joining_policy = 'invite_code' THEN
    IF p_invite_code IS NULL
       OR UPPER(TRIM(p_invite_code)) IS DISTINCT FROM v_circle.invite_code THEN
      RAISE EXCEPTION 'Invalid invite code.';
    END IF;
  ELSIF v_circle.joining_policy = 'request_approval' THEN
    -- circle_join_requests (spec §2.3) is deferred. Failing loudly is better
    -- than silently treating this as open.
    RAISE EXCEPTION 'This circle requires an approved request to join.';
  END IF;

  IF v_circle.member_count >= v_circle.max_members THEN
    RAISE EXCEPTION 'This circle is full.';
  END IF;

  -- ON CONFLICT is belt-and-braces behind the lock: the EXISTS above already
  -- covers the sequential case, and this covers the row not yet visible to a
  -- concurrent snapshot. The trigger only fires on a real insert, so the count
  -- cannot drift.
  INSERT INTO public.circle_members (circle_id, user_id, role)
  VALUES (p_circle_id, v_user, 'member')
  ON CONFLICT (circle_id, user_id) DO NOTHING;

  SELECT * INTO v_circle FROM public.circles WHERE id = p_circle_id;

  RETURN v_circle;
END;
$$;

COMMENT ON FUNCTION public.join_circle(UUID, TEXT) IS
  'The only join path for circle_members, whose INSERT policy is service_role '
  'only. Enforces joining_policy and max_members under the circle row lock.';

GRANT EXECUTE ON FUNCTION public.join_circle(UUID, TEXT) TO authenticated, service_role;

-- ─── Rollback notes ─────────────────────────────────────────────────────────
-- Nothing outside these two tables is touched, so a revert is self-contained:
--
--   DROP FUNCTION IF EXISTS public.join_circle(UUID, TEXT);
--   DROP FUNCTION IF EXISTS public.find_circle_by_invite_code(TEXT);
--   DROP FUNCTION IF EXISTS public.create_circle(TEXT, TEXT, UUID, TEXT, TEXT);
--   DROP TABLE IF EXISTS public.circle_members;   -- drops its trigger with it
--   DROP TABLE IF EXISTS public.circles;
--   DROP FUNCTION IF EXISTS public.sync_circle_member_count();
--   DROP FUNCTION IF EXISTS public.is_circle_moderator(UUID, UUID);
--   DROP FUNCTION IF EXISTS public.is_circle_member(UUID, UUID);
--
-- Do NOT revert by editing this file once it has been applied anywhere — add a
-- corrective migration instead (spec §10.9).
