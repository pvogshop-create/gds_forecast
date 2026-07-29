-- 0010_ou_markets.sql
-- Adds Over/Under market type.
-- O/U markets always pay +100 (even money, 2× payout).
-- After each bet the line shifts proportionally to bet size.
-- Positions are resolved individually against the line locked at bet time.

-- ── 1. Add columns to markets ──────────────────────────────────────────────────
ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS market_type      TEXT NOT NULL DEFAULT 'binary'
    CHECK (market_type IN ('binary', 'over_under')),
  ADD COLUMN IF NOT EXISTS ou_line          NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS ou_opening_line  NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS ou_unit          TEXT,
  ADD COLUMN IF NOT EXISTS resolution_value NUMERIC(8,2);

-- ── 2. Add ou_line_at_bet to positions ────────────────────────────────────────
ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS ou_line_at_bet NUMERIC(6,2);

-- ── 3. Add O/U fields to market_suggestions ───────────────────────────────────
ALTER TABLE public.market_suggestions
  ADD COLUMN IF NOT EXISTS market_type     TEXT NOT NULL DEFAULT 'binary'
    CHECK (market_type IN ('binary', 'over_under')),
  ADD COLUMN IF NOT EXISTS ou_opening_line NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS ou_unit         TEXT;

-- ── 4. Patch sync_market_probability trigger to guard div-by-zero ─────────────
-- When yes_pool + no_pool = 0 (e.g. fresh O/U market with no bets yet),
-- keep yes_probability at 0.5 instead of dividing by zero.
CREATE OR REPLACE FUNCTION public.sync_market_probability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF (NEW.yes_pool + NEW.no_pool) = 0 THEN
    NEW.yes_probability := 0.5000;
  ELSE
    NEW.yes_probability := NEW.yes_pool / (NEW.yes_pool + NEW.no_pool);
  END IF;
  RETURN NEW;
END;
$$;

