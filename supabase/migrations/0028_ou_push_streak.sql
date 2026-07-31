-- 0028_ou_push_streak.sql
--
-- An over/under PUSH must not extend a win streak.
--
-- ─── The bug ────────────────────────────────────────────────────────────────
--
-- A push is a tie: the result lands exactly on the line, the user gets their
-- stake back and nothing more. `resolve_ou_market` (0010) handles the money
-- correctly and deliberately does NOT increment `profiles.wins` for it.
--
-- But `position_status` has no `push` value, so the position is stored as
-- `status = 'won'` with `payout = coins_wagered`. `update_user_streaks` (0020)
-- fires on status becoming 'won' and increments `win_streak` — so a bet that
-- won nothing extends a hot streak. Compounded, a user who only ever pushes can
-- climb the trending "🔥 Hot Streak" Stat Leader card and displace someone who
-- actually won. `wins` and `win_streak` disagree, which is its own confusion.
--
-- Found by `e2e/betting-ou.spec.ts` ("an exact tie is a push"), which asserted
-- `wins` was untouched and then, once the streak assertion was added, caught
-- this immediately.
--
-- ─── Why detect the push rather than add a `push` status ────────────────────
--
-- Adding `'push'` to `position_status` is the cleaner data model, and is
-- probably right eventually. It is not what this migration does, because that
-- enum is read across the app — the /more page buckets positions into
-- Open / Won / Lost / Cancelled, and a new value would fall through every one of
-- those filters, making pushes silently vanish from a user's bet history. That
-- is a bigger, UI-shaped change than a streak fix should carry.
--
-- The other tempting shortcut — treating `payout = coins_wagered` as a push — is
-- WRONG and deliberately avoided. A binary win at long odds can round to exactly
-- the stake: `american_odds_multiplier(-10000)` is 1.01, so a 10-coin bet pays
-- ROUND(10.1) = 10. That would silently swallow a genuine win's streak.
--
-- Instead this reproduces the resolver's own push test exactly. 0010 uses
-- `p_result_value = v_pos.ou_line_at_bet`, and writes `p_result_value` into
-- `markets.resolution_value` BEFORE the position loop runs — so by the time this
-- AFTER UPDATE trigger fires, the value is committed and readable. The two
-- conditions are therefore identical by construction, not by coincidence.
--
-- A push leaves BOTH streaks untouched: it is a no-result, so it neither extends
-- a win streak nor breaks one, matching how sportsbooks treat a push and how
-- `wins` already behaves.
--
-- Idempotent: CREATE OR REPLACE. Reversible: restore the 0020 body.

CREATE OR REPLACE FUNCTION public.update_user_streaks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_push BOOLEAN := FALSE;
BEGIN
  -- Only an O/U position can be a push; `ou_line_at_bet` is NULL on binary bets,
  -- so this never touches the binary path.
  IF NEW.status = 'won' AND NEW.ou_line_at_bet IS NOT NULL THEN
    SELECT (m.resolution_value = NEW.ou_line_at_bet)
      INTO v_is_push
      FROM public.markets m
     WHERE m.id = NEW.market_id;

    -- resolution_value NULL (market not yet carrying a result) => not a push.
    v_is_push := COALESCE(v_is_push, FALSE);
  END IF;

  IF v_is_push THEN
    -- No result. Neither streak moves, and neither is reset.
    RETURN NEW;
  END IF;

  IF NEW.status = 'won' AND (OLD.status IS DISTINCT FROM 'won') THEN
    UPDATE public.profiles
    SET win_streak  = win_streak + 1,
        loss_streak = 0
    WHERE id = NEW.user_id;

  ELSIF NEW.status = 'lost' AND (OLD.status IS DISTINCT FROM 'lost') THEN
    UPDATE public.profiles
    SET loss_streak = loss_streak + 1,
        win_streak  = 0
    WHERE id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.update_user_streaks() IS
  'Streak trigger. Treats an over/under push (markets.resolution_value = '
  'positions.ou_line_at_bet) as a no-result and leaves both streaks unchanged — '
  'a push is stored as status=''won'' only because position_status has no '
  '''push'' value. See 0028.';

-- The trigger binding from 0021 is unchanged and still points at this function;
-- CREATE OR REPLACE keeps it attached, so nothing needs re-binding here.
