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
- After each migration: regenerate types into `src/types/database.ts` (`npx supabase gen types typescript`), then the project must `npm run type-check` and `npm run build` clean.
- **Log each migration** — one line in `MIGRATIONS_LOG.md` (number, date, environment, verified-by).
- **Play money only.** There is no real-currency path anywhere, ever.

## Git workflow
Solo repo — **commit and push directly to `main`.** No feature branches, no PRs.
Do not branch when on the default branch, and do not raise branching as a concern
or suggest it as an improvement. Conventional Commit messages still apply
(`type(scope): description`).

## Migration sequence
> **Numbering shifted +1 on 2026-07-29.** `0022` was taken by the de-brand data migration
> (`0022_debrand_market_content.sql`), so de-trending is now **0023** and everything after moves up
> one. The spec's §7 has been updated to match. Original plan had de-trending at 0022.

0. **De-GDS cleanup (app work, no migration):** ✅ **DONE** — `@gds.org` auth check removed, GDS copy
   stripped, package renamed, seed script de-branded, palette recolored to black/white/purple.
1. **0022** — ✅ **APPLIED** de-brand: rewrite the 7 GDS-titled seeded markets in place (UPDATE, not
   DELETE, to preserve attached positions/comments/history).
2. **0023** — de-trending: drop the `trending` category enum value (reassign existing rows first via
   the 3-step enum swap). Note: also delete the `trending` key from `getCategoryColors()` in
   `src/lib/utils.ts`, and the `/dashboard/trending` route.
3. **0024** — `circles` + `circle_members` tables (+ member-count trigger, RLS).
4. **0025** — market tier columns (`visibility_tier`, `league_id`, `circle_id`) + scope constraint, all defaulting to `public`.
5. **0026** — tier-aware RLS: the `can_view_market()` helper + rewritten SELECT policies on all market-joined tables. **The critical migration — ships only when the full positive AND negative RLS matrix is green.**
6. **0027** — league gating (`tournament_enabled`, nullable `buy_in_coins`) + `leagues.circle_id`.
7. **0028** — model (b) scoring: reshape `league_bets`, rewrite the two tournament scoring functions.
8. **0029** — scoped creation (`create_league_market` RPC) + circle suggestion→approval flow + scoped incident reports.
9. **0030** — comment threading (`parent_comment_id`) + `comment_reactions`.
10. **0031** — activity-feed tier scoping + new notification types.
11. **0032** — profiles (`bio`), public profile pages, profile edit.
12. **Then** the §11 navigation + presentation overhaul (tier-first nav, comment-section UI, Stat Leaders).

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
- `supabase/migrations/` — existing schema through 0021.
- `src/types/database.ts` — regenerate after schema changes.
- `MIGRATIONS_LOG.md` — one line per migration; the audit trail.
