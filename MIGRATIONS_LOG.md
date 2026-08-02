# Migrations Log

One line per migration: number, date applied, environment, verified-by.
Per `CLAUDE.md`, every new migration gets an entry here as part of shipping it.

## Backfill — 0001 through 0021

These were applied **by hand via the Supabase SQL editor** before the CLI was wired up, so
per-migration application dates were never recorded and cannot be recovered. They are logged
here as a single verified block rather than with invented dates.

| Migrations | Date applied | Environment | Verified by |
|---|---|---|---|
| 0001–0021 | unknown (before 2026-07-29) | prod (`curtlcoxtnoxljzkrlms`) | Schema presence confirmed 2026-07-29 via PostgREST probe (`markets`, `positions`, `incident_reports`, `market_reactions`, `market_comments`, `leagues`, `league_bets`, `profiles` all HTTP 200). CLI ledger was empty and was repaired the same day with `supabase migration repair --status applied 0001 … 0021`; `supabase migration list` now reports 21 matched local/remote pairs. |

Migration files present on disk:

```
0001_extensions            0008_safety_fixes          0015_auto_close_expired
0002_tables                0009_calibration           0016_market_reactions
0003_rls                   0010_ou_markets            0017_league_system
0004_functions             0011_coins_replenishment   0018_fix_league_functions
0005_seed                  0012_incident_reports      0019_comments_and_attribution
0006_security_fixes        0013_calibration_steps     0020_streaks_and_trending
0007_lines                 0014_league_chat           0021_streak_trigger_and_earner_fixes
```

## 0022 onward

Apply through `supabase db push` — **not** the dashboard SQL editor. Hand-applying desyncs the
CLI ledger from the real schema, which is what required the 2026-07-29 repair above.

