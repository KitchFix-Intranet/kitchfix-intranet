import { test, expect } from '@playwright/test';

test('clicking a vendor card opens detail view', async ({ page }) => {
  await page.goto('/ops');

  // Navigate into the Vendor Portal and pick the first account (same setup as
  // list-loads.spec.ts — class selectors required for the dynamic-name elements).
  const vendorsTab = page.getByRole('button', { name: 'Vendors', exact: true });
  await expect(vendorsTab).toBeVisible({ timeout: 15_000 });
  await vendorsTab.click();

  await expect(page.getByRole('heading', { name: 'Vendors', exact: true })).toBeVisible();
  await page.locator('.oh-vp-acct-dropdown-trigger').click();
  await page.locator('.oh-vp-acct-dropdown-item').first().click();

  const firstCard = page.locator('.oh-vp-row').first();
  await expect(firstCard).toBeVisible({ timeout: 15_000 });
  await firstCard.click();

  // The VendorCard detail panel opens. "Back" and "Edit" are unconditional
  // buttons with stable text. Read-only: assert visibility only — do NOT click
  // Back, Edit, Deactivate, or any other action button.
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole('button', { name: 'Edit' })).toBeVisible();
});
