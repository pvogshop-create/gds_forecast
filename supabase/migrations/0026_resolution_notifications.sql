-- 0026_resolution_notifications.sql
--
-- Tell losing bettors their market resolved.
--
-- Both resolution functions notified WINNERS ONLY. `resolve_market` (0007) emits
-- `payout_received` from inside a loop that selects `side = v_winning_side`;
-- losers were handled by a single set-based UPDATE with no iteration and no
-- notification at all. `resolve_ou_market` (0010) loops over every position but
-- only its WIN branch inserts anything — its LOSS branch is silent, and its PUSH
-- branch is worse: it moves coins back into the user's balance and says nothing,
-- so a refund looks like an unexplained balance change.
--
-- Net effect for a user: you bet, you lost, and the app never mentioned it. The
-- only signal was your own balance. `market_resolved` has been sitting in the
-- `notification_type` enum since 0002 and was inserted by nothing, anywhere.
--
-- No ALTER TYPE is needed precisely because that value already exists — which
-- also sidesteps the trap that produced 0023, where a new enum value cannot be
-- used in the same transaction that adds it.
--
-- ── Design note: one notification per user per market ────────────────────────
-- `positions` has no UNIQUE (market_id, user_id), so a user may hold several
-- losing positions on one market. Winners get one notification per POSITION,
-- because each pays out at its own locked odds and the amounts differ. Losers get
-- one per USER, with the stake summed: three "you lost" pushes in a row is a
-- worse experience than three "you won" ones, and there is no per-position number
-- worth separating. That is why the losing paths aggregate and the winning paths
-- do not.
--
-- Verified by: e2e/resolution-payout.spec.ts, e2e/betting-ou.spec.ts,
-- e2e/betting-loop.spec.ts (the last two assertions in the first two files were
-- pinning the ABSENCE of these notifications and are updated in the same change).

-- ── 1. resolve_market — binary ───────────────────────────────────────────────
-- Unchanged from 0007 except for the losing-position block at the end.

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
  v_losing_label    TEXT;
BEGIN
  -- ── 0. Admin gate ─────────────────────────────────────────────────────────────
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: resolve_market may only be called by admin.';
  END IF;

  IF p_outcome NOT IN ('yes', 'no') THEN
    RAISE EXCEPTION 'Invalid outcome: %. Must be "yes" or "no".', p_outcome;
  END IF;

  v_winning_side := p_outcome::public.position_side;
  -- Every losing position on a binary market is on the same side, so naming it
  -- in the notification body is unambiguous.
  v_losing_label := CASE WHEN p_outcome = 'yes' THEN 'NO' ELSE 'YES' END;

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

  -- Mark losing positions AND tell their owners.
  --
  -- A data-modifying CTE so the notified set is exactly the rows just flipped —
  -- no second scan that could pick up a different set, and no chance of notifying
  -- a position this call did not resolve. GROUP BY collapses a user's several
  -- losing positions into one message carrying the summed stake. Zero losers
  -- yields zero rows, so a market where everyone won inserts nothing.
  WITH lost AS (
    UPDATE public.positions
    SET status = 'lost',
        payout = 0
    WHERE market_id = p_market_id
      AND side != v_winning_side
      AND status = 'open'
    RETURNING user_id, coins_wagered
  )
  INSERT INTO public.notifications (user_id, type, title, body, data)
  SELECT
    lost.user_id,
    'market_resolved',
    'Market resolved',
    format(
      '"%s" resolved %s. Your %s position (%s coins) didn''t hit.',
      v_market_title,
      upper(p_outcome),
      v_losing_label,
      SUM(lost.coins_wagered)::INTEGER
    ),
    jsonb_build_object(
      'market_id',     p_market_id,
      'market_title',  v_market_title,
      'outcome',       p_outcome,
      'coins_wagered', SUM(lost.coins_wagered)::INTEGER,
      'positions',     COUNT(*)::INTEGER
    )
  FROM lost
  GROUP BY lost.user_id;

  RETURN jsonb_build_object(
    'market_id',    p_market_id,
    'outcome',      p_outcome,
    'total_pool',   v_total_pool,
    'winners_paid', v_payout_count,
    'total_payout', v_total_payout
  );
END;
$$;

