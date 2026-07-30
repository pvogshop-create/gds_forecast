# e2e/TESTIDS.md — the selector contract

Every `data-testid` the app exposes, and what it is for. **123 ids across 30 files.**

These are a contract between the app and `e2e/`. Treat them like a public API:

- **Renaming or removing one breaks tests silently-ish** (a Playwright failure, not a type error).
  Grep `e2e/` before you touch one.
- **Prefer adding a testid over matching user-visible copy.** Copy changes for product reasons; a
  test that asserts on a heading string breaks for a reason that has nothing to do with correctness.
  Assert on copy only when the copy *is* the thing under test (an error message, a disclaimer).
- **`data-*` companions carry values**, so a test can assert state without parsing formatted text —
  `data-coins="1100"` rather than reading `"1,100"` and undoing `toLocaleString`.
- `Button` and most inputs spread `...props`, so a testid passes straight through. No component
  needed changing to accept one.

---

## Betting — `components/markets/BettingPanel.tsx`

| testid | Notes |
|---|---|
| `betting-panel` | Panel root. `data-market-status`. **Absent** unless the market is open. |
| `betting-panel-closed` | The "no longer accepting bets" notice. Mutually exclusive with the above — the panel early-returns, so a closed market has no form at all. |
| `bet-side-yes` / `bet-side-no` | Side selector. `data-selected`. Labels become OVER/UNDER for O/U markets. |
| `bet-preset` | One per preset. `data-amount` ∈ 10/50/100/500. `500` is disabled during calibration. |
| `bet-amount-input` | Custom amount. |
| `bet-error` | Client validation message. Present only when invalid. |
| `bet-preview` | Payout preview block; only rendered when the amount is valid. |
| `bet-preview-payout` | `data-payout` — the integer the DB should pay. |
| `bet-preview-new-line` | O/U only. `data-line` — the line after this bet. |
| `bet-submit` | Disabled while the amount is empty or invalid. Shows `Loading…` mid-flight. |
| `bet-success` | Confirmation block after a successful bet. |
| `bet-balance` | `data-coins` — authoritative balance. |
| `calibration-banner` | `data-effective-max`. Present only while the market has <3 bets. |
| `bet-league-select` | Only rendered when the user has an active league week. |

## Market cards and lists — `components/markets/`

| testid | Notes |
|---|---|
| `market-card` | `data-market-id`, `-status`, `-category`, `-type`. **Can appear more than once per page** — trending renders several algorithmic sections, so scope with `.first()`. |
| `market-card-title` / `market-card-link` | Title and its link to the detail page. |
| `market-card-probability` | `data-probability` (0–1). |
| `market-card-volume` | `data-volume` (rounded total pool). |
| `market-card-bet-yes` / `-bet-no` | Quick-bet chips → `/market/{id}?side=…`. Absent on resolved/closed cards. |
| `market-list` | `data-count`. |
| `market-list-empty` | Empty state. |
| `market-tab-active` / `market-tab-completed` | Active/Completed toggle. `data-selected`. |
| `probability-chart` | `data-points`. Needs ≥2 history rows; binary markets only. |
| `probability-chart-empty` | "Not enough data yet" state. |
| `reactions` | Reaction row container. |
| `reaction-button` | `data-emoji`, `data-count`, `data-reacted`. Five per card: 🔥 🎯 🤔 💰 ✅. |

## Comments — `components/markets/MarketComments.tsx`

| testid | Notes |
|---|---|
| `comments-list` | `data-count`. |
| `comments-empty` | "No comments yet" state. |
| `comment` | `data-comment-id`, `data-mine`. A just-posted comment carries an `optimistic-…` id. |
| `comment-delete` | **Own comments only, and only once persisted** — deliberately not rendered while the id is still `optimistic-…`, so deleting a fresh comment needs a reload. |
| `comment-input` / `comment-submit` | `maxLength=500`; submit disabled while empty. |
| `comment-error` | Server-action error. |
| `mention-dropdown` / `mention-option` | @-mention autocomplete. `data-username`. Selection fires on **mousedown**, so use `dispatchEvent("mousedown")`, not `click()`. |

## Market detail page — `app/(app)/market/[id]/`

`market-title`, `market-stat-yes` (`data-probability`), `market-volume` (`data-volume`),
`incident-widget`, `incident-status`, `incident-votes` (`data-yes`, `data-no`),
`incident-vote-agree` / `-disagree` (**absent** for the reporter — replaced by "You reported this"),
`report-outcome-toggle`, `report-outcome-yes` / `-no`, `report-description`, `report-submit`.

## Feed and leaderboard — `components/feed/`

`activity-feed` (`data-count`), `activity-feed-item`, `activity-feed-empty`,
`leaderboard`, `leaderboard-row` (`data-rank`, `data-username`, `data-coins`).

