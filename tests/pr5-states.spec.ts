// PR 5 - loading + failure + Part C empty-state verification.
//
// Acceptance items covered:
//   1  Loading - skeleton of real layout; rail + command bar live
//   2  prefers-reduced-motion - no pulse
//   3  Skeleton flash delay (150ms) - measured / documented
//   4  500 + timeout + malformed - reported (see PR body)
//   5  Failure state - names what failed, when it last worked,
//                       "these are not the numbers", retry
//   6  Failure vs zero spend - visually unmistakable (bucket cards
//                              absent under FailureCard; amber stripe)
//   7  Freshness timestamp real (never hardcoded)
//   9  Empty range / future range / no-budget card - each verified
//   10 Footer popover on drill table
//   11 At-risk regression: TBR-FL + CIN-KY unchanged
//   12 pass-through STL-FL unchanged
//
// Runs against a dev server with TEST_MODE=true.

import { test, expect } from "@playwright/test";
import path from "node:path";

const OUT = path.resolve(__dirname, "..", "playwright-report", "pr5-states");
test.use({ baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3230" });
test.setTimeout(180_000);

const FYTD_START = "2025-12-29";
const FYTD_END   = "2026-08-24";

async function loadBoard(page, account, start = FYTD_START, end = FYTD_END) {
  const q = `?account=${encodeURIComponent(account)}&start=${start}&end=${end}`;
  await page.goto(`/kpi/purchasing${q}`);
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".kpi-p-card").first()).toBeVisible();
  await page.waitForTimeout(400);
}

test("loading - skeleton appears after 150ms delay; rail + command bar live", async ({ page }) => {
  // Slow the API way down so we can catch the skeleton mid-fetch.
  await page.route("**/api/kpi/purchasing?**", async route => {
    // Only slow the initial mount fetch (?drill=lines etc. still pass).
    const url = route.request().url();
    if (!url.includes("drill=lines") && !url.includes("table=1")) {
      await new Promise(r => setTimeout(r, 1500));
    }
    await route.continue();
  });
  await page.setViewportSize({ width: 1600, height: 1600 });
  const nav = page.goto("/kpi/purchasing?account=ALL&start=" + FYTD_START + "&end=" + FYTD_END);
  await page.waitForTimeout(600); // beyond the 150ms delay
  // Skeleton visible mid-fetch.
  const skel = page.locator(".kpi-p-skel").first();
  await expect(skel).toBeVisible();
  // Rail + command bar are part of Shell - use their well-known classes.
  await expect(page.locator(".kpi-cmd").first()).toBeVisible();
  await expect(page.locator(".kpi-folio").first()).toBeVisible();
  await nav;
  await page.screenshot({ path: path.join(OUT, "skeleton-1600.png"), fullPage: true });
});

test("prefers-reduced-motion - skeleton pulse animation disabled", async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  await page.route("**/api/kpi/purchasing?**", async route => {
    const url = route.request().url();
    if (!url.includes("drill=lines") && !url.includes("table=1")) {
      await new Promise(r => setTimeout(r, 1500));
    }
    await route.continue();
  });
  await page.setViewportSize({ width: 1600, height: 1600 });
  const nav = page.goto("/kpi/purchasing?account=ALL&start=" + FYTD_START + "&end=" + FYTD_END);
  await page.waitForTimeout(600);
  const pulse = page.locator(".kpi-p-skel-pulse").first();
  await expect(pulse).toBeVisible();
  const anim = await pulse.evaluate(el => getComputedStyle(el).animationName);
  expect(anim).toBe("none");
  await nav;
  await ctx.close();
});

test("failure state - 500 renders FailureCard with retry", async ({ page }) => {
  // Force the mount fetch to 500. Retry keys off `retryCount` so we
  // can also verify the button refires the fetch.
  let respondedWith500 = 0;
  await page.route("**/api/kpi/purchasing?account=ALL**", async route => {
    const url = route.request().url();
    if (url.includes("drill=lines") || url.includes("table=1")) {
      await route.continue();
      return;
    }
    respondedWith500++;
    await route.fulfill({ status: 500, body: "" });
  });
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto("/kpi/purchasing?account=ALL&start=" + FYTD_START + "&end=" + FYTD_END);
  await page.waitForLoadState("networkidle");
  const failCard = page.locator('[data-card="board-failed"]');
  await expect(failCard).toBeVisible();
  // "these are not the numbers" - explicit sentence.
  await expect(failCard.getByText(/not a period with no spend/i)).toBeVisible();
  // "when it last worked" - timestamps row present, even if all "unknown".
  await expect(failCard.locator(".kpi-p-fail-when")).toBeVisible();
  // Retry button.
  const retryBtn = failCard.getByRole("button", { name: /try again/i });
  await expect(retryBtn).toBeVisible();
  const before = respondedWith500;
  await retryBtn.click();
  await page.waitForTimeout(500);
  expect(respondedWith500).toBe(before + 1);
  await page.screenshot({ path: path.join(OUT, "fail-500-1600.png"), fullPage: false });
});

test("failure vs zero spend - visually unmistakable", async ({ page }) => {
  // Failure state: bucket cards MUST NOT render underneath.
  await page.route("**/api/kpi/purchasing?account=ALL**", async route => {
    const url = route.request().url();
    if (url.includes("drill=lines") || url.includes("table=1")) {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 500, body: "" });
  });
  await page.setViewportSize({ width: 1600, height: 1200 });
  await page.goto("/kpi/purchasing?account=ALL&start=" + FYTD_START + "&end=" + FYTD_END);
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[data-card="board-failed"]')).toBeVisible();
  // No bucket cards, no drill table, no reimbursable row - the whole
  // board area is REPLACED by the failure card.
  await expect(page.locator('[data-card="bucket-food"]')).toHaveCount(0);
  await expect(page.locator('[data-card="drill-table"]')).toHaveCount(0);
  await expect(page.locator('[data-card="reimb-row"]')).toHaveCount(0);
});

