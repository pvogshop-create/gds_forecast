-- 0020_streaks_and_trending.sql
-- Adds win_streak / loss_streak to profiles with an auto-update trigger,
-- and an RPC to fetch the top weekly earner.

-- ── 1. Streak columns ─────────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS win_streak  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS loss_streak INT NOT NULL DEFAULT 0;

-- ── 2. Trigger function ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_user_streaks()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'won' AND (OLD.status IS DISTINCT FROM 'won') THEN
    UPDATE profiles
    SET win_streak  = win_streak + 1,
        loss_streak = 0
    WHERE id = NEW.user_id;

  ELSIF NEW.status = 'lost' AND (OLD.status IS DISTINCT FROM 'lost') THEN
    UPDATE profiles
    SET loss_streak = loss_streak + 1,
        win_streak  = 0
    WHERE id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop-and-recreate so re-running the migration is idempotent
DROP TRIGGER IF EXISTS on_position_resolved ON public.positions;

CREATE TRIGGER on_position_resolved
  AFTER UPDATE ON public.positions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_user_streaks();

-- ── 3. Weekly top-earner RPC ──────────────────────────────────────────────────
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
    SUM(p.payout - p.cost)::BIGINT AS weekly_earned,
    pr.username,
    pr.display_name,
    pr.avatar_url
  FROM   positions p
  JOIN   profiles  pr ON pr.id = p.user_id
  WHERE  p.status = 'won'
    AND  p.updated_at >= NOW() - INTERVAL '7 days'
  GROUP BY p.user_id, pr.username, pr.display_name, pr.avatar_url
  ORDER BY weekly_earned DESC
  LIMIT 1;
$$;
