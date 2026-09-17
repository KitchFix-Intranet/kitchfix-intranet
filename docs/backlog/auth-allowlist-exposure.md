# Auth is Google-OAuth-only with no domain allowlist

**Filed:** 2026-09-17, after item 3 of the pre-training punch list
went looking for a per-user access gate and found there is not one.
**Status:** Open. Standing exposure, not a training-week item.
**Priority when reopened:** high. Every current mitigation is
"nobody outside the org knows the URL" - security through obscurity.

---

## What this is

The intranet's auth surface is exactly two files:

- `src/lib/auth.js` (93 lines). NextAuth wired to a single provider,
  Google, requesting `openid email profile` plus Sheets / Drive /
  Gmail-send scopes. There is no `signIn` callback, no
  `authorize` predicate, no allowedDomains list, no email allowlist.
- `src/middleware.js` (42 lines). Redirects the unauthenticated to
  `/login` and otherwise `NextResponse.next()`. The only auth check
  is `!!session` - "does a valid session exist."

Any Google account that completes the OAuth flow becomes a valid
session. Once signed in, the account list returned by
`/api/service-calendar/action?action=sc-accounts` is the full list
from `loadAccountList()` (`src/app/api/service-calendar/route.js:
421`) - **every client's meal counts and revenue.** The user's
`user_accounts_derived` row only decides the default landing
account, not what accounts they can see.

## Blast radius

- Every SC surface: per-day meal counts, projections, actuals,
  invoice amounts, chase state, day-of copy.
- Every KPI Labor / Overview / P&L surface (route-level gates read
  the same session and match against the same all-accounts list).
- Every Playbook / OPD document.
- Every Directory listing, incidents record, people row.
- Read-side only under a bare session. Write actions typically
  gate on role via contacts / people lookups keyed on the session
  email, so a stranger cannot easily write - but a stranger CAN
  quietly enumerate the entire operational picture read-only.

## Why the exposure has held

Nobody outside the organisation currently knows the URL, and the
Google login page is not linked from anywhere public. The
mitigation is entirely social - obscurity plus the fact that a
scraper would need to know the domain to point OAuth at it. That
is a real reduction in risk but not an access control.

## Proposals when this reopens (not decisions)

1. **Domain-only allowlist**. Add a `signIn` callback that rejects
   `!email.endsWith('@kitchfix.com')`. Blocks 99% of the exposure
   in five lines. Downside: outside contractors on non-kitchfix
   addresses (Sebastian, external kitchen consultants) would need
   explicit exceptions.

2. **`people`-derived allowlist**. Reject sign-in unless the email
   is present in `people` (ACTIVE) or `user_accounts_manual`. This
   is stricter than option 1 and reuses the same source of truth
   as `user_accounts_derived`. Downside: someone hired at Rippling
   Monday cannot log in until the nightly sync catches up (adds
   an operational friction the current model does not have).

3. **Explicit `auth_allowlist` table**. New Postgres table, Studio-
   maintained, canonical login gate. Highest control, highest
   maintenance burden. Least attractive unless options 1 and 2
   both fail to cover the population.

Option 1 is probably where this lands - domain match is what most
Google-OAuth-backed intranets do and it fits the "captain's
convention" shape (fits in five lines, one file, one comment
explaining why).

## Files a fix will touch

- `src/lib/auth.js` (add `signIn` callback)
- `src/middleware.js` (no change expected - session existence
  remains the correct middleware-level check; the `signIn`
  callback is where domain matching belongs)
- Test surface: `tests/` currently uses `TEST_MODE=true` to bypass
  auth (`src/middleware.js:5-18`); any auth change needs to
  preserve that bypass, and the bypass path itself needs a look -
  it correctly gates on `VERCEL !== "1"` today, which is the right
  belt-and-suspenders shape.

## What is NOT in scope for the eventual fix

- Not "add a permissions system." Access to individual accounts
  is already governed by `user_accounts_derived` for landing +
  role checks per surface. This backlog item is only the
  **auth-time question**: is this identity allowed to have a
  session at all? Everything downstream stays.
- Not "enable RLS on public tables." Standing project decision -
  RLS is off by design; intranet is service-role-only with route-
  layer gating. See CLAUDE.md standing findings.

## What raised it

Pre-training punch list item 3 (2026-09-17). Kevin asked me to
confirm four corporate users had "view access." The people /
Rippling / user_accounts_derived states all resolve fine; there
was no code-side access to grant. Which prompted looking at what
access DOES check - and finding that it does not, meaningfully,
at the auth layer.
