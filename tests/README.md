# End-to-end tests — KitchFix Ops Hub

## Overview

Playwright end-to-end tests that exercise the KitchFix Ops Hub through a real browser (Chromium for now; Firefox/WebKit to be added later in Phase 1). Tests run against a locally running dev server and a dedicated test data sheet so they never touch production data.

## Prerequisites

- Node.js (same version the app uses — see `package.json` / `.nvmrc` if present).
- `npm install` has been run (installs `@playwright/test`).
- Chromium browser installed: `npx playwright install chromium`.
- `.env.local` has `TEST_MODE` and `TEST_COLLECTION_SHEET_ID` set. *(These are added in Step 4 of the Playwright setup plan; until then the harness is scaffolding only.)*
- The dev server is started manually with test mode on before running tests:
  ```bash
  TEST_MODE=true npm run dev
  ```
  The Playwright config does **not** start the server for you.

## Running tests

| Command | What it does |
|---|---|
| `npm run test:e2e` | Run all tests headless (list + HTML reporter). |
| `npm run test:e2e:ui` | Open the Playwright UI runner (watch mode, time-travel debugging). |
| `npm run test:e2e:headed` | Run tests in a visible browser window. |
| `npm run test:e2e:setup` | Run only the `setup` project (auth state bootstrap). |

Useful flags: `npm run test:e2e -- --list` lists tests without running them; `npm run test:e2e -- tests/vendors` runs a subdirectory.

## Auth state

Login is performed once by `tests/auth.setup.ts` (the `setup` project) and the resulting session is saved to `tests/.auth/user.json`, which the `chromium` project loads via `storageState`. That file is **gitignored** — it holds live session state and must never be committed.

The refresh procedure (how to regenerate `user.json` when the session expires) will be documented here once Step 3 wires up the real Google OAuth login flow. For now `auth.setup.ts` is a no-op placeholder.

## When tests fail

Open the HTML report from the last run:

```bash
npx playwright show-report
```

It includes per-test traces, screenshots, and console/network logs for failures.
