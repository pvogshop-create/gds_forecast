# Forecast — Tier Refactor Plan

28 steps, in order. Each is one thing that changes, sized 30–60 min per part.
Migrations 0024 → 0033, then the navigation overhaul.

---

## Why this order

Forecast is adding a **three-tier visibility model** (Public / Circle / League). The spec is
`docs/forecast-data-model-spec.md`; migrations 0001–0022 are applied.

**Steps 1–6 come before any migration** because the test harness spec §10 requires did not exist.
Much of it now does (see Part I): the local stack is up and a Playwright suite with seeded users,
auth helpers and a prod-lockout guard is working. What's still missing is the part that gates
step 10 — the seven-user tier matrix and the visibility assertions themselves.

That matters at **step 10 (migration 0027)**, which rewrites the market read policy from
`USING (auth.role() = 'authenticated')` — every logged-in user reads every market — into tier-scoped
visibility. Get it wrong and private league markets leak between teenagers, and per spec §10.1 it
fails **silently**: no exception, no build error, no type error. The only way to catch it is querying
as different authenticated users and asserting what each one *cannot* see. Writing those tests after
the migration defeats their purpose.

**What makes this affordable now:** CLAUDE.md said "Docker is not installed." That was wrong —
Docker Desktop 4.84.0 is installed with a running daemon, so `supabase start` works. The project had
been avoiding local testing over a constraint that didn't exist.

**Ladder:** local → prod for now (prod holds only seeded test data). A separate staging project
becomes a hard gate at step 10, before real users.

**Numbering note.** `0023` was consumed by `0023_fix_league_notification_and_realtime.sql`, a
bug-fix migration found while building the E2E suite: `close_league_week()` inserted a `league_win`
notification whose enum value never existed, so **every league week-close with a winner aborted the
whole payout transaction**. Only the no-winner carry-over branch avoided the INSERT, which is why it
went unnoticed. It also adds `league_messages` to the realtime publication, fixing league chat not
updating live. De-trending therefore starts at **0024** and profiles lands at **0033**.

---

## Findings folded into the steps

Six things found while reading that are wrong in the repo today. Each is fixed in a step, not filed.

| # | What's wrong | Fixed in |
|---|---|---|
| 1 | CLAUDE.md claims Docker isn't installed — it is (Desktop 4.84.0, daemon up) | Step 1 |
| 2 | Spec §10.7 verification blocks numbered one behind §7; following them tests each migration with the wrong checklist | Step 1 |
| 3 | CLAUDE.md says 0023 deletes `/dashboard/trending` — that's the home feed, 9 files redirect to it, and it never filters by category | Step 1 |
| 4 | CLAUDE.md + spec §10.5 say to regenerate `src/types/database.ts` — it's hand-written, and `gen types` would break every import | Step 1 |
| 5 | Six dev/test leagues still in prod ("Test 1"–"Test 4", duplicate "Forecasters", "Fantasy leauge") | Step 7c |
| 6 | "Edit profile" button links to `/profile/[username]/edit`, which has no route — every user has a 404 button on their own profile | Step 19 |

---

## Prod state (verified)

11 markets (6 actions, 2 sports, 2 social, **1 trending**) · 11 suggestions (**1 trending**) ·
20 positions · 10 profiles · 8 leagues · 4 comments.

De-trending touches **two rows** — which is why it goes first among migrations, as a cheap rehearsal
of the full verification protocol.

---

# Part I — Test harness (steps 1–6)

*No schema changes. This builds the thing that makes every later change safe.*

> **Status 2026-07-29:** steps 1–3 are done. Steps 4–6 were partly built, via a **Playwright** suite
> rather than the Vitest one this plan originally specified — that's a fine substitution and the
> descriptions below have been rewritten to match what exists. What's still missing is the part that
> actually gates step 10: the tier-visibility assertions and the seven-user matrix.

## 1. Doc corrections (30 min) — ✅ DONE