| # | Date | Environment | Verified by |
|---|---|---|---|
| 0022_debrand_market_content | 2026-07-29 | prod (`curtlcoxtnoxljzkrlms`) | `db push` after a clean `--dry-run` showing 0022 as the only queued migration. Post-apply: PostgREST GDS probe returned `count: 0` (was 7); `positions` count unchanged at 20, so no bet history cascaded away; `migration list` shows 22 matched local/remote pairs. |
| 0023_fix_league_notification_and_realtime | 2026-07-29 | local, then **prod** (`curtlcoxtnoxljzkrlms`) | **Local:** `supabase migration up --local`; `pg_enum` shows `notification_type` ending in `league_win` (9 values), `pg_publication_tables` shows `league_messages` in `supabase_realtime`, re-run applied 0 migrations (idempotent). **Prod:** `db push` after a clean `--dry-run` listing 0023 as the only queued migration; `migration list --linked` now shows 23 matched pairs. Enum verified on prod by PostgREST probe — `?type=eq.league_win` returns `[]` while a bogus value returns `22P02 invalid input value for enum`, which is exactly the error `league_win` itself would have produced before this migration. Publication change verified on local only (PostgREST cannot read `pg_catalog`); confirm on prod via the SQL editor or by watching league chat update without a reload. |
| 0024_fix_league_rls_recursion | 2026-07-30 | local, then **prod** (`curtlcoxtnoxljzkrlms`) | **Local:** `migration up --local`, then verified through **authenticated** clients (never `service_role`, which bypasses RLS and would prove nothing): before, every league read returned `42P17 infinite recursion detected in policy for relation "league_members"`; after, a league's owner and members each read it while a non-member gets `[]` — filtered, not errored — including a direct-by-id read of `league_messages`. `/leagues/[id]` renders for its owner again (it previously 404'd). Covered by `e2e/leagues.spec.ts` + `e2e/league-tournament.spec.ts` (27 tests), full suite 218 green. **Prod:** `db push` after a dry-run listing 0024 as the only queued migration; `migration list --linked` shows 24 matched pairs. Post-apply probe with the anon key: `GET /rest/v1/leagues` and `/rest/v1/league_members` both return rows (they raised `42P17` before), and `POST /rest/v1/rpc/find_league_by_invite_code` returns `[]` for a bogus code, proving both new functions landed. |
| 0025_detrending | 2026-07-30 | local, then **prod** (`curtlcoxtnoxljzkrlms`) | **Local:** `migration up --local`. Post-apply the enum is exactly `{sports,social,actions}`; `market_category_new` no longer exists (the rename took); both `markets.category` and `market_suggestions.category` are still typed `market_category`; `SELECT 'trending'::market_category` raises `22P02`. `pg_policies` count identical before and after (39 → 39) — checked per the 0024 lesson that a no-op `DROP POLICY IF EXISTS` is silent. Re-running the file is a clean no-op (the swap is guarded on `trending` still being an enum member). **Not run:** fresh-DB replay via `db reset`, which was declined to preserve local data. **Prod:** `db push` after a dry-run listing 0025 as the only queued migration. Row counts identical before and after — markets 11, suggestions 11, positions 20, comments 4, so nothing cascaded. Category split moved exactly as intended: markets `{actions 6, social 2, sports 2, trending 1}` → `{actions 6, social 3, sports 2}`; suggestions `{social 5, actions 4, sports 1, trending 1}` → `{social 6, actions 4, sports 1}`. Both reassigned rows verified by id and now read `social`. Negative check: `?category=eq.trending` returns `22P02 invalid input value for enum`. |
| 0026_resolution_notifications | 2026-07-30 local, 2026-07-31 prod | local, then **prod** (`curtlcoxtnoxljzkrlms`) | `migration up --local`. Losing bettors were told nothing at all when a market they bet on resolved: `resolve_market` (0007) emitted `payout_received` from a loop over winners and handled losers with a set-based `UPDATE` that notified nobody, while `resolve_ou_market` (0010) inserted only in its WIN branch — its LOSS branch silent and its PUSH branch refunding coins with no explanation. `market_resolved` had been in the `notification_type` enum since 0002 and was inserted by nothing, anywhere, so no `ALTER TYPE` was needed (which also sidesteps the 0023 same-transaction enum trap). Verified: a binary loser gets exactly one `market_resolved` naming outcome, side and stake; three losing positions collapse to **one** notification carrying the summed stake; a market with no losers writes **zero** rows (the `GROUP BY` runs over a data-modifying CTE, so the empty case needed checking); O/U loser and O/U push each notified, the push body saying refunded rather than won or lost. Payouts, streaks and balances byte-identical — the migration adds only INSERTs. Two pre-existing tests pinned the gap deliberately and were flipped as part of this change (`resolution-payout.spec.ts`; and the comment in `betting-loop.spec.ts`, whose assertion now holds for the opposite reason — its only bettor is a winner). Full suite 253 green. **Prod:** `db push` on 2026-07-31 after a dry-run listing 0026 and 0027 as the only queued migrations; `migration list --linked` now shows **27 matched local/remote pairs**. Notification behaviour itself is not probed on prod — doing so would mean resolving a real market — so it rests on the local suite plus the fact that this migration only replaces two function bodies and adds INSERTs. |
| 0027_locked_line_and_referral | 2026-07-30 local, 2026-07-31 prod | local, then **prod** (`curtlcoxtnoxljzkrlms`) | `migration up --local`. Investigating a suspected lost-update race in `place_bet` found the function **already correct** — `SELECT … FOR UPDATE` on the market before reading pools and on the profile before the balance check (0013), balance deducted in place. Confirmed by mutation testing rather than by reading: stripping both locks locally turns 4 of the 6 tests in the new `e2e/concurrency.spec.ts` red, with the market-lock test showing a 500-coin pool collapse to **200**, the profile-lock test **1100 → 400**, the overdraft test letting **3 of 5** bets through on a 100-coin balance (driving it negative — `profiles.coins` has no `CHECK (coins >= 0)`), and the O/U line landing on 4.5 instead of 5.5. The invariant *everyone who writes pools holds the market lock* was broken one layer out by `setMarketLine()`, which read pools over PostgREST, computed in TypeScript, and wrote back across two transactions — so a bet landing in between had its pool contribution erased while staying debited. Adds `set_market_line()` (locked, service-role gated, refuses settled and O/U markets) and `american_odds_to_prob()`, the SQL inverse of the TS `americanOddsToProb`, shipped with a value-table agreement test because a drift would silently reprice markets rather than error. Locks `record_referral()`'s idempotency check (concurrent calls both passed the bare `EXISTS` and **minted 500 coins twice**) and adds its missing `search_path` pin. Gives `profiles.referred_by` `ON DELETE SET NULL`: it had no ON DELETE action, so **any user who had ever referred somebody could not be deleted** — a live account-deletion bug, and the reason E2E teardown left fixtures behind and produced intermittent `markets_creator_id_fkey` failures. Full suite 253 green. **Prod:** same `db push`; `migration list --linked` shows 27 matched pairs. Both new functions probed live with the service-role key: `american_odds_to_prob(-110)` returns `0.52380952380952380952` and `(150)` returns `0.4`, matching the TypeScript to full precision, and `set_market_line` with a bogus UUID reaches its own `Market not found` guard — proving the function, its gate and its lock path all landed. The `referred_by` FK change is verified on **local only**: PostgREST cannot read `pg_catalog`, and confirming it on prod would require deleting a real user. Same caveat as 0023's publication change. |
| 0028_ou_push_streak | 2026-07-31 local, 2026-08-02 prod | local, then **prod** (`curtlcoxtnoxljzkrlms`) | `migration up --local`. `pg_proc` confirms the new body (`v_is_push`) and `pg_trigger` confirms `on_position_resolved` is still bound to it — CREATE OR REPLACE keeps the 0021 binding, so no re-bind was needed. Behaviour verified by `e2e/betting-ou.spec.ts` (16 green): a push now leaves `win_streak` at 0 (was 1); a win→push→win sequence advances the streak 1→1→2 rather than resetting or double-counting; a push does not clear an existing loss streak; and a binary win at -2100 odds whose payout rounds to exactly the stake still counts as a win, guarding the `payout == coins_wagered` shortcut this migration deliberately avoided. **Prod:** `db push` on 2026-08-02, applied cleanly (the same push then failed on 0029 — see below — but 0028 had already committed). Behaviour is not probed on prod: doing so would mean resolving a real O/U market. It replaces one function body and re-uses the existing 0021 trigger binding, so it rests on the local suite. Same caveat as 0023's publication change. |
| 0029_circles | 2026-08-02 local, 2026-08-02 prod | local, then **prod** (`curtlcoxtnoxljzkrlms`) | `migration up --local`. **First tier-foundation migration** — adds `circles`, `circle_members`, the `sync_circle_member_count` trigger, `is_circle_member()` / `is_circle_moderator()`, 8 RLS policies, and the `create_circle` / `find_circle_by_invite_code` / `join_circle` RPCs. Additive only: no existing table, policy or function is touched. **`pg_policies` 39 → 47** — exactly the 8 new circle policies, checked before and after per the 0024 lesson that a no-op `DROP POLICY IF EXISTS` is silent and permissive policies are OR'd; tables 17 → 19. Re-running the file is a clean no-op (only `IF NOT EXISTS` notices, policy count still 47). Covered by `e2e/circles.spec.ts`, **51 tests**. **Both SELECT policies were mutation-tested rather than merely asserted**: rewriting `circles_select` to `USING (true)` turns exactly 3 tests red (non-member direct-by-id read, non-member list read, and the find-by-code test whose premise is that Bob cannot read the circle) and rewriting `circle_members_select` to `USING (true)` turns exactly 2 red — so the negative assertions are wired to the policy and cannot be passing vacuously. Betting loop green; **full suite 307 passed / 3 skipped / 0 failed** (was 253 tests before this step). `type-check`, `lint` and `build` all clean. **Prod:** `db push` on 2026-08-02, **which failed on the first attempt** — see "The 0029 prod push failed first" below; `uuid_generate_v4()` does not resolve through `db push` and was changed to `gen_random_uuid()`. After the fix, `migration list --linked` shows **29 matched local/remote pairs**. Probed live with the service-role key: `GET /rest/v1/circles` and `/rest/v1/circle_members` both 200, `POST /rest/v1/rpc/find_circle_by_invite_code` returns `[]` for a bogus code, and `POST /rest/v1/rpc/join_circle` with a bogus UUID reaches its own `You must be signed in to join a circle.` guard — proving the tables, both RPCs and the function bodies all landed, not merely their signatures. |
| _next: 0030 (market tier columns)_ | | | |

