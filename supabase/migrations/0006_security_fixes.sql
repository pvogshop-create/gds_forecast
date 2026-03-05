-- 0006_security_fixes.sql
-- Addresses high/medium issues from code review:
--   1. place_bet(): guard against caller spoofing; remove broken auto-close
--   2. resolve_market(): add admin gate; fix rounding coin leakage
--   3. sync_market_probability trigger: fire on INSERT too (fixes seeded market probabilities)
--   4. profiles: trigger to block direct coin/wins/total_bets manipulation
--   5. Recalculate probability for all existing markets

-- ─── 1 & 2. Updated place_bet() ──────────────────────────────────────────────
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
  v_market        public.markets%ROWTYPE;
  v_profile       public.profiles%ROWTYPE;
  v_price         NUMERIC(6, 4);
  v_shares        NUMERIC(14, 6);
  v_new_yes_pool  NUMERIC(14, 2);
  v_new_no_pool   NUMERIC(14, 2);
  v_new_prob      NUMERIC(6, 4);
  v_position_id   UUID;
BEGIN
  -- ── 0. Caller authorization ──────────────────────────────────────────────────
  -- If called by an authenticated user (not service_role), they may only bet for themselves.
  -- auth.uid() is NULL when called via service_role, so this check is skipped in that context.
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

  -- Expired market: raise without auto-close attempt (auto-close is a scheduled job concern)
  IF v_market.resolution_date IS NOT NULL AND v_market.resolution_date < NOW() THEN
    RAISE EXCEPTION 'Market has expired. It is now closed.';
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

  -- ── 4. CPMM: compute price and shares ────────────────────────────────────────
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

  v_shares   := p_coins::NUMERIC / v_price;
  v_new_prob := v_new_yes_pool / (v_new_yes_pool + v_new_no_pool);

  -- ── 5. Deduct coins from user ─────────────────────────────────────────────────
  UPDATE public.profiles
  SET coins      = coins - p_coins,
      total_bets = total_bets + 1,
      updated_at = NOW()
  WHERE id = p_user_id;

  -- ── 6. Update market pools ───────────────────────────────────────────────────
  UPDATE public.markets
  SET yes_pool = v_new_yes_pool,
      no_pool  = v_new_no_pool
  WHERE id = p_market_id;

  -- ── 7. Insert position ───────────────────────────────────────────────────────
  INSERT INTO public.positions (
    market_id, user_id, side, coins_wagered, shares_bought, price_at_bet
  ) VALUES (
    p_market_id, p_user_id, p_side, p_coins, v_shares, v_price
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
      'coins_wagered', p_coins,
      'shares_bought', v_shares,
      'price_at_bet',  v_price,
      'position_id',   v_position_id,
      'market_title',  v_market.title
    )
  );

  -- ── 10. Return result ─────────────────────────────────────────────────────────
  RETURN jsonb_build_object(
    'position_id',     v_position_id,
    'shares_bought',   v_shares,
    'price_at_bet',    v_price,
    'coins_spent',     p_coins,
    'coins_remaining', v_profile.coins - p_coins,
    'new_probability', v_new_prob
  );
END;
$$;

-- ─── Updated resolve_market() ─────────────────────────────────────────────────
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
  v_market            public.markets%ROWTYPE;
  v_winning_side      public.position_side;
  v_total_pool        NUMERIC(14, 2);
  v_total_win_shares  NUMERIC(14, 6);
  v_position          public.positions%ROWTYPE;
  v_payout            INTEGER;
  v_payout_count      INTEGER := 0;
  v_total_payout      INTEGER := 0;
  v_market_title      TEXT;
  v_last_winner_user  UUID;
  v_last_winner_pos   UUID;
  v_remainder         INTEGER;
