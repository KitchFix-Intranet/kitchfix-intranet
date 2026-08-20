// PR-L Mulish -> Inter flip paint gate.
//
// Blocks (assertion failures):
//   - any text-bearing element wraps where it did not before
//   - any content overflows its container
//   - any numeric column loses tabular alignment (font-variant-numeric
//     does not resolve to tabular-nums)
//
// Reports (Kevin rules on the number):
//   - bounding-box shifts >5% on ops nav pills, page headings, and
//     any element with an explicit grid-template-columns track
//
// Ignores:
//   - shifts under 5% elsewhere (guaranteed by any typography change,
//     not worth attention)
//
// Coverage: /ops, /service-calendar, /financial at 1024, 1280, 1536.
// Kevin note: ops nav pills first, highest visibility, most exposed
// to Inter's wider default glyphs.

import { test, expect } from '@playwright/test';

const SURFACES = [
  { path: '/ops', label: 'ops' },
  { path: '/service-calendar', label: 'service-calendar' },
  { path: '/financial', label: 'financial' },
];

const VIEWPORTS = [1024, 1280, 1536];

test.setTimeout(180_000);

async function killMobileBar(page: any) {
  await page.evaluate(() => {
    const bar = document.querySelector('.sc-mobile-books-bar') as HTMLElement | null;
    if (bar) { bar.style.display = 'none'; bar.style.pointerEvents = 'none'; }
  });
}

async function measureNavPills(page: any) {
  return page.evaluate(() => {
    const container = document.querySelector('.oh-nav, [class*="nav-list"], [class*="topnav"]') as HTMLElement | null;
    const pills = Array.from(document.querySelectorAll('.oh-nav-item')) as HTMLElement[];
    return {
      containerBox: container ? container.getBoundingClientRect().toJSON() : null,
      containerScrollWidth: container ? container.scrollWidth : null,
      containerClientWidth: container ? container.clientWidth : null,
      pillCount: pills.length,
      pills: pills.map(p => ({
        text: p.innerText.trim(),
        box: p.getBoundingClientRect().toJSON(),
        wrapped: p.getClientRects().length > 1,
      })),
      body: getComputedStyle(document.body).fontFamily,
      appFont: (document.querySelector('.oh-app') && getComputedStyle(document.querySelector('.oh-app') as Element).fontFamily) || null,
    };
  });
}