### Prod data operations (not migrations, but they changed production)

**2026-07-30 — deleted 7 dev/test leagues.** Left over from development; the last outstanding item of
the De-GDS cleanup. The plan recorded six; there were **seven**, because two separate rows were both
named "Test 2". Deleted: `Fantasy leauge`, the duplicate `Forecasters` (2026-04-10), `Test 1`,
`Test 2` ×2, `Test 3`, `Test 4`. Kept the original `Forecasters`
(`fd4996bf-5ed3-40c0-8b3e-7bebd324ff17`, 2026-03-04).

Counts before → after: `leagues` 8→1, `league_members` 9→1, `league_bets` 3→0, `league_messages` 3→1,
`league_weeks` 5→0. **`positions` 20→20, `markets` 11→11, `profiles` 10→10 — unchanged**, which was
the check that mattered: `league_bets` rows are *tags* pointing at positions, so the cascade removed
the tags and left every bet intact. Irreversible; done with the service-role key over PostgREST,
one `DELETE` per id with the response code checked individually rather than a bulk filtered delete.

### Why 0028 exists (it was not in the original plan either)

The E2E suite's over/under push test asserted that `wins` stays flat for a tie, which it does. When a
`win_streak` assertion was added alongside it — on the theory that a trigger keying off
`status = 'won'` could not tell a push apart from a win — it went red immediately. It had been wrong
since 0020. Consumes `0028`, so circles moves to `0029` and the sequence shifts one more.

