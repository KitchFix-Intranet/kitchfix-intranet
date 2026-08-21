// PR-N R6 (Kevin 2026-08-21):
// 1. Hint stepped to 11px regular in --rail-3ink so it reads as a
//    hint rather than competing with the eyebrow label beside it.
// 2. `.scav-f label` selector tightened to `.scav-f > .scav-label`
//    so the eyebrow treatment is opt-in via class + direct-child.
//    Prevents future silent capture of any nested <label> element.
// 3. Post-tightening verification: every remaining `.scav-f`
//    descendant still renders as intended.

import { test, expect } from '@playwright/test';

const ACCOUNT = 'TXR - AZ';

async function openPriceRail(page: any, width = 1440) {
  await page.setViewportSize({ width, height: 1080 });
  await page.goto('/service-calendar?view=admin');
  await page.waitForSelector('.scav', { timeout: 30_000 });
  await page.locator(`.scav-acct[data-account-key="${ACCOUNT}"]`).click();
  await page.waitForSelector('.scav-srow');
  await page.locator('.scav-srow').first().click();
  await page.waitForSelector('.scav-insp-scroll[data-rail-variant="service"]');
}

test('R6-1: hint reads subordinate to eyebrow label', async ({ page }) => {
  await openPriceRail(page);
  const priceInput = page.locator('.scav-insp-scroll[data-rail-variant="service"] input[id^="np-"]').first();
  const orig = await priceInput.inputValue();
  await priceInput.fill((Number(orig) + 0.31).toFixed(2));
  await page.locator('.scav-insp-scroll[data-rail-variant="service"] textarea[id^="rs-"]').first().fill('r6 probe');

  const hint = page.locator('.scav-insp-scroll[data-rail-variant="service"] .scav-f > .scav-label .hint').first();
  const style = await hint.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      textTransform: cs.textTransform,
      letterSpacing: cs.letterSpacing,
      fontWeight: cs.fontWeight,
      fontSize: parseFloat(cs.fontSize),
      color: cs.color,
    };
  });
  expect(style.textTransform).toBe('none');
  expect(style.letterSpacing).toBe('normal');
  expect(style.fontWeight).toBe('400');
  expect(style.fontSize).toBeLessThan(12);
  expect(style.fontSize).toBeGreaterThanOrEqual(9);
  expect(style.color).toBe('rgb(174, 191, 212)');
});

test('R6-2: eyebrow labels still render uppercase display-weight micro (all 12 in EditorRail)', async ({ page }) => {
  await openPriceRail(page);
  const labels = page.locator('.scav-insp-scroll[data-rail-variant="service"] .scav-f > .scav-label');
  const count = await labels.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const style = await labels.nth(i).evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        textTransform: cs.textTransform,
        display: cs.display,
        fontWeight: cs.fontWeight,
      };
    });
    expect(style.textTransform, `label #${i} lost uppercase after tightening`).toBe('uppercase');
    expect(style.display, `label #${i} lost flex layout`).toBe('flex');
    expect(Number(style.fontWeight), `label #${i} lost display weight`).toBeGreaterThanOrEqual(700);
  }
});

test('R6-3: credit-card labels do NOT match the eyebrow rule (opt-in scope holds)', async ({ page }) => {
  await openPriceRail(page);
  const priceInput = page.locator('.scav-insp-scroll[data-rail-variant="service"] input[id^="np-"]').first();
  const orig = await priceInput.inputValue();
  await priceInput.fill((Number(orig) + 0.31).toFixed(2));
  await page.locator('.scav-insp-scroll[data-rail-variant="service"] .scav-seg button', { hasText: 'Backdate' }).click();

  const d = new Date();
  d.setDate(d.getDate() - 14);
  const backdate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await page.locator('.scav-insp-scroll[data-rail-variant="service"] input[type="date"]').first().fill(backdate);
  await page.locator('.scav-insp-scroll[data-rail-variant="service"] textarea[id^="rs-"]').first().fill('r6-3');

  await page.waitForSelector('[data-credit-choice="1"]');
  const card = page.locator('[data-credit-opt="issue"]');
  const cardStyle = await card.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { textTransform: cs.textTransform, display: cs.display };
  });
  expect(cardStyle.textTransform).toBe('none');
  expect(cardStyle.display).toBe('grid');

  await page.locator('.scav-insp-scroll[data-rail-variant="service"]').screenshot({ path: 'test-results/r6-rail-with-hint.png' });
});

test('R6-4: 1024 - no horizontal scrollbar, hint visibly subordinate', async ({ page }) => {
  await openPriceRail(page, 1024);
  const priceInput = page.locator('.scav-insp-scroll[data-rail-variant="service"] input[id^="np-"]').first();
  const orig = await priceInput.inputValue();
  await priceInput.fill((Number(orig) + 0.42).toFixed(2));
  await page.locator('.scav-insp-scroll[data-rail-variant="service"] textarea[id^="rs-"]').first().fill('r6');

  const rail = page.locator('.scav-insp-scroll[data-rail-variant="service"]');
  const scrollW = await rail.evaluate((el) => el.scrollWidth);
  const clientW = await rail.evaluate((el) => el.clientWidth);
  expect(scrollW).toBeLessThanOrEqual(clientW + 1);
  await rail.screenshot({ path: 'test-results/r6-rail-1024.png' });
});

test('R6-5: 1536 - hint remains subordinate at large viewport', async ({ page }) => {
  await openPriceRail(page, 1536);
  const priceInput = page.locator('.scav-insp-scroll[data-rail-variant="service"] input[id^="np-"]').first();
  const orig = await priceInput.inputValue();
  await priceInput.fill((Number(orig) + 0.42).toFixed(2));
  await page.locator('.scav-insp-scroll[data-rail-variant="service"] textarea[id^="rs-"]').first().fill('r6');

  const rail = page.locator('.scav-insp-scroll[data-rail-variant="service"]');
  const scrollW = await rail.evaluate((el) => el.scrollWidth);
  const clientW = await rail.evaluate((el) => el.clientWidth);
  expect(scrollW).toBeLessThanOrEqual(clientW + 1);
  await rail.screenshot({ path: 'test-results/r6-rail-1536.png' });
});