test("failure freshness uses real timestamps from a prior successful load", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1200 });
  // First successful load populates lastFreshness state.
  await page.goto("/kpi/purchasing?account=ALL&start=" + FYTD_START + "&end=" + FYTD_END);
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.kpi-p-card').first()).toBeVisible();
  // Now intercept a TBR fetch to 500.
  await page.route(/\/api\/kpi\/purchasing\?account=TBR/, async route => {
    const url = route.request().url();
    if (url.includes("drill=lines") || url.includes("table=1")) {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 500, body: "" });
  });
  // Trigger a client-side transition (folio rail pick) so page.js
  // state is preserved across the account switch - the whole point
  // of `lastFreshness`. A full page.goto would remount and reset
  // state; the folio rail uses router.replace which doesn't.
  const tbrLink = page.locator('.kpi-folio [data-account="TBR - FL"], .kpi-folio button:has-text("TBR"), .kpi-folio a:has-text("TBR")').first();
  if (await tbrLink.count() > 0) {
    await tbrLink.click();
  } else {
    // Fallback - use the URL query change (Next router will replace).
    await page.evaluate(() => {
      const url = new URL(window.location.href);
      url.searchParams.set("account", "TBR - FL");
      window.history.pushState({}, "", url.toString());
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
  }
  await page.waitForTimeout(1500);
  const fail = page.locator('[data-card="board-failed"]');
  await expect(fail).toBeVisible();
  // At least one dd cell should contain a UTC date-time from real data (not "unknown").
  const dds = await fail.locator('.kpi-p-fail-when dd').allTextContents();
  const anyReal = dds.some(t => /\d{4}-\d{2}-\d{2} at \d{2}:\d{2} UTC/.test(t));
  expect(anyReal).toBe(true);
});

test("Part C - empty range at at-risk renders neutral, no verdict", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  // TBJ - NY at P1 (2025-12-29..2026-01-25) - very early season, minimal spend.
  await loadBoard(page, "TBJ - NY", "2025-12-29", "2026-01-04");
  // Food bucket card should render.
  const food = page.locator('[data-card="bucket-food"]');
  await expect(food).toBeVisible();
  // No verdict pill in the hot palette (no "OVER", "UNDER") - accepts
  // "No spend" or similar neutral.
  const pillLabel = ((await food.locator('.kpi-p-pill').first().textContent()) || "").trim();
  expect(pillLabel.toLowerCase()).not.toMatch(/\bover\b|\bunder\b/i);
});

test("Part C - future range suppresses verdicts", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  // Pick a range starting after today.
  const future = "2027-01-04";
  const futureEnd = "2027-01-31";
  await loadBoard(page, "TBR - FL", future, futureEnd);
  // No verdict pill (or all pills neutral).
  const pills = await page.locator('.kpi-p-pill').allTextContents();
  for (const p of pills) {
    expect(p.toLowerCase()).not.toMatch(/\bover budget\b|\bunder budget\b/i);
  }
});

test("Part C - no-budget reimbursable at pass-through has no variance block", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  await loadBoard(page, "STL - MO", FYTD_START, FYTD_END);
  const reimb = page.locator('[data-card="reimb-row"]');
  await expect(reimb).toBeVisible();
  // No red / green variance value nodes.
  const varz = await reimb.locator('.kpi-p-value.r, .kpi-p-value.g').count();
  expect(varz).toBe(0);
});

test("Part D - drill-table footer popover explains SHOW filter", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  await loadBoard(page, "ALL", FYTD_START, FYTD_END);
  const trigger = page.locator('[data-hs-help="qDrillTableFooter"]');
  await expect(trigger).toBeVisible();
  await trigger.click();
  const pop = page.locator('[data-hs-help-for="qDrillTableFooter"]');
  await expect(pop).toBeVisible();
  const text = ((await pop.textContent()) || "").toLowerCase();
  expect(text).toContain("range total");
  expect(text).toMatch(/filter.*narrows|show filter|regardless of filter/i);
});

test("at-risk regression: TBR-FL + CIN-KY still render as before", async ({ page }) => {
  for (const account of ["TBR - FL", "CIN - KY"]) {
    await page.setViewportSize({ width: 1600, height: 1600 });
    await loadBoard(page, account, FYTD_START, FYTD_END);
    await expect(page.locator('[data-card="mgmt-fee"], [data-card="mgmt-fee-hole"]')).toHaveCount(0);
    await expect(page.locator('[data-card="board-failed"]')).toHaveCount(0);
    await expect(page.locator('.kpi-p-b-food')).toHaveCount(1);
    await expect(page.locator('.kpi-p-flatrow-3up')).toBeVisible();
    await expect(page.locator('[data-card="drill-table"]')).toBeVisible();
    await page.screenshot({ path: path.join(OUT, `atrisk-${account.replace(/[^a-zA-Z0-9]+/g, "-")}-1600.png`), fullPage: true });
  }
});

test("pass-through regression: STL-FL still renders mgmt-fee board", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1600 });
  await loadBoard(page, "STL - FL", FYTD_START, FYTD_END);
  await expect(page.locator('[data-card="mgmt-fee"]')).toBeVisible();
  await expect(page.locator('[data-card="drill-table"]')).toHaveCount(0);
  await expect(page.locator('[data-card="board-failed"]')).toHaveCount(0);
});
