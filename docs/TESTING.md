# Testing - KitchFix Ops Hub

> **Last verified:** 2026-07-12 (post-#407 TEST_MODE bypass + #408 CI rewrite).

## Overview

End-to-end browser tests using Playwright. Two run contexts today; a third (authed preview) is a documented follow-up.

- **Local development** - tests run against a locally running dev server (`npm run dev` at `http://localhost:3000`) with a saved Google OAuth auth state (the `setup` project bootstraps it once; `chromium`-project tests reuse it). TEST_MODE bypass optional for suites that don't want to authenticate through Google.
- **CI (GitHub Actions)** - two jobs since PR #408. Job A runs the SC nav-matrix spec against an **in-runner production build** with the TEST_MODE bypass. Job B runs a dependency-free smoke check against the **PR's own Vercel preview URL** (read from the `deployment_status` event payload). Neither points at prod.
- **Authed preview e2e** - not built. Would require plumbing `VERCEL_AUTOMATION_BYPASS_SECRET` into the smoke check headers so it can reach the API surface. Documented follow-up in [`SC_STATUS.md`](SC_STATUS.md).

See `tests/README.md` for local run instructions and the (now legacy) auth-state refresh procedure.

## TEST_MODE bypass (LIVE since PR #407)

`src/middleware.js` short-circuits at the very top of the chain when both gates are TRUE:

```js
if (process.env.TEST_MODE === "true" && process.env.VERCEL !== "1") {
  return NextResponse.next();
}
```

**Double-gated** on purpose. `VERCEL === "1"` on every Vercel runtime (build + preview + prod); the middleware auth chain always runs there. TEST_MODE is safe to export in the CI runner env or a local shell without any risk of leaking into a Vercel deploy.

**What TEST_MODE enables**: Playwright can navigate directly to any authed surface without going through Google OAuth. All data routes the test needs are stubbed via `page.route` inside each spec - TEST_MODE bypasses AUTH, not the data layer.

**What TEST_MODE is NOT**: it does not route Sheet writes to test clones. `TEST_COLLECTION_SHEET_ID` and `TEST_HUB_SHEET_ID` remain reserved for a future write-test suite. The current sc-nav-matrix spec exercises client-side nav only.

## CI integration (post-#408)

GitHub Actions workflow: `.github/workflows/e2e.yml`. Two jobs, two event streams.

### Job A - `matrix` (in-runner build, on `pull_request`)

**Trigger**: every PR to `main` (`opened`, `synchronize`, `reopened`).

**Steps**: checkout -> `npm ci` -> install Playwright -> `npx next build` -> `TEST_MODE=true npx next start` (backgrounded) -> wait for readiness -> `npx playwright test tests/sc-nav-matrix.spec.ts`.

**Placeholder env vars**: `AUTH_URL`, `AUTH_SECRET`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` are all set to inline literals (`ci-placeholder-not-a-secret` etc). No Kevin-setup step blocks the check from running on the very PR that adds it. The values are inert because middleware auth is bypassed and every data route is stubbed.

**Why in-runner build**: this is what makes the check actually test the PR's code. Testing against prod (the pre-#408 shape) proved "prod is up," not "this PR works."

### Job B - `preview-smoke` (Vercel preview, on `deployment_status`)

**Trigger**: Vercel's GitHub App emits `deployment_status` with `state=success` when the PR's preview finishes building. The workflow filters to `deployment_status.state == 'success'` and reads `github.event.deployment_status.environment_url` (the PR's own preview URL).

**Steps**: dependency-free curl checks that the preview responds. Accepts `2xx / 3xx / 401` as "serving" (Vercel Preview Protection returns 302 SSO redirect for automated pulls; that's a "serving" state, not a failure).

**Honest limitation**: the smoke cannot reach the API surface because Preview Protection blocks it. Would need `VERCEL_AUTOMATION_BYPASS_SECRET` in the request header. Deferred as the "authed preview e2e" follow-up.

### What's gone from the CI

The pre-#408 workflow ran Playwright against a hardcoded prod URL (`PLAYWRIGHT_BASE_URL=https://kitchfix-intranet.vercel.app`). That string no longer exists in the workflow - `grep 'kitchfix-intranet.vercel.app' .github/workflows/e2e.yml` returns zero hits.

## Nav matrix regression net

`tests/sc-nav-matrix.spec.ts` - the #407 regression net. 26-URL matrix covering:

- Every scope combination (season / period / month)
- With and without account key
- Every valid account key
- Cold navigation (fresh URL entry)
- Warm navigation (from a prior state via `router.push`)

Assertions per URL: `router.push` produces the expected URL change; the corresponding view mounts (`.sc-workspace-grid-row`, `.sc-full-season-card`, etc.); zero `ReferenceError` accumulates across the render (guard against the TDZ + free-variable classes documented in [`GOTCHAS.md`](GOTCHAS.md)).

The matrix uses `page.route` to stub every data-route response with a `REAL_DAY` fixture that reaches the render depth Playwright is testing - an all-empty stub silently passes and lies about coverage. That "must include a real day" requirement is a hard comment inside the spec.

## Guard specs to know about

- `tests/sc-nav-matrix.spec.ts` - #407 regression net (above)
- `tests/sc-tdz-hotfix.spec.ts` - #378 TDZ / free-variable render-depth guard (extended in #382 to include a MonthCard drill click)

## Legacy test artifacts

- `tests/.auth/user.json` - auth state from the pre-#408 production-target era. Not consumed by the current workflow (both jobs bypass auth). Kept for local `test:e2e:setup` fallback. Refresh procedure (in `tests/README.md`) still works but is only useful for local runs that don't want to use TEST_MODE.
- `tests/auth.setup.ts` - the Playwright setup project that generates `.auth/user.json`. Only invoked by local `test:e2e:setup`. Whether it should be kept or retired is an open question in [`SC_STATUS.md`](SC_STATUS.md) "Old Playwright specs".

## What's covered today

Read-only browser tests against:

- Home dashboard (authenticated render, legacy from Phase 1 Round 1)
- Vendor Portal (list view, detail interaction, legacy from Phase 1 Round 1)
- **SC nav matrix** (26 URLs, TEST_MODE-authed, in-runner build) - the #407 net

Read-only means the tests navigate + render + assert on what's on screen. They do not submit forms or trigger any action that writes to a Google Sheet or Postgres row.

## What's NOT covered (deliberate gaps)

- **Any test that writes to a Google Sheet or Postgres.** Requires TEST_MODE plumbing to route to test targets - reserved env vars exist but no consumer.
- **API-surface tests against Vercel previews.** Requires the `VERCEL_AUTOMATION_BYPASS_SECRET` header plumbing (documented follow-up).

## When tests fail

```bash
npx playwright show-report
```

Opens the last run's HTML report in a browser: screenshots, console logs, network traffic, and a step-by-step trace for each failure.

## Captain's log

- **2026-05-11** - Initial Playwright suite (Home dashboard + Vendor Portal read-only) captured during Phase 0.
- **2026-05-13** - Auth state discovered to be environment-scoped (NextAuth session cookies domain-locked; `localhost:3000` state fails against Vercel). See [`GOTCHAS.md`](GOTCHAS.md) "Auth state is environment-scoped".
- **2026-07-11** - Nav-matrix spec landed as part of PR #407. Read-only investigation preserved in [`audits/SC_NAV_SUBSYSTEM_MAP_2026-07-11.md`](audits/SC_NAV_SUBSYSTEM_MAP_2026-07-11.md).
- **2026-07-12** - CI workflow rewritten in PR #408. Two-job split (in-runner matrix + preview smoke). Pre-existing "test against prod" shape retired; the hardcoded prod URL is gone. TEST_MODE bypass (from #407) is the mechanism that makes job A possible. Vercel Preview Protection 302 redirect is treated as "serving" by the smoke check (documented behavior, not a workaround).
