# TESTING.md — how testing works here, and what "done" means

These rules are **binding**, in the same way `CLAUDE.md`'s engineering conventions are. They are not
aspirations. Read this before writing a test or claiming a task finished.

---

## The core rule

> **No feature, fix, or migration is "done" until it ships with passing tests in the same change.**

Not a follow-up commit. Not a TODO. Not "I'll add tests once it settles." The same change.

A change that has no test is a change nobody can safely touch again — and this codebase is about to
have its entire visibility model rewritten. The tests are what make that survivable.

### Why this is stricter here than in most projects

This app fails in two ways that produce **no error message**:

1. **RLS is silent.** A too-permissive policy leaks private data and throws nothing. A too-strict one
   returns `[]` and looks like an empty feed. Neither shows up in a build, a type-check, or a
   click-through as yourself — because as the owner or the admin you can see everything.
2. **Money is silent.** Payouts are computed from odds locked at bet time. An off-by-one in the
   multiplier does not crash; it just pays the wrong number, forever, to teenagers who will notice.

Both classes of bug are invisible to every tool except a test that asserts the exact value as a
specific user. That is the entire premise of this file.

**This is not hypothetical.** The first run of the E2E suite found that
`league_members_select` (written in migration `0003`) subqueried its own table, so **every**
authenticated read of every league table failed with `42P17 infinite recursion detected in policy` —
the leagues feature had been completely dead for real users for the whole life of the project. It was
invisible because `service_role` bypasses RLS, so seeding, cron, and the admin dashboard all worked
fine. See `MIGRATIONS_LOG.md` → "Why 0024 exists".

---

## Two layers, both required

| Layer | Tool | Runs | Covers |
|---|---|---|---|
| Logic, RPCs, RLS | **Vitest** | `npm test` | pure functions, SQL behaviour, and policy matrices through authenticated clients |
| User flows | **Playwright** | `npm run test:e2e` | real browser, real session, real database |

A change that touches both layers needs tests in both. A payout-formula change needs a Vitest
assertion on the arithmetic **and** an E2E assertion that the balance on screen matches the database.

```bash
npm test                 # Vitest — src/**/*.test.ts
npm run test:e2e         # Playwright — e2e/**/*.spec.ts (serial, local Supabase)
npm run test:e2e:loop    # just the flagship canary
npm run test:all         # both
npm run type-check && npm run build   # must also be clean
```

### First-time E2E setup

```bash
npx supabase start                 # needs Docker (it is installed; see CLAUDE.md)
npx supabase migration up --local
npm run db:local:bootstrap         # see "Local environment parity" below
npx playwright install chromium
npm run test:e2e
```

---

## The RLS methodology (spec §10.3–§10.4)

### `service_role` bypasses RLS. Never test a policy with it.

The admin client never sees a policy. A policy test written through it passes unconditionally and
proves nothing. This is exactly how the `0024` recursion survived for months.

RLS tests run through a client **authenticated as a specific user**:

```ts
// e2e/helpers/db.ts
const client = await anonClientFor(USERS.bob.email);   // anon key + Bob's session
const { data, error } = await client.from("markets").select("*").eq("id", circleXMarketId);
```

`admin` from the same module is for **setup, teardown, and reading state to assert against** — never
for the assertion about access itself.

### The single most important test: the direct-by-ID read

Hiding a row from a *list* is not access control. The row must be unreadable **even when the user
knows its exact UUID and asks for it directly**:

```ts
const { data, error } = await bob.from("markets").select("*").eq("id", circleXMarketId);
expect(error).toBeNull();   // RLS does not error — it filters…
expect(data).toEqual([]);   // …to empty. A row here is a leak.
```

Every tier-scoped table gets this test: `markets`, `positions`, `market_comments`,
`market_reactions`, `market_probability_history`, `activity_feed`.

**Test writes as well as reads.** A policy that scopes SELECT but leaves INSERT as
`user_id = auth.uid()` still lets an outsider who knows a private market's UUID write a comment into
it. Assert both directions.

