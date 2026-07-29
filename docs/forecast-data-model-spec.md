# Forecast — Data Model Spec (v2)

**Purpose.** Define the complete target schema for the three-tier refactor before any migration is written, and the verification gate every migration passes before it ships. This is the document you implement from, migration by migration. It assumes the decisions reached in planning:

- Three visibility tiers: **Public**, **Circle**, **League**.
- The fantasy-football tournament is an **opt-in sub-feature of leagues**, not the default. Nothing in the current tournament code is deleted; it is gated behind a flag.
- Tournament scoring uses model **(b)**: a user's bets count toward a league if the market is league-exclusive to that league (automatic) **or** the user opted a public/circle bet into that league (manual tag).
- The current build is treated as **Phase 0** — a working intimate prediction market — and is extended, not rewritten.

Everything below is reviewable. SQL is implementation-ready but should be read as a proposal, not a final migration. Open decisions are collected in §8 (all now resolved); §10 is the in-depth verification plan that gates every migration; §11 is the navigation/layout architecture for the UI. The data model is §§1–9; the testing gate is §10; the UI axis is §11.

---

## 1. The core concept: visibility tiers

Today every market is globally visible to every authenticated user. The entire refactor hangs off one change: **a market now belongs to exactly one of three tiers, and who can see it follows from that tier.**

| Tier | Scope | Who can see it | Who can create it | Who resolves it |
|---|---|---|---|---|
| **Public** | The whole platform | Everyone | Admin only (via suggestion → approval) | Admin, or community incident vote |
| **Circle** | One school / chapter / camp / team | Members of that circle | Members suggest → moderator approves & sets line | Circle moderators, or scoped incident vote |
| **League** | One friend group (6–30 people) | Members of that league | Any league member, directly | Market creator, or league-member dispute vote |

Every other change in this spec is downstream of this table. Get the tier column and its row-level security right and the rest cascades.

---

## 2. New entities

### 2.1 `circles`

A circle is the layer between a user and the public — a school, a chapter, a camp, a team. It contains members and circle-exclusive markets, and it can optionally contain leagues.

```sql
CREATE TABLE public.circles (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name          TEXT NOT NULL,
  slug          TEXT UNIQUE NOT NULL,              -- URL-friendly, e.g. 'lincoln-high'
  description   TEXT,
  creator_id    UUID NOT NULL REFERENCES public.profiles(id),
  joining_policy TEXT NOT NULL DEFAULT 'invite_code'
                 CHECK (joining_policy IN ('open', 'invite_code', 'request_approval')),
  invite_code   TEXT UNIQUE DEFAULT upper(substr(md5(random()::text), 1, 8)),
  member_count  INTEGER NOT NULL DEFAULT 0,         -- denormalized for fast display
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX circles_slug_idx ON public.circles(slug);
```

Notes:
- `joining_policy` mirrors how real groups gate entry. For alpha, `invite_code` is the workhorse — same mental model as leagues. `open` is for big public circles you want anyone to join; `request_approval` needs the requests table in 2.3 (deferrable to a later phase).
- **Circle markets always require approval.** A circle member *suggests* a market (optionally with a suggested line); a circle **moderator** approves it and sets/overrides the opening line before it goes live — exactly the public-market suggestion → approval flow, scoped to the circle. There is deliberately no direct member-create path for circle markets, so there's no `market_creation_policy` toggle to configure. (League markets, by contrast, are direct-create — see §3.5 / Open Decision #3 — because a friend group doesn't need an approver.) During alpha you are a moderator of every circle, so functionally you approve all circle lines; the moderator role exists so this delegates cleanly when you open new schools.
- `member_count` is denormalized so circle browse/list pages don't aggregate on every render. Keep it in sync with a trigger on `circle_members` (see 2.2).

### 2.2 `circle_members`

```sql
CREATE TABLE public.circle_members (
  circle_id  UUID NOT NULL REFERENCES public.circles(id)  ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member'
             CHECK (role IN ('creator', 'moderator', 'member')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (circle_id, user_id)
);

CREATE INDEX circle_members_user_idx ON public.circle_members(user_id);

-- Keep circles.member_count in sync
CREATE OR REPLACE FUNCTION public.sync_circle_member_count()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.circles SET member_count = member_count + 1 WHERE id = NEW.circle_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.circles SET member_count = member_count - 1 WHERE id = OLD.circle_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER circle_member_count_sync
  AFTER INSERT OR DELETE ON public.circle_members
  FOR EACH ROW EXECUTE FUNCTION public.sync_circle_member_count();
```

This mirrors `league_members` almost exactly — three roles instead of two, because circles need moderators distinct from the single creator.

### 2.3 `circle_join_requests` (deferrable)

Only needed if you ship the `request_approval` joining policy. You can launch alpha without it (use `invite_code` everywhere) and add it in a later phase.

```sql
CREATE TABLE public.circle_join_requests (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  circle_id  UUID NOT NULL REFERENCES public.circles(id)  ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'pending'
             CHECK (status IN ('pending', 'approved', 'denied')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (circle_id, user_id)
);
```

### 2.4 `comment_reactions` (new)

Comment-level reactions, mirroring the existing market reactions. Part of the Real Sports App comment-section feel — reactions are how most people participate without typing.

```sql
CREATE TABLE public.comment_reactions (
  comment_id UUID NOT NULL REFERENCES public.market_comments(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES public.profiles(id)       ON DELETE CASCADE,
  emoji      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comment_id, user_id, emoji)
);

CREATE INDEX comment_reactions_comment_idx ON public.comment_reactions(comment_id);
```

The emoji set is intentionally *not* a CHECK constraint here (unlike the current `market_reactions`), so the reaction palette can evolve without a migration. Validate the allowed set in the application layer instead. (Optional: tighten to a CHECK later once the set stabilizes.)

---

## 3. Modified entities

### 3.1 `markets` — the central change

