# Forecast — Project Context for Claude Code

## How to work in this repo (read first)
1. **Do it, don't delegate it back.** If you are about to tell the user to run a command, create a
   file, or make an edit — and you have the tools to do it yourself — **do it yourself and report
   afterward.** Never hand back a to-do list of things you were capable of doing. Ask first only for
   things genuinely outside your reach (browser OAuth logins, dashboard clicks, secrets you don't
   have) or that are destructive and irreversible.
2. **Fix what you find.** If you notice something broken, unsafe, stale, or wrong — even when it is
   unrelated to the current task — **fix it and mention it in your summary.** Do not file it as a
   suggestion and move on. Keep each drive-by fix small and self-contained; anything large enough to
   need its own design gets raised instead of silently undertaken.

## What this is
Forecast is a **play-money** prediction market for teenagers — social-first, built around friend groups. Users wager play coins (never real money) on yes/no and over/under markets, comment and react, and climb leaderboards. Originally built as "GDS Forecast" gated to one school; now pivoting into a national consumer product called **Forecast**.

Wedge: "where your group chat's hot takes go on the record."

## The refactor we're doing
Take the current single-audience app (Phase 0) and add a **three-tier visibility model**. This is the central change everything else serves — getting tier RLS right matters more than anything else here.

| Tier | Scope | Who sees it | Who creates it | Who resolves it |
|---|---|---|---|---|
| Public | whole platform | everyone | admin (suggestion → approval) | admin / community vote |
| Circle | one school / camp / team | circle members | members suggest → moderator approves & sets line | moderators / scoped vote |
| League | one friend group (6–30) | league members | any member, directly | creator / dispute vote |

Markets gain `visibility_tier` + `league_id` / `circle_id`; access is enforced by RLS via a `can_view_market()` helper.

**The full design + migration plan is in `docs/forecast-data-model-spec.md`. Read the relevant section of that spec before implementing any migration.** This file is orientation; the spec is the source of truth.

## Stack
- Next.js (App Router + React Server Components), React, TypeScript
- Supabase: Postgres, Row-Level Security (RLS), magic-link Auth, Realtime, SECURITY DEFINER RPCs
- Vercel hosting
- Vitest for tests
- Package manager: npm
- Existing migrations live in `supabase/migrations/` (through 0021). New work starts at **0022**.

## Locked product decisions (do not relitigate)
- **Three tiers**: Public / Circle / League (table above).
- **Tournament is an opt-in sub-feature of leagues**, gated behind a `tournament_enabled` flag (default false) — NOT deleted. The existing weekly buy-in / golf-scoring machinery is **kept**; it only runs when a league turns it on. A league is otherwise just a private space with its own markets, chat, and a coin-balance leaderboard.
- **Tournament scoring = model (b)**: a bet counts toward a league if the market is league-exclusive to it (**automatic**) OR the user opted a public/circle bet into it (**manual tag**). Only league-exclusive markets auto-count.
- A public/circle bet may be tagged to **multiple** leagues (counts in each independently).
- **Circle markets always require approval** — members suggest, a moderator approves and sets the opening line. No direct member-create for circles.
- **Circle markets never auto-count** for leagues inside the circle — only league-exclusive markets auto-count.
- **League markets ARE direct-create** by any member; the creator resolves directly, and the incident-report vote is the dispute path (low threshold that scales down for small groups).
- Circle/league membership is verified by **invite code** for now (no email-domain checks).
- **Comments**: one level of threading (top-level + replies).
- **"Market about you"**: in-app notification when a market @-mentions an existing user (the non-user viral share version is a later feature).
- The economy is **play-money only, forever** — no purchase, transfer, or cash-out path, ever.

## Navigation direction (UI)
Tier-first, not category-first. Top-level nav = Home / Explore / your circles / your leagues. Categories (Sports/Actions/Social) become **filter chips** inside every feed, not nav items. "Trending" is a Home sort, not a tab. Home = public trending for the alpha, evolving to a personalized blend later. Built in the presentation phase, AFTER the tier migrations exist. (Spec §11.)

