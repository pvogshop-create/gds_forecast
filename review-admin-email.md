> **OBSOLETE (2026-07-29).** This review covers the `@gds.org` / `ADMIN_EMAIL` gating in
> `src/app/api/auth/callback/route.ts`. That entire domain-check block was removed in the de-GDS
> cleanup — sign-in is now open to any authenticated email — so the issues below no longer describe
> live code. Kept for history only. Safe to delete.

## Summary

The multi-admin email change is well-structured and works correctly for the stated use case, but the stale strict-equality check in `callback/route.ts` creates a latent correctness trap that will silently block future non-`@gds.org` admins at login, and the per-request env-var parsing in the middleware is a minor but unnecessary performance cost.

## Issues

- **[severity: high] Correctness — `callback/route.ts` line 55 is not updated and will silently block future non-`@gds.org` admin emails at the authentication boundary.**

  The gating logic now has two different interpretations of "is admin":
  - `auth.ts` and `proxy.ts` both use `getAdminEmails()` / a local `.split(",")` — correctly checking all emails in the list.
  - `callback/route.ts` line 55 still does `email === process.env.ADMIN_EMAIL`, which is a verbatim string match against the entire raw env value (e.g. `"pvogshop@gmail.com,pvogelstein30@gds.org"`).

  The prompt notes this is "acceptable for now" because the new admin email (`pvogelstein30@gds.org`) passes the `isGdsUser` branch. That reasoning is correct today, but it creates a maintenance trap: the callback is the **only** place where non-`@gds.org` admins (like `pvogshop@gmail.com`) are granted entry. If `ADMIN_EMAIL` ever becomes `"pvogshop@gmail.com,secondadmin@gmail.com"`, the strict-equality check fails for both, and those admins are signed out and redirected at login with no error message indicating why.

  The inconsistency also makes the codebase actively misleading — a future reader of `callback/route.ts` will see a single-email check and not know it is out of sync with the rest of the auth layer.

  Suggested fix: replace line 55 in `callback/route.ts` with the same split-and-includes pattern used elsewhere:
  ```typescript
  const adminEmailList = (process.env.ADMIN_EMAIL ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const isAdminEmail = adminEmailList.includes(email);
  if (!isGdsUser && !isAdminEmail) { ... }
  ```

- **[severity: medium] Performance — `getAdminEmails()` in `auth.ts` re-parses the env string on every call, and the middleware also re-parses on every request.**

  `getAdminEmails()` is a plain function that reads and splits `process.env.ADMIN_EMAIL` each time it is invoked. In `auth.ts` it is called twice per `requireAdmin()` invocation (once explicitly, and `isAdmin()` also calls it). In `proxy.ts` the same inline split runs on every matched request — which is essentially every page load.

  The env var is static for the lifetime of the process; there is no reason to parse it more than once.

  Suggested fix: hoist the result to a module-level constant in both files:
  ```typescript
  // auth.ts — parse once at module load
  const ADMIN_EMAILS: ReadonlySet<string> = new Set(
    (process.env.ADMIN_EMAIL ?? "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean)
  );
  ```
  Using a `Set` also upgrades the `.includes()` O(n) lookup to O(1), which is trivially better even for small lists.

  Apply the same pattern at the top of `proxy.ts`.

- **[severity: low] Security — empty-string fallthrough in the admin check passes silently when `ADMIN_EMAIL` is not set.**

  Both `getAdminEmails()` and the middleware inline version default to `""` when `ADMIN_EMAIL` is undefined, producing an empty array/set after `filter(Boolean)`. This means `adminEmails.includes(user?.email ?? "")` correctly returns `false` for every user, so admin routes are blocked for everyone — which is the safe behavior.

  However, there is no warning or startup assertion when `ADMIN_EMAIL` is absent. A misconfigured deployment (missing env var) will silently make admin routes inaccessible with no signal in the logs. This is not a security hole but it will waste time in a debugging session.

  Suggested fix: add a startup warning:
  ```typescript
  if (!process.env.ADMIN_EMAIL) {
    console.warn("[auth] ADMIN_EMAIL is not set — admin routes will be inaccessible.");
  }
  ```

- **[severity: low] Correctness — `isAdmin()` in `auth.ts` returns `false` when `user?.email` is `undefined`, mapping it to the empty string `""`.**

  The expression `getAdminEmails().includes(user?.email ?? "")` falls back to checking whether `""` is in the admin list. After `filter(Boolean)`, `""` will never be in that list, so the behavior is safe (returns false). But the intent is "return false when there is no user", and mapping a missing email to `""` relies on a subtle side-effect of `filter(Boolean)` having already removed `""` from the list. If `filter(Boolean)` were ever removed, the behavior would silently change.

  Suggested fix: make the guard explicit:
  ```typescript
  export async function isAdmin(): Promise<boolean> {
    const user = await getUser();
    if (!user?.email) return false;
    return ADMIN_EMAILS.has(user.email);
  }
  ```

## Verdict

NEEDS CHANGES — the high-severity correctness issue in `callback/route.ts` is a latent bug that will block non-`@gds.org` admin logins silently. It should be fixed now while the multi-admin change is still in scope, rather than left as a known inconsistency that will be forgotten before it matters.
