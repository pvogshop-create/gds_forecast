-- 0022_debrand_market_content.sql
-- De-brand the seeded market content. Forecast is pivoting from "GDS Forecast"
-- (one school) to a national product, and 7 of the seeded markets still name
-- Georgetown Day School in their title or description — including one that is
-- still open.
--
-- These rows are UPDATEd in place rather than deleted: each has positions,
-- comments, reactions, and probability history referencing it, and a DELETE
-- would cascade that test bet history away and skew the leaderboards derived
-- from it.
--
-- Idempotent by construction: every UPDATE matches on the old GDS string, so a
-- second run matches zero rows. The new copy here is kept identical to
-- supabase/seed.ts so fresh environments and this database agree.

-- ── 1. Titles ─────────────────────────────────────────────────────────────────
UPDATE public.markets
   SET title = 'Will our school win the state championship this year?'
 WHERE title = 'Will GDS win the DCSAA championship this year?';

UPDATE public.markets
   SET title = 'Will the boys basketball team finish with a winning record?'
 WHERE title = 'Will the GDS boys basketball team finish with a winning record?';

UPDATE public.markets
   SET title = 'Will school be cancelled for a snow day before spring break?'
 WHERE title = 'Will GDS cancel school for a snow day before spring break?';

UPDATE public.markets
   SET title = 'Will the most-followed student account hit 1k Instagram followers?'
 WHERE title = 'Will the most-followed GDS student account hit 1k Instagram followers?';

UPDATE public.markets
   SET title = 'Will a student go viral on TikTok this semester?'
 WHERE title = 'Will a GDS student go viral on TikTok this semester?';

UPDATE public.markets
   SET title = 'Will the school host a pep rally before the end of the school year?'
 WHERE title = 'Will GDS host a pep rally before the end of the school year?';

-- ── 2. Descriptions ───────────────────────────────────────────────────────────
-- Note: 'Will the school lunch menu change...' has a clean title but a GDS
-- description, so it appears here only.
UPDATE public.markets
   SET description = 'Resolves YES if the school wins the state overall championship title before the end of the school year.'
 WHERE description = 'Resolves YES if Georgetown Day School wins the DCSAA overall championship title before the end of the school year.';

UPDATE public.markets
   SET description = 'Resolves YES if the varsity boys basketball team wins more than 50% of their regular-season games.'
 WHERE description = 'Resolves YES if the GDS varsity boys basketball team wins more than 50% of their regular-season games.';

UPDATE public.markets
   SET description = 'Resolves YES if the cafeteria introduces at least one new menu item or removes an existing staple within 30 days.'
 WHERE description = 'Resolves YES if the GDS cafeteria introduces at least one new menu item or removes an existing staple within 30 days.';

UPDATE public.markets
   SET description = 'Resolves YES if school is cancelled or delayed due to weather at least once before spring break.'
 WHERE description = 'Resolves YES if GDS cancels or delays school due to weather at least once before spring break.';

UPDATE public.markets
   SET description = 'Resolves YES if any current student''s verified personal Instagram account reaches 1,000 followers before June 1.'
 WHERE description = 'Resolves YES if any current GDS student''s verified personal Instagram account reaches 1,000 followers before June 1.';

UPDATE public.markets
   SET description = 'Resolves YES if a video by a student receives more than 500,000 views on TikTok before the end of the semester.'
 WHERE description = 'Resolves YES if a video by a GDS student receives more than 500,000 views on TikTok before the end of the semester.';

UPDATE public.markets
   SET description = 'Resolves YES if the school organizes at least one all-school pep rally before the final day of the school year.'
 WHERE description = 'Resolves YES if Georgetown Day School organizes at least one all-school pep rally before the final day of the school year.';

-- ── 3. Catch anything seeded by 0005_seed.sql that this missed ─────────────────
-- 0005 seeded a differently-worded market ('GDS wins the internal prediction
-- championship?') that is not present in this database, but would be in a fresh
-- environment where 0005 runs before this migration.
UPDATE public.markets
   SET title = 'Our team wins the internal prediction championship?'
 WHERE title = 'GDS wins the internal prediction championship?';

UPDATE public.markets
   SET description = 'Will the analytics team finish #1 on the global leaderboard by end of Q2 2026?'
 WHERE description = 'Will the GDS analytics team finish #1 on the global leaderboard by end of Q2 2026?';
