-- 0017_league_system.sql
-- Adds competitive weekly buy-in pool system to leagues.
-- Each week: buy-in collected → players tag bets → highest gross payout wins pool.
-- Golf scoring: 1st = 1 pt, 2nd = 2 pts, … (cumulative lower is better).

-- ─── 1. Extend existing tables ─────────────────────────────────────────────────

ALTER TABLE public.leagues
  ADD COLUMN IF NOT EXISTS buy_in_coins    INTEGER      NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS week_start_date TIMESTAMPTZ,            -- NULL = no schedule yet
  ADD COLUMN IF NOT EXISTS carry_over_pool INTEGER      NOT NULL DEFAULT 0;

ALTER TABLE public.league_members
  ADD COLUMN IF NOT EXISTS total_points INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS weeks_played INTEGER NOT NULL DEFAULT 0;

-- ─── 2. league_weeks ───────────────────────────────────────────────────────────

CREATE TABLE public.league_weeks (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  league_id   UUID        NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  week_number INTEGER     NOT NULL,
  week_start  TIMESTAMPTZ NOT NULL,
  week_end    TIMESTAMPTZ NOT NULL,
  pool_coins  INTEGER     NOT NULL DEFAULT 0,
  status      TEXT        NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active', 'completed', 'rolled_over')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (league_id, week_number)
);

CREATE INDEX league_weeks_league_status_idx ON public.league_weeks (league_id, status);

-- ─── 3. league_week_participants ───────────────────────────────────────────────

CREATE TABLE public.league_week_participants (
  week_id      UUID    NOT NULL REFERENCES public.league_weeks(id)  ON DELETE CASCADE,
  user_id      UUID    NOT NULL REFERENCES public.profiles(id)       ON DELETE CASCADE,
  league_id    UUID    NOT NULL REFERENCES public.leagues(id)        ON DELETE CASCADE,
  buy_in_paid  INTEGER NOT NULL,
  gross_payout INTEGER NOT NULL DEFAULT 0,
  points       INTEGER,                        -- golf rank, NULL until week closes
  PRIMARY KEY (week_id, user_id)
);

CREATE INDEX lwp_week_idx ON public.league_week_participants (week_id);

-- ─── 4. league_bets ────────────────────────────────────────────────────────────
-- One position can be tagged to at most one league (PK enforces this).

