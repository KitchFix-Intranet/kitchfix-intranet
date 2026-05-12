# End-to-end tests — KitchFix Ops Hub

## Overview

Playwright end-to-end tests that exercise the KitchFix Ops Hub through a real browser (Chromium for now; Firefox/WebKit to be added later in Phase 1). Tests run against a locally running dev server you start yourself — the Playwright config does **not** start one for you. Round 1 tests are **read-only** and run against the live production Google Sheets (reads don't mutate state); the `TEST_MODE` plumbing that would route writes to test clones is deferred — see `docs/TESTING.md`.

## Prerequisites

- Node.js (same version the app uses)
- `npm install` has been run
- `.env.local` set up for normal dev. Tests run against prod Google Sheets in read-only mode for now. See `docs/TESTING.md` for scope and the deferred `TEST_MODE` plumbing.
- Auth state has been generated. See "Auth state" section below.

Then start the dev server before running tests:

```bash
npm run dev
```

## Running tests

| Command | What it does |
|---|---|
| `npm run test:e2e` | Run all tests headless (list + HTML reporter). |
| `npm run test:e2e:ui` | Open the Playwright UI runner (watch mode, time-travel debugging). |
| `npm run test:e2e:headed` | Run tests in a visible browser window. |
| `npm run test:e2e:setup` | Run only the `setup` project (auth state bootstrap). |

Useful flags: `npm run test:e2e -- --list` lists tests without running them; `npm run test:e2e -- tests/vendors` runs a subdirectory.

## Auth state

All tests reuse a saved authenticated session from
`tests/.auth/user.json` (gitignored). This file is created by the
`setup` Playwright project, which runs `tests/auth.setup.ts`.

### When to refresh auth state

- First time setting up the test harness on a new machine
- When the session expires (Google OAuth sessions typically last weeks)
- After clearing `tests/.auth/` for any reason
- If tests start failing with login redirects in the first navigation

### How to refresh auth state

1. Start the dev server in one terminal:
     npm run dev

2. In a second terminal, run the auth setup script with --headed so
   the browser is visible:
     npm run test:e2e:setup -- --headed

3. A Chromium window opens to http://localhost:3000.

4. The Playwright Inspector opens at the same time. Ignore it for now.

5. In the Chromium window, complete the Google OAuth login. Use the
   account you normally use for the Ops Hub. Wait until the home
   dashboard fully loads.

6. Click "Resume" in the Playwright Inspector. The script will save
   auth state to `tests/.auth/user.json` and exit.

7. Verify the file exists and is roughly 2-10 KB:
     ls -lh tests/.auth/user.json

That's it. All subsequent test runs will reuse this file.

### Troubleshooting

- "Google won't let me sign in / says browser is not secure":
  Use a Google account that allows OAuth from less-secure browsers,
  or temporarily turn off the security warning. This is a Google
  anti-automation measure, not a Playwright issue.

- "Resume button is greyed out":
  The page is still loading or has thrown an error. Open the
  inspector's Console tab to see why.

## When tests fail

Open the HTML report from the last run:

```bash
npx playwright show-report
```

It includes per-test traces, screenshots, and console/network logs for failures.
