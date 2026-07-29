# Forecast — Tier Refactor Execution Plan

## Context

Forecast is a play-money prediction market for teenagers, mid-pivot from a single-school app
("GDS Forecast") into a national product organized around a **three-tier visibility model**
(Public / Circle / League). The data-model spec (`docs/forecast-data-model-spec.md`) defines the
target schema; migrations `0001–0022` are applied and `0023` (de-trending) is next in sequence.

**The headline finding: the next step is not 0023.**

Every migration from here is gated on a verification harness that spec §10 treats as mandatory and
that **does not exist**. The repo has exactly two test files (`src/__tests__/utils.test.ts`,
`src/__tests__/market-logic.test.ts`) — both pure unit tests of math helpers. There is no
authenticated-client RLS harness, no test-user matrix, and no betting-loop regression script.

That gap matters because of what's coming. Migration **0026 (tier-aware RLS)** is the one that, if
wrong, leaks private league and circle markets between teenagers — and per spec §10.1 it fails
**silently**: no exception, no build error, no type error. A too-permissive policy looks identical
to a correct one until someone screenshots a market they were never meant to see. The only way to
catch it is to run queries as different authenticated users and assert both what they *can* and
*cannot* read. Writing that harness after 0026 defeats its purpose.

**What unblocks this now:** CLAUDE.md states "Docker is not installed," and that note is stale —
Docker Desktop 4.84.0 is installed with the daemon running (`docker version` reports
`Server: Docker Desktop 4.84.0`, engine 29.6.2). That makes `supabase start` viable, which restores
the fast local rung of the spec's testing ladder. The entire verification strategy has been shaped
around a constraint that no longer applies.

So the plan is: **build the harness first (Phase A), rehearse the full protocol on the cheap
migration (0023, Phase B), then drive the tier migrations through it** — with the RLS tests written
red *before* 0026's policies exist.

### Decisions taken (from planning Q&A)

- **Ladder:** local (`supabase start`) → prod for now; prod holds only disposable seeded test data.
  A separate staging project becomes a hard gate before real users arrive (end of Phase D).
- **`/dashboard/trending` route stays.** 0023 drops only the enum value. The route is the home feed
  and does not filter by category; renaming it is spec §11 nav work.
- **The "Hot Streak" / "Cold Streak" Stat Leader cards must be preserved.** They read
  `profiles.win_streak` / `loss_streak` and are unrelated to the `trending` enum — 0023 does not
  touch that page, and Chunk B2 verifies they still render.
- **Plan covers the full arc** (0023 → 0032 → nav), fully chunked end to end: every phase is broken
  into 30–60 minute units with its own done-criteria. Later chunks (E onward) will still want
  refinement once the tier surface is real, but each is sized and scoped.

### Live state verified against prod (`curtlcoxtnoxljzkrlms`)

| | |
|---|---|
| Markets | 11 total — 6 `actions`, 2 `sports`, 2 `social`, **1 `trending`** |
| Suggestions | 11 total — **1 `trending`** |
| Positions | 20 · Profiles 10 · Leagues 8 · Comments 4 |
| Migration ledger | 22 matched local/remote pairs |

The de-trending data migration touches exactly **two rows**. It is a genuinely cheap dress rehearsal.

---

## Findings to fix along the way

These are real defects in the project's own docs and conventions, found while reading. Each is
folded into a chunk rather than filed as a suggestion.

1. **CLAUDE.md: "Docker is not installed" is false.** It has been steering the project away from
   local testing. → Chunk 0.
2. **Spec §10.7 per-migration blocks are numbered off-by-one.** §7 was renumbered +1 on 2026-07-29
   when 0022 was consumed by the de-brand, but §10.7's headers were not. The block labeled
   "0022 — De-trending" is 0023's verification; "0025 — Tier-aware RLS (the critical one)" is
   actually 0026. Following §10.7 by its headers applies the wrong test block to every migration.
   → Chunk 0.
3. **CLAUDE.md's "0023 also deletes the `/dashboard/trending` route" is wrong.** That route is the
   post-login home feed — `proxy.ts:58,66`, `app/page.tsx:12`, `api/auth/callback/route.ts:12,16`,
   `(auth)/login/page.tsx:16`, `(auth)/onboarding/page.tsx:11`, `OnboardingForm.tsx:70`,
   `lib/auth.ts:37`, `Sidebar.tsx:25,70`, `BottomTabBar.tsx:9` all target it, and the page never
   filters on `category`. Deleting it in 0023 breaks auth routing for zero benefit. → Chunk 0
   (correct the note); the rename lands in Phase H.