-- ── 5. place_ou_bet() stored procedure ────────────────────────────────────────
-- Fixed-odds O/U bet: always +100 (2× payout).
-- Line shifts by 0.5 × CEIL(coins / 100) toward the bet side.
-- Respects the same 5-bet / 100-coin calibration period as place_bet().
CREATE OR REPLACE FUNCTION public.place_ou_bet(
  p_market_id UUID,
  p_user_id   UUID,
  p_side      public.position_side,
  p_coins     INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market       public.markets%ROWTYPE;
  v_profile      public.profiles%ROWTYPE;
  v_position_id  UUID;
  v_bet_count    BIGINT;
  v_line_shift   NUMERIC(6,2);
  v_new_line     NUMERIC(6,2);
  v_new_yes_pool NUMERIC(14,2);
  v_new_no_pool  NUMERIC(14,2);
BEGIN
  -- ── 0. Caller authorization ────────────────────────────────────────────────
  IF auth.uid() IS NOT NULL AND p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: cannot place bet for another user.';
  END IF;

  -- ── 1. Validate input ──────────────────────────────────────────────────────
  IF p_coins < 10 THEN
    RAISE EXCEPTION 'Minimum bet is 10 coins. You tried to bet: %', p_coins;
  END IF;
  IF p_coins > 500 THEN
    RAISE EXCEPTION 'Maximum bet is 500 coins per position. You tried to bet: %', p_coins;
  END IF;

  -- ── 2. Lock and validate market ────────────────────────────────────────────
  SELECT * INTO v_market
  FROM public.markets
  WHERE id = p_market_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Market not found: %', p_market_id;
  END IF;
  IF v_market.status != 'open' THEN
    RAISE EXCEPTION 'Market is not open for betting. Current status: %', v_market.status;
  END IF;
  IF v_market.market_type != 'over_under' THEN
    RAISE EXCEPTION 'Use place_bet() for binary markets.';
  END IF;
  IF v_market.ou_line IS NULL THEN
    RAISE EXCEPTION 'O/U market has no line set.';
  END IF;
  IF v_market.resolution_date IS NOT NULL AND v_market.resolution_date < NOW() THEN
    RAISE EXCEPTION 'Market has expired.';
  END IF;

  -- ── 3. Calibration period check ────────────────────────────────────────────
  SELECT COUNT(*) INTO v_bet_count
  FROM public.positions
  WHERE market_id = p_market_id;

  IF v_bet_count < 5 AND p_coins > 100 THEN
    RAISE EXCEPTION
      'Market is in its calibration period (bet % of 5). Max bet is 100 coins.',
      v_bet_count + 1;
  END IF;

  -- ── 4. Lock and validate user profile ─────────────────────────────────────
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found: %', p_user_id;
  END IF;
  IF v_profile.coins < p_coins THEN
    RAISE EXCEPTION 'Insufficient coins. Balance: %, Required: %', v_profile.coins, p_coins;
  END IF;

  -- ── 5. Compute line shift: 0.5 × CEIL(coins / 100) ────────────────────────
  -- 10–100 coins → 0.5 | 101–200 → 1.0 | 201–300 → 1.5 | ... | 401–500 → 2.5
  v_line_shift := 0.5 * CEIL(p_coins::NUMERIC / 100.0);

  IF p_side = 'yes' THEN
    -- OVER bet: line rises
    v_new_line     := v_market.ou_line + v_line_shift;
    v_new_yes_pool := v_market.yes_pool + p_coins;
    v_new_no_pool  := v_market.no_pool;
  ELSE
    -- UNDER bet: line falls
    v_new_line     := v_market.ou_line - v_line_shift;
    v_new_yes_pool := v_market.yes_pool;
    v_new_no_pool  := v_market.no_pool + p_coins;
  END IF;

  -- ── 6. Deduct coins from user ──────────────────────────────────────────────
  UPDATE public.profiles
  SET coins      = coins - p_coins,
      total_bets = total_bets + 1,
      updated_at = NOW()
  WHERE id = p_user_id;

  -- ── 7. Update market: pools + live line ───────────────────────────────────
  UPDATE public.markets
  SET yes_pool = v_new_yes_pool,
      no_pool  = v_new_no_pool,
      ou_line  = v_new_line
  WHERE id = p_market_id;

  -- ── 8. Insert position ─────────────────────────────────────────────────────
  -- shares_bought = 2 × coins (pre-computed fixed payout at +100 odds)
  -- price_at_bet  = 0.5 (implied probability of +100)
  -- yes_odds_at_bet = 100 (always for O/U)
  -- ou_line_at_bet  = line at the moment of bet (locked for resolution)
  INSERT INTO public.positions (
    market_id, user_id, side, coins_wagered, shares_bought,
    price_at_bet, yes_odds_at_bet, ou_line_at_bet
  ) VALUES (
    p_market_id, p_user_id, p_side, p_coins, p_coins * 2,
    0.5, 100, v_market.ou_line
  )
  RETURNING id INTO v_position_id;

  -- ── 9. Log to activity feed ────────────────────────────────────────────────
  INSERT INTO public.activity_feed (user_id, action_type, market_id, data)
  VALUES (
    p_user_id,
    CASE WHEN p_side = 'yes' THEN 'bet_yes' ELSE 'bet_no' END,
    p_market_id,
    jsonb_build_object(
      'coins_wagered',  p_coins,
      'ou_line_at_bet', v_market.ou_line,
      'side_label',     CASE WHEN p_side = 'yes' THEN 'OVER' ELSE 'UNDER' END,
      'market_title',   v_market.title,
      'position_id',    v_position_id
    )
  );

  -- ── 10. Return result ──────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'position_id',     v_position_id,
    'ou_line_at_bet',  v_market.ou_line,
    'new_line',        v_new_line,
    'coins_spent',     p_coins,
    'coins_remaining', v_profile.coins - p_coins,
    'potential_payout', p_coins * 2
  );
