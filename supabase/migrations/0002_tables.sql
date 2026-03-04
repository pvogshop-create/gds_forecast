-- 0002_tables.sql
-- Core schema: all tables, triggers, and indexes

-- ─── PROFILES ───────────────────────────────────────────────────────────────
-- One row per auth.users user. Auto-created by trigger on signup.
CREATE TABLE public.profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT UNIQUE,                         -- null until onboarding
  display_name  TEXT,
  avatar_url    TEXT,
  coins         INTEGER NOT NULL DEFAULT 1000,       -- starting balance (coins)
  total_bets    INTEGER NOT NULL DEFAULT 0,
  wins          INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger: auto-create profile row when user signs up via Google OAuth
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.email),
    NEW.raw_user_meta_data ->> 'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;  -- idempotent
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ─── MARKETS ────────────────────────────────────────────────────────────────
CREATE TYPE public.market_category AS ENUM (
  'sports',
  'social',
  'actions',
  'trending'
);

CREATE TYPE public.market_status AS ENUM (
  'open',           -- accepting bets
  'closed',         -- no new bets, awaiting resolution
  'resolved_yes',
  'resolved_no',
  'cancelled'
);

CREATE TABLE public.markets (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  category        public.market_category NOT NULL,
  status          public.market_status NOT NULL DEFAULT 'open',

  -- CPMM pool state. Seeded at 100 each = 50/50 starting probability.
  yes_pool        NUMERIC(14, 2) NOT NULL DEFAULT 100.00,
  no_pool         NUMERIC(14, 2) NOT NULL DEFAULT 100.00,

  -- Stored probability, kept in sync via trigger (fast reads, no recalc in app)
  yes_probability NUMERIC(6, 4) NOT NULL DEFAULT 0.5000,

  -- Resolution
  resolution_date TIMESTAMPTZ,        -- market closes to bets at this time
  resolved_at     TIMESTAMPTZ,
  resolved_by     UUID REFERENCES public.profiles(id),
  resolution_note TEXT,

  -- Metadata
  creator_id      UUID NOT NULL REFERENCES public.profiles(id),
  is_featured     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger: recalculate yes_probability whenever pool balances change
CREATE OR REPLACE FUNCTION public.sync_market_probability()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.yes_pool + NEW.no_pool > 0 THEN
    NEW.yes_probability := NEW.yes_pool / (NEW.yes_pool + NEW.no_pool);
  END IF;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER market_probability_sync
  BEFORE UPDATE OF yes_pool, no_pool ON public.markets
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_market_probability();

-- ─── POSITIONS ──────────────────────────────────────────────────────────────
CREATE TYPE public.position_side AS ENUM ('yes', 'no');
CREATE TYPE public.position_status AS ENUM ('open', 'won', 'lost', 'cancelled');

CREATE TABLE public.positions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id     UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  side          public.position_side NOT NULL,
  coins_wagered INTEGER NOT NULL,                   -- coins spent (integer)
  shares_bought NUMERIC(14, 6) NOT NULL,            -- CPMM shares received
  price_at_bet  NUMERIC(6, 4) NOT NULL,              -- probability at time of bet
  status        public.position_status NOT NULL DEFAULT 'open',
  payout        INTEGER,                             -- null until resolved
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX positions_user_id_idx   ON public.positions(user_id);
CREATE INDEX positions_market_id_idx ON public.positions(market_id);
CREATE INDEX positions_status_idx    ON public.positions(status);

-- ─── MARKET PROBABILITY HISTORY ─────────────────────────────────────────────
-- Snapshot after every bet — used for the probability line chart
CREATE TABLE public.market_probability_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  market_id       UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  yes_probability NUMERIC(6, 4) NOT NULL,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX mph_market_id_idx    ON public.market_probability_history(market_id);
CREATE INDEX mph_recorded_at_idx  ON public.market_probability_history(recorded_at DESC);

-- ─── MARKET SUGGESTIONS ─────────────────────────────────────────────────────
CREATE TYPE public.suggestion_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE public.market_suggestions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  category    public.market_category NOT NULL,
  status      public.suggestion_status NOT NULL DEFAULT 'pending',
  admin_note  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX suggestions_user_id_idx ON public.market_suggestions(user_id);
CREATE INDEX suggestions_status_idx  ON public.market_suggestions(status);

-- ─── LEAGUES ────────────────────────────────────────────────────────────────
CREATE TABLE public.leagues (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  description TEXT,
  creator_id  UUID NOT NULL REFERENCES public.profiles(id),
  invite_code TEXT UNIQUE DEFAULT upper(substr(md5(random()::text), 1, 6)),
  is_public   BOOLEAN NOT NULL DEFAULT FALSE,
  max_members INTEGER NOT NULL DEFAULT 20,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX leagues_creator_id_idx ON public.leagues(creator_id);

CREATE TABLE public.league_members (
  league_id  UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',   -- 'owner' | 'member'
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (league_id, user_id)
);

CREATE INDEX league_members_user_id_idx ON public.league_members(user_id);

-- ─── NOTIFICATIONS ──────────────────────────────────────────────────────────
CREATE TYPE public.notification_type AS ENUM (
  'bet_placed',
  'market_resolved',
  'payout_received',
  'suggestion_approved',
  'suggestion_rejected',
  'league_joined',
  'league_invite'
);

CREATE TABLE public.notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type        public.notification_type NOT NULL,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  data        JSONB,                              -- { market_id, league_id, ... }
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX notifications_user_id_idx  ON public.notifications(user_id);
CREATE INDEX notifications_is_read_idx  ON public.notifications(is_read);
CREATE INDEX notifications_created_idx  ON public.notifications(created_at DESC);

-- ─── ACTIVITY FEED ──────────────────────────────────────────────────────────
-- Append-only event log for the social feed
CREATE TABLE public.activity_feed (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,   -- 'bet_yes' | 'bet_no' | 'market_won' | 'league_joined' | ...
  market_id   UUID REFERENCES public.markets(id) ON DELETE SET NULL,
  league_id   UUID REFERENCES public.leagues(id) ON DELETE SET NULL,
  data        JSONB,            -- { coins_wagered, probability, market_title, ... }
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX activity_feed_user_id_idx    ON public.activity_feed(user_id);
CREATE INDEX activity_feed_market_id_idx  ON public.activity_feed(market_id);
CREATE INDEX activity_feed_created_at_idx ON public.activity_feed(created_at DESC);