4. **`src/types/database.ts` is hand-written, not generated.** Its header says "Manual TypeScript
   types matching the Supabase schema." It exports app-shaped types (`MarketCategory`, `Profile`,
   `Market`, …) that every import depends on. CLAUDE.md and spec §10.5 both instruct
   `npx supabase gen types typescript` after each migration — which emits a completely different
   `Database` interface shape and would break the app wholesale. → Chunk 0 corrects the convention
   to *hand-update*, with generated output written to a separate file as a cross-check only.
5. **Six dev/test leagues remain in prod** — "Test 1"–"Test 4", a duplicate "Forecasters", and
   "Fantasy leauge" (sic). Spec §7 lists deleting these as outstanding De-GDS cleanup. → Chunk B3.
6. **The "Edit profile" button is a dead link.**
   `src/app/(app)/profile/[username]/page.tsx:111` links to `/profile/[username]/edit`, which has no
   route — the directory holds only `page.tsx` and `loading.tsx`. It renders whenever `isOwnProfile`,
   so every user gets a 404 button on their own profile. Violates the repo's "never ship a button
   that does nothing" rule. → Chunk G6, alongside the `bio` column that the edit form needs anyway.

---

## Phase A — Verification foundation

*The actual next step. Nothing here changes the schema; it builds the thing that makes every later
schema change safe.*

### Chunk A1 — Stand up local Supabase (45 min)

- `npx supabase init` from the repo root — creates the missing `supabase/config.toml`
  (it has never existed; the project is linked via `supabase/.temp/linked-project.json`).
- `npx supabase start`. First run pulls images; expect it to be the slow one.
- Record the local API URL, anon key, and service-role key it prints.
- Add `.env.test.local` (gitignored) holding the **local** keys. RLS tests must never point at prod.
- Confirm `supabase/config.toml` didn't clobber the existing link; `npx supabase migration list`
  should still show the 22 remote pairs.

**Done when:** `supabase status` reports all services running and Studio loads at `localhost:54323`.

### Chunk A2 — Prove the migration history replays clean (45 min)

- `npx supabase db reset` — replays `0001`→`0022` against the fresh local DB.
- This is the first time the full history has ever run start-to-finish (0001–0021 were originally
  hand-applied via the dashboard SQL editor). **Expect breakage** and budget for it: ordering
  issues, statements that assumed prior manual state, or the `0005_seed.sql` admin-user dependency.
- Fix by *adding* a corrective migration, never by editing an applied file (spec §10.9 — prod and
  local history must stay identical).

**Done when:** `db reset` completes clean and local schema matches prod's shape.

### Chunk A3 — Seed the seven-user test matrix (60 min)

New file `supabase/seed-test-users.ts`, modeled on the env-loading and service-client setup already
in `supabase/seed.ts` (lines 17–49).

Auth is magic-link, so these users have no passwords — create them with
`admin.auth.admin.createUser({ email, password, email_confirm: true })` so the harness can call
`signInWithPassword`. Per spec §10.3:

| User | League A | League B | Circle X | Circle Y | Tests |
|---|---|---|---|---|---|
| Alice | member | — | member | — | sees public + League A + Circle X |
| Bob | member | — | — | — | same league, **not** her circle |
| Carol | — | — | member | — | same circle, **not** her league |
| Dave | — | member | — | member | total isolation |
| Erin | — | — | — | — | public-only floor |
| Mod | — | — | moderator | — | approves Circle X suggestions |
| Admin | — | — | — | — | platform admin |

Circle membership rows are inserted in Chunk C1 once `circles` exists; seed users + leagues now,
guarded so re-running is idempotent.

**Done when:** the script runs twice with no error and all seven appear in local `auth.users` with
correct league membership.

### Chunk A4 — RLS harness scaffold (60 min)

New `src/__tests__/rls/helpers.ts` implementing spec §10.4:

```ts
const admin = createClient(URL, SERVICE_ROLE_KEY);   // setup/teardown ONLY — bypasses RLS
async function clientFor(email: string, password: string) { … }  // anon key + real session
```

Guardrails worth building in now, because they are what makes the suite trustworthy:
- **Fail loudly if the target URL is not localhost** — a suite pointed at prod that "passes" proves
  nothing and creates password users in prod.
