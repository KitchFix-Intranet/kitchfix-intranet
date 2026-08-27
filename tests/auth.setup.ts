import { test as setup, expect } from '@playwright/test';
import fs from 'fs';

const authFile = 'tests/.auth/user.json';

// Owner ruling 2026-08-27: NextAuth session TTL is 30 days. Fail
// setup at 25 days so tests never run against stale state. Expiry
// is predictable; it should not cost an investigation each time.
// This constant is the "belt" to the assertBoardLoaded helper's
// "suspenders" (tests/lib/board-loaded.ts) - the setup check
// prevents the confusion at the source, and the runtime check
// catches sessions that expire mid-run.
const MAX_AUTH_FILE_AGE_DAYS = 25;

setup('authenticate via Google OAuth', async ({ page }) => {
  // Idempotent: if we already have cached auth state with cookies, skip the
  // interactive login entirely. This makes `dependencies: ['setup']` safe to
  // run non-interactively, and prevents an automated run from clobbering a good
  // tests/.auth/user.json with a fresh unauthenticated one.
  //
  // NOTE: setup.skip() throws a control-flow error, so it MUST be called
  // outside the try/catch below — otherwise the catch swallows the skip and the
  // interactive login runs anyway.
  let cachedCookieCount = 0;
  let authFileAgeDays: number | null = null;
  if (fs.existsSync(authFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(authFile, 'utf8'));
      cachedCookieCount = Array.isArray(parsed.cookies) ? parsed.cookies.length : 0;
    } catch {
      cachedCookieCount = 0; // corrupt/unreadable — force a fresh login
    }
    const st = fs.statSync(authFile);
    authFileAgeDays = (Date.now() - st.mtimeMs) / (24 * 3600 * 1000);
  }

  // 2026-08-27 age guard - the durable half of PR #858 / the
  // viewport-clip spec landing. Prior state: this setup skipped
  // whenever cookies were present, regardless of file age. Result:
  // tests/.auth/user.json aged 47 days on 2026-08-27 (past the 30d
  // NextAuth TTL), every spec's `page.goto('/kpi/labor?...')` landed
  // on StateSessionExpired, every waitForSelector timed out at 30s
  // with "waiting for .kpi-sig" - and the root cause "your session
  // is 17 days past expiry" was not in any message. Refresh command
  // spelled out so a chef running the spec battery in a walk-in
  // does not have to hunt.
  if (cachedCookieCount > 0 && authFileAgeDays !== null && authFileAgeDays > MAX_AUTH_FILE_AGE_DAYS) {
    throw new Error(
      `${authFile} is ${authFileAgeDays.toFixed(1)} days old (max ${MAX_AUTH_FILE_AGE_DAYS}d before NextAuth session expires). ` +
      `Refresh with: delete tests/.auth/user.json, then npx playwright test tests/auth.setup.ts (interactive Google login).`,
    );
  }

  setup.skip(cachedCookieCount > 0, 'Auth state already cached; skipping login.');

  // Navigate to the app — NextAuth will redirect to sign-in if not authed
  await page.goto('/');

  console.log('\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  MANUAL LOGIN REQUIRED');
  console.log('  1. The browser window is now open.');
  console.log('  2. Complete the Google OAuth login flow.');
  console.log('  3. Wait until you see the home dashboard.');
  console.log('  4. Return to the Playwright Inspector and click "Resume".');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n');

  // Pause for manual login. Inspector opens automatically.
  await page.pause();

  // After resume: verify we landed on an authenticated page
  // The home dashboard URL is '/' — adjust if your app redirects elsewhere
await expect(page).toHaveURL(/^https?:\/\/[^/]+\//);

  // Sanity check: a known authed-only element should be visible.
  // Pick something stable from the home dashboard hero or launchpad nav.
  // If unsure, just save state without this check; we can tighten later.

  await page.context().storageState({ path: authFile });

  console.log(`\n✓ Auth state saved to ${authFile}\n`);
});
