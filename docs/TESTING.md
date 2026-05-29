# Testing - KitchFix Ops Hub

## Overview

End-to-end browser tests using Playwright. Two run contexts:

- **Local development** - tests run against a locally running dev server (`npm run dev` at `http://localhost:3000`) with a saved Google OAuth auth state (the `setup` project bootstraps it once; `chromium`-project tests reuse it).
- **CI (GitHub Actions)** - tests run against **production** (`https://kitchfix-intranet.vercel.app`) on every PR to `main`. Auth state is restored from the `PLAYWRIGHT_AUTH_STATE_B64` secret. Read-only test scope makes this safe.

See `tests/README.md` for run instructions and the auth-state refresh procedure.

## What's covered (Phase 1, Round 1)

Read-only tests against:

- Home dashboard (authenticated render)
- Vendor Portal (list view, detail interaction)

Read-only means: the tests navigate, render, and assert on what's on screen. They do not submit forms or trigger any action that writes to a Google Sheet. Running them against live production Sheets is therefore safe - reads don't mutate state.

## What's NOT covered (deliberate gaps)

- **Any test that writes to a Google Sheet.** Two separate blockers:
  - Vendor Portal write actions (update, deactivate, add) write to the **HUB** sheet (`vendor_master`, `vendor_accounts` tabs). We have not cloned HUB, so there's no safe write target.
  - Inventory, Service Calendar, Labor, and Invoice writes would hit the **COLLECTION** sheet. We *have* cloned COLLECTION, but it isn't wired up because the `TEST_MODE` plumbing (below) has been deferred.

## TEST_MODE plumbing - deferred future work

When we add the first write test, we'll need:

- `TEST_MODE=true` env var to gate test routing
- `TEST_COLLECTION_SHEET_ID` env var pointing to the test COLLECTION clone
- `TEST_HUB_SHEET_ID` env var pointing to a HUB clone (**not yet created**)
- A helper in `src/lib/sheets.js` that returns the correct sheet ID based on `TEST_MODE`
- All `SHEET_IDS.HUB` and `SHEET_IDS.COLLECTION` references audited and routed through that helper

Scoped at ~2 hours of dev work plus a Kevin-managed step to clone HUB. Tracked in `docs/archive/migration/MIGRATION.md` as a follow-up to Phase 1 Task 1 (the original Phase 1-5 plan; partially superseded by `docs/SUPABASE_MIGRATION.md` but this follow-up still applies).

## Test sheet IDs (reserved)

- **Test COLLECTION clone:** `1OcccMHY-TSvv30drmL0RdqaMz36GjoQgmpCp6vIaZYE` - created 2026-05-12, shared with `kitchfix-sheets@speedy-actor-487922-p4.iam.gserviceaccount.com`, currently unused.
- **Test HUB clone:** NOT YET CREATED.

## Auth state

See the "Auth state" section in `tests/README.md` - when to refresh, the two-terminal sequence, and known Google anti-automation snags.

## When tests fail

```bash
npx playwright show-report
```

Opens the last run's HTML report in a browser: screenshots, console logs, network traffic, and a step-by-step trace for each failure.

## CI integration

GitHub Actions workflow: `.github/workflows/e2e.yml`.

**Triggers:** Every PR to `main` (`opened`, `synchronize`, `reopened`).

**What it runs:** All chromium tests against production. The `setup` project is skipped - CI uses the auth state from the secret instead of running the interactive login.

**Required secrets** (already configured under repo Settings → Secrets and variables → Actions):
- `PLAYWRIGHT_AUTH_STATE_B64` - base64-encoded `tests/.auth/user.json`, production-scoped cookies
- `VERCEL_AUTOMATION_BYPASS_SECRET` - Vercel deployment protection bypass token (reserved for future use; not currently sent in headers)

**Production target rationale:** The original design pointed CI at the PR's Vercel preview URL, but `wait-for-vercel-preview` can't authenticate through Vercel's Standard Protection wall - it polls the preview URL and gets 401s. Production target sidesteps the bypass-token plumbing entirely. Trade-off: a PR breaking the home dashboard would land in prod before CI catches it on the next PR. Acceptable given the read-only test scope. Revisit when TEST_MODE plumbing arrives.

**Refreshing the auth state secret:**

1. Regenerate `tests/.auth/user.json` against production:
```bash
   rm tests/.auth/user.json
   PLAYWRIGHT_BASE_URL=https://kitchfix-intranet.vercel.app npm run test:e2e:setup -- --headed
```
2. Sign in with the test Google account, wait for home dashboard, click Resume in Playwright Inspector.
3. Re-encode and update the GitHub secret:
```bash
   base64 -i tests/.auth/user.json | pbcopy
```
4. Paste into GitHub → Settings → Secrets → `PLAYWRIGHT_AUTH_STATE_B64` (edit, replace value).

Auth state cookies expire on Google's schedule - when CI starts failing with "expected pattern: not /login" assertions, the cookies have expired and a refresh is needed.