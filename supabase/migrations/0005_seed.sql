-- 0005_seed.sql
-- Example markets for initial app population.
-- Run this AFTER creating your admin user and replacing ADMIN_USER_ID below.
--
-- Usage: Replace 'ADMIN_USER_ID_HERE' with the UUID from auth.users for your admin.
-- Run via: supabase db execute --file supabase/migrations/0005_seed.sql
--   OR run seed.ts which handles the UUID lookup automatically.

-- Temporarily grant insert for seed (this migration runs as service_role)
DO $$
DECLARE
  v_admin_id UUID;
BEGIN
  -- Look up admin by email (set ADMIN_EMAIL env var before running)
  -- If running manually, replace the email below with your admin email.
  SELECT id INTO v_admin_id
  FROM auth.users
  WHERE email = current_setting('app.admin_email', true)
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    RAISE NOTICE 'Admin user not found — skipping seed. Run seed.ts after first login.';
    RETURN;
  END IF;

  -- Insert seed markets
  INSERT INTO public.markets (title, description, category, yes_pool, no_pool, is_featured, creator_id, resolution_date)
  VALUES
    (
      'Chiefs win Super Bowl LX?',
      'Will the Kansas City Chiefs win Super Bowl LX in the 2025-26 NFL season?',
      'sports',
      450.00, 150.00,
      TRUE,
      v_admin_id,
      NOW() + INTERVAL '60 days'
    ),
    (
      'Bitcoin above $150K by end of 2026?',
      'Will BTC close above $150,000 on any day before January 1, 2027?',
      'actions',
      300.00, 500.00,
      TRUE,
      v_admin_id,
      NOW() + INTERVAL '300 days'
    ),
    (
      'Zendaya & Tom Holland engaged by 2027?',
      'Will Zendaya and Tom Holland publicly announce their engagement before Jan 1, 2027?',
      'social',
      500.00, 500.00,
      FALSE,
      v_admin_id,
      NOW() + INTERVAL '300 days'
    ),
    (
      'OpenAI launches GPT-5 by Q2 2026?',
      'Will OpenAI publicly release a model branded as GPT-5 before July 1, 2026?',
      'actions',
      650.00, 350.00,
      TRUE,
      v_admin_id,
      NOW() + INTERVAL '120 days'
    ),
    (
      'USA Women''s Hockey Gold — 2026 Winter Olympics?',
      'Will the USA Women''s Ice Hockey team win gold at the 2026 Winter Olympics?',
      'sports',
      600.00, 400.00,
      TRUE,
      v_admin_id,
      NOW() + INTERVAL '45 days'
    ),
    (
      'Fed cuts interest rates before June 2026?',
      'Will the Federal Reserve reduce the federal funds rate at least once before June 30, 2026?',
      'actions',
      610.00, 390.00,
      FALSE,
      v_admin_id,
      NOW() + INTERVAL '90 days'
    ),
    (
      'GDS wins the internal prediction championship?',
      'Will the GDS analytics team finish #1 on the global leaderboard by end of Q2 2026?',
      'trending',
      500.00, 500.00,
      FALSE,
      v_admin_id,
      NOW() + INTERVAL '90 days'
    );

  -- Seed initial probability history (one snapshot per market)
  INSERT INTO public.market_probability_history (market_id, yes_probability)
  SELECT id, yes_probability FROM public.markets WHERE creator_id = v_admin_id;

  RAISE NOTICE 'Seed data inserted successfully for admin: %', v_admin_id;
END;
$$;
