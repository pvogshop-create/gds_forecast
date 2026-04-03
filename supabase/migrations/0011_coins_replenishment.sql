-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 0011: Daily Bonus + Referral System
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Add new columns to profiles ──────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_daily_claim  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS referral_code     TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referral_count    INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referred_by       UUID REFERENCES public.profiles(id);

-- ── 2. Back-fill referral codes for existing profiles ───────────────────────
UPDATE public.profiles
SET referral_code = UPPER(SUBSTRING(MD5(gen_random_uuid()::TEXT), 1, 8))
WHERE referral_code IS NULL;

-- ── 3. Trigger function: auto-generate referral code on insert ───────────────
CREATE OR REPLACE FUNCTION public.set_referral_code()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.referral_code IS NULL THEN
    NEW.referral_code := UPPER(SUBSTRING(MD5(gen_random_uuid()::TEXT), 1, 8));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_referral_code ON public.profiles;
CREATE TRIGGER trg_set_referral_code
  BEFORE INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_referral_code();

-- ── 4. RPC: claim_daily_bonus ────────────────────────────────────────────────
-- Awards a random 50–150 coins once per 24 hours.
-- Returns { award: N, coins_after: M }
CREATE OR REPLACE FUNCTION public.claim_daily_bonus(p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_profile   RECORD;
  v_award     INT;
  v_new_coins INT;
BEGIN
  SELECT coins, last_daily_claim
    INTO v_profile
    FROM public.profiles
   WHERE id = p_user_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found.';
  END IF;

  -- Enforce 24-hour cooldown
  IF v_profile.last_daily_claim IS NOT NULL AND
     NOW() - v_profile.last_daily_claim < INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'Daily bonus already claimed. Try again later.';
  END IF;

  -- Random award: 50–150 coins
  v_award := 50 + FLOOR(RANDOM() * 101)::INT;

  UPDATE public.profiles
     SET coins            = coins + v_award,
         last_daily_claim = NOW(),
         updated_at       = NOW()
   WHERE id = p_user_id
   RETURNING coins INTO v_new_coins;

  RETURN jsonb_build_object('award', v_award, 'coins_after', v_new_coins);
END;
$$;

-- ── 5. RPC: record_referral ──────────────────────────────────────────────────
-- Called once when a new user signs up via a referral link.
-- Awards +500 coins to the referrer per successful referral (linear).
-- Idempotent: no-op if new user already has referred_by set.
CREATE OR REPLACE FUNCTION public.record_referral(
  p_new_user_id  UUID,
  p_referral_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_referrer_id UUID;
BEGIN
  -- Guard: already referred
  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE id = p_new_user_id AND referred_by IS NOT NULL
  ) THEN
    RETURN;
  END IF;

  -- Look up referrer by code
  SELECT id INTO v_referrer_id
    FROM public.profiles
   WHERE referral_code = p_referral_code
     AND id <> p_new_user_id;  -- can't refer yourself

  IF v_referrer_id IS NULL THEN
    RETURN;  -- invalid or self-referral code — silently ignore
  END IF;

  -- Record who referred this user
  UPDATE public.profiles
     SET referred_by  = v_referrer_id,
         updated_at   = NOW()
   WHERE id = p_new_user_id;

  -- Award +500 coins to referrer and increment their count
  UPDATE public.profiles
     SET coins          = coins + 500,
         referral_count = referral_count + 1,
         updated_at     = NOW()
   WHERE id = v_referrer_id;

  -- Notify the referrer
  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_referrer_id,
    'league_joined',  -- reuse existing type (closest semantic match)
    'Friend joined using your link!',
    'You earned 500 coins for referring a new member.',
    jsonb_build_object('type', 'referral', 'new_user_id', p_new_user_id)
  );
END;
$$;

-- ── 6. Grant execute to authenticated users ──────────────────────────────────
GRANT EXECUTE ON FUNCTION public.claim_daily_bonus(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_referral(UUID, TEXT) TO service_role;
