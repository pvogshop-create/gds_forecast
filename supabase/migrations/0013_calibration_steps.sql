-- 0013_calibration_steps.sql
-- Updates calibration period from a flat 5-bet / 100-coin cap to a
-- 3-bet ramp: bet 1 → max 200, bet 2 → max 300, bet 3 → max 400.
-- After 3 bets the global 500-coin cap is removed; only the user's balance limits them.

-- ── place_bet() ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.place_bet(
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
  v_market          public.markets%ROWTYPE;
  v_profile         public.profiles%ROWTYPE;
  v_price           NUMERIC(6, 4);
  v_shares          NUMERIC(14, 6);
  v_new_yes_pool    NUMERIC(14, 2);
  v_new_no_pool     NUMERIC(14, 2);
  v_new_prob        NUMERIC(6, 4);
  v_position_id     UUID;
  v_yes_odds_at_bet INTEGER;
  v_bet_count       BIGINT;
BEGIN
  -- ── 0. Caller authorization ──────────────────────────────────────────────────
  IF auth.uid() IS NOT NULL AND p_user_id != auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized: cannot place bet for another user.';
  END IF;

  -- ── 1. Validate input ────────────────────────────────────────────────────────
  IF p_coins < 10 THEN
    RAISE EXCEPTION 'Minimum bet is 10 coins. You tried to bet: %', p_coins;
  END IF;
  -- No global maximum: calibration period below handles early limits;
  -- user balance check handles the rest.

  -- ── 2. Lock and validate market ──────────────────────────────────────────────
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

  IF v_market.resolution_date IS NOT NULL AND v_market.resolution_date < NOW() THEN
    RAISE EXCEPTION 'Market has expired.';
  END IF;

  -- ── 3. Calibration period check ──────────────────────────────────────────────
  -- First 3 bets on a new market have stepped caps so mis-priced opening lines
  -- cannot be heavily exploited before the market self-corrects.
  SELECT COUNT(*) INTO v_bet_count
  FROM public.positions
  WHERE market_id = p_market_id;

  IF v_bet_count = 0 AND p_coins > 200 THEN
    RAISE EXCEPTION 'Market calibration period (bet 1 of 3). Max bet is 200 coins.';
  END IF;
  IF v_bet_count = 1 AND p_coins > 300 THEN
    RAISE EXCEPTION 'Market calibration period (bet 2 of 3). Max bet is 300 coins.';
  END IF;
  IF v_bet_count = 2 AND p_coins > 400 THEN
    RAISE EXCEPTION 'Market calibration period (bet 3 of 3). Max bet is 400 coins.';
  END IF;

  -- ── 4. Lock and validate user profile ────────────────────────────────────────
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

  -- ── 5. CPMM: compute price, shares, and new pools ────────────────────────────
  IF p_side = 'yes' THEN
    v_price        := v_market.yes_probability;
    v_new_yes_pool := v_market.yes_pool + p_coins;
    v_new_no_pool  := v_market.no_pool;
  ELSE
    v_price        := 1.0 - v_market.yes_probability;
    v_new_yes_pool := v_market.yes_pool;
    v_new_no_pool  := v_market.no_pool + p_coins;
  END IF;

  IF v_price <= 0.01 OR v_price >= 0.99 THEN
    RAISE EXCEPTION 'Market price is at its limit. Cannot bet further in this direction.';
  END IF;

  v_shares              := p_coins::NUMERIC / v_price;
  v_new_prob            := v_new_yes_pool / (v_new_yes_pool + v_new_no_pool);
  v_yes_odds_at_bet     := public.prob_to_american_odds(v_market.yes_probability::NUMERIC);

  -- ── 6. Deduct coins from user ─────────────────────────────────────────────────
  UPDATE public.profiles
  SET coins      = coins - p_coins,
      total_bets = total_bets + 1,
      updated_at = NOW()
  WHERE id = p_user_id;

  -- ── 7. Update market pools (triggers probability recalc) ─────────────────────
  UPDATE public.markets
  SET yes_pool = v_new_yes_pool,
      no_pool  = v_new_no_pool
  WHERE id = p_market_id;

  -- ── 8. Insert position ───────────────────────────────────────────────────────
  INSERT INTO public.positions (
    market_id, user_id, side, coins_wagered, shares_bought, price_at_bet, yes_odds_at_bet
  ) VALUES (
    p_market_id, p_user_id, p_side, p_coins, v_shares, v_price, v_yes_odds_at_bet
  )
  RETURNING id INTO v_position_id;

  -- ── 9. Record probability history snapshot ────────────────────────────────────
  INSERT INTO public.market_probability_history (market_id, yes_probability)
  VALUES (p_market_id, v_new_prob);

  -- ── 10. Log to activity feed ───────────────────────────────────────────────────
  INSERT INTO public.activity_feed (user_id, action_type, market_id, data)
  VALUES (
    p_user_id,
    CASE WHEN p_side = 'yes' THEN 'bet_yes' ELSE 'bet_no' END,
    p_market_id,
    jsonb_build_object(
      'coins_wagered',    p_coins,
      'shares_bought',    v_shares,
      'price_at_bet',     v_price,
      'yes_odds_at_bet',  v_yes_odds_at_bet,
      'position_id',      v_position_id,
      'market_title',     v_market.title
    )
  );

  -- ── 11. Return result ─────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'position_id',      v_position_id,
    'shares_bought',    v_shares,
    'price_at_bet',     v_price,
    'yes_odds_at_bet',  v_yes_odds_at_bet,
    'coins_spent',      p_coins,
    'coins_remaining',  v_profile.coins - p_coins,
    'new_probability',  v_new_prob
  );
END;
$$;

-- ── place_ou_bet() ────────────────────────────────────────────────────────────
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
  -- No global maximum: calibration period below handles early limits;
  -- user balance check handles the rest.

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

  IF v_bet_count = 0 AND p_coins > 200 THEN
    RAISE EXCEPTION 'Market calibration period (bet 1 of 3). Max bet is 200 coins.';
  END IF;
  IF v_bet_count = 1 AND p_coins > 300 THEN
    RAISE EXCEPTION 'Market calibration period (bet 2 of 3). Max bet is 300 coins.';
  END IF;
  IF v_bet_count = 2 AND p_coins > 400 THEN
    RAISE EXCEPTION 'Market calibration period (bet 3 of 3). Max bet is 400 coins.';
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
  v_line_shift := 0.5 * CEIL(p_coins::NUMERIC / 100.0);

  IF p_side = 'yes' THEN
    v_new_line     := v_market.ou_line + v_line_shift;
    v_new_yes_pool := v_market.yes_pool + p_coins;
    v_new_no_pool  := v_market.no_pool;
  ELSE
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
    'position_id',      v_position_id,
    'ou_line_at_bet',   v_market.ou_line,
    'potential_payout', p_coins * 2,
    'coins_spent',      p_coins,
    'coins_remaining',  v_profile.coins - p_coins,
    'new_line',         v_new_line
  );
END;
$$;
