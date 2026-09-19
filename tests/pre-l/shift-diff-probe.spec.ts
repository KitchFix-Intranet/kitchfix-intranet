// Typography-shift probe. Measures bounding boxes for elements
// vulnerable to typography changes: nav pills (nowrap, no fixed
// width - most exposed to a wider font), headings (h1/h2 + named
// title classes), and elements inside fixed grid-template-columns
// tracks (where cell content can widen past its declared track).
//
// Written for PR-L (Mulish -> Inter flip) but retained for the
// next typography change. If font tokens, Google Font imports, or
// font-family declarations change, run this before + after and
// diff via scripts/pr-l-shift-diff.mjs to see which real-world
// elements shift enough to matter (Kevin's binding threshold:
// 5% width shift on nav/headings/fixed-grid tracks).
//
// How to run (see docs/CONVENTIONS.md if this becomes a formal
// pattern, otherwise the recipe is here):
//   1. git checkout {BASELINE_COMMIT}   # e.g. pre-flip main
//   2. TEST_MODE=true npm run dev       # separate terminal
//   3. SHIFT_DIFF_LABEL=pre TEST_MODE=true npx playwright test \
//        tests/pre-l/shift-diff-probe.spec.ts
//   4. git checkout {CHANGE_COMMIT}     # e.g. your typography branch
//   5. Restart dev server (CSS var changes need a fresh compile).
//   6. SHIFT_DIFF_LABEL=post TEST_MODE=true npx playwright test \
//        tests/pre-l/shift-diff-probe.spec.ts
//   7. node scripts/pr-l-shift-diff.mjs
//
// Writes JSON captures to /tmp/pr-l-shift-diff-{pre,post}.json.
// Not part of any CI gate - this is an investigation harness.

import { test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

const SURFACES = [
  { path: '/ops', label: 'ops' },
  { path: '/service-calendar', label: 'service-calendar' },
  { path: '/financial', label: 'financial' },
];
const VIEWPORTS = [1024, 1280, 1536];

const LABEL = process.env.SHIFT_DIFF_LABEL || 'unlabeled';
const results: any[] = [];

test.setTimeout(240_000);

async function killMobileBar(page: any) {
  await page.evaluate(() => {
    const bar = document.querySelector('.sc-mobile-books-bar') as HTMLElement | null;
    if (bar) { bar.style.display = 'none'; bar.style.pointerEvents = 'none'; }
  });
}

async function captureFor(page: any, surface: string, width: number) {
  return page.evaluate(({ surface, width }: any) => {
    const boxOf = (el: Element | null) => {
      if (!el) return null;
      const r = (el as HTMLElement).getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const measure = (sel: string) => {
      const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      return els.map((el, i) => ({
        sel,
        idx: i,
        text: (el.innerText || el.textContent || '').trim().slice(0, 60),
        box: boxOf(el),
        wrapped: el.getClientRects().length > 1,
      }));
    };
    return {
      surface,
      width,
      appFont: getComputedStyle(document.querySelector('.oh-app') || document.body).fontFamily,
      navPills: measure('.oh-nav-item'),
      headings: [
        ...measure('h1'),
        ...measure('h2'),
        ...measure('.oh-hero-title'),
        ...measure('.sc-chrome-bar-title'),
        ...measure('.scv2 .sc-ribbon-title'),
        ...measure('.oh-tool-empty-title'),
      ],
      // Fixed grid-template-columns rows - Kevin's tier-2 target.
      // These are the executive-dashboard fixed-track rows most
      // likely to widen and clip.
      gridRows: [
        ...measure('.oh-exec-pnl-row'),
        ...measure('.oh-exec-portfolio-row'),
        ...measure('.oh-exec-portfolio-header'),
        ...measure('.oh-inv-vs-grid'),
        ...measure('.sc-elr-row'),
        ...measure('.sc-elr-row-lead'),
        ...measure('.sc-day-row'),
      ],
    };
  }, { surface, width });
}

for (const surface of SURFACES) {
  for (const width of VIEWPORTS) {
    test(`capture ${surface.label} @ ${width}px [${LABEL}]`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1080 });
      await page.goto(surface.path);
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(800);
      await killMobileBar(page);
      const cap = await captureFor(page, surface.label, width);
      results.push(cap);
    });
  }
}

test.afterAll(async () => {
  const out = `/tmp/pr-l-shift-diff-${LABEL}.json`;
  await writeFile(out, JSON.stringify(results, null, 2));
  console.log(`\n[shift-diff] wrote ${results.length} captures to ${out}\n`);
});