## Non-negotiable engineering conventions
- **RLS-first, and RLS fails silently.** Every market-joined table (`markets`, `positions`, `market_comments`, `market_reactions`, `market_probability_history`, `activity_feed`) is read-scoped by the `can_view_market()` helper. A wrong policy leaks private data with no error thrown. A new tier-scoped table ships **with** its RLS policy, never without.
- **Write the RLS test BEFORE writing the migration.** Positive + negative, red then green. "Looks right" is not "is right." (Verification plan: spec §10.)
- **`service_role` bypasses RLS — never test policies with it.** RLS tests run through clients authenticated as specific seed users (the seven-user matrix in spec §10.3). The critical test is a direct-by-ID read: a user who shouldn't see a market must get `[]` even when querying its exact UUID, not merely be hidden from a list.
- **The betting loop must never break.** After every migration, run the end-to-end regression: claim bonus → place bet → pools/odds/coins update → resolve → payout/streak/notification → leaderboard. (Spec §10.6.)
- **Migrations are numbered 0022 onward and applied in order.** Continue the repo's existing `IF NOT EXISTS` / `DROP ... IF EXISTS` / `ADD VALUE IF NOT EXISTS` guards so re-running is idempotent.
- **Environment ladder:** local (`supabase start`) → staging (a **separate** Supabase project, loaded with a prod snapshot) → prod. Never run an unverified migration against the project real users depend on. (Currently the hosted project holds only test data — see below.) Full protocol + per-migration test plans are spec §10.
- **Match existing codebase patterns** — state-changing operations go through SECURITY DEFINER RPCs (see `place_bet`), not direct client table writes.
- After each migration: **hand-update** `src/types/database.ts` to match the new schema, then the
  project must `npm run type-check` and `npm run build` clean. That file is **manually written** (see
  its own header comment) and exports app-shaped types — `MarketCategory`, `Profile`, `Market`, … —
  that every import in `src/` depends on. Do **not** overwrite it with
  `npx supabase gen types typescript`: the generator emits a completely differently-shaped `Database`
  interface and would break the app wholesale. An earlier version of this line said "regenerate";
  that was a trap, corrected 2026-07-29. If you want generated types as a cross-check, write them to
  a separate file (`src/types/database.generated.ts`) and diff by eye.
- **Log each migration** — one line in `MIGRATIONS_LOG.md` (number, date, environment, verified-by).
- **Play money only.** There is no real-currency path anywhere, ever.