- A `expectCannotRead(client, table, id)` helper asserting `error === null && data.length === 0`.
  RLS *filters*, it does not throw — asserting on an error is the classic false-green.

Add a `test:rls` script to `package.json`. Vitest config already resolves `@` → `src` and runs in a
node environment, so no config change is needed.

Write one throwaway assertion (Erin can read a public market) to prove the harness authenticates.

**Done when:** `npm run test:rls` signs in as a seeded user and passes a real assertion.

### Chunk A5 — Betting-loop regression script (60 min)

`src/__tests__/rls/betting-loop.test.ts`, automating spec §10.6. This runs after **every** migration
from here on; it is the tripwire for "the migration broke the core product."

1. Claim daily bonus → balance rises, `last_daily_claim` set, second same-day claim rejected.
2. `place_bet` → `positions` row created, pools shift, `yes_probability` recomputes via trigger,
   `market_probability_history` appended, coins decrease, `yes_odds_at_bet` locked.
3. Resolve → winners `status='won'` + `payout`, losers `'lost'`, coins credited, streak trigger
   fires, `market_resolved` + `payout_received` notifications created.
4. Leaderboard reflects balances; weekly-top-earner RPC returns the right user.

**Done when:** the full loop is green locally — this is the baseline every later chunk re-runs.

---

## Phase B — 0023 De-trending (the dress rehearsal)

*Deliberately first among migrations: two rows of real data, no tier logic, and it exercises the
entire §10.5 protocol on a change where a mistake costs nothing.*

### Chunk B1 — Write and locally verify 0023 (45 min)

`supabase/migrations/0023_detrending.sql`, following spec §3.2's three-step enum swap (Postgres
cannot drop an enum value in place):

1. `UPDATE markets SET category='actions' WHERE category='trending'` (1 row); same for
   `market_suggestions` (1 row).
2. `CREATE TYPE market_category_new AS ENUM ('sports','social','actions')`.
3. Swap both columns via `USING category::text::market_category_new`, drop the old type, rename.

Only `0002_tables.sql` references `market_category` (lines 43, 62, 145) — no views or check
constraints depend on it, so the `DROP TYPE` should succeed. If it doesn't, the failure names what
still points at the old type (spec §10.8).

Keep the repo's `IF NOT EXISTS` / `DROP … IF EXISTS` idempotency guards. Document the rollback in a
header comment — the enum swap is not cleanly reversible once the old type is dropped.

Verify per §10.7's de-trending block (the one mislabeled "0022"): enum is exactly three values, zero
`trending` rows remain, market count 11 before == 11 after, and inserting `category='trending'` now
errors.

**Done when:** applies clean on `db reset`, verification queries pass, betting loop still green.

### Chunk B2 — App-side de-trending (45 min)

Genuinely small, because `trending` is overwhelmingly a *route* name in this codebase:

- `src/lib/utils.ts` — delete the `trending` key from `getCategoryLabel` (line 69) and from
  `getCategoryColors` (lines 86–87, which already carry a comment naming 0023 as the trigger).
  Both are `Record<MarketCategory, …>`, so the compiler flags any miss.
- `src/app/(admin)/admin/AdminCreateMarket.tsx:15` — remove the `{ value: "trending" }` pill.
  `is_featured` is the correct mechanism for surfacing a market (spec §3.2).
- `src/types/database.ts:6` — hand-edit `MarketCategory` to
  `"sports" | "social" | "actions"`. **Do not run `gen types`** (Finding 4).

**Explicitly unchanged:** `/dashboard/trending` and every redirect to it; the four algorithmic
sections; and the **Hot Streak / Cold Streak** Stat Leader cards, which read `profiles.win_streak` /
`loss_streak` and never touch `category`.

Then `npm run type-check` && `npm run lint` && `npm run build`, and load the page to confirm Hot
Streak still renders.

### Chunk B3 — Ship 0023 to prod + drive-by cleanup (30 min)

- `npx supabase db push --dry-run` — confirm 0023 is the only queued migration.
- `npx supabase db push`.
- Re-probe PostgREST: `trending` count 0, markets count still 11, positions still 20.
- Delete the six dev/test leagues (Finding 5) — check for attached `league_members` /
  `league_bets` / chat rows first, since this is a destructive prod write.