Findings 1–4 above, corrected in `CLAUDE.md` and `docs/forecast-data-model-spec.md`, each marked so
the next reader knows the old guidance was wrong rather than merely stale. Spec §10.7 headers and all
cross-references (§8 decisions, §10.8 gotchas, in-block forward refs) renumbered to match §7.

## 2. Local Supabase stack (45 min) — ✅ DONE

Stack is up: API `54321`, DB `54322`, Studio `54323`, Mailpit `54324`. Config lives in `.env.test`,
**committed on purpose** — every value is one of Supabase's well-known local demo keys, identical on
every machine running `supabase start` and worthless outside your own Docker. `.gitignore` carries an
explicit `!.env.test` negation.

`playwright.config.ts` forwards those keys through `webServer.env`, which is what stops `.env.local`
(pointed at the hosted project) from being picked up during a test run.

## 3. Migration history replay (45 min) — ✅ DONE

All 23 migrations apply to a fresh local DB; `migration list --local` shows 23 matched pairs.

Worth noting it replayed **clean on the first attempt**, which was not the expected outcome —
0001–0021 were originally hand-applied one at a time through the dashboard SQL editor against a
database that already had state, so ordering bugs were likely. There were none.

Rule still stands for everything ahead: fix by **adding a corrective migration**, never by editing an
applied file (spec §10.9).

## 4. Seven-user tier matrix (60 min) — ⚠️ PARTIAL

`e2e/helpers/fixtures.ts` seeds five users — `admin`, `owner`, `alice`, `bob`, `broke` — shaped for
betting, league and admin flows. Those don't test tier visibility, because none of them differ by
*membership* in the way the boundaries require.

The matrix needs the adversarial pairs: someone in Alice's league but **not** her circle, someone in
her circle but **not** her league, someone isolated from both, and a public-only floor.

| User | League A | League B | Circle X | Circle Y | Exists to prove |
|---|---|---|---|---|---|
| Alice | ✓ | | ✓ | | sees public + League A + Circle X |
| Bob | ✓ | | | | same league as Alice, **not** her circle |
| Carol | | | ✓ | | same circle as Alice, **not** her league |
| Dave | | ✓ | | ✓ | fully isolated from Alice |
| Erin | | | | | public-only floor |
| Mod | | | moderator | | approves Circle X suggestions |
| Admin | | | | | platform admin |

Extend `fixtures.ts` with Carol, Dave, Erin and Mod. **Circle rows can't land until step 8 creates
`circles`** — so seed the users and leagues now, circles later, both idempotently.

## 5. RLS harness (60 min) — ⚠️ INFRA DONE, ASSERTIONS MISSING

Built and working: `e2e/helpers/{auth,db,env,seed,fixtures}.ts`, `global-setup.ts` /
`global-teardown.ts`, `smoke.spec.ts`, and a gated `/api/test/login` route that 404s unless
`E2E_TEST_SECRET` is set.

The guardrail this plan called for **is in place** — `e2e/helpers/env.ts:42-49` refuses to run
against any non-loopback host, so the suite cannot be aimed at prod and cannot mint password users
there.

Still missing, and this is what gates step 10:

- The **tier-visibility assertions** themselves (they land in 10a, written red).
- An `expectCannotRead(client, table, id)` helper asserting `error === null && data.length === 0`.
  RLS *filters*, it does not throw — asserting on a thrown error is the classic false-green.
- The matching `expectCannotWrite` for step 10d's negative write cases.

## 6. Betting-loop regression (60 min) — ❌ NOT DONE

`package.json` declares `test:e2e:loop` → `e2e/betting-loop.spec.ts`, **but that file doesn't
exist** — the script fails if run. This is the tripwire for "the migration broke the product," and it
re-runs after every migration from here on, so it needs to exist before step 7.

Mostly assembly rather than new machinery: `e2e/helpers/seed.ts` already exports `createMarket`,
`placeBetAs`, `resolveMarketAs`, `setCoins`, `createLeague` and `startWeek`.