END;
$$;

-- ── 6. resolve_ou_market() stored procedure ───────────────────────────────────
-- Admin provides the actual numeric result.
-- Each position is resolved individually against its locked ou_line_at_bet:
--   OVER (side='yes') wins if result > line_at_bet → 2× payout
--   UNDER (side='no') wins if result < line_at_bet → 2× payout
--   PUSH if result = line_at_bet → full refund
--   Loss otherwise → payout 0
CREATE OR REPLACE FUNCTION public.resolve_ou_market(
  p_market_id    UUID,
  p_result_value NUMERIC,
  p_admin_id     UUID,
  p_note         TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market     public.markets%ROWTYPE;
  v_pos        public.positions%ROWTYPE;
  v_payout     INTEGER;
  v_winners    INTEGER := 0;
  v_total_paid INTEGER := 0;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Admin only.';
  END IF;

  SELECT * INTO v_market
  FROM public.markets
  WHERE id = p_market_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Market not found: %', p_market_id;
  END IF;
  IF v_market.market_type != 'over_under' THEN
    RAISE EXCEPTION 'Use resolve_market() for binary markets.';
  END IF;
  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market is already resolved or cancelled.';
  END IF;

  -- Mark market resolved; store actual result in resolution_value
  UPDATE public.markets
  SET status           = 'resolved_yes',
      resolved_at      = NOW(),
      resolved_by      = p_admin_id,
      resolution_note  = p_note,
      resolution_value = p_result_value
  WHERE id = p_market_id;

  -- Resolve each open position individually
  FOR v_pos IN
    SELECT * FROM public.positions
    WHERE market_id = p_market_id AND status = 'open'
  LOOP
    IF v_pos.ou_line_at_bet IS NULL THEN
      -- Malformed position; skip gracefully
      CONTINUE;
    END IF;

    IF (v_pos.side = 'yes' AND p_result_value > v_pos.ou_line_at_bet) OR
       (v_pos.side = 'no'  AND p_result_value < v_pos.ou_line_at_bet) THEN
      -- WIN: 2× payout (original stake + 100% profit)
      v_payout := v_pos.coins_wagered * 2;
      UPDATE public.positions
        SET status = 'won', payout = v_payout
        WHERE id = v_pos.id;
      UPDATE public.profiles
        SET coins = coins + v_payout, wins = wins + 1
        WHERE id = v_pos.user_id;
      INSERT INTO public.notifications (user_id, type, title, body, data)
      VALUES (
        v_pos.user_id, 'payout_received', 'You won! 🎉',
        format('Your %s bet on "%s" (line %s) paid out %s coins.',
          CASE WHEN v_pos.side = 'yes' THEN 'OVER' ELSE 'UNDER' END,
          v_market.title, v_pos.ou_line_at_bet, v_payout),
        jsonb_build_object('market_id', p_market_id, 'payout', v_payout)
      );
      INSERT INTO public.activity_feed (user_id, action_type, market_id, data)
      VALUES (
        v_pos.user_id, 'market_won', p_market_id,
        jsonb_build_object('payout', v_payout, 'market_title', v_market.title)
      );
      v_winners    := v_winners + 1;
      v_total_paid := v_total_paid + v_payout;

    ELSIF p_result_value = v_pos.ou_line_at_bet THEN
      -- PUSH: full refund
      v_payout := v_pos.coins_wagered;
      UPDATE public.positions
        SET status = 'won', payout = v_payout
        WHERE id = v_pos.id;
      UPDATE public.profiles
        SET coins = coins + v_payout
        WHERE id = v_pos.user_id;
      v_total_paid := v_total_paid + v_payout;

    ELSE
      -- LOSS
      UPDATE public.positions
        SET status = 'lost', payout = 0
        WHERE id = v_pos.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'market_id',    p_market_id,
    'result_value', p_result_value,
    'winners_paid', v_winners,
    'total_payout', v_total_paid
  );
END;
$$;
