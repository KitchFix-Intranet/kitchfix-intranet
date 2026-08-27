import { test, expect } from '@playwright/test';
import { assertBoardLoaded } from '../lib/board-loaded';

test('vendor portal list view loads', async ({ page }) => {
  await page.goto('/ops');
  await assertBoardLoaded(page, 'button:has-text("Vendors")', { context: 'ops hub vendors tab' });

  // Ops Hub renders behind a spinner until /api/ops?action=bootstrap resolves.
  // The OpsNav pill is the first stable, authed-only landmark; click into Vendors.
  const vendorsTab = page.getByRole('button', { name: 'Vendors', exact: true });
  await expect(vendorsTab).toBeVisible({ timeout: 15_000 });
  await vendorsTab.click();

  // Vendor Portal mounted — its <h2 class="oh-vp-title"> heading.
  await expect(page.getByRole('heading', { name: 'Vendors', exact: true })).toBeVisible();

  // The portal shows a landing placeholder until an account is selected.
  // Class selectors needed here: the account dropdown trigger's label is
  // "Select Account…" (non-ASCII ellipsis) and the menu items have dynamic
  // account names — neither has a stable role+name handle.
  await page.locator('.oh-vp-acct-dropdown-trigger').click();
  await page.locator('.oh-vp-acct-dropdown-item').first().click();

  // VendorList async-fetches the vendor list; rows are <button class="oh-vp-row">
  // with dynamic vendor names — class selector required. Generous wait for fetch.
  await expect(page.locator('.oh-vp-row').first()).toBeVisible({ timeout: 15_000 });
});
