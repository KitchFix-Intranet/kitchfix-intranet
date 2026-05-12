# Testing — KitchFix Ops Hub

## Overview

End-to-end browser tests using Playwright. They run against a locally running dev server with a saved Google OAuth auth state (the `setup` project bootstraps it once; `chromium`-project tests reuse it). See `tests/README.md` for run instructions and the auth-state refresh procedure.

## What's covered (Phase 1, Round 1)

Read-only tests against:

- Home dashboard (authenticated render)
- Vendor Portal (list view, detail interaction)

Read-only means: the tests navigate, render, and assert on what's on screen. They do not submit forms or trigger any action that writes to a Google Sheet. Running them against live production Sheets is therefore safe — reads don't mutate state.

## What's NOT covered (deliberate gaps)

- **Any test that writes to a Google Sheet.** Two separate blockers:
  - Vendor Portal write actions (update, deactivate, add) write to the **HUB** sheet (`vendor_master`, `vendor_accounts` tabs). We have not cloned HUB, so there's no safe write target.
  - Inventory, Service Calendar, Labor, and Invoice writes would hit the **COLLECTION** sheet. We *have* cloned COLLECTION, but it isn't wired up because the `TEST_MODE` plumbing (below) has been deferred.

## TEST_MODE plumbing — deferred future work

When we add the first write test, we'll need:

- `TEST_MODE=true` env var to gate test routing
- `TEST_COLLECTION_SHEET_ID` env var pointing to the test COLLECTION clone
- `TEST_HUB_SHEET_ID` env var pointing to a HUB clone (**not yet created**)
- A helper in `src/lib/sheets.js` that returns the correct sheet ID based on `TEST_MODE`
- All `SHEET_IDS.HUB` and `SHEET_IDS.COLLECTION` references audited and routed through that helper

Scoped at ~2 hours of dev work plus a Kevin-managed step to clone HUB. Tracked in `docs/MIGRATION.md` as a follow-up to Phase 1 Task 1.

## Test sheet IDs (reserved)

- **Test COLLECTION clone:** `1OcccMHY-TSvv30drmL0RdqaMz36GjoQgmpCp6vIaZYE` — created 2026-05-12, shared with `kitchfix-sheets@speedy-actor-487922-p4.iam.gserviceaccount.com`, currently unused.
- **Test HUB clone:** NOT YET CREATED.

## Auth state

See the "Auth state" section in `tests/README.md` — when to refresh, the two-terminal sequence, and known Google anti-automation snags.

## When tests fail

```bash
npx playwright show-report
```

Opens the last run's HTML report in a browser: screenshots, console logs, network traffic, and a step-by-step trace for each failure.
