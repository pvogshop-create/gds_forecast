-- 0007_lines.sql — American odds payout system
-- • Adds suggested_yes_odds to market_suggestions (set by suggester, default +100)
-- • Adds yes_odds_at_bet to positions (locked in at time of bet)
-- • place_bet(): records yes_odds_at_bet on every new position
-- • resolve_market(): pays winners using locked-in American odds instead of pool-proportional math

-- ── 1. Schema changes ─────────────────────────────────────────────────────────

ALTER TABLE public.market_suggestions
  ADD COLUMN IF NOT EXISTS suggested_yes_odds INTEGER DEFAULT 100;

ALTER TABLE public.positions
  ADD COLUMN IF NOT EXISTS yes_odds_at_bet INTEGER;

-- ── 2. Helper SQL functions ───────────────────────────────────────────────────

-- Probability (0.0–1.0) → American odds integer
-- Mirrors the TypeScript probToAmericanOdds() in market-logic.ts
CREATE OR REPLACE FUNCTION public.prob_to_american_odds(p NUMERIC)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF p >= 0.5 THEN
    RETURN ROUND(-(p / (1.0 - p)) * 100)::INTEGER;
  ELSE
    RETURN ROUND(((1.0 - p) / p) * 100)::INTEGER;
  END IF;
END;
$$;

-- American odds integer → total payout multiplier (stake + profit)
-- +100 → 2.0  |  +150 → 2.5  |  -150 → 1.667
CREATE OR REPLACE FUNCTION public.american_odds_multiplier(odds INTEGER)
RETURNS NUMERIC
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF odds >= 0 THEN
    RETURN (100 + odds)::NUMERIC / 100;
  ELSE
    RETURN (ABS(odds) + 100)::NUMERIC / ABS(odds);
  END IF;
END;
$$;

-- ── 3. Backfill existing positions ───────────────────────────────────────────
-- Reconstruct the YES-side probability at time of bet from price_at_bet:
--   YES bet → price_at_bet = yes_probability  → yes_odds = f(price_at_bet)
--   NO  bet → price_at_bet = 1 - yes_probability → yes_prob = 1 - price_at_bet

UPDATE public.positions
SET yes_odds_at_bet = CASE
  WHEN side = 'yes' THEN public.prob_to_american_odds(price_at_bet::NUMERIC)
  ELSE                   public.prob_to_american_odds(1.0 - price_at_bet::NUMERIC)
END
WHERE yes_odds_at_bet IS NULL;

ALTER TABLE public.positions
  ALTER COLUMN yes_odds_at_bet SET NOT NULL,
  ALTER COLUMN yes_odds_at_bet SET DEFAULT 100;

-- ── 4. Updated place_bet() ────────────────────────────────────────────────────

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

  -- ── 3. Lock and validate user profile ────────────────────────────────────────
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

  -- ── 4. CPMM: compute price, shares, and new pools ────────────────────────────
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

  -- ── 5. Deduct coins from user ─────────────────────────────────────────────────
  UPDATE public.profiles
  SET coins      = coins - p_coins,
      total_bets = total_bets + 1,
      updated_at = NOW()
  WHERE id = p_user_id;

  -- ── 6. Update market pools (triggers probability recalc) ─────────────────────
  UPDATE public.markets
  SET yes_pool = v_new_yes_pool,
      no_pool  = v_new_no_pool
  WHERE id = p_market_id;

  -- ── 7. Insert position ───────────────────────────────────────────────────────
  INSERT INTO public.positions (
    market_id, user_id, side, coins_wagered, shares_bought, price_at_bet, yes_odds_at_bet
  ) VALUES (
    p_market_id, p_user_id, p_side, p_coins, v_shares, v_price, v_yes_odds_at_bet
  )
  RETURNING id INTO v_position_id;

  -- ── 8. Record probability history snapshot ────────────────────────────────────
  INSERT INTO public.market_probability_history (market_id, yes_probability)
  VALUES (p_market_id, v_new_prob);

  -- ── 9. Log to activity feed ───────────────────────────────────────────────────
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

  -- ── 10. Return result ─────────────────────────────────────────────────────────
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

