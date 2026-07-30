-- 0025_detrending.sql
--
-- Remove 'trending' from the `market_category` enum.
--
-- WHY: `trending` is simultaneously a category value AND the name of the home
-- feed, which is a cross-category "what's hot" view. A market can be trending
-- *and* sports; the enum forces a false either/or, and the collision produces
-- subtle bugs in any tier work that filters by category. Trending should be a
-- **view** (a sort over all categories), never a category. `is_featured`
-- already exists as the mechanism for pinning something to the home feed, so
-- nothing is lost. See spec §3.2.
--
-- WHAT THIS DOES NOT TOUCH: the `/dashboard/trending` route. That is the
-- post-login home feed, nine files redirect to it, and it never filters on
-- `category` — it ranks algorithmically and shows Stat Leader cards driven by
-- `profiles.win_streak` / `loss_streak`. Renaming that route is §11 navigation
-- work, deliberately deferred.
--
-- ROW REASSIGNMENT: Postgres cannot drop an enum value in place, so existing
-- rows must be moved off it first. Both affected production rows were inspected
-- individually rather than blanket-defaulted:
--
--   markets            "Will a student go viral on TikTok this semester?"
--   market_suggestions "Will Isa get with Nathaniel or will Leif/Allen?"
--
-- Both are clearly SOCIAL (a student going viral; a relationship market), so
-- they move to 'social'. Spec §3.2 suggests 'actions' as a blanket default, but
-- it explicitly allows picking the right category per market — and bucketing a
-- TikTok-virality market alongside Fed-rate-decision markets would be wrong.
-- Any other row that somehow carries 'trending' also lands in 'social', which
-- is the closest fit for the kind of market that was tagged this way.
--
-- IDEMPOTENCY: the whole swap is guarded on 'trending' still being a member of
-- the enum, so re-running is a no-op. Migrations run in a transaction, so a
-- mid-swap failure rolls back whole rather than leaving a half-renamed type.
--
-- SAFETY CHECK PERFORMED BEFORE WRITING THIS: nothing other than the two table
-- columns depends on `market_category` — no functions (by signature or body),
-- no indexes, no views, and no RLS policies reference it. That is why the
-- `DROP TYPE` below is expected to succeed. If it ever fails, the error names
-- the dependency that must be repointed first, and that error is the feature,
-- not the bug (spec §10.8).
--
-- REVERSIBILITY: not cleanly reversible. Re-adding 'trending' to the enum is
-- trivial (`ALTER TYPE ... ADD VALUE`), but the information about *which* rows
-- previously held it is destroyed by the UPDATE. The two ids above are recorded
-- here so the original state can be reconstructed by hand if ever needed:
--   markets            b1d899b9-3b73-4fca-95ff-3ef8f9bbb161
--   market_suggestions e6abdc15-80be-4ce2-a231-c7a1696044fc

DO $migration$
BEGIN
  -- Guard: only run the swap while 'trending' is still part of the enum.
  IF EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'market_category'
      AND e.enumlabel = 'trending'
  ) THEN

    -- ─── 1. Move every row off the value being dropped ──────────────────────
    EXECUTE $q$
      UPDATE public.markets
         SET category = 'social'
       WHERE category = 'trending'
    $q$;

    EXECUTE $q$
      UPDATE public.market_suggestions
         SET category = 'social'
       WHERE category = 'trending'
    $q$;

    -- ─── 2. Build the replacement type without 'trending' ───────────────────
    EXECUTE $q$
      CREATE TYPE public.market_category_new AS ENUM ('sports', 'social', 'actions')
    $q$;

    -- ─── 3. Repoint both columns, drop the old type, take over its name ─────
    EXECUTE $q$
      ALTER TABLE public.markets
        ALTER COLUMN category TYPE public.market_category_new
        USING category::text::public.market_category_new
    $q$;

    EXECUTE $q$
      ALTER TABLE public.market_suggestions
        ALTER COLUMN category TYPE public.market_category_new
        USING category::text::public.market_category_new
    $q$;

    EXECUTE $q$DROP TYPE public.market_category$q$;
    EXECUTE $q$ALTER TYPE public.market_category_new RENAME TO market_category$q$;

  END IF;
END
$migration$;
