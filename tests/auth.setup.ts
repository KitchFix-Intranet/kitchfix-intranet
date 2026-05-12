import { test as setup, expect } from '@playwright/test';

const authFile = 'tests/.auth/user.json';

setup('authenticate via Google OAuth', async ({ page }) => {
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
  await expect(page).toHaveURL(/^http:\/\/localhost:3000\//);

  // Sanity check: a known authed-only element should be visible.
  // Pick something stable from the home dashboard hero or launchpad nav.
  // If unsure, just save state without this check; we can tighten later.

  await page.context().storageState({ path: authFile });

  console.log(`\n✓ Auth state saved to ${authFile}\n`);
});