### The seven-user matrix

Seed these once and reuse them for every migration's RLS tests. They are chosen so that every
visibility boundary has somebody on each side of it.

| User | League A | League B | Circle X | Circle Y | Role | Exists to prove |
|---|---|---|---|---|---|---|
| **Alice** | member | — | member | — | normal | sees public + League A + Circle X |
| **Bob** | member | — | — | — | normal | in Alice's league, **not** her circle → must not see Circle X |
| **Carol** | — | — | member | — | normal | in Alice's circle, **not** her league → must not see League A |
| **Dave** | — | member | — | member | normal | fully separate → must see none of Alice's private data |
| **Erin** | — | — | — | — | normal | public-only floor → sees nothing tier-scoped |
| **Mod** | — | — | moderator | — | circle moderator | can approve Circle X suggestions / set lines |
| **Admin** | — | — | — | — | platform admin | approves public markets, reaches `/admin` |

The adversarial pairs that matter: **Bob vs Circle X**, **Carol vs League A**, **Dave vs everything
Alice has**, **Erin vs all tiers**.

Also assert the helper directly, since every dependent policy leans on it:

```ts
expect((await alice.rpc("can_view_market", { p_market_id: circleXMarketId })).data).toBe(true);
expect((await bob.rpc(  "can_view_market", { p_market_id: circleXMarketId })).data).toBe(false);
```

> The current `e2e/` suite covers **Phase 0**, which has no tiers yet, so it uses a smaller five-user
> fixture set (`e2e/helpers/fixtures.ts`). The seven-user matrix lands in Vitest alongside migration
> **0028** (tier-aware RLS), where there is finally a tier boundary to test. That migration does not
> ship on a single red negative test.

### Admin is not a database concept

There is **no `is_admin` column and no Postgres role**. Admin identity is an app-layer email
allowlist (`ADMIN_EMAIL`, checked in `src/lib/auth.ts` and `src/proxy.ts`). The database only knows
`service_role`. So admin authorization needs testing at **both** layers: that a non-admin is bounced
from `/admin`, *and* that `resolve_market` refuses an authenticated caller — including the admin
fixture, whose browser session is not `service_role` either.

---

## What "covered" means

A new feature is covered when **all six** of these exist. Fewer is not covered.

1. **Happy path.** The thing works when used correctly.
2. **At least one failure or permission path.** What happens when it is used wrongly, or by somebody
   who should not be able to.
3. **Authorization proven by a direct API/RPC call.** A disabled button and an unrendered control are
   *not* access control — they are decoration over the real boundary. If the endpoint accepts the
   request, the feature is not secure, however tidy the UI looks. Several real boundaries in this app
   are reachable *only* this way: `BettingPanel` disables submit on an invalid amount, the daily-bonus
   button disables itself after a claim, and a closed market renders no bet form at all. Each of those
   is asserted with a direct `POST`.
4. **Exact-value state assertions.** Money is asserted to the **exact integer** — never a range,
   never "more than before", never `toBeTruthy`. `expect(coins).toBe(1100)`, not
   `expect(coins).toBeGreaterThan(1000)`. Where a value is genuinely random (the 50–150 daily bonus),
   assert the range **and** assert the resulting balance exactly against the returned amount.
5. **Tiered-visibility checks by direct ID / direct route access** wherever a tier is involved. See
   above.
6. **The flagship betting loop stays green.**

### The flagship canary

`e2e/betting-loop.spec.ts` walks the whole core loop in one test: log in → claim bonus → place a bet
→ coins/pools/odds move → admin resolves → payout + streak + notification land → leaderboard reflects
it. Every step is asserted against the database at exact values.

**If this file is red, stop.** Do not ship the change. Do not adjust the test. Spec §10.6 requires it
to pass after every migration; `CLAUDE.md` states the betting loop must never break.

---

## Reporting

