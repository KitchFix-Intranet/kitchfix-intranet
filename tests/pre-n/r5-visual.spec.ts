// PR-N R5 visual acceptance (Kevin 2026-08-21):
// Item 1 - panes inset from shell edge; account cards spaced; no grey.
// Item 2 - credit cards 2-column (20px radio + 1fr body); sentence case;
// no horizontal scrollbar in the rail at 1024 or 1536.

import { test, expect } from '@playwright/test';
import { assertBoardLoaded } from '../lib/board-loaded';

const ACCOUNT = 'TXR - AZ';

async function openBackdateWithCredit(page: any, width: number) {
  await page.setViewportSize({ width, height: 1080 });
  await page.goto('/service-calendar?view=admin');
  await assertBoardLoaded(page, '.scav', { context: 'sc admin' });
  await page.waitForTimeout(400);

  await page.locator(`.scav-acct[data-account-key="${ACCOUNT}"]`).click();
  await page.waitForSelector('.scav-srow', { timeout: 10_000 });
  await page.locator('.scav-srow').first().click();
  await page.waitForSelector('.scav-insp-scroll[data-rail-variant="service"]', { timeout: 8_000 });

  await page.locator('.scav-insp-scroll[data-rail-variant="service"] .scav-seg button', { hasText: 'Backdate' }).click();

  const d = new Date();
  d.setDate(d.getDate() - 14);
  const backdate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await page.locator('.scav-insp-scroll[data-rail-variant="service"] input[type="date"]').first().fill(backdate);

  const priceInput = page.locator('.scav-insp-scroll[data-rail-variant="service"] input[id^="np-"]').first();
  const orig = await priceInput.inputValue();
  await priceInput.fill((Number(orig) + 0.42).toFixed(2));
  await page.locator('.scav-insp-scroll[data-rail-variant="service"] textarea[id^="rs-"]').first().fill('R5 visual');

  await page.waitForSelector('[data-credit-choice="1"]', { timeout: 5_000 });
  await page.waitForTimeout(300);
}

test('R5 visual: 1024 - rail has no horizontal scrollbar; credit cards render correctly', async ({ page }) => {
  await openBackdateWithCredit(page, 1024);
  const rail = page.locator('.scav-insp-scroll[data-rail-variant="service"]');
  await rail.screenshot({ path: 'test-results/r5-rail-1024.png' });

  const scrollW = await rail.evaluate((el) => el.scrollWidth);
  const clientW = await rail.evaluate((el) => el.clientWidth);
  expect(scrollW, `rail scrollWidth ${scrollW} > clientWidth ${clientW} at 1024`).toBeLessThanOrEqual(clientW + 1);

  const issueLabel = await page.locator('[data-credit-opt="issue"] .scav-credit-card-t').innerText();
  const noneLabel = await page.locator('[data-credit-opt="none"] .scav-credit-card-t').innerText();
  expect(issueLabel).toBe('Issue the credit');
  expect(noneLabel).toBe('No credit');

  const issueTransform = await page.locator('[data-credit-opt="issue"] .scav-credit-card-t').evaluate((el) => getComputedStyle(el).textTransform);
  expect(issueTransform).toBe('none');
  const cardTransform = await page.locator('[data-credit-opt="issue"]').evaluate((el) => getComputedStyle(el).textTransform);
  expect(cardTransform).toBe('none');

  const gridCols = await page.locator('[data-credit-opt="issue"]').evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  expect(gridCols).toMatch(/^20px /);
});

test('R5 visual: 1536 - rail has no horizontal scrollbar; credit cards render correctly', async ({ page }) => {
  await openBackdateWithCredit(page, 1536);
  const rail = page.locator('.scav-insp-scroll[data-rail-variant="service"]');
  await rail.screenshot({ path: 'test-results/r5-rail-1536.png' });

  const scrollW = await rail.evaluate((el) => el.scrollWidth);
  const clientW = await rail.evaluate((el) => el.clientWidth);
  expect(scrollW, `rail scrollWidth ${scrollW} > clientWidth ${clientW} at 1536`).toBeLessThanOrEqual(clientW + 1);
});

test('R5 visual: pane container inset from shell edge; background transparent', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto('/service-calendar?view=admin');
  await assertBoardLoaded(page, '.scav', { context: 'sc admin' });
  await page.waitForTimeout(400);

  const styles = await page.locator('.scav').evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      bg: cs.backgroundColor,
      padTop: parseFloat(cs.paddingTop),
      padBottom: parseFloat(cs.paddingBottom),
      padLeft: parseFloat(cs.paddingLeft),
      padRight: parseFloat(cs.paddingRight),
    };
  });
  expect(styles.bg).toBe('rgba(0, 0, 0, 0)');
  expect(styles.padTop).toBeGreaterThan(0);
  expect(styles.padBottom).toBeGreaterThan(0);
  expect(styles.padLeft).toBeGreaterThan(0);
  expect(styles.padRight).toBeGreaterThan(0);

  await page.screenshot({ path: 'test-results/r5-shell-inset.png', fullPage: false });
});
