-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0012: Community Incident Reports
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. incident_reports table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.incident_reports (
  id               UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  market_id        UUID        NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  reporter_id      UUID        NOT NULL REFERENCES public.profiles(id),
  description      TEXT        NOT NULL CHECK (length(description) BETWEEN 10 AND 500),
  proposed_outcome TEXT        NOT NULL,  -- 'yes' | 'no' | numeric string for O/U
  status           TEXT        NOT NULL DEFAULT 'voting'
                               CHECK (status IN ('voting','passed','vetoed','resolved','dismissed')),
  yes_votes        INT         NOT NULL DEFAULT 0,
  no_votes         INT         NOT NULL DEFAULT 0,
  veto_deadline    TIMESTAMPTZ,           -- set when status → 'passed'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. incident_votes table ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.incident_votes (
  report_id  UUID        NOT NULL REFERENCES public.incident_reports(id) ON DELETE CASCADE,
  user_id    UUID        NOT NULL REFERENCES public.profiles(id),
  agrees     BOOLEAN     NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (report_id, user_id)
);

-- ── 3. Indexes ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_incident_reports_market
  ON public.incident_reports(market_id);

CREATE INDEX IF NOT EXISTS idx_incident_reports_status
  ON public.incident_reports(status);

CREATE INDEX IF NOT EXISTS idx_incident_reports_veto
  ON public.incident_reports(veto_deadline)
  WHERE status = 'passed';

-- ── 4. RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.incident_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incident_votes   ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can read reports and votes
CREATE POLICY "incident_reports_read" ON public.incident_reports
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "incident_votes_read" ON public.incident_votes
  FOR SELECT TO authenticated USING (true);

-- Inserts go through SECURITY DEFINER RPCs only (no direct insert policy needed for users)
-- Service role bypasses RLS

-- ── 5. RPC: submit_incident_report ───────────────────────────────────────────
-- Inserts a new report; enforces one active report per market.
CREATE OR REPLACE FUNCTION public.submit_incident_report(
  p_market_id        UUID,
  p_reporter_id      UUID,
  p_description      TEXT,
  p_proposed_outcome TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_market  RECORD;
  v_new_id  UUID;
BEGIN
  -- Validate market exists and is resolvable
  SELECT status, market_type INTO v_market
    FROM public.markets
   WHERE id = p_market_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Market not found.';
  END IF;

  IF v_market.status NOT IN ('open', 'closed') THEN
    RAISE EXCEPTION 'Incident reports can only be filed for open or closed markets.';
  END IF;

  -- Enforce one active report per market
  IF EXISTS (
    SELECT 1 FROM public.incident_reports
    WHERE market_id = p_market_id
      AND status IN ('voting', 'passed')
  ) THEN
    RAISE EXCEPTION 'An active incident report already exists for this market.';
  END IF;

  -- Validate proposed_outcome
  IF TRIM(p_proposed_outcome) = '' THEN
    RAISE EXCEPTION 'Proposed outcome cannot be empty.';
  END IF;

  INSERT INTO public.incident_reports
    (market_id, reporter_id, description, proposed_outcome)
  VALUES
    (p_market_id, p_reporter_id, p_description, p_proposed_outcome)
  RETURNING id INTO v_new_id;

  RETURN v_new_id;
END;
$$;

-- ── 6. RPC: cast_incident_vote ────────────────────────────────────────────────
-- Upserts a vote, recomputes totals, and checks if threshold is met.
-- Threshold: total_votes >= 4 AND agree_rate >= 0.60
-- Returns { total_votes, yes_votes, no_votes, status }
CREATE OR REPLACE FUNCTION public.cast_incident_vote(
  p_report_id UUID,
  p_user_id   UUID,
  p_agrees    BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_report     RECORD;
  v_total      INT;
  v_yes        INT;
  v_agree_rate NUMERIC;
  v_new_status TEXT;
BEGIN
  -- Fetch and lock the report
  SELECT * INTO v_report
    FROM public.incident_reports
   WHERE id = p_report_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Incident report not found.';
  END IF;

  IF v_report.status != 'voting' THEN
    RAISE EXCEPTION 'This report is no longer open for voting.';
  END IF;

  -- Prevent reporter from voting on their own report
  IF v_report.reporter_id = p_user_id THEN
    RAISE EXCEPTION 'You cannot vote on your own incident report.';
  END IF;

  -- Upsert vote (change mind is allowed)
  INSERT INTO public.incident_votes (report_id, user_id, agrees)
  VALUES (p_report_id, p_user_id, p_agrees)
  ON CONFLICT (report_id, user_id)
  DO UPDATE SET agrees = EXCLUDED.agrees,
                created_at = NOW();

  -- Recompute vote totals
  SELECT COUNT(*),
         SUM(CASE WHEN agrees THEN 1 ELSE 0 END)
    INTO v_total, v_yes
    FROM public.incident_votes
   WHERE report_id = p_report_id;

  v_new_status := 'voting';

  -- Check thresholds once we have enough votes
  IF v_total >= 4 THEN
    v_agree_rate := v_yes::NUMERIC / v_total;

    IF v_agree_rate >= 0.60 THEN
      v_new_status := 'passed';
      -- Set veto deadline to 24 hours from now
      UPDATE public.incident_reports
         SET yes_votes     = v_yes,
             no_votes      = v_total - v_yes,
             status        = 'passed',
             veto_deadline = NOW() + INTERVAL '24 hours',
             updated_at    = NOW()
       WHERE id = p_report_id;

      -- Notify the admin (stored as a system notification for admin user lookup)
      -- We insert into notifications for any profile with admin context
      -- (admin reads from the admin panel; this is supplemental)

    ELSIF (v_total - v_yes)::NUMERIC / v_total > 0.60 THEN
      v_new_status := 'dismissed';
      UPDATE public.incident_reports
         SET yes_votes  = v_yes,
             no_votes   = v_total - v_yes,
             status     = 'dismissed',
             updated_at = NOW()
       WHERE id = p_report_id;

    ELSE
      -- Not enough agreement either way yet
      UPDATE public.incident_reports
         SET yes_votes  = v_yes,
             no_votes   = v_total - v_yes,
             updated_at = NOW()
       WHERE id = p_report_id;
    END IF;

  ELSE
    -- Not enough votes yet — just update counts
    UPDATE public.incident_reports
       SET yes_votes  = v_yes,
           no_votes   = v_total - v_yes,
           updated_at = NOW()
     WHERE id = p_report_id;
  END IF;

  RETURN jsonb_build_object(
    'total_votes', v_total,
    'yes_votes',   v_yes,
    'no_votes',    v_total - v_yes,
    'status',      v_new_status
  );
END;
$$;

-- ── 7. Grants ─────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.submit_incident_report(UUID, UUID, TEXT, TEXT)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public.cast_incident_vote(UUID, UUID, BOOLEAN)
  TO authenticated;