1. Claim daily bonus → balance rises, `last_daily_claim` set, second same-day claim rejected.
2. Place bet → position created, pools shift, probability recomputes via trigger, history row
   appended, coins decrease, `yes_odds_at_bet` locked.
3. Resolve → winners `won` + payout, losers `lost`, coins credited, streak trigger fires,
   `market_resolved` + `payout_received` notifications created.
4. Leaderboard reflects balances; weekly-top-earner RPC returns the right user.

**Done when:** green locally against the local stack.

---

# Part II — Tier foundation (steps 7–10)

## 7. Drop the `trending` category — 0024 (2h)

Trending is both an enum value and the name of the home tab; the collision causes subtle bugs in tier
work. It becomes a *view*, not a category.

**7a — Migration (45 min).** Postgres can't drop an enum value in place, so the three-step swap from
spec §3.2: reassign the 2 rows to `actions`, create `market_category_new` without `trending`, swap
both columns via `USING category::text::market_category_new`, drop the old type, rename. Only
`0002_tables.sql` references the type, so the drop should succeed — if it doesn't, the error names
what still points at it.

**7b — App cleanup (45 min).** Delete the `trending` key from `getCategoryLabel()` and
`getCategoryColors()` in `src/lib/utils.ts`; remove the Trending pill from
`AdminCreateMarket.tsx:15`; narrow `MarketCategory` in `src/types/database.ts:6` **by hand**
(Finding 4 — never `gen types` over that file). Both helpers are `Record<MarketCategory, …>`, so the
compiler catches a miss.

*Explicitly unchanged:* `/dashboard/trending` and its 9 redirect sites, the four algorithmic
sections, and the **Hot Streak / Cold Streak** cards — they read `profiles.win_streak` /
`loss_streak`, never `category`. The route rename is step 22.

**7c — Ship + cleanup (30 min).** `db push --dry-run` → `db push`. Re-probe: trending count 0,
markets still 11, positions still 20. Delete the six dev/test leagues (Finding 5), checking for
attached members/bets/chat first — destructive prod write. Log in `MIGRATIONS_LOG.md`, commit.

## 8. Circles and circle members — 0025 (105 min)

**8a — Tables + RLS (60 min).** Per spec §2.1–2.2: `circles`, `circle_members`, the `member_count`
sync trigger, slug uniqueness, and their RLS policies — **shipped together**, never a table without
its policy. Extend step 4's seed script to create Circle X / Circle Y and place Alice, Carol, Mod,
Dave.

**8b — Verification (45 min).** Member-count trigger increments and decrements; a member reads their
own circle; **a user cannot insert a `circle_members` row for someone else**; duplicate slug
rejected; circle delete cascades with no orphans; creator gets `role='creator'`. Betting loop green.

## 9. Market tier columns — 0026 (90 min)

**9a — Columns + constraint (45 min).** Per spec §3.1: `visibility_tier`, `league_id`, `circle_id` on
`markets`, all defaulting to public, plus the scope CHECK.

RLS is deliberately **not** touched here — every market stays globally readable until step 10. That
ordering is intentional; don't pull the policy forward.

**9b — Verification (45 min).** Every existing market is `public`/NULL/NULL. The constraint must
reject: a public market with either scope id set; a league market with null `league_id`; a circle
market with null `circle_id`; and **any** market with both ids. Verify cascades — deleting a league
removes its league-tier markets and their positions/comments, and reaches **no** public rows.

## 10. Tier-aware RLS — 0027 (5h) ⚠️ the critical one

The migration that leaks data if it's wrong. Tests are written **red, before the policies exist**.

**10a — Write the matrix red (60 min).** `src/__tests__/rls/tier-visibility.test.ts`. Seed one market
per tier, then assert the full matrix while `can_view_market()` still doesn't exist — the failure is
proof the tests are wired to reality.

*Positive:* Alice → public + League A + Circle X · Bob → public + League A · Carol → public + Circle X
· Dave → public + League B + Circle Y · Erin → public only.