```sql
-- Add tier columns
ALTER TABLE public.markets
  ADD COLUMN visibility_tier TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility_tier IN ('public', 'circle', 'league')),
  ADD COLUMN league_id UUID REFERENCES public.leagues(id) ON DELETE CASCADE,
  ADD COLUMN circle_id UUID REFERENCES public.circles(id) ON DELETE CASCADE;

-- Enforce that the right scope id is set for the tier (and only that one)
ALTER TABLE public.markets
  ADD CONSTRAINT markets_tier_scope_check CHECK (
    (visibility_tier = 'public' AND league_id IS NULL AND circle_id IS NULL) OR
    (visibility_tier = 'circle' AND circle_id IS NOT NULL AND league_id IS NULL) OR
    (visibility_tier = 'league' AND league_id IS NOT NULL AND circle_id IS NULL)
  );

CREATE INDEX markets_league_idx ON public.markets(league_id) WHERE league_id IS NOT NULL;
CREATE INDEX markets_circle_idx ON public.markets(circle_id) WHERE circle_id IS NOT NULL;
CREATE INDEX markets_tier_status_idx ON public.markets(visibility_tier, status);
```

**Migration safety:** the `DEFAULT 'public'` means every existing market becomes a public market automatically. No data loss, no broken rows, and the current tournament code keeps working because all tagged bets still point at public markets. This is the whole reason the refactor is low-risk.

### 3.2 The `'trending'` category problem

`market_category` currently has four values: `sports`, `social`, `actions`, `trending`. `trending` is a real enum value *and* the name of the home tab, which is a cross-category "what's hot" view. This collision will cause subtle bugs in any tier work. Trending should be a **view**, not a category.

Postgres can't drop an enum value in place, so this is a three-step migration:

```sql
-- 1. Reassign existing 'trending' markets to a real category.
--    Pick the right category per market, or default them to 'actions'.
UPDATE public.markets SET category = 'actions' WHERE category = 'trending';
UPDATE public.market_suggestions SET category = 'actions' WHERE category = 'trending';

-- 2. Create the new enum without 'trending'.
CREATE TYPE public.market_category_new AS ENUM ('sports', 'social', 'actions');

-- 3. Swap the column type, then drop the old enum.
ALTER TABLE public.markets
  ALTER COLUMN category TYPE public.market_category_new
  USING category::text::public.market_category_new;
ALTER TABLE public.market_suggestions
  ALTER COLUMN category TYPE public.market_category_new
  USING category::text::public.market_category_new;

DROP TYPE public.market_category;
ALTER TYPE public.market_category_new RENAME TO market_category;
```

Do this **before** the tier work so your test data is clean. The admin Create form's "Trending" pill gets removed at the same time; "feature this market" (the `is_featured` pin) is the correct mechanism for surfacing something on the home view, and it already exists.

### 3.3 `leagues` — gate the tournament

```sql
ALTER TABLE public.leagues
  ADD COLUMN circle_id UUID REFERENCES public.circles(id) ON DELETE SET NULL,
  ADD COLUMN tournament_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- buy_in_coins is meaningless when the tournament is off; make it nullable.
ALTER TABLE public.leagues
  ALTER COLUMN buy_in_coins DROP NOT NULL,
  ALTER COLUMN buy_in_coins SET DEFAULT NULL;
```

- `circle_id` (nullable) lets a league optionally live inside a circle. This is what powers the **league-promote-to-circle** mechanic — a league inside a circle can push one of its markets up to circle-tier. A standalone friend-group league just leaves this null.
- `tournament_enabled` defaults `FALSE`. A league is, by default, now just a private space with its own markets, chat, and a simple coin-balance leaderboard. The owner can flip the tournament on, at which point all the existing `league_weeks` / buy-in / golf-scoring machinery activates. Existing leagues keep their `buy_in_coins` value but it stays dormant until the flag is on.

### 3.4 `league_members` — keep, untouched

