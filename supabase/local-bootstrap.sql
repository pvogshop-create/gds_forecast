-- supabase/local-bootstrap.sql
--
-- Run this ONCE after `supabase start` on a fresh local instance, before the
-- E2E suite:  npm run db:local:bootstrap
--
-- ─── Why this file exists ───────────────────────────────────────────────────
--
-- This is NOT a migration and must never become one. It does not change the
-- schema; it reproduces locally the *project provisioning* that the hosted
-- Supabase project already has, so that local and prod behave identically.
--
-- The problem: recent Supabase local images ship a restrictive default ACL,
--
--   pg_default_acl → owner=postgres, schema=public, tables:
--     anon=Dxtm  authenticated=Dxtm  service_role=Dxtm
--
-- i.e. TRUNCATE/REFERENCES/TRIGGER/MAINTAIN but *no* SELECT, INSERT, UPDATE or
-- DELETE. Tables in `public` are owned by `postgres`, so that ACL is the one
-- that applies to every table this repo's migrations create. The result on a
-- fresh `supabase start` + `supabase migration up`:
--
--   $ curl .../rest/v1/markets -H "apikey: <anon>"
--   {"code":"42501","message":"permission denied for table markets"}
--
-- ...and the same for the service-role key. The entire app is dead locally,
-- including seeding, while working fine in production — because the hosted
-- project was provisioned back when Supabase granted these privileges to the
-- three API roles by default. None of this repo's migrations ever needed to
-- grant them, so nothing in version control captures the dependency.
--
-- ─── Why grants, not policies ───────────────────────────────────────────────
--
-- GRANTs are coarse table-level plumbing; RLS is the actual access control.
-- Every table here has RLS ENABLED (0003, 0012, 0014, 0016, 0017, 0019), so
-- granting `anon`/`authenticated` full DML does not widen access by one row —
-- each statement is still filtered by policy. This is precisely Supabase's
-- long-standing default posture. Removing the grants would not harden anything;
-- it would just break the client.
--
-- ─── This is NOT a migration, and that is a decision ────────────────────────
--
-- Settled 2026-07-30: this stays a one-time local bootstrap step and must not be
-- promoted into `supabase/migrations/`.
--
-- The reasoning: these GRANTs are *project provisioning*, not schema. Production
-- already has them — they were the Supabase default when that project was
-- created — so a migration would be a permanent no-op there while implying the
-- app's schema depends on something it does not. Keeping it separate also keeps
-- the migration sequence reserved for real design changes.
--
-- The tradeoff accepted: a fresh local database needs one manual step
-- (`npm run db:local:bootstrap`). E2E global setup detects the exact 42501
-- failure and names that command, so the cost is one clear error message once
-- per machine. See TESTING.md § "Local environment parity".
--
-- Safe to re-run: GRANT is idempotent.

-- ─── Existing objects ───────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES  IN SCHEMA public TO anon, authenticated, service_role;

-- ─── Future objects ─────────────────────────────────────────────────────────
-- Without these, the next migration that adds a table reintroduces the bug
-- (0025 `circles` / `circle_members` would land unreadable).
--
-- Only the `postgres`-owned default ACL is touched: that is the restrictive one,
-- and `postgres` owns everything `supabase migration up` creates.
-- `supabase_admin`'s default ACL is already `arwdDxtm` for all three roles, and
-- `postgres` is not permitted to change another role's defaults anyway
-- ("ERROR: permission denied to change default privileges"), so there is
-- nothing to do — and nothing that needs doing — for that role.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
