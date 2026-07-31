-- 0027_locked_line_and_referral.sql
--
-- Close the two unlocked read-modify-write paths that sit outside place_bet.
--
-- `place_bet` / `place_ou_bet` (0013) are concurrency-correct: each takes
-- `SELECT ... FOR UPDATE` on the market before reading pools, and on the profile
-- before checking the balance. Their pool writes are snapshot literals
-- (`SET yes_pool = v_new_yes_pool`), which is textbook read-modify-write and is
-- safe ONLY because of that lock. e2e/concurrency.spec.ts pins the pairing.
--
-- The invariant that makes it work is "everyone who writes pools holds the market
-- lock." Two callers broke it:
--
-- 1. `setMarketLine()` in src/app/(admin)/admin/actions.ts read yes_pool/no_pool
--    over PostgREST, computed new pools in TypeScript, and wrote them back — two
--    round trips, two transactions, no lock. A bet committing in between had its
--    pool contribution silently erased: the coins stayed debited and the position
--    stayed open at its locked odds, but the money vanished from the pool and the
--    probability moved back. This migration moves that arithmetic into the
--    database behind the same `FOR UPDATE` every other pool writer takes, which
--    also brings it in line with the CLAUDE.md rule that state changes go through
--    SECURITY DEFINER RPCs rather than direct client table writes.
--
-- 2. `record_referral()` (0011) guarded idempotency with a bare EXISTS and no
--    lock. Two concurrent calls for the same new user — a double-fired auth
--    callback is the plausible path — both passed the check and both awarded 500
--    coins. The increment is in place so no coins are LOST; they are MINTED
--    twice, which in a play-money economy is the same problem pointed the other
--    way.
--
-- Deliberately NOT fixed here: `start_league_week()` (0018) evaluates
-- `p.coins >= buy_in` in its cursor query and debits in a separate statement with
-- no profile lock, so a concurrent bet can drive a balance negative — and
-- `profiles.coins` has no CHECK (coins >= 0) to catch it. Its member cursor also
-- has no ORDER BY, so two concurrent calls with overlapping members can deadlock.
-- That is tournament-gated and needs its own decision about lock ordering plus a
-- scan for existing negative balances before a CHECK can be added. Logged in
-- MIGRATIONS_LOG.md instead of half-fixed here.

-- ── 1. american_odds_to_prob — the inverse of prob_to_american_odds ───────────
-- The DB had prob_to_american_odds() (0007, guarded in 0008) and
-- american_odds_multiplier(), but never the inverse — it existed only in
-- TypeScript as americanOddsToProb() in src/lib/market-logic.ts. Moving the line
-- calculation into SQL needs it here, and any drift between the two
-- implementations would silently reprice markets, so the E2E suite asserts the
-- two agree across a table of values rather than trusting they match.
--
-- Mirrors the TS exactly:
--   odds >= 0 → 100 / (odds + 100)
--   odds <  0 → |odds| / (|odds| + 100)

CREATE OR REPLACE FUNCTION public.american_odds_to_prob(p_odds INTEGER)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  IF p_odds IS NULL THEN
    RETURN 0.5;
  END IF;

  IF p_odds >= 0 THEN
    RETURN 100.0 / (p_odds + 100.0);
  END IF;

  RETURN ABS(p_odds)::NUMERIC / (ABS(p_odds) + 100.0);
END;
$$;

-- ── 2. set_market_line — the locked replacement for the TS read-modify-write ──
-- Rebalances yes_pool/no_pool to express the given American odds for YES while
-- holding total volume constant. The probability column is not written directly:
-- the existing `market_probability_sync` trigger (BEFORE UPDATE OF yes_pool,
-- no_pool — 0006) recomputes it from the pools, exactly as it does for a bet.