-- ── 2. resolve_ou_market — over/under ────────────────────────────────────────
-- Unchanged from 0010 except that the LOSS and PUSH branches now accumulate into
-- arrays, which are turned into one notification per user after the loop.
--
-- The payout arithmetic and the branch predicates are deliberately byte-identical
-- to 0010. Restructuring a money function to make a notification convenient is not
-- a trade worth making, and classifying positions after the fact by inspecting
-- their `payout` value (a win is 2× stake, a push is 1× stake) would be a silent
-- dependency on that ratio never changing.

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
  v_market      public.markets%ROWTYPE;
  v_pos         public.positions%ROWTYPE;
  v_payout      INTEGER;
  v_winners     INTEGER := 0;
  v_total_paid  INTEGER := 0;
  v_loss_users  UUID[]    := '{}';
  v_loss_coins  INTEGER[] := '{}';
  v_loss_sides  TEXT[]    := '{}';
  v_push_users  UUID[]    := '{}';
  v_push_coins  INTEGER[] := '{}';
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
      -- Malformed position; skip gracefully. NOTE: such a position keeps
      -- status = 'open' on a resolved market forever — it never pays and never
      -- loses. place_ou_bet always sets ou_line_at_bet, so this is only reachable
      -- by a direct insert, but the gap is real and is logged in MIGRATIONS_LOG.md
      -- rather than silently changed here.
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
        -- Payload widened to match the binary path, which carried market_title
        -- and outcome while this one carried only market_id and payout.
        jsonb_build_object(
          'market_id',    p_market_id,
          'market_title', v_market.title,
          'payout',       v_payout,
          'result_value', p_result_value,
          'line_at_bet',  v_pos.ou_line_at_bet
        )
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
      v_push_users := v_push_users || v_pos.user_id;
      v_push_coins := v_push_coins || v_pos.coins_wagered;

    ELSE
      -- LOSS
      UPDATE public.positions
        SET status = 'lost', payout = 0
        WHERE id = v_pos.id;
      v_loss_users := v_loss_users || v_pos.user_id;
      v_loss_coins := v_loss_coins || v_pos.coins_wagered;
      v_loss_sides := v_loss_sides ||
        (CASE WHEN v_pos.side = 'yes' THEN 'OVER' ELSE 'UNDER' END);
    END IF;
  END LOOP;

  -- One notification per losing user. Unlike the binary case a user's losing
  -- positions may sit on different sides, so the side is named only when there is
  -- exactly one of them.
  IF array_length(v_loss_users, 1) IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT
      t.user_id,
      'market_resolved',
      'Market resolved',
      CASE WHEN COUNT(*) = 1 THEN
        format('"%s" resolved at %s. Your %s bet (%s coins) didn''t hit.',
          v_market.title, p_result_value, MIN(t.side), SUM(t.coins)::INTEGER)
      ELSE
        format('"%s" resolved at %s. Your %s bets (%s coins) didn''t hit.',
          v_market.title, p_result_value, COUNT(*)::INTEGER, SUM(t.coins)::INTEGER)
      END,
      jsonb_build_object(
        'market_id',     p_market_id,
        'market_title',  v_market.title,
        'result_value',  p_result_value,
        'coins_wagered', SUM(t.coins)::INTEGER,
        'positions',     COUNT(*)::INTEGER
      )
    FROM unnest(v_loss_users, v_loss_coins, v_loss_sides) AS t(user_id, coins, side)
    GROUP BY t.user_id;
  END IF;

  -- One notification per pushed user. This is the sneakiest of the three gaps:
  -- coins reappear in the balance with no explanation whatsoever.
  IF array_length(v_push_users, 1) IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, data)
    SELECT
      t.user_id,
      'market_resolved',
      'Market pushed',
      format('"%s" resolved at exactly %s — a push. Your %s coins were refunded.',
        v_market.title, p_result_value, SUM(t.coins)::INTEGER),
      jsonb_build_object(
        'market_id',     p_market_id,
        'market_title',  v_market.title,
        'result_value',  p_result_value,
        'refunded',      SUM(t.coins)::INTEGER,
        'positions',     COUNT(*)::INTEGER,
        'push',          true
      )
    FROM unnest(v_push_users, v_push_coins) AS t(user_id, coins)
    GROUP BY t.user_id;
  END IF;

  RETURN jsonb_build_object(
    'market_id',    p_market_id,
    'result_value', p_result_value,
    'winners_paid', v_winners,
    'total_payout', v_total_paid
  );
END;
$$;