*Negative:* Bob reads no Circle X market · Carol reads no League A market · Dave reads neither of
Alice's · Erin reads nothing tier-scoped. **Each negative is a direct-by-ID read** — hiding a row from
a list is not enough; it must be unreadable when the user knows its exact UUID.

**10b — Ship the policies green (60 min).** Per spec §4: the `can_view_market(p_market_id)` helper
(`SQL STABLE SECURITY DEFINER SET search_path = public`), then replace
`markets_select_authenticated` (`0003_rls.sql:34-37`) with `USING (can_view_market(id))`. Iterate
until 10a is fully green.

**10c — Dependent tables (60 min).** Repeat the whole matrix across `positions`, `market_comments`,
`market_reactions`, `market_probability_history`, and `activity_feed` (that last as
`market_id IS NULL OR can_view_market(market_id)`). Bob must not read a comment, position, price
point, or feed entry belonging to a Circle X market — including by direct id. Plus: the helper
returns the correct boolean for all five users × every forbidden market.

**10d — Close the write path (60 min).** ⚠️ **Not in spec §4 — found during a plan audit.** §4
specifies SELECT policies and the `markets` INSERT path, and nothing else. The existing insert
policies on dependent tables check authorship only:

```sql
-- 0019_comments_and_attribution.sql:25   and   0016_market_reactions.sql:25
WITH CHECK (user_id = auth.uid())      -- "are you inserting as yourself" — that's all
```

Neither asks whether you can *see* the market. So once 10b–10c make reads tier-scoped, an outsider
who knows a private market's UUID can still **write** into it: inject a comment or reaction into a
league or circle market they were never allowed to read. Members who can see the market then see the
injected content. It also leaks existence — the insert succeeds or fails depending on whether the
UUID is real.

Add `can_view_market(market_id)` to the `WITH CHECK` of every dependent-table insert policy
(`market_comments`, `market_reactions`, and any other market-joined write path), and extend the
matrix with **negative write** tests: Bob's insert into a Circle X market must be rejected, not
merely invisible. A read-only test suite would pass this hole silently.

**10e — Perf, ship, staging (60 min).** `EXPLAIN` the market-list and feed queries under a normal
user; the helper runs per row, so confirm no pathological plan (spec §4 flags a join-based rewrite
for larger scale). Ship, log, commit.

**Then create the staging Supabase project** — free tier, loaded from a prod snapshot. From step 11
on, migrations climb local → staging → prod. Creating it needs dashboard clicks, so that part is
yours; wiring the restore and pointing the suite at it is scriptable.

> **Gate:** this migration ships only when the entire positive **and** negative matrix is green
> across all six tables — **reads and writes both**. One red negative test blocks it.

---

# Part III — Leagues and scoring (steps 11–12)

## 11. League tournament gating — 0028 (90 min)

**11a — Migration (45 min).** Per spec §3.3: `tournament_enabled BOOLEAN NOT NULL DEFAULT FALSE`,
`leagues.circle_id` (nullable, `ON DELETE SET NULL`), and `buy_in_coins` dropped to nullable. Every
existing league becomes a plain private space — chat, markets, coin leaderboard — with its buy-in
retained but dormant.

**11b — Verification + owner toggle (45 min).** With the flag off the weekly machinery is a no-op;
**a non-owner cannot flip it** (an RPC/RLS check, not just UI); nullable buy-in accepted; league chat,
standings, membership and invite codes all still work. Wire the settings toggle to the owner check.

## 12. Model (b) tournament scoring — 0029 (3.5h)