-- ── 5. Updated resolve_market() — pays using locked-in American odds ──────────

CREATE OR REPLACE FUNCTION public.resolve_market(
  p_market_id UUID,
  p_outcome   TEXT,
  p_admin_id  UUID,
  p_note      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_market          public.markets%ROWTYPE;
  v_winning_side    public.position_side;
  v_total_pool      NUMERIC(14, 2);
  v_position        public.positions%ROWTYPE;
  v_side_odds       INTEGER;
  v_payout          INTEGER;
  v_payout_count    INTEGER := 0;
  v_total_payout    INTEGER := 0;
  v_market_title    TEXT;
BEGIN
  -- ── 0. Admin gate ─────────────────────────────────────────────────────────────
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: resolve_market may only be called by admin.';
  END IF;

  IF p_outcome NOT IN ('yes', 'no') THEN
    RAISE EXCEPTION 'Invalid outcome: %. Must be "yes" or "no".', p_outcome;
  END IF;

  v_winning_side := p_outcome::public.position_side;

  SELECT * INTO v_market
  FROM public.markets
  WHERE id = p_market_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Market not found: %', p_market_id;
  END IF;

  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Market cannot be resolved. Current status: %', v_market.status;
  END IF;

  v_total_pool   := v_market.yes_pool + v_market.no_pool;
  v_market_title := v_market.title;

  -- Update market status
  UPDATE public.markets
  SET status          = CASE WHEN p_outcome = 'yes' THEN 'resolved_yes'::public.market_status
                             ELSE 'resolved_no'::public.market_status END,
      resolved_at     = NOW(),
      resolved_by     = p_admin_id,
      resolution_note = p_note,
      updated_at      = NOW()
  WHERE id = p_market_id;

  -- Pay out each winning position using the American odds locked in at bet time.
  -- YES side: odds = yes_odds_at_bet
  -- NO  side: odds = -yes_odds_at_bet  (negation gives the NO-side odds)
  FOR v_position IN
    SELECT *
    FROM public.positions
    WHERE market_id = p_market_id
      AND side = v_winning_side
      AND status = 'open'
    ORDER BY created_at
    FOR UPDATE
  LOOP
    v_side_odds := CASE
      WHEN v_position.side = 'yes' THEN  v_position.yes_odds_at_bet
      ELSE                               -v_position.yes_odds_at_bet
    END;

    v_payout := GREATEST(
      0,
      ROUND(v_position.coins_wagered::NUMERIC * public.american_odds_multiplier(v_side_odds))::INTEGER
    );

    UPDATE public.positions
    SET status = 'won',
        payout = v_payout
    WHERE id = v_position.id;

    UPDATE public.profiles
    SET coins      = coins + v_payout,
        wins       = wins + 1,
        updated_at = NOW()
    WHERE id = v_position.user_id;

    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_position.user_id,
      'payout_received',
      'You won! 🎉',
      format(
        'Your %s position on "%s" paid out %s coins.',
        upper(p_outcome),
        v_market_title,
        v_payout
      ),
      jsonb_build_object(
        'market_id',    p_market_id,
        'market_title', v_market_title,
        'payout',       v_payout,
        'outcome',      p_outcome
      )
    );

    INSERT INTO public.activity_feed (user_id, action_type, market_id, data)
    VALUES (
      v_position.user_id,
      'market_won',
      p_market_id,
      jsonb_build_object(
        'payout',       v_payout,
        'market_title', v_market_title,
        'outcome',      p_outcome
      )
    );

    v_payout_count := v_payout_count + 1;
    v_total_payout := v_total_payout + v_payout;
  END LOOP;

  -- Mark losing positions
  UPDATE public.positions
  SET status = 'lost',
      payout = 0
  WHERE market_id = p_market_id
    AND side != v_winning_side
    AND status = 'open';

  RETURN jsonb_build_object(
    'market_id',    p_market_id,
    'outcome',      p_outcome,
    'total_pool',   v_total_pool,
    'winners_paid', v_payout_count,
    'total_payout', v_total_payout
  );
END;
$$;
