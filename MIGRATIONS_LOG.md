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
| 0023_fix_league_notification_and_realtime | 2026-07-29 | **local only** | `supabase migration up --local`. Post-apply `pg_enum` shows `notification_type` ending in `league_win` (9 values); `pg_publication_tables` shows `league_messages` in `supabase_realtime`. Re-run applied 0 migrations (idempotent). **Not yet on prod** — needs a `db push` when you next promote. |
| _next: 0024 (de-trending — drop the `trending` category enum value)_ | | | |

### Why 0023 exists (it was not in the original plan)

`close_league_week()` inserts a `league_win` notification, but that value was never added to the
`notification_type` enum — so every league week-close **with a winner** aborted the whole payout
transaction. Separately, `league_messages` was never added to the realtime publication, so league
chat never updated live. Both were found while building the E2E suite (see `TESTING.md`), which
could not test the tournament flow without them. This consumed `0023`, so the planned sequence
shifted +1: de-trending is now **0024** and profiles lands at **0033**.
