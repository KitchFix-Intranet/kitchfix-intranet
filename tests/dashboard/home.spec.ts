import { test, expect } from '@playwright/test';

test('home dashboard loads with auth state', async ({ page }) => {
  await page.goto('/');

  // If the saved auth state failed, NextAuth/middleware would bounce us to the
  // login page — assert we are NOT on a sign-in route.
  await expect(page).not.toHaveURL(/sign-?in|\/login|\/api\/auth/i);

  // The three launchpad cards (<h3 class="kf-launch-title">) only render after
  // /api/dashboard resolves and the session is authenticated — a stable,
  // authed-only signal. Home should be interactive well under 10s.
  await expect(page.getByRole('heading', { name: 'Ops Hub' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('heading', { name: 'Team Directory' })).toBeVisible();
});