BEGIN
  -- ── 0. Admin gate ─────────────────────────────────────────────────────────────
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: resolve_market may only be called by admin.';
  END IF;

  -- Validate outcome
  IF p_outcome NOT IN ('yes', 'no') THEN
    RAISE EXCEPTION 'Invalid outcome: %. Must be "yes" or "no".', p_outcome;
  END IF;

  v_winning_side := p_outcome::public.position_side;

  -- Lock market
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

  -- Total winning shares
  SELECT COALESCE(SUM(shares_bought), 0)
  INTO v_total_win_shares
  FROM public.positions
  WHERE market_id = p_market_id
    AND side = v_winning_side
    AND status = 'open';

  -- Update market status first
  UPDATE public.markets
  SET status          = CASE WHEN p_outcome = 'yes' THEN 'resolved_yes'::public.market_status
                             ELSE 'resolved_no'::public.market_status END,
      resolved_at     = NOW(),
      resolved_by     = p_admin_id,
      resolution_note = p_note,
      updated_at      = NOW()
  WHERE id = p_market_id;

  -- Pay out winners
  FOR v_position IN
    SELECT *
    FROM public.positions
    WHERE market_id = p_market_id
      AND side = v_winning_side
      AND status = 'open'
    ORDER BY created_at
    FOR UPDATE
  LOOP
    IF v_total_win_shares > 0 THEN
      v_payout := GREATEST(
        1,
        ROUND(v_position.shares_bought * (v_total_pool / v_total_win_shares))::INTEGER
      );
    ELSE
      v_payout := 0;
    END IF;

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

    v_payout_count     := v_payout_count + 1;
    v_total_payout     := v_total_payout + v_payout;
    v_last_winner_user := v_position.user_id;
    v_last_winner_pos  := v_position.id;
  END LOOP;

  -- Rounding correction: give any leftover (or take back overpay) from the last winner
  v_remainder := v_total_pool::INTEGER - v_total_payout;
  IF v_remainder != 0 AND v_last_winner_user IS NOT NULL THEN
    UPDATE public.profiles
    SET coins = coins + v_remainder
    WHERE id = v_last_winner_user;

    UPDATE public.positions
    SET payout = payout + v_remainder
    WHERE id = v_last_winner_pos;
  END IF;

  -- Mark losing positions
  UPDATE public.positions
  SET status = 'lost',
      payout = 0
  WHERE market_id = p_market_id
    AND side != v_winning_side
    AND status = 'open';

  RETURN jsonb_build_object(
    'market_id',      p_market_id,
    'outcome',        p_outcome,
    'total_pool',     v_total_pool,
    'winners_paid',   v_payout_count,
    'total_payout',   v_total_payout + COALESCE(v_remainder, 0),
    'winning_shares', v_total_win_shares
  );
END;
$$;

-- ─── 3. Fix sync_market_probability trigger to fire on INSERT too ─────────────
DROP TRIGGER IF EXISTS market_probability_sync ON public.markets;

CREATE TRIGGER market_probability_sync
  BEFORE INSERT OR UPDATE OF yes_pool, no_pool ON public.markets
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_market_probability();

-- Fix existing seeded markets whose yes_probability is stale (set at DEFAULT 0.5)
UPDATE public.markets
SET yes_probability = CASE
  WHEN yes_pool + no_pool > 0 THEN yes_pool / (yes_pool + no_pool)
  ELSE 0.5
END
WHERE yes_pool + no_pool > 0;

-- ─── 4. Protect coins/wins/total_bets from direct user modification ───────────
CREATE OR REPLACE FUNCTION public.prevent_coin_manipulation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Block authenticated users from directly changing financial columns.
  -- SECURITY DEFINER functions (place_bet, resolve_market) run as service_role
  -- so their updates are permitted.
  IF (
    NEW.coins != OLD.coins
    OR NEW.wins != OLD.wins
    OR NEW.total_bets != OLD.total_bets
  ) AND auth.role() = 'authenticated'
  THEN
    RAISE EXCEPTION 'Cannot directly modify coins, wins, or total_bets.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_coin_manipulation ON public.profiles;

CREATE TRIGGER prevent_coin_manipulation
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_coin_manipulation();
