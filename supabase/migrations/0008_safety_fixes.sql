-- 0008_safety_fixes.sql
-- • prob_to_american_odds(): guard against p=0 and p=1 (divide-by-zero)
-- • admin_adjust_balance(): atomic coin increment/decrement (eliminates TOCTOU race)

-- ── 1. Fix prob_to_american_odds divide-by-zero ────────────────────────────────
-- place_bet() already rejects p ≤ 0.01 / p ≥ 0.99, but this function is IMMUTABLE
-- and could be called independently (backfills, admin queries) with edge-case values.

CREATE OR REPLACE FUNCTION public.prob_to_american_odds(p NUMERIC)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  -- Degenerate probabilities: return even odds as a safe fallback
  IF p IS NULL OR p <= 0 OR p >= 1 THEN
    RETURN 100;
  END IF;

  IF p >= 0.5 THEN
    RETURN ROUND(-(p / (1.0 - p)) * 100)::INTEGER;
  ELSE
    RETURN ROUND(((1.0 - p) / p) * 100)::INTEGER;
  END IF;
END;
$$;

-- ── 2. admin_adjust_balance — atomic coin adjustment ──────────────────────────
-- Replaces the read-modify-write pattern in adjustUserBalance() server action.
-- GREATEST(0, coins + p_amount) ensures the balance never goes negative.
-- SECURITY DEFINER + service_role guard ensures only admin code can call this.

CREATE OR REPLACE FUNCTION public.admin_adjust_balance(
  p_user_id UUID,
  p_amount  INTEGER
)
RETURNS INTEGER  -- returns the new coin balance
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_balance INTEGER;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: admin_adjust_balance may only be called by service_role.';
  END IF;

  UPDATE public.profiles
  SET coins      = GREATEST(0, coins + p_amount),
      updated_at = NOW()
  WHERE id = p_user_id
  RETURNING coins INTO v_new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User not found: %', p_user_id;
  END IF;

  RETURN v_new_balance;
END;
$$;