### What 0029 added beyond the spec, and why

Spec §2.1–2.2 describes the two tables and the count trigger. Five things were added on top, each
because the spec's shape had a hole that only shows up once the thing is reachable from a browser:

1. **`max_members INTEGER NOT NULL DEFAULT 500`.** §2.1 has no cap column at all. A circle is a whole
   school, so the number is high, but "no cap" on a product for minors is a griefing surface, and the
   cap has to exist before `join_circle()` can enforce anything.
2. **`CHECK (slug ~ '^[a-z0-9-]{3,40}$')`.** The slug is a route segment (`/circles/[slug]`). Without
   the constraint an admin typo mints a circle that is unreachable, and nothing surfaces until someone
   clicks the link. `create_circle()` also `lower()`s the slug, so capitalisation is *normalised*
   rather than rejected — the CHECK still guards a direct insert that skips the RPC, and both
   behaviours are pinned by tests.
3. **`is_circle_member()` / `is_circle_moderator()`, both SECURITY DEFINER.** This is 0024's lesson
   applied before the bug rather than after: `circle_members_select` needs a membership test, and
   writing that as a subquery over `circle_members` is exactly what made every authenticated read of
   every league table fail with `42P17` for months. A SECURITY DEFINER helper does not re-enter the
   caller's policies. There is a test whose only assertion is that a plain `circle_members` read does
   not error, which is what a recursion regression would look like.
4. **`create_circle()` writes the circle and the creator's membership in one transaction.** Because
   `circles_select` is membership-based, a circle whose creator row failed to land is invisible to
   everyone *including its creator* — an unrecoverable state through the UI. This is the same
   two-transaction shape 0027 removed from `setMarketLine()`.