CREATE OR REPLACE FUNCTION public.set_market_line(
  p_market_id UUID,
  p_yes_odds  INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market  public.markets%ROWTYPE;
  v_total   NUMERIC(14, 2);
  v_prob    NUMERIC;
  v_new_yes NUMERIC(14, 2);
  v_new_no  NUMERIC(14, 2);
BEGIN
  -- Same gate shape as resolve_market: admin identity is app-layer (an email
  -- allowlist), so the database's only usable check is that the caller reached it
  -- through a service_role path rather than a user session.
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: set_market_line may only be called by admin.';
  END IF;

  SELECT * INTO v_market
  FROM public.markets
  WHERE id = p_market_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Market not found: %', p_market_id;
  END IF;

  IF v_market.market_type != 'binary' THEN
    RAISE EXCEPTION 'set_market_line applies to binary markets only. O/U markets carry a line, not pools.';
  END IF;

  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Cannot re-line a settled market. Current status: %', v_market.status;
  END IF;

  v_total := v_market.yes_pool + v_market.no_pool;
  v_prob  := public.american_odds_to_prob(p_yes_odds);

  -- ROUND then subtract, so the two pools always re-sum to the original total
  -- exactly and no volume is created or destroyed by rounding.
  v_new_yes := ROUND(v_total * v_prob);
  v_new_no  := v_total - v_new_yes;

  UPDATE public.markets
  SET yes_pool = v_new_yes,
      no_pool  = v_new_no
  WHERE id = p_market_id;

  RETURN jsonb_build_object(
    'market_id',   p_market_id,
    'yes_odds',    p_yes_odds,
    'yes_pool',    v_new_yes,
    'no_pool',     v_new_no,
    'total_pool',  v_total
  );
END;
$$;

-- ── 3. profiles.referred_by — let a referrer be deleted ──────────────────────
-- `profiles_referred_by_fkey` (0011) was created with no ON DELETE action, so it
-- defaults to NO ACTION: once a user has referred anybody, that user can never be
-- deleted. Any attempt fails with a foreign-key violation.
--
-- Two consequences, one of which is live in production:
--   • Account deletion is impossible for anyone who ever referred a friend — the
--     `auth.users` delete cascades to `profiles` and then trips this constraint.
--   • The E2E teardown cannot remove such a fixture, so `cleanupAll()` warns and
--     moves on, leaving a partially-cleaned database. That is the likely source of
--     the intermittent "Fixture … is missing" and `markets_creator_id_fkey`
--     failures the suite has been showing: a cached fixture id going stale because
--     some users were removed and others survived.
--
-- SET NULL is the right semantics: if the referrer's account is gone, the
-- attribution simply clears. The referred user keeps their account and their
-- coins; only the pointer disappears.

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_referred_by_fkey;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_referred_by_fkey
  FOREIGN KEY (referred_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- ── 4. record_referral — lock before the idempotency check ───────────────────
-- Unchanged from 0011 except for the row lock and an added search_path pin
-- (0011's version was SECURITY DEFINER with no `SET search_path`, which leaves
-- the resolution of every unqualified name up to the caller's setting).

CREATE OR REPLACE FUNCTION public.record_referral(
  p_new_user_id  UUID,
  p_referral_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id UUID;
BEGIN
  -- Lock the new user's row BEFORE testing whether they have already been
  -- referred. Without this the EXISTS below is a plain read-then-write: two
  -- concurrent calls for the same new user both see referred_by IS NULL, both
  -- proceed, and the referrer is paid 500 coins twice.
  PERFORM 1 FROM public.profiles WHERE id = p_new_user_id FOR UPDATE;

  -- Guard: already referred
  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_new_user_id AND referred_by IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  -- Look up referrer by code
  SELECT id INTO v_referrer_id
    FROM public.profiles
   WHERE referral_code = p_referral_code
     AND id <> p_new_user_id;  -- can't refer yourself

  IF v_referrer_id IS NULL THEN
    RETURN;  -- invalid or self-referral code — silently ignore
  END IF;

  -- Record who referred this user
  UPDATE public.profiles
     SET referred_by  = v_referrer_id,
         updated_at   = NOW()
   WHERE id = p_new_user_id;

  -- Award +500 coins to referrer and increment their count
  UPDATE public.profiles
     SET coins          = coins + 500,
         referral_count = referral_count + 1,
         updated_at     = NOW()
   WHERE id = v_referrer_id;

  -- Notify the referrer
  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_referrer_id,
    'league_joined',  -- reuse existing type (closest semantic match)
    'Friend joined using your link!',
    'You earned 500 coins for referring a new member.',
    jsonb_build_object('type', 'referral', 'new_user_id', p_new_user_id)
  );
END;
$$;