- Log 0023 in `MIGRATIONS_LOG.md` per the existing table format.
- Commit + push to `main` (`feat(db): 0023 drop the trending category enum value`).

---

## Phase C — Circles and tier columns

### Chunk C1 — 0024 circles tables (60 min)
Per spec §2.1–2.2: `circles` + `circle_members`, the `member_count` trigger, slug uniqueness, and
their RLS policies — **shipped together**, never a table without its policy. Extend
`seed-test-users.ts` (A3) to create Circle X / Circle Y and place Alice, Carol, Mod, Dave.

### Chunk C2 — 0024 verification (45 min)
Per §10.7's circles block: member-count trigger increments/decrements; a member reads their own
circle; **a user cannot insert a `circle_members` row for another user**; duplicate slug rejected;
circle delete cascades with no orphans; creator gets `role='creator'`. Betting loop green.

### Chunk C3 — 0025 market tier columns (45 min)
Per §3.1: `visibility_tier`, `league_id`, `circle_id` on `markets`, all defaulting to `public`, plus
the scope CHECK constraint. RLS is deliberately **not** changed here — all markets stay globally
readable until 0026. That ordering is intentional; don't "helpfully" pull the policy forward.

### Chunk C4 — 0025 verification (45 min)
Every pre-existing market is `public`/NULL/NULL. The constraint must reject: a `public` market with
a non-null `league_id` or `circle_id`; a `league` market with null `league_id`; a `circle` market
with null `circle_id`; and **any** market with both ids set. Verify cascades: deleting a league
deletes its league-tier markets and their positions/comments, and reaches **no** public rows.

---

## Phase D — 0026 Tier-aware RLS (the critical migration)

*The one that leaks data if wrong. Tests are written **before** the policies, red first.*

### Chunk D1 — Write the RLS matrix RED (60 min)
`src/__tests__/rls/tier-visibility.test.ts`. Seed one market per tier (public, League A, League B,
Circle X, Circle Y), then assert the full §10.7 matrix — **before `can_view_market` exists**, so
these fail. That failure is the proof the tests are actually wired to reality.

Positive: Alice → public + League A + Circle X · Bob → public + League A · Carol → public + Circle X
· Dave → public + League B + Circle Y · Erin → public only.

Negative (the point): Bob cannot read any Circle X market; Carol cannot read any League A market;
Dave cannot read either of Alice's; Erin cannot read anything tier-scoped. Each negative uses the
**direct-by-ID** read from §10.4 — hiding a row from a list is not enough; it must be unreadable
when the user knows its exact UUID.

### Chunk D2 — Ship 0026 policies GREEN (60 min)
Per spec §4: the `can_view_market(p_market_id)` helper (`SQL STABLE SECURITY DEFINER
SET search_path = public`), then replace `markets_select_authenticated` — currently
`USING (auth.role() = 'authenticated')` at `0003_rls.sql:34-37`, i.e. every authenticated user reads
every market — with `USING (can_view_market(id))`. Iterate until D1 is fully green.

### Chunk D3 — Dependent-table cascade (60 min)
Repeat the entire positive+negative matrix across `positions`, `market_comments`,
`market_reactions`, `market_probability_history`, and `activity_feed` (the last as
`market_id IS NULL OR can_view_market(market_id)`). Bob must not read a comment, position,
price-history point, or feed entry belonging to a Circle X market — including by direct id. Plus the
helper assertions: `can_view_market()` returns the correct boolean for all five users × forbidden
markets. **This migration does not ship on a single red negative test.**

### Chunk D4 — Performance, ship, and stand up staging (60 min)
`EXPLAIN` the market-list and feed queries under a normal user; confirm the per-row helper call
isn't producing a pathological plan (spec §4 flags a join-based rewrite for later scale).
Ship to prod, log, commit.

**Then create the staging Supabase project** — a free-tier project loaded from a prod snapshot.
This is the agreed gate: from 0027 onward, and certainly before real users, migrations climb
local → staging → prod. Creating the project needs dashboard access, so it's yours to click through;
wiring the snapshot/restore and pointing the suite at it is scriptable.

---

## Phase E — Leagues and tournament scoring (0027, 0028)

*Everything here runs local → staging → prod, since staging exists from D4 onward.*

### Chunk E1 — 0027 league gating migration (45 min)
Per §3.3: `leagues.tournament_enabled BOOLEAN NOT NULL DEFAULT FALSE`, `leagues.circle_id` (nullable
FK, `ON DELETE SET NULL`), and `buy_in_coins` dropped to nullable with a `NULL` default. Every one of
the existing leagues becomes a plain private space — chat, markets, coin-balance leaderboard — with
its `buy_in_coins` value retained but dormant.