No schema change. The existing `total_points` and `weeks_played` columns stay (they're used by the tournament, which now runs only when enabled). The simple per-league leaderboard reads coin balances, not these columns.

### 3.5 `league_bets` — reshape for model (b)

This is the subtle one. Today `league_bets(position_id, league_id, week_id, user_id)` is a manual tag assigned when you place a bet, and the tournament scoring re-filters by resolution date anyway — so `week_id` is partly redundant. Under model (b), a position counts toward a league if **either**:

1. the position's market is league-exclusive to that league (`market.league_id = L`) — automatic, no row needed, or
2. the user manually opted a public/circle position into that league — recorded in `league_bets`.

So `league_bets` becomes **manual-tag-only**, and the week is derived from resolution date at scoring time rather than stored.

```sql
-- Drop week_id; the week is computed from the market's resolution date when scoring.
ALTER TABLE public.league_bets DROP CONSTRAINT league_bets_pkey;
ALTER TABLE public.league_bets DROP COLUMN week_id;
ALTER TABLE public.league_bets ADD PRIMARY KEY (position_id, league_id);

-- (Optional, see Open Decision #1) If a public bet may only count in ONE league,
-- replace the PK above with a UNIQUE on position_id alone.
```

`league_bets` now means exactly: "this public/circle position has been opted into this league's tournament." League-exclusive positions are never in this table — they count automatically.

**Scoring under (b).** The live-scores and week-close functions union the two sources. The shape of the gross-payout computation becomes:

```sql
-- Gross payout for user U in league L for the window [week_start, week_end]:
SELECT COALESCE(SUM(pos.payout), 0)
FROM public.positions pos
JOIN public.markets   mkt ON mkt.id = pos.market_id
WHERE pos.user_id = U
  AND pos.status  = 'won'
  AND mkt.resolved_at BETWEEN week_start AND week_end
  AND (
        mkt.league_id = L                                   -- (1) league-exclusive: automatic
     OR pos.id IN (SELECT position_id FROM public.league_bets   -- (2) opted-in public/circle
                   WHERE league_id = L)
      );
```

This replaces the body of `get_live_week_scores()` and the gross-payout update inside `close_league_week()` (migration 0017). The rest of those functions — buy-in collection, golf ranking via `RANK()`, pool payout, carry-over — is unchanged. Only the "what counts" clause changes.

**Constraint to enforce in the tagging action:** a position may only be tagged to a league the user belongs to, and a league-exclusive position may never be tagged to a *different* league. Enforce in the RPC (it's a logic check, not a table constraint).

### 3.6 `market_comments` — add threading

```sql
ALTER TABLE public.market_comments
  ADD COLUMN parent_comment_id UUID REFERENCES public.market_comments(id) ON DELETE CASCADE;

CREATE INDEX mc_parent_idx ON public.market_comments(parent_comment_id)
  WHERE parent_comment_id IS NOT NULL;
```

One level of nesting: top-level comments plus replies to them. (Replies-to-replies render flat under the top-level parent — enough for the sports-comment-section feel without the complexity of deep trees.) The existing Realtime subscription on `market_comments` keeps working.

### 3.7 `market_suggestions` — target tier

Suggestions are used for markets that need approval: **public** markets (approved by the platform admin) and **all circle** markets (approved by a circle moderator, who sets the opening line). Only **league** markets skip this table — they're created directly by members (§3.5).

```sql
ALTER TABLE public.market_suggestions
  ADD COLUMN target_tier TEXT NOT NULL DEFAULT 'public'
    CHECK (target_tier IN ('public', 'circle')),
  ADD COLUMN target_circle_id UUID REFERENCES public.circles(id) ON DELETE CASCADE;
```

(No `target_league_id` — leagues never suggest, they create directly.)

### 3.8 `incident_reports` — scope voting to the audience

The community-resolution system generalizes cleanly. Two changes:

1. **Eligibility:** only users who can *see* a market may report or vote on it (today it's any authenticated user for any market). Enforce with the `can_view_market()` helper in §4 inside the `submit_incident_report` and `cast_incident_vote` RPCs.
2. **Threshold scales with audience.** A 4-vote / 60% bar is right for public and large circles. For a 6-person league it's impossible. Make the threshold a function of how many people can see the market:

```sql
-- Pseudocode for the threshold inside cast_incident_vote:
--   required_votes = GREATEST(2, LEAST(4, CEIL(eligible_voters * 0.5)))
--   passes when total_votes >= required_votes AND agree_rate >= 0.60
```

For league markets, the **default** path is simpler than voting: the market creator resolves directly (they made the market, they call it). The incident report is the *dispute* mechanism — used when someone disagrees with the creator. So for leagues, incident reports are the exception, not the norm.

No new columns are strictly required on `incident_reports`; the scope is derived from the market. (Optionally cache `tier` on the report for cheaper queries.)

### 3.9 `notifications` — new types

```sql
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'market_about_you';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'circle_joined';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'circle_invite';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'comment_reply';
-- Optional, can be noisy — consider digesting instead of per-event:
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'league_market_created';
ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS 'circle_market_created';
```

`market_about_you` is the viral hook: when a market's title or description `@`-mentions an existing user, they get notified ("People are forecasting on a market about you"). See Open Decision #5 for the non-user version, which needs a share mechanic rather than a notification.

### 3.10 `activity_feed` — circle scope + visibility

```sql
ALTER TABLE public.activity_feed
  ADD COLUMN circle_id UUID REFERENCES public.circles(id) ON DELETE SET NULL;
```

The feed already has `market_id` and `league_id`. The important part is **visibility**: a feed entry about a league-exclusive or circle-exclusive market must not leak into the public feed. Every code path that inserts into `activity_feed` must carry the tier context, and the read policy must respect it (see §4). Audit every `INSERT INTO public.activity_feed` site when this lands.

### 3.11 `profiles` — light touch

Mostly unchanged. For public profile pages, add an optional bio:

```sql
ALTER TABLE public.profiles ADD COLUMN bio TEXT;
```

Onboarding completion continues to use "username is null" as the signal (no new column needed). Public profile pages (`/profile/[username]` for other users) and the profile-edit form are **application** work, not schema — the data already supports them.

---

## 4. Row-level security strategy

The governing rule: **you can read a market-related row if and only if you can read its market.** Rather than repeat the tier join in every policy, define one helper and reuse it.

```sql
CREATE OR REPLACE FUNCTION public.can_view_market(p_market_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.markets m
    WHERE m.id = p_market_id AND (
      m.visibility_tier = 'public'
      OR (m.visibility_tier = 'league'
          AND m.league_id IN (SELECT league_id FROM public.league_members WHERE user_id = auth.uid()))
      OR (m.visibility_tier = 'circle'
          AND m.circle_id IN (SELECT circle_id FROM public.circle_members WHERE user_id = auth.uid()))
    )
  );
$$;
```

Then the SELECT policies become uniform:

```sql
-- markets
CREATE POLICY markets_select_visible ON public.markets FOR SELECT
  USING (can_view_market(id));

-- everything that hangs off a market
CREATE POLICY positions_select_visible ON public.positions FOR SELECT
  USING (can_view_market(market_id));
CREATE POLICY mph_select_visible ON public.market_probability_history FOR SELECT
  USING (can_view_market(market_id));
CREATE POLICY comments_select_visible ON public.market_comments FOR SELECT
  USING (can_view_market(market_id));
CREATE POLICY reactions_select_visible ON public.market_reactions FOR SELECT
  USING (can_view_market(market_id));
CREATE POLICY activity_select_visible ON public.activity_feed FOR SELECT
  USING (market_id IS NULL OR can_view_market(market_id));
```

**Insert policies** encode the creation rules from the §1 table:
- `markets` insert: `service_role` **OR** an authenticated user inserting a `league`-tier market into a league they belong to. Public and circle markets are both inserted by the approval action (which runs with elevated privilege when a moderator/admin approves a suggestion and sets the line), so they're covered by `service_role`. Only **league** markets have a direct member-create path: route that through a `SECURITY DEFINER` RPC (`create_league_market`) that checks the user is a member of the target league, matching the existing `place_bet` pattern. The table policy then stays `service_role`-only and the RPC does the authorization for the one direct path.

**Performance note:** `can_view_market()` runs per row. For alpha (hundreds of users, thousands of rows) this is fine. At larger scale, swap the helper for a join-based policy or materialize a per-user visible-market set. Not a launch concern; flagged for later.

**Testing is mandatory here.** RLS fails silently — a wrong policy leaks private markets the moment they exist. Before building each scoped table, write the Vitest case: a user in League A queries and sees public + League-A rows and **not** League-B rows. Write it, watch it fail, then write the policy. Seed a matrix of test users (in A only / in Circle X only / in both / in neither) via the existing `supabase/seed.ts`.

---

## 5. Permissions matrix (consolidated)

| Action | Public | Circle | League |
|---|---|---|---|
| **See markets** | everyone | circle members | league members |
| **Create market** | admin only (suggestion → approval) | members suggest → moderator approves & sets line | any member, directly |
| **Suggest market** | any user → admin queue | any member → moderator queue (always) | n/a (direct create) |
| **Comment / react** | anyone who can see it | circle members | league members |
| **Resolve market** | admin / community vote (4 / 60%) | moderators / scoped vote | creator directly / dispute vote (low threshold) |
| **Report incident** | any user | circle members | league members |
| **Bet counts in tournament** | only if tagged to a league | only if tagged to a league | automatic for that league (model b) |

---

## 6. Full target enum list

After the refactor:

- `market_category`: `sports`, `social`, `actions` *(trending removed)*
- `market_status`: `open`, `closed`, `resolved_yes`, `resolved_no`, `cancelled` *(unchanged)*
- `market_type`: `binary`, `over_under` *(unchanged)*
- `position_side`: `yes`, `no` *(unchanged)*
- `position_status`: `open`, `won`, `lost`, `cancelled` *(unchanged)*
- `suggestion_status`: `pending`, `approved`, `rejected` *(unchanged)*
- `notification_type`: existing + `market_about_you`, `circle_joined`, `circle_invite`, `comment_reply`, (optional) `league_market_created`, `circle_market_created`
- New string-checked fields (not enums, for flexibility): `circles.joining_policy`, `markets.visibility_tier`, `market_suggestions.target_tier`, `circle_members.role`

---

## 7. Migration order

Each migration is independently deployable and leaves the app working.

> **Renumbered +1 on 2026-07-29.** `0022` was consumed by the de-brand data migration
> (`0022_debrand_market_content.sql`, applied), which rewrote the 7 GDS-titled seeded markets in
> place. De-trending therefore became **0023** and every migration below shifted up one. The list
> here reflects the current numbering; earlier drafts of this section had de-trending at 0022.

0. **0022 — De-brand seed content.** ✅ Applied 2026-07-29. `UPDATE` the 7 GDS-named markets' titles
   and descriptions in place; no `DELETE`, so attached positions/comments/history survive.
1. **0023 — De-trending.** Reassign `trending` markets, swap the `market_category` enum (§3.2). No tier logic yet. Lowest risk.
2. **0024 — Circles tables.** `circles`, `circle_members`, member-count trigger, their RLS. No markets touch circles yet, so nothing else changes.
3. **0025 — Market tier columns.** Add `visibility_tier` / `league_id` / `circle_id` + the scope constraint to `markets`, all defaulting to public (§3.1). Existing markets unaffected.
4. **0026 — Tier-aware RLS.** The `can_view_market()` helper and the rewritten SELECT policies on all market-joined tables (§4). **Ship with the test suite from §4 green.** This is the migration that, if wrong, leaks data — treat it with the most care.
5. **0027 — League gating + circle link.** `tournament_enabled`, nullable `buy_in_coins`, `leagues.circle_id` (§3.3). All existing leagues become non-tournament private spaces; flip individual leagues on as desired.
6. **0028 — Model (b) scoring.** Reshape `league_bets` (drop `week_id`), rewrite the gross-payout clause in `get_live_week_scores` and `close_league_week` (§3.5).
7. **0029 — Scoped creation + suggestions.** `create_league_market` RPC (the one direct member-create path), market insert policy, the circle suggestion → moderator-approval flow with line-setting, `market_suggestions.target_tier` / `target_circle_id` (§3.7), scoped incident-report eligibility + scaled threshold (§3.8).
8. **0030 — Comments threading + comment reactions.** `parent_comment_id`, `comment_reactions` table (§3.6, §2.4).
9. **0031 — Activity feed scope + notifications.** `activity_feed.circle_id`, new notification types, audit every feed-insert site for tier context (§3.10, §3.9).
10. **0032 — Profiles.** `bio` column (§3.11). Public profile pages and profile edit are app work that can land alongside.

The De-GDS cleanup (removing the `@gds.org` auth check and GDS copy, deleting dev test leagues) is
**application** work, not migrations. ✅ Done 2026-07-29 — the auth check and copy are gone and the
palette is recolored; the dev test leagues are still outstanding.

---

## 8. Open decisions

These change specific columns or logic. Resolve before the migration each one touches.

**1. Can one public/circle bet count in multiple leagues?** (Affects `league_bets` PK in 0028.)
*Recommendation: yes — allow it (PK on `(position_id, league_id)`).* A user in three leagues can opt the same public bet into all three; it counts independently in each. Simpler for users ("it counts everywhere I want it to"), and the union scoring handles it. The alternative (one league per bet, UNIQUE on `position_id`) prevents "spreading one good call across all my leagues," if you consider that a problem. Easy to switch later.

**2. How do you stop someone joining a circle they don't belong to (e.g. claiming a school they don't attend)?** (Affects circle `joining_policy` rollout.)
*Recommendation: invite codes for alpha; defer real verification.* Codes distributed by trusted seed users are good enough at small scale. Email-domain verification per circle (e.g. only `@lincolnhigh.edu` can join the Lincoln circle) is the eventual answer but it's a Phase 4+ feature, not a launch blocker. Note: most schools don't give students email, so domain verification is unreliable anyway — codes may stay the primary mechanism.

**3. League market resolution: creator-resolves vs always-vote.** (Affects 0029 incident logic.)
*Recommendation: creator resolves directly; vote is the dispute path.* In a 6-person friend group, requiring 4 votes to resolve every market is friction that kills the casual-market vibe. The creator made the market, they call it; if someone disagrees, the dispute vote (low threshold) overrides. This matches how friend groups actually settle bets.

**4. Circle market creation. — DECIDED: members suggest, moderator approves & sets the line.**
Circle markets are never created directly. A member proposes the market (optionally with a suggested line); a circle moderator approves it and sets/overrides the opening line before it goes live — the same suggestion → approval pipeline as public markets, scoped to the circle. This keeps a quality and appropriateness gate on every circle line, and the line-setting step ensures odds are sane before money moves. There is no `market_creation_policy` toggle; circles have one creation path. (During alpha you moderate every circle, so you approve all circle lines; the moderator role lets this delegate when you open new schools.) League markets remain direct-create (Decision #3) — friend groups don't need an approver.

**5. The "market about you" hook for people who aren't on the platform yet.** (Affects whether `market_about_you` is enough.)
*Recommendation: ship the in-app version now (notify existing mentioned users); treat the non-user version as a separate share feature later.* You can't send an in-app notification to someone with no account. The true viral version — "47 classmates are forecasting about you, sign up to see" — requires an out-of-band reach: the market creator shares a link/screenshot, or you capture an invite. That's a share-mechanic feature, not a notification, and it's worth building in the growth phase. For now, mentioning an existing user notifies them, which already drives re-engagement.

**6. Comment threading depth.** (Affects 0030.)
*Recommendation: one level (top-level + replies, replies-to-replies render flat).* Full nesting is complexity the sports-comment-section feel doesn't need. One level captures "X replied to Y's take" without infinite-tree rendering headaches.

**7. Do circle-tier markets auto-count for leagues inside that circle?** (Affects 0028 scoring clause.)
*Recommendation: no — only league-exclusive markets auto-count.* Keep model (b) crisp: automatic counting is strictly for markets that *belong to the league*. A circle market a league member bets on is treated like a public bet — opt-in via tag if they want it in their league tournament. Mixing circle markets into automatic league scoring blurs the tiers and creates weird edge cases (a market counting for several leagues at once inside a circle).

---

## 9. What this spec deliberately leaves out

To keep the refactor scoped, these are explicitly *not* in v1 and belong to later phases:

- Social graph (follow / friend / block, follower lists). None of it exists today; none is needed for the three-tier model.
- Direct messaging.
- Cross-circle leagues (members from different circles in one league) — possible later once circles are stable.
- The non-user "market about you" share mechanic (Open Decision #5).
- Email-domain circle verification (Open Decision #2).
- Real-money anything — the play-coin economy is and stays the entire economy.

---

## 10. Migration verification plan

Every migration in §7 is verified before it advances, with both **positive** tests (the new feature works) and **negative** tests (the new boundary actually holds). This section defines exactly how. Treat it as a gate: a migration is not "done" until it passes its block in §10.7 and the standard protocol in §10.5.

### 10.1 Why this is non-negotiable

A schema change on an RLS system fails in two ways that produce **no error message**:

1. **Too permissive** — a policy lets a user read rows they shouldn't. Private league markets leak into a stranger's feed. Nothing throws. You find out when a kid screenshots a market they were never supposed to see.
2. **Too strict** — a policy blocks rows a user *should* see. A feature silently returns an empty list and looks "broken," but there's no exception to catch.

Neither shows up in a build, a type-check, or a casual click-through as yourself (you can see everything). The only way to catch them is to run queries **as different authenticated users**, asserting both what they *can* and *cannot* see. That is the spine of this plan.

### 10.2 Three environments — never run an unverified migration on production

Every migration climbs a three-rung ladder, in order, and only advances when the rung below is green:

1. **Local** (`supabase start` → local Postgres). Apply the migration, run the automated suite. Fast loop, throwaway data.
2. **Staging** (a *separate* Supabase project from prod). Restore a **snapshot of production data** into staging first, then apply the migration there. This is the rung that catches problems that only exist against real data — the forgotten `trending` market, the league with a null field, the user with a weird username. Run the full automated suite **and** a manual smoke pass.
3. **Production.** Only after staging is green. Apply during low-traffic hours. Keep prod and staging migration history identical.

The cost of a staging project is zero (free tier). The cost of a leaked-data migration on prod is the trust of your alpha users. Always pay the former.

### 10.3 The test-user matrix

Seed these users (via the existing `supabase/seed.ts`) once, and reuse them for every migration's RLS tests. They're chosen so that every visibility boundary has someone on each side of it.

| User | League A | League B | Circle X | Circle Y | Role | Exists to test |
|---|---|---|---|---|---|---|
| **Alice** | member | — | member | — | normal | sees public + League A + Circle X |
| **Bob** | member | — | — | — | normal | in Alice's league, **not** her circle → must not see Circle X markets |
| **Carol** | — | — | member | — | normal | in Alice's circle, **not** her league → must not see League A markets |
| **Dave** | — | member | — | member | normal | fully separate → must not see League A or Circle X anything |
| **Erin** | — | — | — | — | normal | public-only baseline → sees nothing tier-scoped |
| **Mod** | — | — | moderator | — | circle moderator | can approve Circle X suggestions / set lines |
| **Admin** | — | — | — | — | platform admin | approves public markets, has admin dashboard |

The key adversarial pairs: **Bob vs Circle X** (same league, different circle), **Carol vs League A** (same circle, different league), **Dave vs everything Alice has** (total isolation), **Erin vs all tiers** (public floor).

### 10.4 How to test RLS correctly

**`service_role` bypasses RLS entirely.** The admin client never sees a policy. If you test with it, every test passes and proves nothing. RLS tests must run through clients **authenticated as a specific user**.

The harness pattern in this stack (`@supabase/supabase-js` + Vitest):

```ts
import { createClient } from "@supabase/supabase-js";

const admin = createClient(URL, SERVICE_ROLE_KEY); // setup/teardown only — bypasses RLS

// One authed client per test user (anon key + their session)
async function clientFor(email: string, password: string) {
  const c = createClient(URL, ANON_KEY);
  await c.auth.signInWithPassword({ email, password });
  return c; // queries through `c` now run under that user's auth.uid()
}
```

**The single most important test in the whole plan — direct-by-ID read of a hidden row:**

```ts
// Bob knows the UUID of a Circle-X-only market. He must get nothing back.
const { data, error } = await bob.from("markets").select("*").eq("id", circleXMarketId);
expect(error).toBeNull();      // RLS does not error — it filters
expect(data).toEqual([]);      // ...to empty. If this returns the row, you have a leak.
```

Hiding a market from a *list* is not enough. The row must be unreadable even when the user knows its exact id and asks for it directly. Every tier-scoped table gets this test: `markets`, `positions`, `market_comments`, `market_reactions`, `market_probability_history`, `activity_feed`.

**Helper assertion** — `can_view_market()` must return the right boolean per (user, market) pair, because every dependent policy leans on it:

```ts
expect((await alice.rpc("can_view_market", { p_market_id: circleXMarketId })).data).toBe(true);
expect((await bob.rpc(  "can_view_market", { p_market_id: circleXMarketId })).data).toBe(false);
```

For pure-SQL verification you can alternatively use **pgTAP** with `SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claims`, but the JS-client approach above matches the repo's existing Vitest setup, so lead with it.

### 10.5 Standard protocol — run this after *every* migration

Migration-agnostic checklist. Nothing advances to the next rung until all ten pass:

1. **Applies cleanly.** The up migration runs with no error on a fresh local DB and on the staging snapshot.
2. **Reverses.** A `down` migration exists and restores the prior state, **or** the file documents why it's irreversible and what the manual rollback is.
3. **Idempotent.** Re-running it doesn't error — continue the repo's existing `IF NOT EXISTS` / `DROP ... IF EXISTS` / `ADD VALUE IF NOT EXISTS` guards.
4. **Existing data survives.** Row counts on affected tables are unchanged (unless the migration is *supposed* to change them); no orphaned foreign keys; no existing row now violates a new constraint. Spot-check with `SELECT count(*)` before/after.
5. **Types updated, app builds.** Hand-update `src/types/database.ts` to match the new schema, then `npm run type-check` and `npm run build` both pass. That file is **manually written** (see its header) and exports app-shaped types every import depends on — do *not* overwrite it with `npx supabase gen types typescript`, which emits a differently-shaped `Database` interface and breaks the app. Generated output, if you want it as a cross-check, goes to a separate `src/types/database.generated.ts`. *(Corrected 2026-07-29; this step previously said "regenerate.")*
6. **Positive tests pass.** The migration's "must work" list in §10.7 is green.
7. **Negative tests pass.** The migration's "must fail" list in §10.7 is green — especially the direct-by-ID RLS reads.
8. **Regression passes.** The betting-loop smoke script (§10.6) runs end-to-end.
9. **Query-plan sanity.** `EXPLAIN` any new query the migration introduces on a hot path; confirm no accidental sequential scans on large tables and no runaway nested loops from per-row function calls.
10. **Logged.** Record the migration number, date, environment, and "verified by" in a running `MIGRATIONS_LOG.md`. One line each; it's your audit trail when something regresses three weeks later.

### 10.6 The betting-loop regression script

The core loop that must **never** break, regardless of which migration just landed. Automate it as a single Vitest flow and run it at step 8 of every protocol pass:

1. Seed user starts with a known balance. **Claim daily bonus** → balance increases by the bonus amount; `last_daily_claim` updates; a second claim the same day is rejected.
2. **Place a bet** on a visible `open` market → a `positions` row is created; `yes_pool`/`no_pool` shift; `yes_probability` recomputes via trigger; a `market_probability_history` row is appended; the user's `coins` decrease by the stake; `yes_odds_at_bet` is locked.
3. **Resolve the market** (admin path) → winning positions get `status='won'` and a `payout`; losing get `status='lost'`; winners' `coins` increase; the streak trigger updates `win_streak`/`loss_streak`; `market_resolved` + `payout_received` notifications are created.
4. **Leaderboard reflects** the new balances; the **weekly top earner** RPC returns the right user; the activity feed shows the bet and the resolution.

If any step fails after a migration, the migration broke the core loop — stop and fix before anything else.

### 10.7 Per-migration verification

Each block lists what must work, what must be forbidden, the regression to confirm, and the done bar. Run alongside the §10.5 protocol.

> **Renumbered +1 on 2026-07-29 — second pass.** When `0022` was consumed by the de-brand migration, §7's list was shifted but *these* block headers were missed, leaving them one behind for several days. Following them by header would have applied the wrong test block to every migration — notably testing tier columns (0025) with the tier-RLS checklist. The headers below are now correct and match §7. If you find a migration number in this document that disagrees with §7, §7 wins.

**0023 — De-trending (enum swap)**
- *Must work:* zero markets/suggestions have `category='trending'` after; all former trending rows now carry a valid category; the new `market_category` enum is exactly `{sports, social, actions}`; market count before == after (none dropped).
- *Must fail:* inserting a market with `category='trending'` raises an error (value no longer exists).
- *Regression:* the betting loop; the Suggest form (which only ever offered the three real categories) still submits; dashboards filter correctly.
- *Edge:* confirm no view, default, or check constraint still references the old enum (the swap drops the old type — if anything depends on it, the drop fails, which is the signal to fix it). Verify the suggestions table migrated too.
- *Done when:* enum is three values, no `trending` rows remain, betting loop green.

**0024 — Circles tables**
- *Must work:* create a circle; add a member; `member_count` increments on insert and decrements on delete (trigger test); a member can read their own circle; slug uniqueness is enforced.
- *Must fail:* a user inserting a `circle_members` row for *another* user (`user_id != auth.uid()`) is rejected; a duplicate slug is rejected.
- *Regression:* markets, leagues, betting loop entirely unaffected (nothing references circles yet).
- *Edge:* deleting a circle cascades to `circle_members` with no orphans and leaves `member_count` consistent; the creator row gets `role='creator'`.
- *Done when:* circle CRUD + membership + count trigger verified; no impact on existing tables.

**0025 — Market tier columns**
- *Must work:* every pre-existing market now has `visibility_tier='public'`, `league_id=NULL`, `circle_id=NULL`; you can insert a `league`-tier market with a `league_id`; a `circle`-tier market with a `circle_id`.
- *Must fail (the scope constraint):* a `public` market with a non-null `league_id` or `circle_id`; a `league` market with a null `league_id`; a `circle` market with a null `circle_id`; **any** market with *both* `league_id` and `circle_id` set.
- *Regression:* RLS is **not yet changed** here, so all markets (including new tiered ones) are still globally readable — confirm the betting loop still works; the visibility enforcement lands in 0026, and that ordering is intentional.
- *Edge:* `ON DELETE CASCADE` — deleting a league deletes its league-tier markets; deleting a circle deletes its circle-tier markets (and, by chain, their positions/comments). Verify no shared/public data is caught in the cascade.
- *Done when:* all existing markets are public-tier, the scope constraint rejects every malformed combination, betting loop green.

**0026 — Tier-aware RLS (the critical one)**
- *Must work (positive matrix):* Alice sees public + League A + Circle X markets; Bob sees public + League A; Carol sees public + Circle X; Dave sees public + League B + Circle Y; Erin sees public only.
- *Must fail (negative matrix — the whole point):* **Bob cannot read any Circle X market**, by list *or by direct UUID*; **Carol cannot read any League A market**; **Dave cannot read League A or Circle X anything**; **Erin cannot read any tier-scoped market**. Run the §10.4 direct-by-ID test for each forbidden pair.
- *Dependent-table cascade:* repeat the positive+negative matrix for `positions`, `market_comments`, `market_reactions`, `market_probability_history`, and `activity_feed`. Bob must not be able to read a comment, a position, a price-history point, or a feed entry belonging to a Circle X market — even by direct id.
- *Helper:* `can_view_market()` returns the correct boolean for all 5 users × the forbidden markets.
- *Regression:* public markets remain fully visible to everyone; betting loop works for visible markets.
- *Performance:* `EXPLAIN` the main market-list query under a normal user; confirm the per-row `can_view_market()` call isn't producing a pathological plan at seed scale (note §4's flag for larger-scale optimization).
- *Done when:* **the entire positive AND negative matrix is green across all six tables**, plus the helper assertions. This migration does not ship on a single red negative test.

**0027 — League gating + circle link**
- *Must work:* new leagues default `tournament_enabled=false`; existing leagues retain their `buy_in_coins`; you can set a league's `circle_id`; flipping `tournament_enabled=true` activates the weekly machinery.
- *Must fail / no-op:* with `tournament_enabled=false`, the tournament path does not run (week-start is never invoked / is a no-op); a league member who isn't the owner can't flip the flag.
- *Regression:* league chat, standings, membership, invite codes all work; a league with the flag **on** still runs a full tournament (verified fully in 0028).
- *Edge:* a nullable `buy_in_coins` is accepted; existing leagues with a value remain valid and dormant until enabled.
- *Done when:* default-off confirmed, existing leagues intact, flag toggles behavior.

**0028 — Model (b) scoring**
- *Must work:* a bet on a **League A-exclusive** market counts toward League A's tournament with **no manual tag**; a public bet **tagged** to League A counts; the union produces the correct `gross_payout`; week membership derives correctly from the market's `resolved_at`.
- *Must fail:* a League A-exclusive market does **not** count toward League B; an **untagged** public bet counts toward **no** league.
- *Edge:* a public bet tagged to two leagues counts in **each** independently (Decision #1); golf `RANK()` ties and the pool-rounding remainder still behave; a league-exclusive market that resolves *outside* any active week window simply doesn't score (no crash).
- *Regression:* run a **full tournament cycle** on a flag-enabled league — start week → collect buy-ins → place a mix of league-exclusive and tagged-public bets → resolve markets → close week → verify pool payout, golf points, carry-over-on-no-winner, and the `league_win` notification.
- *Done when:* the union scoring is correct for every must-work/must-fail case and a full cycle pays out correctly.

**0029 — Scoped creation + suggestions**
- *Must work:* a League A member directly creates a League A market via `create_league_market`; a Circle X member submits a circle suggestion; **Mod** approves it and sets the opening line; the approved market goes live as a `circle`-tier market visible to Circle X members.
- *Must fail:* a non-member creates a market in a league they're not in (rejected); a non-moderator approves a circle suggestion (rejected); a member tries to **directly insert** a circle-tier market bypassing the suggestion flow (rejected — circles have no direct-create path); a user reports/votes on an incident for a market they can't see (rejected).
- *Edge:* the scaled incident threshold computes correctly — `GREATEST(2, LEAST(4, CEIL(eligible_voters * 0.5)))` gives ~3 for a 6-person league and 4 for a 200-person circle; a reporter still can't vote on their own report.
- *Regression:* public suggestion → admin approval still works; existing incident voting on public markets still resolves at 4/60%.
- *Done when:* all three creation paths behave per the §5 matrix and incident eligibility is correctly scoped.

**0030 — Comments threading + reactions**
- *Must work:* post a top-level comment; reply to it (`parent_comment_id` set); react to a comment; reacting again toggles the reaction off.
- *Must fail:* reacting to or reading a comment on a market you can't see (inherits market visibility); replying to a non-existent parent.
- *Edge:* deleting a parent comment cascades to its replies; a reply renders under its top-level parent.
- *Regression:* existing flat comments still load; the Realtime subscription still fires on new inserts.
- *Done when:* threading + reactions work and inherit market visibility.

**0031 — Activity feed scope + notifications**
- *Must work:* the new notification types insert and render; activity entries carry `circle_id`; a League A market action appears in **League A members'** feeds.
- *Must fail (leak test):* a League A-exclusive market action does **not** appear in the public feed or in a non-member's feed (run as Erin and Dave); a Circle X action doesn't leak to non-members.
- *Edge:* **audit every `INSERT INTO public.activity_feed` site** and confirm each passes the correct tier context — this is where leaks hide. Verify the `ADD VALUE` enum additions actually applied (see §10.8).
- *Regression:* public activity still shows for everyone; existing notifications still deliver.
- *Done when:* feed visibility matches market visibility on every insert path and new notification types work.

**0032 — Profiles**
- *Must work:* `bio` accepts and returns text; another user's public profile page loads; the profile-edit form saves your own changes.
- *Must fail:* editing another user's profile (rejected by the existing `profiles_update_own` policy).
- *Regression:* profile reads, leaderboards, and the betting loop all work.
- *Done when:* bio + public profiles + self-edit verified, others'-edit blocked.

### 10.8 Postgres gotchas to verify explicitly

These bite at apply-time or hide as silent leaks; check each where noted.

- **Enum value drop (0023).** Postgres can't drop an enum value in place — the three-step swap in §3.2 is mandatory. The old-type `DROP` will fail if any default, view, or constraint still references it; treat that failure as the to-do list of things to repoint first.
- **`ALTER TYPE ... ADD VALUE` (0031 notifications).** A newly added enum value **cannot be used in the same transaction it's added in**, and in some Postgres versions `ADD VALUE` can't run inside a transaction block at all. Verify the migration actually applies on staging and that the new notification types are usable immediately after; if not, split the `ADD VALUE` statements into their own migration ahead of any code that inserts those values.
- **`can_view_market()` performance.** It runs once per candidate row. Fine at seed scale; `EXPLAIN` the market-list and feed queries to confirm, and remember §4's note about swapping to a join-based policy if row counts grow.
- **Cascade chains.** `ON DELETE CASCADE` from `leagues`/`circles` reaches markets → positions → comments → reactions → history. Verify a league/circle delete cleans all of it with no orphans, and — critically — that it never reaches *public* or *other-tier* rows.

### 10.9 Rollback and failure procedure

If a migration fails verification on **staging**: do not promote it. Prefer **fixing forward** — write the next migration to correct it — over editing a migration that has already been applied anywhere, so that prod and staging histories never diverge. If the migration never reached prod and only exists locally, you may amend the file directly. If a migration somehow reaches prod and misbehaves, roll forward with a corrective migration immediately; only use the `down` migration if the change is cleanly reversible and no user data was written against it. Whatever happens, prod and staging migration history stay identical — that invariant is what lets staging predict prod.

### 10.10 Definition of done (per migration)

A migration is done only when **all** of these are true:

- [ ] Applies cleanly on a fresh local DB and on the staging snapshot of prod data
- [ ] `down` migration exists, or irreversibility + manual rollback is documented
- [ ] Re-running is idempotent
- [ ] Existing-data counts and foreign keys intact; no existing row violates a new constraint
- [ ] Types regenerated; `type-check` and `build` pass
- [ ] All "must work" tests for the migration are green
- [ ] All "must fail" tests are green, including every direct-by-ID RLS read
- [ ] Betting-loop regression script passes end-to-end
- [ ] Query plans on new hot paths are sane
- [ ] Logged in `MIGRATIONS_LOG.md`

Only then does it climb to the next environment, and only after prod is it crossed off §7.

---

## 11. Navigation and layout (the UI axis)

The schema defines *what exists*; this section defines *how a user moves through it*. The governing decision:

**Flip the primary navigation axis from category-first to tier-first.** Today the top-level navigation is Trending / Sports / Actions / Social — organized by *what kind* of question a market is. The philosophy is organized by *whose conversation* a market belongs to. So the UI makes **place (tier) the primary navigation** and demotes **category to a filter** present inside every feed. A user navigates by "my league / my school / the public," and filters by Sports/Actions/Social within whatever they're looking at.

Why: if the first thing a user navigates by is Sports vs Social, the product feels like a generic markets app. If the first thing they navigate by is "my league / my school / the world," it feels like their place — which is the entire pitch.

### 11.1 Desktop (sidebar)

Top — places (the navigation):
- **Home** — personalized landing feed (see the open decision in §11.4).
- **Explore** — the broad public feed; discovery layer.
- **Your circles** — each circle the user belongs to, listed individually with its avatar (Discord/Slack-rail style). Tapping one opens that circle's feed.
- **Your leagues** — each league listed individually with its avatar. Tapping one opens that league's feed.

Bottom — utility:
- **My Bets**, **Notifications**, **Reports** (incident reports).
- **Create** — a context-aware button (see §11.3).
- **Admin** (admins only), profile card with coin balance.

Category (Sports / Actions / Social) is a **filter-chip row at the top of every feed** — Home, Explore, each circle, each league — never a sidebar item.

### 11.2 Mobile (bottom tab bar)

Five slots: **Home · Circles · Leagues · Activity · More.**
- Categories are chips under Home and inside each circle/league feed (same as desktop).
- **Circles** and **Leagues** open list views (no room for an individual-item rail on mobile); tap a row to enter that place.
- **Activity** folds in Notifications + My Bets + Stat Leaders.
- **More** holds Reports, the Suggest fallback, profile, settings, and Admin.

### 11.3 Trending and Create — two specific changes

- **"Trending" stops being a destination.** "What's hot" becomes the default *sort* of the Home feed, and Stat Leaders (Hot/Cold streak, Week's Best) becomes a Home *module*. The data already exists; this is purely where it surfaces.
- **"Suggest a Line" becomes a context-aware Create button**, whose behavior matches the §5 permissions matrix based on where the user is:
  - In a **league** → *create market directly* (no approval).
  - In a **circle** → *suggest market* → moderator approves and sets the line.
  - On **Home / Explore** (public) → *suggest market* → admin approves and sets the line.

### 11.4 Open decision — what is "Home"?

- **Option A (simple):** Home = public trending. Circles and leagues are separate destinations. Essentially today's landing minus the category tabs.
- **Option B (engaging):** Home = a personalized blend — your leagues' and circle's markets/activity prioritized, with hot public markets mixed in. "What's happening in my world" on open.

*Recommendation: ship A for alpha, evolve to B.* Option B fits the philosophy's "alive on open" goal but needs ranking logic (weighting league vs. circle vs. public vs. recency) that isn't worth building before the tiers are validated. Start with Home = trending, observe how people move between their tiers, then build the blend tuned on real behavior.

### 11.5 When this is built

This is **application work, not a migration**, and it lands in the presentation-overhaul phase **after** the tier migrations (0022–0028) — the sidebar can't list "your circles / your leagues as places" until circles exist and markets carry a tier. It primarily touches `BottomTabBar.tsx`, `Sidebar.tsx`, the `dashboard/*` routes (which collapse from four category routes into tier-scoped feeds with a category filter), the league/circle detail pages, and a new context-aware Create control. It pairs directly with the comment-section and Stat Leaders presentation work in the same phase.

---

*End of v2. Decisions in §8 and §11.4 are the locked product choices; §10 is the gate every migration passes before advancing. Build order: De-GDS cleanup first (application work), then migrations 0022 onward in order behind the §10 gate, then the §11 navigation/presentation overhaul once the tiers exist. Do not promote any migration past staging until its §10.7 block and the §10.5 protocol are green.*