**Every finished task's summary must end with a line naming the tests and the pass count**, in this
exact shape so it is greppable:

```
Tests: <files or test names added/changed> — <N> passing, <M> pre-existing green.
```

For example:

```
Tests: e2e/betting-ou.spec.ts (10 new), src/__tests__/market-logic.test.ts (+3) — 13 passing, 178 pre-existing green.
```

If you did not add tests, the line says so and explains why — and "why" had better be that the change
was a comment or a doc edit.

---

## Forbidden

These are not judgement calls.

- **Weakening, deleting, or skipping a test to make a change pass.** The test is the requirement. If
  the test is wrong, fix it *as its own change*, with the reasoning written down.
- **Loosening an exact assertion** to a range, a `toBeGreaterThan`, or a `toBeTruthy` because the
  exact value stopped matching. A changed number means behaviour changed; find out why.
- **Widening a timeout or adding a sleep** to paper over a race. Poll for the actual condition. The
  helpers `waitForCommentCount` / `waitForReactionCount` exist for exactly this — several components
  update optimistically, so the DOM is ahead of the database and a single read races the write.
- **`.only` or `.skip` committed to `main`.**
- **Testing an RLS policy through `service_role`.**
- **Asserting a bug as if it were intent** without saying so. Where the suite pins current-but-wrong
  behaviour (losers get no resolution notification; a just-posted comment cannot be deleted until
  remount), the test says so in a comment and names the gap, so that fixing it fails the test
  deliberately rather than silently.

### The one escape hatch

`test.fixme('not built yet')` — for a genuinely unbuilt feature, so the gap is tracked instead of
forgotten. Never for a test that is merely failing. Current legitimate uses: profile editing
(`/profile/[username]/edit` does not exist), leaving a league, and league settings — all of which have
no UI at all.

---

## Local environment parity

A fresh `supabase start` does **not** match the hosted project. Recent Supabase images ship a
restrictive default ACL that grants `anon` / `authenticated` / `service_role` no
SELECT/INSERT/UPDATE/DELETE on schema `public`, so every request — even with the service key —
returns `42501 permission denied`. The hosted project was provisioned when those grants were the
default, so it works and local does not.

`npm run db:local:bootstrap` applies `supabase/local-bootstrap.sql`, which restores the grants and
sets the default privileges for future tables. Run it once per fresh local database.

It is **not** a migration and must not become one — settled 2026-07-30. These grants are project
provisioning, not schema; prod already has them, so a migration would be a permanent no-op there
while implying a schema dependency that does not exist.

Global setup detects this specific failure and points at the fix rather than at `supabase start`.

## How the E2E suite is wired

- **Serial, one worker, no retries.** The suite shares one Postgres and asserts exact values;
  concurrency or a silent retry would make those assertions meaningless — a retry can pass only
  because the first attempt already moved the balance.
- **Its own port (3100) and its own origin.** A dev server you started by hand runs on 3000 against
  `.env.local`, which points at the **hosted** project — and global setup deletes users. The suite
  also refuses to run at all unless `NEXT_PUBLIC_SUPABASE_URL` is local
  (`e2e/helpers/env.ts` → `assertLocalSupabase`).
- **`localhost`, not `127.0.0.1`.** `/api/auth/callback` builds its redirect from `request.url`, which
  Next reports as `localhost` regardless of the Host header. Driving the app at `127.0.0.1` makes that
  redirect cross origins and silently drops the session cookie it just set.
- **Fixtures are stable, state is reset per test.** Five users are created once; each spec creates its
  own markets and resets balances in `beforeEach`. Identity is shared, mutable state is not.
- **Programmatic login** via a gated, test-only `POST /api/test/login` that 404s in production and
  without `E2E_TEST_SECRET`, and accepts only `@forecast.test` addresses.
- Selectors are `data-testid`, catalogued in `e2e/TESTIDS.md`. Prefer adding a testid over matching
  user-visible copy — copy changes for product reasons and should not break a test.