**Done when:** applies clean, existing leagues keep their buy-in values, new leagues default to
tournament-off.

### Chunk E2 — 0027 verification + owner-only flag (45 min)
Per §10.7's league-gating block: with the flag off the weekly machinery is a no-op (week-start never
runs); a **non-owner cannot flip `tournament_enabled`** — that's an RLS/RPC check, not just UI;
nullable `buy_in_coins` is accepted; league chat, standings, membership and invite codes all still
work. Add a league-settings toggle wired to the owner check. Betting loop green.

### Chunk E3 — 0028 reshape `league_bets` (45 min)
Per §3.5: drop the existing PK, drop `week_id` (the week is derived from `markets.resolved_at` at
scoring time), re-key to `PRIMARY KEY (position_id, league_id)` — Decision #1, so one public bet may
count in several leagues independently. **Back up the table's contents first**; this is the one
migration in the sequence that discards a column with live meaning.

**Done when:** the table means exactly "this public/circle position was opted into this league."

### Chunk E4 — 0028 rewrite the two scoring functions (60 min)
Replace the gross-payout clause in `get_live_week_scores()` and `close_league_week()` (both from
`0017_league_system.sql`, patched in `0018`) with the model-(b) union from §3.5:

```sql
AND ( mkt.league_id = L                                     -- league-exclusive: automatic
   OR pos.id IN (SELECT position_id FROM league_bets WHERE league_id = L) )  -- opted-in
```