> The heading is literally **"Leaderboard"** — the string "Top Earners" does not exist in this
> codebase. Medals 🥇🥈🥉 for ranks 1–3; the **last** row gets 💩 once there are more than three.

## Trending Stat Leaders — `app/(app)/dashboard/trending/page.tsx`

`stat-leader-hot`, `stat-leader-cold`, `stat-leader-week`. **Each tile is conditionally rendered**, so
a spec must seed a win streak, a loss streak, and a payout resolved inside the last 7 days or the whole
card is absent.

## Navigation — `components/layout/`

`sidebar-nav-main`, `sidebar-nav-secondary`, `sidebar-coins` (`data-coins`), `sidebar-signout`,
`bottom-tab-bar`.

> Both navs are always in the DOM; Tailwind's `lg:` (1024px) decides which is *visible*. At the
> desktop project's 1280px the sidebar shows; the `mobile` project (412px) is where the tab bar is
> testable. Labels are duplicated between the two, so always scope by container.

## Auth — `app/(auth)/`

`login-email`, `login-submit`, `login-error`, `login-sent`,
`onboarding-username`, `onboarding-submit`, `onboarding-error`.

> The login input is `type="email"` in a form without `noValidate`, so native validation swallows
> anything without an `@`. Use something like `a@b` to reach the component's own check.
> The onboarding submit is `disabled` for a malformed username — the disabled state *is* the
> enforcement there; only the taken-username path produces a message.

## Leagues — `app/(app)/leagues/`

`create-league-open`, `create-league-name`, `create-league-buy-in`, `create-league-week-start`
(`<input type="datetime-local">` → `YYYY-MM-DDTHH:mm`), `create-league-submit`,
`join-league-open`, `join-league-code`, `join-league-submit`, `join-league-error`,
`league-card` (`data-league-id`, `data-member-count`),
`league-invite-code`, `league-tab-weekly` / `-standings` (assert `aria-selected`),
`league-pool` (`data-pool`),
`weekly-standings-row` / `alltime-standings-row` (`data-rank`, `data-user-id`, `data-total-points`),
`league-chat-input`, `league-chat-send`, `league-chat-message`.

## /more, notifications, suggest, profile

`more-tab` (`data-tab`, `data-active`), `alerts-unread-badge` (`data-unread`), `mark-all-read`,
`notification-item` (`data-type`, `data-read`),
`earn-coins-claim`, `daily-bonus-status` (`data-can-claim`), `daily-bonus-error`,
`referral-link` (`data-code`),
`suggest-title`, `suggest-description`, `suggest-category` (`data-category`, `data-selected`),
`suggest-line`, `suggest-submit`,
`profile-username`, `profile-stat-coins` / `-winrate` / `-bets`,
`report-market-select`, `report-description`, `report-submit`.

## Admin — `app/(admin)/admin/`

`admin-tab` (`data-tab`, `data-active`),
`admin-suggestion-row` (`data-suggestion-id`), `admin-approve`, `admin-reject-note`,
`admin-market-row` (`data-market-id`, `data-market-status`),
`admin-resolve-yes` / `-resolve-no` (**two clicks**: the first arms, the second confirms),
`admin-toggle-status` (Close ↔ Reopen), `admin-set-line-open`, `admin-set-line-input`,
`admin-set-line-confirm` (the input only mounts after the open toggle),
`admin-incident-row` (`data-report-id`, `data-status`), `admin-resolve-now`, `admin-veto`,
`admin-create-title`, `admin-create-description`, `admin-create-category` (`data-category`),
`admin-create-resolution-date` (`<input type="date">` → `YYYY-MM-DD`),
`admin-create-featured`, `admin-create-submit`.

## Toasts — `components/ui/Toast.tsx`

`toast-container`, `toast` (`data-toast-type` ∈ success/error/info).
**Auto-dismisses after 4000ms** — assert promptly or with a bounded timeout.

---

## Components deleted rather than tested

These existed but were rendered nowhere, so they were removed instead of being given testids:

- `components/layout/NotificationBell.tsx` — zero import sites. The live unread badge is the `Alerts`
  tab badge on `/more` (`alerts-unread-badge`).
- `components/ui/WelcomeModal.tsx` — zero import sites.
- `claimDailyBonus` in `app/(app)/more/actions.ts` — never imported, and could not have worked
  (user-scoped client vs. the `prevent_coin_manipulation` trigger). The live path is
  `POST /api/daily-bonus`.

- `features/notifications/useNotifications.ts` — deleted with `NotificationBell`, which was its only
  consumer. If the §11 nav work wants a live unread count, write it fresh against the current schema:
  the old hook derived `unreadCount` once from a 50-row fetch and then only incremented/decremented
  it, so it drifted whenever rows were read anywhere else.