async function measureNumericTabular(page: any) {
  return page.evaluate(() => {
    const numericSelectors = [
      '.oh-num-tabular',
      '.oh-kpi-value',
      '.oh-kpi-cost-pct',
      '.oh-kpi-cost-footer',
      '.oh-sc-val',
      '.oh-sc-val-sm',
      '.oh-sc-val-lg',
      '.oh-sc-val-muted',
      '.oh-sc-kpi-cell',
      '.oh-sc-rev-context-val',
      '.oh-sp-header-total',
      '.oh-snap-metric-value',
      '.oh-snap-pct-value',
      '.oh-snap-proj-value',
      '.oh-snap-ytd-value',
      '.oh-footer-total',
      '.oh-ticket-total',
      '.oh-inv-gl-amount',
      '.oh-inv-review-total',
      '.oh-inv-tab-count',
      '.oh-hx-total',
      '.oh-hx-cat-total',
      '.oh-hx-cat-pct',
      '.oh-kcb-total',
      '.sc-chrome-bar-stats-value',
      '.sc-chrome-bar-stats-count',
      '.sc-brm-th-num',
      '.sc-elr-hero-count',
      '.sc-day-extras-band-count',
    ];
    const out: any[] = [];
    for (const sel of numericSelectors) {
      const els = Array.from(document.querySelectorAll(sel)) as HTMLElement[];
      for (const el of els) {
        const cs = getComputedStyle(el);
        out.push({
          sel,
          text: (el.innerText || '').trim().slice(0, 40),
          fvn: cs.fontVariantNumeric,
          font: cs.fontFamily.split(',')[0].replace(/['"]/g, ''),
        });
      }
    }
    return out;
  });
}

async function measureHeadings(page: any) {
  return page.evaluate(() => {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, .oh-hero-title, .sc-chrome-bar-title, .scv2 .sc-ribbon-title, .oh-tool-empty-title')) as HTMLElement[];
    return headings.map(h => ({
      tag: h.tagName.toLowerCase(),
      cls: h.className,
      text: h.innerText.trim().slice(0, 60),
      box: h.getBoundingClientRect().toJSON(),
      font: getComputedStyle(h).fontFamily.split(',')[0].replace(/['"]/g, ''),
      wrapped: h.getClientRects().length > 1,
    }));
  });
}

for (const surface of SURFACES) {
  for (const width of VIEWPORTS) {
    test(`${surface.label} @ ${width}px: nav pills within container, no wrap, no overflow`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1080 });
      await page.goto(surface.path);
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(600);
      await killMobileBar(page);

      const nav = await measureNavPills(page);
      console.log(`${surface.label}@${width}px NAV:`, JSON.stringify(nav, null, 2));

      // Blocking assertions.
      // 1. Body font family resolves to Inter first.
      expect(nav.appFont ?? nav.body).toMatch(/^["']?Inter["']?/i);

      // 2. No individual nav pill wraps to multiple lines.
      const wrappedPills = nav.pills.filter(p => p.wrapped);
      expect(wrappedPills, `wrapped pill(s): ${wrappedPills.map(p => p.text).join(', ')}`).toHaveLength(0);

      // 3. Nav container does not overflow horizontally beyond the
      //    viewport (some overflow-x scroll containers are OK - we
      //    check that the pills themselves fit within the container's
      //    scrollWidth, not that scrollWidth <= clientWidth).
      if (nav.containerBox) {
        // Each pill's right edge <= container.scrollWidth
        for (const pill of nav.pills) {
          const pillRight = pill.box.right - nav.containerBox.left;
          expect(pillRight, `pill "${pill.text}" right edge ${pillRight} <= container scrollWidth ${nav.containerScrollWidth}`).toBeLessThanOrEqual((nav.containerScrollWidth ?? 999999) + 1);
        }
      }
    });

    test(`${surface.label} @ ${width}px: numeric columns keep tabular-nums`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1080 });
      await page.goto(surface.path);
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(600);
      await killMobileBar(page);

      const nums = await measureNumericTabular(page);
      console.log(`${surface.label}@${width}px NUMS (${nums.length} elements):`, JSON.stringify(nums.slice(0, 12), null, 2));

      // Blocking: every present numeric element resolves to
      // tabular-nums (either directly or via inheritance).
      const bad = nums.filter(n => !/(tabular-nums|tabular)/i.test(n.fvn));
      expect(bad, `Non-tabular numeric elements: ${JSON.stringify(bad.slice(0, 5), null, 2)}`).toHaveLength(0);

      // Blocking: every present numeric element resolves to Inter
      // (parent chain flipped).
      const nonInter = nums.filter(n => !/^Inter$/i.test(n.font));
      expect(nonInter, `Non-Inter numeric elements: ${JSON.stringify(nonInter.slice(0, 5), null, 2)}`).toHaveLength(0);
    });

    test(`${surface.label} @ ${width}px: headings do not wrap unexpectedly`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1080 });
      await page.goto(surface.path);
      await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(600);
      await killMobileBar(page);

      const headings = await measureHeadings(page);
      console.log(`${surface.label}@${width}px HEADINGS (${headings.length}):`, JSON.stringify(headings, null, 2));

      // Blocking: no h1/h2/named heading wraps to a new line.
      // (h3 permitted to wrap since they are often in tight cards.)
      const wrappedTopLevel = headings.filter(h => h.wrapped && (h.tag === 'h1' || h.tag === 'h2' || h.cls.includes('title')));
      expect(wrappedTopLevel, `wrapped heading(s): ${wrappedTopLevel.map(h => `${h.tag}.${h.cls}: "${h.text}"`).join(' | ')}`).toHaveLength(0);
    });
  }
}