A bet counts for a league if the market is league-exclusive to it (**automatic**) or the user tagged
a public/circle bet into it (**manual**). Circle markets never auto-count, even inside that circle
(Decision #7).

**12a — Reshape `league_bets` (45 min).** Per spec §3.5: drop the PK, drop `week_id` (the week is
derived from `markets.resolved_at` at scoring time), re-key to `(position_id, league_id)` so one
public bet can count in several leagues (Decision #1). **Back up the table first** — this is the one
migration in the sequence that discards a column with live meaning.

**12b — Rewrite the two scoring functions (60 min).** Replace the gross-payout clause in
`get_live_week_scores()` and `close_league_week()` (from `0017`, patched in `0018`) with the union:

```sql
AND ( mkt.league_id = L                                                      -- automatic
   OR pos.id IN (SELECT position_id FROM league_bets WHERE league_id = L) )  -- opted in
```

Buy-in collection, golf `RANK()`, pool payout and carry-over are untouched. Only "what counts"
changes.

**12c — Tagging RPC (45 min).** The manual opt-in path, `SECURITY DEFINER`, matching `place_bet`. Two
checks that can't be table constraints: a user may only tag a league they **belong to**, and a
league-exclusive position may **never** be tagged to a different league.

**12d — Full cycle regression (60 min).** On a flag-enabled league: start week → buy-ins → mixed
exclusive and tagged bets → resolve → close. Verify pool payout, golf points, `RANK()` ties, the
rounding remainder, carry-over when nobody wins, and the `league_win` notification.
*Must fail:* a League A-exclusive market scores nothing for League B; an untagged public bet scores
for no league; a market resolving outside any week simply doesn't score.

---

# Part IV — Creation paths (steps 13–15) · migration 0030

## 13. League market direct-create (105 min)

**13a — `create_league_market` RPC (60 min).** The **only** direct member-create path in the product.
`SECURITY DEFINER`, matching `place_bet`: verify the caller is a member of the target league, then
insert a league-tier market. The table policy stays service-role-only and the RPC does the
authorization (spec §4). Non-members rejected.

**13b — Create UI (45 min).** Wire it to a form inside the league feed, reusing the field shapes from
`src/app/(app)/suggest/page.tsx` rather than authoring a second market form — same inputs, different
submit target, no approval step.

## 14. Circle suggestion → approval (105 min)

**14a — Schema (45 min).** Per spec §3.7: `market_suggestions.target_tier` (CHECK `public`/`circle`)
and `target_circle_id`. No `target_league_id` — leagues never suggest. Circles have **no**
direct-create path, so a member inserting a circle-tier market directly must be rejected
(locked Decision #4).

**14b — Moderator approval + line-setting (60 min).** Extend the existing admin approval flow in
`src/app/(admin)/admin/actions.ts` so a **circle moderator** — not just the platform admin — can
approve suggestions scoped to their circle and set the opening line before it goes live. Approval is
the elevated path that inserts the market. Verify with the seeded Mod user; a non-moderator approving
must be rejected.

## 15. Scoped incident reports (60 min)

Per spec §3.8, two changes to `submit_incident_report` and `cast_incident_vote`: gate eligibility on
`can_view_market()` so you can only report or vote on markets you can see, and scale the pass bar to
audience size — `GREATEST(2, LEAST(4, CEIL(eligible_voters * 0.5)))` at ≥60% agreement. That gives ~3
for a six-person league, 4 for a 200-person circle.

**Public markets must still resolve at the existing 4 / 60% bar** — that's the regression to protect.
A reporter still can't vote on their own report.

---

# Part V — Social and profiles (steps 16–19)

## 16. Comment threading and reactions — 0031 (90 min)

**16a — Migration (45 min).** Per spec §3.6 and §2.4: `market_comments.parent_comment_id` (self-FK,
cascade) with a partial index, plus `comment_reactions` keyed `(comment_id, user_id, emoji)`. Note the
deliberate asymmetry — no emoji CHECK constraint here, unlike `market_reactions`, so the palette can
evolve without a migration; validate in the app layer.

**16b — RLS + verification (45 min).** Both inherit market visibility. Reply sets
`parent_comment_id`; reacting twice toggles off; deleting a parent cascades to replies; **you can't
read or react to a comment on a market you can't see**, including by direct id. Confirm the existing
Realtime subscription still fires.

## 17. Notification types — 0032a (45 min)

Deliberately **its own migration, ahead of any code that inserts these values.**
`ALTER TYPE notification_type ADD VALUE IF NOT EXISTS` for `market_about_you`, `circle_joined`,
`circle_invite`, `comment_reply`, optionally `league_market_created` / `circle_market_created`.

Per spec §10.8: a newly added enum value **cannot be used in the transaction that adds it**, and in
some Postgres versions `ADD VALUE` can't run in a transaction block at all. Verify the values are
usable *after* apply before writing anything that inserts them.

## 18. Activity feed scoping and new notifications — 0032b (165 min)

**18a — Column + insert audit (60 min).** `activity_feed.circle_id` (spec §3.10), then **audit every
`INSERT INTO public.activity_feed` call site** and confirm each carries tier context. Spec §10.7 names
this as where leaks hide — the read policy is only half the protection; an insert that drops tier
context leaks regardless.

**18b — Leak tests (45 min).** As Erin (public-only) and Dave (isolated): a League A-exclusive market
action must not appear in the public feed or a non-member's feed; a Circle X action must not leak.
Public activity still shows for everyone; existing notifications still deliver.

**18c — Actually fire the new notifications (60 min).** Step 17 only adds enum *values*; without this
part nothing ever creates or renders them, and the whole of spec §3.9 ships as dead schema.

- **`market_about_you`** — the spec's named viral hook. When a market's title or description
  `@`-mentions an existing user, notify them ("people are forecasting on a market about you"). Reuse
  the mention-parsing that already exists for comment `@`-mentions (`0019`) rather than writing a
  second parser. Fires on market create and on approval.
- **`circle_joined` / `circle_invite`** — on joining a circle and on being invited (step 25's flow).
- **`comment_reply`** — when someone replies to your comment (step 16's `parent_comment_id`).

Each must respect tier visibility: never notify a user about a market they can't see. Render all four
in the existing notifications UI.

*Not in scope:* the non-user version of `market_about_you` ("47 classmates are forecasting about you,
sign up to see"). That needs an out-of-band share mechanic, not a notification — spec Decision #5
defers it to the growth phase.

## 19. Profile bio and the missing edit route — 0033 (60 min)

`profiles.bio TEXT` (spec §3.11), then fix Finding 6: `profile/[username]/page.tsx:111` renders an
"Edit profile" button linking to `/profile/[username]/edit`, and **that route doesn't exist** — the
directory holds only `page.tsx` and `loading.tsx`. It renders whenever `isOwnProfile`, so every user
has a 404 button on their own profile, against the repo's own "never ship a button that does nothing"
rule.

Build the edit route with a form for display name, avatar and the new bio. Verify the existing
`profiles_update_own` policy still blocks editing someone else's.

---

# Part VI — Navigation overhaul (steps 20–28) · spec §11

Only after the tier migrations are proven — the sidebar can't list "your circles / your leagues as
places" until circles exist and markets carry a tier.

**The flip:** place (tier) becomes primary navigation; category becomes a filter chip inside every
feed. Home = public trending for alpha (Option A), evolving to a personalized blend later — the
ranking logic for B isn't worth building before the tiers are validated (§11.4).

## 20. Category filter chips (45 min)
Build first; every later feed consumes it. A Sports / Social / Actions chip row that filters the feed
below it. Colors come from `getCategoryColors()` in `src/lib/utils.ts`, not CSS tokens.

## 21. Feed consolidation (60 min)
Retire `/dashboard/{sports,social,actions}` as routes — their content becomes the chip-filtered view
of one feed. Extract the shared feed body so Home, Explore, circle and league feeds all render the
same component with a different market scope.

## 22. Home route and Stat Leaders (60 min)
Rename `/dashboard/trending` → Home and repoint all nine redirect sites (`proxy.ts:58,66`,
`app/page.tsx:12`, `api/auth/callback/route.ts:12,16`, `login/page.tsx:16`, `onboarding/page.tsx:11`,
`OnboardingForm.tsx:70`, `lib/auth.ts:37`, `Sidebar.tsx:25,70`, `BottomTabBar.tsx:9`).

Trending becomes the default **sort**, not a destination. Preserve the four algorithmic sections and
**all three** Stat Leader cards — **Hot Streak, Cold Streak, and Week's Best** — as a Home module
(spec §11.3). They exist in the code today and must survive the move intact.

## 23. Sidebar, tier-first (60 min)
`Sidebar.tsx`: top = places (Home, Explore, each circle individually with its avatar, each league
individually — Discord-rail style). Bottom = utility (My Bets, Notifications, Reports, Create, Admin,
profile card with coin balance).

## 24. Mobile tab bar (45 min)
`BottomTabBar.tsx` to the five slots from §11.2: **Home · Circles · Leagues · Activity · More.**
Circles and Leagues open list views (no room for a per-item rail on mobile); Activity folds in
Notifications + My Bets + Stat Leaders; More holds Reports, Suggest, profile, settings, Admin.

## 25. Circle screens (60 min)
Circle list, circle feed (reusing step 21's component), join-by-invite-code, member list. Model the
card on the existing `src/components/leagues/LeagueCard.tsx`.

## 26. League feed parity (45 min)
Point `/leagues/[id]` at the shared feed component so league markets render with the same chips and
card treatment as everywhere else. Keep the tournament standings panel visible only when
`tournament_enabled` is on.

## 27. Context-aware Create button (60 min)
Per §11.3, one control whose behavior follows the permissions matrix based on where the user is: in a
**league** → create directly (step 13's RPC); in a **circle** → suggest → moderator approves; on
**Home / Explore** → suggest → admin approves. Replaces the standalone "Suggest a Line" entry point.

## 28. Comment section UI (60 min)
Render step 16's threading in `src/components/markets/MarketComments.tsx` — replies nested under their
top-level parent, replies-to-replies flat under that same parent — plus the reaction palette. This is
the "real sports app comment section" the spec is after.

---

# Deliberately not in these 28 steps

Stated so absence reads as a decision rather than an oversight. The first three are spec content the
plan consciously defers; the rest is spec §9's own exclusion list.

**Deferred spec content:**

- **`circles.joining_policy` beyond invite codes** (§2.1) and **`circle_join_requests`** (§2.3). The
  column ships with the table in step 8 and accepts `open` / `invite_code` / `request_approval`, but
  only the invite-code path is built (step 25). Decision #2 says codes are the right call for alpha —
  and notes most schools don't issue student email, so domain verification may never be primary.
  `circle_join_requests` is needed only for `request_approval`; the spec marks it deferrable.
- **League → circle promote** (§3.3). Step 11 adds `leagues.circle_id`, which is what would power a
  league inside a circle pushing one of its markets up to circle tier. The column lands; the mechanic
  doesn't. It needs its own approval-and-attribution design, and nothing else depends on it.
- **The non-user "market about you" share mechanic** (Decision #5) — see step 18c.

**Out of scope per spec §9:** social graph (follow/friend/block), direct messaging, cross-circle
leagues, email-domain circle verification, and real-money anything. The play-coin economy is the
entire economy, permanently.

---

# Verification

**Every step:** `npm run type-check` && `npm run lint` && `npm run build` clean.

**Every migration** (spec §10.5, all ten): applies clean on a fresh local DB · rollback documented ·
idempotent on re-run · row counts and FKs intact · types hand-updated and app builds · positive tests
green · negative tests green including every direct-by-ID read **and every negative write** ·
betting-loop regression green · `EXPLAIN` sane on new hot-path queries · one line logged in
`MIGRATIONS_LOG.md`.

```bash
npx supabase start                 # local stack (step 2)
npx supabase db reset              # replay full history locally
npm run test:rls                   # RLS matrix — red before 10b, green after
npm test                           # unit + betting-loop regression
npx supabase db push --dry-run     # confirm only the intended migration is queued
```

**Git:** commit and push directly to `main` — no branches, no PRs.
