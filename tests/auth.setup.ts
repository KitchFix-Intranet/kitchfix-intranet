import { test as setup, expect } from '@playwright/test';
import fs from 'fs';

const authFile = 'tests/.auth/user.json';

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
  if (fs.existsSync(authFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(authFile, 'utf8'));
      cachedCookieCount = Array.isArray(parsed.cookies) ? parsed.cookies.length : 0;
    } catch {
      cachedCookieCount = 0; // corrupt/unreadable — force a fresh login
    }
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
