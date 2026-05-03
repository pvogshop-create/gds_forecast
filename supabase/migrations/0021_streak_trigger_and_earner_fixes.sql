-- 0021_streak_trigger_and_earner_fixes.sql
-- Code-review fixes:
--   1. Streak trigger now fires only on actual status transitions (WHEN clause)
--      so non-resolution updates skip the function entirely.
--   2. get_weekly_top_earner now joins markets and filters on markets.resolved_at
--      so bets that *resolved* this week are counted regardless of when placed.

-- ── 1. Re-bind streak trigger with a WHEN guard ───────────────────────────────
DROP TRIGGER IF EXISTS on_position_resolved ON public.positions;

CREATE TRIGGER on_position_resolved
  AFTER UPDATE ON public.positions
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.update_user_streaks();

-- ── 2. Weekly top-earner: filter on market resolution time, not bet placement ─
CREATE OR REPLACE FUNCTION public.get_weekly_top_earner()
RETURNS TABLE(
  user_id      UUID,
  weekly_earned BIGINT,
  username     TEXT,
  display_name TEXT,
  avatar_url   TEXT
)
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.user_id,
    SUM(p.payout - p.coins_wagered)::BIGINT AS weekly_earned,
    pr.username,
    pr.display_name,
    pr.avatar_url
  FROM   positions p
  JOIN   profiles  pr ON pr.id      = p.user_id
  JOIN   markets   m  ON m.id       = p.market_id
  WHERE  p.status = 'won'
    AND  m.resolved_at IS NOT NULL
    AND  m.resolved_at >= NOW() - INTERVAL '7 days'
  GROUP BY p.user_id, pr.username, pr.display_name, pr.avatar_url
  ORDER BY weekly_earned DESC
  LIMIT 1;
$$;