Everything else in those functions — buy-in collection, golf `RANK()`, pool payout, carry-over — is
untouched. Only "what counts" changes. Circle markets deliberately do **not** auto-count for leagues
inside that circle (Decision #7).

### Chunk E5 — 0028 tagging RPC + guards (45 min)
The manual opt-in path, as a `SECURITY DEFINER` RPC matching `place_bet`. Two logic checks that
cannot be table constraints (§3.5): a user may only tag a league they **belong to**, and a
league-exclusive position may **never** be tagged to a different league.

### Chunk E6 — 0028 full tournament cycle regression (60 min)
Per §10.7: on a flag-enabled league, run start week → collect buy-ins → place a mix of
league-exclusive and tagged-public bets → resolve → close week. Verify pool payout, golf points,
`RANK()` ties, the pool-rounding remainder, carry-over when nobody wins, and the `league_win`
notification. **Must-fail:** a League A-exclusive market scores nothing for League B; an *untagged*
public bet scores for no league; a market resolving outside any active week simply doesn't score
(no crash).

---

## Phase F — Scoped creation (0029)

### Chunk F1 — `create_league_market` RPC (60 min)
The **one** direct member-create path in the whole product. `SECURITY DEFINER`, matching the
`place_bet` pattern: verify the caller is a member of the target league, then insert a `league`-tier
market with `league_id` set. The `markets` insert policy stays `service_role`-only and the RPC does
the authorization (§4). Non-members rejected.

### Chunk F2 — League create UI (45 min)
Wire the RPC to a create form inside the league feed. Reuse the field shapes from
`src/app/(app)/suggest/page.tsx` (112 lines) rather than authoring a second market form — same
title/description/category/line inputs, different submit target and no approval step.

### Chunk F3 — 0029 circle suggestion schema (45 min)
Per §3.7: `market_suggestions.target_tier TEXT NOT NULL DEFAULT 'public' CHECK (target_tier IN
('public','circle'))` and `target_circle_id`. No `target_league_id` — leagues never suggest. Circles
have **no** direct-create path, so a member inserting a circle-tier market directly must be rejected
(locked Decision #4).

### Chunk F4 — Moderator approval + line-setting (60 min)
Extend the existing admin suggestion-approval flow (`src/app/(admin)/admin/actions.ts`) so a **circle
moderator** — not just the platform admin — can approve suggestions scoped to their circle and set
the opening line before it goes live. Approval is the elevated path that inserts the circle-tier
market. Verify with the seeded **Mod** user; a non-moderator approving must be rejected.

### Chunk F5 — 0029 scoped incident reports + scaled threshold (60 min)
Per §3.8, two changes to `submit_incident_report` and `cast_incident_vote`: gate eligibility on
`can_view_market()` so you can only report/vote on markets you can see, and scale the pass bar to
audience size — `required_votes = GREATEST(2, LEAST(4, CEIL(eligible_voters * 0.5)))`, passing at
≥60% agreement. That yields ~3 for a six-person league and 4 for a 200-person circle. **Public
markets must still resolve at the existing 4 / 60% bar** — that's the regression to protect. A
reporter still cannot vote on their own report.

---

## Phase G — Social and profiles (0030, 0031, 0032)

### Chunk G1 — 0030 threading + comment reactions (45 min)
Per §3.6 and §2.4: `market_comments.parent_comment_id` (self-FK, `ON DELETE CASCADE`) with the
partial index `WHERE parent_comment_id IS NOT NULL`, plus the `comment_reactions` table keyed
`(comment_id, user_id, emoji)`. Note the deliberate asymmetry — `comment_reactions` has **no** emoji
CHECK constraint (unlike the existing `market_reactions`) so the palette can evolve without a
migration; validate the allowed set in the app layer.

### Chunk G2 — 0030 RLS + verification (45 min)
Both new surfaces inherit market visibility via `can_view_market()`. Verify: reply sets
`parent_comment_id`; reacting twice toggles off; deleting a parent cascades to replies; **you cannot
read or react to a comment on a market you can't see**, including by direct id. Confirm the existing
Realtime subscription on `market_comments` still fires on insert.

### Chunk G3 — 0031 notification enum values, alone (45 min)
Per the §10.8 gotcha, this is deliberately **its own migration ahead of any code that inserts these
values**: `ALTER TYPE notification_type ADD VALUE IF NOT EXISTS` for `market_about_you`,
`circle_joined`, `circle_invite`, `comment_reply`, and optionally `league_market_created` /
`circle_market_created`. A newly added enum value cannot be used in the same transaction it's added
in, and in some Postgres versions `ADD VALUE` can't run in a transaction block at all. Verify the
values are actually usable *after* apply before writing anything that inserts them.

### Chunk G4 — 0031 activity feed scope + insert-site audit (60 min)
`activity_feed.circle_id` (§3.10), then **audit every `INSERT INTO public.activity_feed` call site**
and confirm each carries the correct tier context. Spec §10.7 names this as where leaks hide — the
read policy is only half the protection; an insert that drops tier context leaks regardless.

### Chunk G5 — 0031 feed leak tests (45 min)
Run as **Erin** (public-only) and **Dave** (fully isolated): a League A-exclusive market action must
not appear in the public feed or in a non-member's feed; a Circle X action must not leak to
non-members. Public activity still shows for everyone; existing notifications still deliver.

### Chunk G6 — 0032 profiles + the dead Edit-profile link (60 min)
`profiles.bio TEXT` (§3.11). Then fix a **live bug found during planning**:
`src/app/(app)/profile/[username]/page.tsx:111` renders an "Edit profile" button linking to
`/profile/[username]/edit`, and **that route does not exist** — only `page.tsx` and `loading.tsx` do.
It renders whenever `isOwnProfile`, so every user has a 404 button on their own profile, violating
the project's own "never ship a button that does nothing" rule. Build the edit route with a form
covering display name, avatar and the new bio. Verify the existing `profiles_update_own` policy still
blocks editing someone else's profile.

---

## Phase H — Navigation and presentation (spec §11)

Only after the tier migrations are proven — the sidebar cannot list "your circles / your leagues as
places" until circles exist and markets carry a tier. Governing flip: **place (tier) becomes primary
navigation; category becomes a filter chip inside every feed.**

Home = **Option A** for alpha (public trending), evolving to the personalized blend later
(§11.4) — the ranking logic for B isn't worth building before the tiers are validated.

### Chunk H1 — Category filter-chip component (45 min)
Build it first; every later feed chunk consumes it. A chip row (Sports / Social / Actions) that
filters the feed it sits above. Colors come from `getCategoryColors()` in `src/lib/utils.ts`, not
CSS tokens — per the repo's design-token rule.

### Chunk H2 — Collapse the category routes into tier feeds (60 min)
Retire `/dashboard/{sports,social,actions}` as routes; their content becomes the chip-filtered view
of a single feed. Extract the shared feed body so Home, Explore, circle and league feeds all render
the same component with a different market scope.

### Chunk H3 — Home route + Stat Leaders module (60 min)
Rename `/dashboard/trending` → the Home route and repoint all nine redirect sites (`proxy.ts:58,66`,
`app/page.tsx:12`, `api/auth/callback/route.ts:12,16`, `(auth)/login/page.tsx:16`,
`(auth)/onboarding/page.tsx:11`, `OnboardingForm.tsx:70`, `lib/auth.ts:37`, `Sidebar.tsx:25,70`,
`BottomTabBar.tsx:9`). **Trending becomes the default sort, not a destination.** Preserve the four
algorithmic sections and the **Hot Streak / Cold Streak** Stat Leader cards as a Home module — they
read `profiles.win_streak` / `loss_streak` and must survive the move intact.

### Chunk H4 — Sidebar restructure, tier-first (60 min)
`src/components/layout/Sidebar.tsx`: top = places (Home, Explore, each circle individually with its
avatar, each league individually — Discord-rail style); bottom = utility (My Bets, Notifications,
Reports, Create, Admin, profile card with coin balance).

### Chunk H5 — Mobile bottom tab bar (45 min)
`src/components/layout/BottomTabBar.tsx` to the five slots from §11.2: **Home · Circles · Leagues ·
Activity · More.** Circles and Leagues open list views (no room for a per-item rail on mobile);
Activity folds in Notifications + My Bets + Stat Leaders; More holds Reports, Suggest, profile,
settings, Admin.

### Chunk H6 — Circle browse + detail screens (60 min)
New surfaces: a circle list, a circle feed reusing the H2 feed component, join-by-invite-code, and a
member list. Model the card on the existing `src/components/leagues/LeagueCard.tsx`.

### Chunk H7 — League feed parity (45 min)
Point the existing `/leagues/[id]` page at the shared feed component so league markets render with
the same chips and card treatment as everywhere else. Keep the tournament standings panel visible
only when `tournament_enabled` is on.

### Chunk H8 — Context-aware Create button (60 min)
Per §11.3, one control whose behavior follows the §5 permissions matrix based on where the user is:
in a **league** → create directly (F1's RPC); in a **circle** → suggest → moderator approves; on
**Home / Explore** → suggest → admin approves. Replaces the standalone "Suggest a Line" entry point.

### Chunk H9 — Comment-section UI for threading (60 min)
Render G1's one-level threading in `src/components/markets/MarketComments.tsx` — replies nested under
their top-level parent, replies-to-replies flat under the same parent — plus the comment reaction
palette. This is the "real sports app comment section" feel the spec is after.

---

## Chunk 0 — Doc corrections (30 min, do first, no code)

Small and worth doing before anything else, because these notes are actively misleading the work:

1. **CLAUDE.md** — replace "Docker is not installed" with the true state (Docker Desktop 4.84.0,
   daemon running, `supabase start` viable). Update the surrounding claim that `db dump` / `start`
   don't work.
2. **Spec §10.7** — renumber every per-migration header +1 to match §7 (Finding 2). Add a note that
   §10.7 headers were desynced by the 2026-07-29 renumber.
3. **CLAUDE.md** — correct the 0023 line to drop the `/dashboard/trending` route deletion (Finding 3).
4. **CLAUDE.md + spec §10.5** — change "regenerate types into `src/types/database.ts`" to
   *hand-update* it, noting the file is manual and that `gen types` output goes to a separate
   cross-check file (Finding 4).

---

## Verification

**Per chunk:** `npm run type-check` && `npm run lint` && `npm run build` clean.

**Per migration** (spec §10.5, all ten): applies clean on fresh local DB · rollback documented ·
idempotent on re-run · row counts and FKs intact · types hand-updated and app builds · positive
tests green · negative tests green including every direct-by-ID RLS read · betting-loop regression
green · `EXPLAIN` sane on new hot-path queries · one line logged in `MIGRATIONS_LOG.md`.

**Commands:**
```bash
npx supabase start                 # local stack (Chunk A1)
npx supabase db reset              # replay full history locally
npm run test:rls                   # RLS matrix — MUST be red before D2, green after
npm test                           # unit + betting-loop regression
npx supabase db push --dry-run     # confirm only the intended migration is queued
```

**The gate that matters:** 0026 ships only when the entire positive **and** negative matrix is green
across all six market-joined tables, with every negative asserted as a direct-by-ID read returning
`[]` and a null error. One red negative test blocks the migration.

**Git:** commit and push directly to `main` per repo convention — no branches, no PRs.