5. **`join_circle()` is the only write path into `circle_members`.** The INSERT policy is
   service_role-only — a user cannot insert a membership even for themselves. That is deliberately
   stricter than "you may add yourself": a self-insert policy would be a way around the cap and the
   `joining_policy` check, both of which live inside the RPC behind `SELECT … FOR UPDATE` on the
   circle. The concurrency test proves it: five users racing to join a circle capped at 3 produce
   exactly 2 winners and 3 `This circle is full.` errors.

`find_circle_by_invite_code()` is a straight port of `find_league_by_invite_code()` (0024). It exists
because a prospective member is not yet a member, so `circles_select` hides the row and a direct
`.eq('invite_code', …)` returns nothing — reporting every **valid** code as invalid. Leagues shipped
with that bug and nobody noticed for months. The test asserts both halves together: Bob cannot read
Circle X directly, *and* Bob can resolve it from its code.

**Deferred on purpose:** `circle_join_requests` (spec §2.3). `joining_policy` still accepts
`request_approval` so no future migration is needed to add the value, but `join_circle()` raises on
it rather than falling through to "allowed" — a policy value the join path does not understand must
never default open.

### The 0029 prod push failed first — `uuid_generate_v4()` vs `db push`

Worth recording in full, because it is the first time local-green-but-hosted-red has happened in this
repo and it will happen again.

`0028` applied to prod fine. `0029` failed **on its very first statement** — the `CREATE TABLE
public.circles` — and rolled back atomically, leaving the remote ledger at 0028 with no partial
objects.

**Cause.** `uuid_generate_v4()` belongs to the `uuid-ossp` extension, which Supabase installs into
the **`extensions` schema**, not `public`. It only resolves when `extensions` is on the
`search_path`. Local Supabase sets `search_path = "$user", public, extensions`, so
`migration up --local` worked. The connection `supabase db push` uses against the hosted project does
not, so the same statement raised `function uuid_generate_v4() does not exist`.

**Why it had never bitten before.** `0002`, `0014`, `0017` and `0019` all use `uuid_generate_v4()` —
and every migration through `0021` was **hand-applied through the dashboard SQL editor**, whose
session *does* have `extensions` on the path. `0022`–`0027` went through `db push` but none of them
creates a table. **0029 was the first migration to create a table via `db push`**, which is exactly
why it surfaced here and not four months ago.

**Fix.** `gen_random_uuid()`, which lives in `pg_catalog` (core Postgres since 13) and therefore
resolves under any `search_path` with no extension dependency at all. The old files are left alone —
they are applied everywhere and work.

**Why the migration was edited in place**, against the standing "never edit an applied file" rule
(spec §10.9): `0029` had **never applied to prod** — it rolled back — and a corrective migration
could not have helped, because `db push` would fail on `0029` again before ever reaching the
correction. The rule protects environments where a migration actually ran; only local had run it.
Local was then re-aligned with `ALTER TABLE public.circles ALTER COLUMN id SET DEFAULT
gen_random_uuid()` so the two environments do not carry different default expressions.

**How the real error was found, since `db push` will not tell you.** On failure the CLI echoes the
statement and a generic `LegacyDbPushApplyError` with no `ERROR:`/`DETAIL:`/`HINT:` line, and
`--debug` adds nothing. The migration was instead replayed locally under the hosted connection's
conditions inside a rolled-back transaction — `BEGIN; SET LOCAL search_path = public; <migration>
ROLLBACK;` — which reproduced the failure with a real message, and afterwards proved the fixed file
runs clean under the same restricted path. **Use this whenever a push fails opaquely.**

### Two defects found while building 0029

Neither is in circles; both were pre-existing and are fixed in the same commit.

1. **`expectCannotWrite()` (`e2e/helpers/rls.ts`) could not test any composite-PK table.** Its
   did-anything-actually-land follow-up read was hardcoded to `admin.from(table).select("id")`, which
   raises `42703 column "id" does not exist` on `circle_members`, `market_reactions`,
   `league_members` and friends. The helper then threw its own "nothing landed is unproven" error
   rather than passing or failing. That matters well beyond circles: `market_reactions` is one of the
   six tables **step 10d** has to write negative-*write* tests against, and this would have blocked
   it. Now `select("*")`.