## Local toolchain traps (read before debugging a broken build)
- **Supabase CLI is a project devDependency, not global** (`npm -g` needs sudo here, and Supabase
  doesn't support global installs). Run `npx supabase …` **from the repo root** — the link lives in
  `supabase/.temp/linked-project.json`, so from `~` it fails with "Cannot find project ref."
  Project ref `curtlcoxtnoxljzkrlms`. There is no `supabase/config.toml` yet; linking works
  regardless, but `supabase start` needs one — see the Docker note below.
- **Docker IS installed and running** — Docker Desktop 4.84.0, engine 29.6.2 (`docker version`
  reports a live `Server:` block). An earlier note here claimed the opposite and steered the project
  away from local testing for months; it was wrong, corrected 2026-07-29. `supabase start` and
  `supabase db dump` therefore both work. The one missing piece is `supabase/config.toml` — the
  project was never `init`-ed — so run `npx supabase init` once before the first `supabase start`.
  (Probing the PostgREST endpoint with the service-role key from `.env.local` still works for a
  quick look at remote data, but it is no longer the only option for schema inspection.)
- **Never run `npm audit fix --force`.** npm's resolver proposes `next@9.3.3` and
  `eslint-config-next@12` — downgrades of 8 and 4 majors. 12 high-severity advisories are knowingly
  left open (eslint chain is dev-only; postcss and sharp arrive through Next and need an upstream
  patch). Plain `npm audit fix` is safe and has been applied.
- **If `npm run type-check` or `lint` dies with `Cannot find module '../lib/tsc.js'`**, the
  `node_modules/.bin` symlinks have been flattened into real files by a copy that dereferences
  symlinks (Finder drag, zip round-trip, cloud sync). `npm install` will **not** repair it — only
  `rm -rf node_modules && npm install` does.
- **Tailwind is v4**, so `bg-opacity-*` / `border-opacity-*` / `text-opacity-*` silently do nothing.
  Use the slash modifier (`bg-[var(--color-coin)]/15`). Three were broken this way until 2026-07-29.
- **The repo folder gets dragged around.** If a shell reports "working directory was deleted", the
  directory moved — `find ~ -maxdepth 3 -iname "GDS_Kalshi" -type d` — it is not data loss.

## Design tokens
Palette is **black / white / purple**; `--color-primary` is `#7C3AED`. All colour lives in the
`@theme` block of `src/app/globals.css` — never hardcode a hex or a raw Tailwind palette class in a
component; reference a token. Red, green, and amber are reserved for **meaning only** (NO buttons,
win/loss, resolution status, coins) and must not be used decoratively. Category chip colours come
from `getCategoryColors()` in `src/lib/utils.ts`, not from CSS tokens.

## Git workflow
Solo repo — **commit and push directly to `main`.** No feature branches, no PRs.
Do not branch when on the default branch, and do not raise branching as a concern
or suggest it as an improvement. Conventional Commit messages still apply
(`type(scope): description`).

## Migration sequence
> **Numbering has shifted +1 five times.** `0022` went to the de-brand data migration. `0023` went to
> the `league_win` enum + league-chat realtime fixes. `0024` went to the league RLS
> **infinite-recursion** fix (those three on 2026-07-29). `0026` went to the resolution-notification
> fix and `0027` to the unlocked read-modify-write fix (both 2026-07-30). Every one of the latter four
> was a silent breakage found by the new E2E suite (see `MIGRATIONS_LOG.md`). De-trending is therefore
> **0025**, the tier work proper starts at **0028**, and profiles lands at **0036**. Spec §7 and §10.7
> both match this numbering.
>
> **Check `ls supabase/migrations/` before naming a new file.** This has now bitten twice in one day:
> `0026_resolution_notifications.sql` was first written as `0025_…`, and
> `0027_locked_line_and_referral.sql` was first written as `0026_…`, each colliding with a migration
> that landed while it was being written. `db push` rejects duplicate version prefixes.

0. **De-GDS cleanup (app work, no migration):** ✅ **DONE** — `@gds.org` auth check removed, GDS copy
   stripped, package renamed, seed script de-branded, palette recolored to black/white/purple.
1. **0022** — ✅ **APPLIED (prod)** de-brand: rewrite the 7 GDS-titled seeded markets in place
   (UPDATE, not DELETE, to preserve attached positions/comments/history).
2. **0023** — ✅ **APPLIED** add `league_win` to the
   `notification_type` enum (its absence aborted every league week-close that had a winner) and add
   `league_messages` to the `supabase_realtime` publication (league chat never updated live).
3. **0024** — ✅ **APPLIED (prod)** fix **infinite recursion** in
   `league_members_select` (from 0003): it subqueried `league_members` from inside that table's own
   policy, so every authenticated read of `leagues` / `league_members` / `league_messages` /
   `league_weeks` / `league_week_participants` / `league_bets` failed with
   `42P17 infinite recursion detected in policy`. **The entire leagues feature was dead for every
   real user** — `/leagues/[id]` 404'd even for its own owner — and only `service_role` paths worked,
   which is why it never surfaced. Adds the `is_league_member()` SECURITY DEFINER helper, rewrites the
   league policies to use it, and adds `find_league_by_invite_code()` so a prospective member can
   resolve a private league from its code (invite-code joining had never worked either). **Read this
   migration before writing 0030's tier RLS — `can_view_market()` is the same shape and the same trap.**
4. **0025** — de-trending: drop the `trending` category enum value (reassign existing rows first via
   the 3-step enum swap). App-side, this is small: delete the `trending` key from
   `getCategoryColors()` **and** `getCategoryLabel()` in `src/lib/utils.ts`, drop the "Trending" pill
   from `AdminCreateMarket.tsx`, and narrow `MarketCategory` in `src/types/database.ts`.
   **Do NOT delete the `/dashboard/trending` route in 0025** — an earlier version of this line said
   to, and that was wrong. That route is the post-login *home feed*; nine files redirect to it
   (`proxy.ts`, `app/page.tsx`, `api/auth/callback`, `login`, `onboarding`, `OnboardingForm`,
   `lib/auth.ts`, `Sidebar`, `BottomTabBar`) and the page never filters on `category`. Renaming it is
   §11 nav work (**plan.md step 22**, Part VI), and its algorithmic sections plus all three Stat
   Leader cards — Hot Streak, Cold Streak, Week's Best, which read `profiles.win_streak` /
   `loss_streak`, not `category` — must survive that move.
5. **0026** — ⏳ **WRITTEN, NOT APPLIED** resolution notifications: both resolve functions notified
   winners only, so a losing bettor was never told their market resolved, and `resolve_ou_market`'s
   PUSH branch refunded coins silently. No `ALTER TYPE` needed — `market_resolved` has been in the
   `notification_type` enum since 0002 and was inserted by nothing, anywhere.
6. **0027** — ⏳ **WRITTEN, NOT APPLIED** the unlocked read-modify-write fix. `place_bet` /
   `place_ou_bet` were **already correct** — both take `SELECT … FOR UPDATE` on the market before
   reading pools and on the profile before checking the balance (verified by mutation testing: strip
   the locks and 4 of 6 tests in `e2e/concurrency.spec.ts` go red with 300–700 coins vanishing). The
   invariant they rely on — *everyone who writes pools holds the market lock* — was broken by
   `setMarketLine()`, which read pools over PostgREST, computed in TS, and wrote back across two
   transactions. Adds `set_market_line()` + `american_odds_to_prob()`, locks `record_referral()`'s
   idempotency check (concurrent calls minted 500 coins twice), and gives
   `profiles.referred_by` `ON DELETE SET NULL` — it had no ON DELETE action, so **any user who ever
   referred somebody could not be deleted at all**.
7. **0028** — ✅ **APPLIED (local only)** stop an over/under **push** extending a win
   streak. A push is stored as `status='won'` (there is no `push` value in `position_status`),
   so the streak trigger counted a tie as a win. `update_user_streaks` now recognises a push by
   comparing `markets.resolution_value` to `positions.ou_line_at_bet` — the resolver's own test —
   and leaves both streaks untouched.
8. **0029** — `circles` + `circle_members` tables (+ member-count trigger, RLS).
9. **0030** — market tier columns (`visibility_tier`, `league_id`, `circle_id`) + scope constraint, all defaulting to `public`.
10. **0031** — tier-aware RLS: the `can_view_market()` helper + rewritten SELECT policies on all market-joined tables, **and `can_view_market()` added to the `WITH CHECK` of their INSERT policies**. The existing `mc_insert` (0019) and `reactions_insert` (0016) test authorship only (`user_id = auth.uid()`), so tier-scoping reads alone still lets an outsider who knows a private market's UUID write a comment or reaction into it. **The critical migration — ships only when the full positive AND negative matrix is green for reads *and* writes.**
11. **0032** — league gating (`tournament_enabled`, nullable `buy_in_coins`) + `leagues.circle_id`.
12. **0033** — model (b) scoring: reshape `league_bets`, rewrite the two tournament scoring functions.
13. **0034** — scoped creation (`create_league_market` RPC) + circle suggestion→approval flow + scoped incident reports.
14. **0035** — comment threading (`parent_comment_id`) + `comment_reactions`.
15. **0036** — activity-feed tier scoping + new notification types.
16. **0037** — profiles (`bio`), public profile pages, profile edit.
17. **Then** the §11 navigation + presentation overhaul (tier-first nav, comment-section UI, Stat Leaders).

## What already exists (Phase 0 — extend, don't rebuild)
Working CPMM with American-odds payouts, probability-history charts, over/under markets, RLS throughout with `SECURITY DEFINER` RPCs for state changes, community resolution via incident reports + voting, Realtime comments with @mentions, streak triggers, a weekly tournament system, magic-link auth (currently `@gds.org`-gated), and an admin dashboard with suggestion approval + line-setting. The refactor extends this; it does not replace it.

## Current data state
The hosted Supabase project currently holds only **seeded test accounts** (handles like `*30@gds.org`) plus the owner — no real users yet. This is the safest possible time to refactor: a mistake only affects disposable test data. Keep RLS tests rigorous anyway (they prove correctness, not just safety), and stand up a true separate staging project before opening alpha to real users.

## Guardrails
- Users are **teenagers/minors**. Keep all generated content, copy, and markets age-appropriate; public/circle markets are reviewed before going live and comments are moderated.
- **No real money** anywhere — play coins only. This is what keeps the platform clear of gambling regulation; never add a purchase, transfer, or cash-out path.
- **Private-tier data must never leak** outside its audience (league/circle markets, comments, positions). When unsure about visibility, default to more restrictive and add an RLS test.

## Key references
- `docs/forecast-data-model-spec.md` — full spec: data model (§§1–9), verification plan (§10), navigation/layout (§11), locked decisions (§8, §11.4). **Read the relevant section before each migration.**
- `supabase/migrations/` — existing schema through 0024.
- `TESTING.md` — **binding** testing rules: what "done" means, the two required layers, the RLS
  methodology, and the forbidden shortcuts. Read it before writing a test or claiming a task finished.
- `src/types/database.ts` — hand-written; hand-update after schema changes (never `gen types` over it).
- `MIGRATIONS_LOG.md` — one line per migration; the audit trail.
