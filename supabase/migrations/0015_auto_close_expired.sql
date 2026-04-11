-- 0015_auto_close_expired.sql
-- Adds close_expired_markets() — moves past-deadline open markets to 'closed'
-- so they appear in the Completed tab rather than cluttering the Active feed.
-- Called at the top of each dashboard page server render.

CREATE OR REPLACE FUNCTION public.close_expired_markets()
RETURNS INTEGER  -- returns count of markets closed
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  UPDATE public.markets
  SET status     = 'closed',
      updated_at = NOW()
  WHERE status          = 'open'
    AND resolution_date IS NOT NULL
    AND resolution_date < NOW();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Allow authenticated users to call this function (it only changes market status,
-- not financial data, and the SECURITY DEFINER ensures it runs as the owner).
GRANT EXECUTE ON FUNCTION public.close_expired_markets() TO authenticated;