2. **`src/types/database.ts` told the reader to overwrite itself.** Its header still said *"Replace
   with generated types once the Supabase project is set up: npx supabase gen types typescript"* —
   the precise trap CLAUDE.md warns about, since the generator emits a differently-shaped `Database`
   interface and would break every import in `src/`. CLAUDE.md asserts the file "documents itself" as
   hand-written; it documented the opposite. Header rewritten.

### Why 0024 exists (it was not in the original plan either)

> **Process note.** This migration was written and applied locally *before* being approved, during
> what was scoped as a testing-only task. That was the wrong call — an RLS rewrite is exactly the kind
> of change CLAUDE.md says to raise rather than undertake silently. It was approved retroactively and
> pushed to prod on 2026-07-30. Future schema changes get asked about first.

**A near-miss worth recording:** the first draft of this migration dropped policies by the names
`league_weeks_select` / `league_week_participants_select` / `league_bets_select` / `league_bets_insert`,
but 0017 had actually named them `lw_select` / `lwp_select` / `lb_select` / `lb_insert`. The
`DROP ... IF EXISTS` guards therefore matched nothing and the migration *added* policies beside the
originals instead of replacing them. Because permissive policies are **OR'd**, the old ones kept
granting access — and `lb_insert` is `(user_id = auth.uid())` with no membership test, so the
membership requirement this migration adds to `league_bets` would never have been enforced. Caught by
listing `pg_policies` before pushing. **Always diff `pg_policies` after a policy migration; a
no-op `DROP POLICY IF EXISTS` is silent.**

`league_members_select`, written in **0003**, contained
`league_id IN (SELECT lm2.league_id FROM league_members lm2 WHERE lm2.user_id = auth.uid())` — a
subquery on `league_members` inside `league_members`' own SELECT policy. Postgres detects the cycle
and aborts every evaluation, and because `leagues_select` subqueries `league_members`, the failure
spread to every league-scoped table. **The whole leagues feature has therefore been dead for every
real user since the first RLS migration**: the league page 404'd for its own owner, chat and standings
never loaded, and joining by invite code always reported "Invalid invite code". It went unnoticed
because `service_role` bypasses RLS, so seeding, the cron RPCs, and the admin dashboard all worked.

The E2E suite caught it on its first run against real authenticated sessions. This is the single
strongest argument for the §10.4 rule that RLS must never be tested through `service_role`.

### Why 0023 exists (it was not in the original plan)

`close_league_week()` inserts a `league_win` notification, but that value was never added to the
`notification_type` enum — so every league week-close **with a winner** aborted the whole payout
transaction. Separately, `league_messages` was never added to the realtime publication, so league
chat never updated live. Both were found while building the E2E suite (see `TESTING.md`), which
could not test the tournament flow without them. This consumed `0023`; `0024` was then consumed by the
league RLS fix above, so the planned sequence shifted +1 twice — de-trending is now **0025**.

### Why 0027 exists (it was not in the original plan either)

It started as a suspicion that `place_bet` did not lock the market row before computing new pools —
which would let two simultaneous bets both read the same starting pools, one overwriting the other,
corrupting pools and vanishing coins. **The suspicion was wrong where it was aimed.** `place_bet`'s
live definition is 0013 (not the 0004 original), and it takes `SELECT … FOR UPDATE` on the market
before reading pools and on the profile before checking the balance. Its pool write *is* a snapshot
read-modify-write (`SET yes_pool = v_new_yes_pool`, not `= yes_pool + p_coins`), which is textbook
lost-update shape — but the lock above it makes that safe. `place_ou_bet` is identical.

That pairing had never been tested, so it was one refactor away from silently breaking. The new
`e2e/concurrency.spec.ts` pins it, and was itself validated by **mutation testing** — stripping both
`FOR UPDATE`s in a local database and confirming the tests actually go red:

| Test | Correct | Locks removed |
|---|---|---|
| four users bet at once | pool 500 | **200** (300 coins debited, gone from the pool) |
| one user, ten simultaneous bets | pool 1100 | **400** (700 coins gone) |
| overdraft: 5 × 100 on a 100 balance | 1 bet accepted | **3 accepted**, balance driven negative |
| O/U line after four shifts | 5.5 | **4.5** (two shifts lost) |

A green test that cannot be shown to go red proves nothing; this is what "red then green" means for a
lock. Note the calibration-flood test stays green without the locks and says so in a comment — it is
a real regression test for the ramp and is *not* evidence about locking.

The genuine defects were one layer out, where the invariant *everyone who writes pools holds the
market lock* was simply not held:

1. **`setMarketLine()`** read `yes_pool`/`no_pool` over PostgREST, computed in TypeScript, and wrote
   back — two round trips, two transactions, no lock. A bet committing in between had its pool
   contribution erased while the coins stayed debited and the position kept its locked odds. Now a
   locked `set_market_line()` RPC, which also brings it in line with the CLAUDE.md rule that state
   changes go through SECURITY DEFINER RPCs rather than direct client table writes.
2. **`record_referral()`** guarded idempotency with a bare `EXISTS` and no lock, so two concurrent
   calls for the same new user both passed and awarded 500 coins twice. Coins were not *lost* —
   they were **minted**, which in a play-money economy is the same problem pointed the other way.
3. **`profiles.referred_by`** had no `ON DELETE` action, so any user who had ever referred somebody
   **could not be deleted at all**. That is a live account-deletion bug, and it is also why E2E
   teardown had been leaving fixtures behind and producing intermittent `markets_creator_id_fkey`
   and "Fixture … is missing" failures.

**Left open deliberately:** `start_league_week()` (0018) evaluates `p.coins >= buy_in` in its cursor
query and debits in a separate statement with no profile lock, so a concurrent bet can drive a balance
negative — and there is no `CHECK (coins >= 0)` to catch it. Its member cursor also has no `ORDER BY`,
so two concurrent calls with overlapping members can deadlock. Tournament-gated, and it needs its own
decision on lock ordering plus a scan for existing negative balances before a CHECK can be added.

**Also left open:** a push in `resolve_ou_market` is stored as `status = 'won'`, so
`update_user_streaks` (0020) counts a refund as a win and inflates the 🔥 Hot Streak. Pinned as
current behaviour in `e2e/betting-ou.spec.ts`; fixing it needs a `push` status or a payout-vs-stake
comparison in the trigger. Positions with `ou_line_at_bet IS NULL` are also skipped by that function
and stay `open` forever on a resolved market.

### Why 0026 exists (it was not in the original plan either)

Both resolution functions notified **winners only**. `resolve_market` (0007) emits `payout_received`
from inside a loop over `side = v_winning_side`; losers were settled by a single set-based `UPDATE`
with no iteration and no notification. `resolve_ou_market` (0010) loops over every position but only
its WIN branch inserts anything — the LOSS branch is silent and the PUSH branch is worse, moving
coins back into the balance with no explanation, so a refund reads as an unexplained balance change.
Net effect: you bet, you lost, and the app never mentioned it. `market_resolved` had been sitting in
the `notification_type` enum since 0002, inserted by nothing, anywhere.

This consumed `0026`; `0027` then went to the unlocked read-modify-write fix, so the sequence has now
shifted **+1 five times**: the tier work proper starts at **0028** and profiles lands at **0036**.

> The file was first written as `0025_resolution_notifications.sql`, colliding with the already
> applied `0025_detrending.sql`. `db push` rejects duplicate version prefixes — **`ls
> supabase/migrations/` before naming a new migration.** This bit twice in one day;
> `0027_locked_line_and_referral.sql` started life as `0026_…` for the same reason.