CREATE TABLE public.league_bets (
  position_id UUID NOT NULL REFERENCES public.positions(id)    ON DELETE CASCADE,
  league_id   UUID NOT NULL REFERENCES public.leagues(id)      ON DELETE CASCADE,
  week_id     UUID NOT NULL REFERENCES public.league_weeks(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES public.profiles(id)     ON DELETE CASCADE,
  PRIMARY KEY (position_id, league_id)
);

CREATE INDEX lb_week_user_idx ON public.league_bets (week_id, user_id);

-- ─── 5. RLS ────────────────────────────────────────────────────────────────────

ALTER TABLE public.league_weeks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_week_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.league_bets              ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lw_select"
  ON public.league_weeks FOR SELECT TO authenticated
  USING (league_id IN (
    SELECT league_id FROM public.league_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "lwp_select"
  ON public.league_week_participants FOR SELECT TO authenticated
  USING (league_id IN (
    SELECT league_id FROM public.league_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "lb_select"
  ON public.league_bets FOR SELECT TO authenticated
  USING (league_id IN (
    SELECT league_id FROM public.league_members WHERE user_id = auth.uid()
  ));

CREATE POLICY "lb_insert"
  ON public.league_bets FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ─── 6. start_league_week() ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.start_league_week(p_league_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_league            public.leagues%ROWTYPE;
  v_prev_week_number  INTEGER;
  v_new_week_number   INTEGER;
  v_week_start        TIMESTAMPTZ;
  v_week_end          TIMESTAMPTZ;
  v_week_id           UUID;
  v_pool_coins        INTEGER;
  v_participant_count INTEGER := 0;
  v_member            RECORD;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: start_league_week may only be called by service_role.';
  END IF;

  SELECT * INTO v_league
  FROM public.leagues
  WHERE id = p_league_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'League not found: %', p_league_id;
  END IF;

  IF v_league.week_start_date IS NULL THEN
    RAISE EXCEPTION 'League % has no week_start_date set.', p_league_id;
  END IF;

  -- Determine next week number
  SELECT COALESCE(MAX(week_number), 0)
  INTO v_prev_week_number
  FROM public.league_weeks
  WHERE league_id = p_league_id;

  v_new_week_number := v_prev_week_number + 1;

  -- Compute start/end based on the anchor date
  v_week_start := v_league.week_start_date
                  + ((v_new_week_number - 1) * INTERVAL '7 days');
  v_week_end   := v_week_start + INTERVAL '7 days';

  -- Carry-over pool from rolled-over weeks
  v_pool_coins := v_league.carry_over_pool;

  -- Reset carry_over_pool on the league
  UPDATE public.leagues
  SET carry_over_pool = 0, updated_at = NOW()
  WHERE id = p_league_id;

  -- Insert the week record (pool updated after collecting buy-ins)
  INSERT INTO public.league_weeks (league_id, week_number, week_start, week_end, pool_coins, status)
  VALUES (p_league_id, v_new_week_number, v_week_start, v_week_end, 0, 'active')
  RETURNING id INTO v_week_id;

  -- Collect buy-ins from all members who can afford it
  FOR v_member IN
    SELECT lm.user_id
    FROM public.league_members lm
    JOIN public.profiles p ON p.id = lm.user_id
    WHERE lm.league_id = p_league_id
      AND p.coins >= v_league.buy_in_coins
  LOOP
    UPDATE public.profiles
    SET coins      = coins - v_league.buy_in_coins,
        updated_at = NOW()
    WHERE id = v_member.user_id;

    INSERT INTO public.league_week_participants (week_id, user_id, league_id, buy_in_paid)
    VALUES (v_week_id, v_member.user_id, p_league_id, v_league.buy_in_coins);

    v_pool_coins        := v_pool_coins + v_league.buy_in_coins;
    v_participant_count := v_participant_count + 1;
  END LOOP;

  -- Write final pool (carry-over + buy-ins collected)
  UPDATE public.league_weeks
  SET pool_coins = v_pool_coins
  WHERE id = v_week_id;

  RETURN jsonb_build_object(
    'week_id',      v_week_id,
    'week_number',  v_new_week_number,
    'week_start',   v_week_start,
    'week_end',     v_week_end,
    'participants', v_participant_count,
    'pool_coins',   v_pool_coins
  );
END;
$$;

-- ─── 7. close_league_week() ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.close_league_week(p_week_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week            public.league_weeks%ROWTYPE;
  v_league          public.leagues%ROWTYPE;
  v_max_payout      INTEGER;
  v_winner          RECORD;
  v_winner_count    INTEGER;
  v_payout_share    INTEGER;
  v_remainder       INTEGER;
  v_first_winner    UUID;
BEGIN
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized: close_league_week may only be called by service_role.';
  END IF;

  SELECT * INTO v_week
  FROM public.league_weeks
  WHERE id = p_week_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Week not found: %', p_week_id;
  END IF;

  IF v_week.status != 'active' THEN
    RAISE EXCEPTION 'Week % is not active (status: %).', p_week_id, v_week.status;
  END IF;

  SELECT * INTO v_league
  FROM public.leagues
  WHERE id = v_week.league_id;

  -- ── Compute gross_payout for each participant ──────────────────────────────
  -- gross_payout = sum of payout from winning positions that:
  --   (a) are tagged to this league + week
  --   (b) resolved during this week's window
  UPDATE public.league_week_participants lwp
  SET gross_payout = COALESCE((
    SELECT SUM(pos.payout)
    FROM public.league_bets lb
    JOIN public.positions pos ON pos.id = lb.position_id
    JOIN public.markets   mkt ON mkt.id = pos.market_id
    WHERE lb.week_id  = p_week_id
      AND lb.user_id  = lwp.user_id
      AND pos.status  = 'won'
      AND mkt.resolved_at BETWEEN v_week.week_start AND v_week.week_end
  ), 0)
  WHERE lwp.week_id = p_week_id;

  -- ── Check whether anyone had qualifying payouts ────────────────────────────
  SELECT COALESCE(MAX(gross_payout), 0)
  INTO v_max_payout
  FROM public.league_week_participants
  WHERE week_id = p_week_id;

  IF v_max_payout = 0 THEN
    -- Roll over: carry pool to next week
    UPDATE public.leagues
    SET carry_over_pool = carry_over_pool + v_week.pool_coins,
        updated_at      = NOW()
    WHERE id = v_week.league_id;

    UPDATE public.league_weeks
    SET status = 'rolled_over'
    WHERE id = p_week_id;

    RETURN jsonb_build_object(
      'status',     'rolled_over',
      'pool_coins', v_week.pool_coins
    );
  END IF;

  -- ── Assign golf-style points via RANK() ────────────────────────────────────
  -- RANK() gives competition ranking: ties share same rank, next rank skips.
  WITH ranked AS (
    SELECT user_id,
           RANK() OVER (ORDER BY gross_payout DESC) AS r
    FROM public.league_week_participants
    WHERE week_id = p_week_id
  )
  UPDATE public.league_week_participants lwp
  SET points = r.r
  FROM ranked r
  WHERE lwp.week_id = p_week_id AND lwp.user_id = r.user_id;

  -- ── Update cumulative league_members standings ─────────────────────────────
  UPDATE public.league_members lm
  SET total_points = total_points + lwp.points,
      weeks_played = weeks_played + 1
  FROM public.league_week_participants lwp
  WHERE lwp.week_id  = p_week_id
    AND lm.league_id = v_week.league_id
    AND lm.user_id   = lwp.user_id;

  -- ── Pay out pool to winner(s) (points = 1) ────────────────────────────────
  SELECT COUNT(*) INTO v_winner_count
  FROM public.league_week_participants
  WHERE week_id = p_week_id AND points = 1;

  v_payout_share := v_week.pool_coins / v_winner_count;
  v_remainder    := v_week.pool_coins - (v_payout_share * v_winner_count);
  v_first_winner := NULL;

  FOR v_winner IN
    SELECT user_id
    FROM public.league_week_participants
    WHERE week_id = p_week_id AND points = 1
    ORDER BY user_id   -- deterministic ordering for remainder assignment
  LOOP
    IF v_first_winner IS NULL THEN
      v_first_winner := v_winner.user_id;
    END IF;

    UPDATE public.profiles
    SET coins      = coins + v_payout_share,
        updated_at = NOW()
    WHERE id = v_winner.user_id;

    INSERT INTO public.notifications (user_id, type, title, body, data)
    VALUES (
      v_winner.user_id,
      'league_win',
      'You won this week! 🏆',
      format(
        'You won Week %s of "%s" and earned %s coins.',
        v_week.week_number,
        v_league.name,
        v_payout_share
      ),
      jsonb_build_object(
        'league_id',   v_week.league_id,
        'week_id',     p_week_id,
        'week_number', v_week.week_number,
        'payout',      v_payout_share
      )
    );
  END LOOP;

  -- Give any rounding remainder to the first winner
  IF v_remainder > 0 AND v_first_winner IS NOT NULL THEN
    UPDATE public.profiles
    SET coins = coins + v_remainder
    WHERE id = v_first_winner;
  END IF;

  -- ── Mark week completed ────────────────────────────────────────────────────
  UPDATE public.league_weeks
  SET status = 'completed'
  WHERE id = p_week_id;

  RETURN jsonb_build_object(
    'status',           'completed',
    'pool_coins',       v_week.pool_coins,
    'winner_count',     v_winner_count,
    'payout_per_winner', v_payout_share
  );
END;
$$;

-- ─── 8. get_live_week_scores() ─────────────────────────────────────────────────
-- Read-only version of the scoring query used for the live standings display.
-- Callable by authenticated users (members of the league).

CREATE OR REPLACE FUNCTION public.get_live_week_scores(p_week_id UUID)
RETURNS TABLE (user_id UUID, gross_payout BIGINT)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    lwp.user_id,
    COALESCE(SUM(CASE WHEN pos.status = 'won' THEN pos.payout ELSE 0 END), 0) AS gross_payout
  FROM public.league_week_participants lwp
  LEFT JOIN public.league_bets lb
         ON lb.week_id = p_week_id AND lb.user_id = lwp.user_id
  LEFT JOIN public.positions pos ON pos.id = lb.position_id
  LEFT JOIN public.markets   mkt ON mkt.id = pos.market_id
         AND mkt.resolved_at BETWEEN (
               SELECT week_start FROM public.league_weeks WHERE id = p_week_id
             ) AND NOW()
  WHERE lwp.week_id = p_week_id
  GROUP BY lwp.user_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_live_week_scores(UUID) TO authenticated;
