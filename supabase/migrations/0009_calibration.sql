-- 0009_calibration.sql
-- Adds a calibration period to new markets.
-- The first 5 bets on any market are capped at 100 coins so that
-- mis-priced opening lines cannot be exploited before the market self-corrects.

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

  IF p_coins > 500 THEN
    RAISE EXCEPTION 'Maximum bet is 500 coins per position. You tried to bet: %', p_coins;
  END IF;

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
  -- Count existing bets inside the market lock so this is atomic.
  -- First 5 bets are capped at 100 coins to prevent exploitation of mis-priced lines.
  SELECT COUNT(*) INTO v_bet_count
  FROM public.positions
  WHERE market_id = p_market_id;

  IF v_bet_count < 5 AND p_coins > 100 THEN
    RAISE EXCEPTION
      'Market is in its calibration period (bet % of 5). Max bet is 100 coins.',
      v_bet_count + 1;
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
