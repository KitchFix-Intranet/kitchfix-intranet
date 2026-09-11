// STANDING PROBE - run before every PR that touches Labor Next
// period layout (StoryBlock's NextPeriodPlan component or the
// .kpi-npp-* CSS block).
//
// Kevin ruling post-#1110: "make it degrade rather than break.
// The requirement is that nothing overflows its container at any
// width the standing probe checks."
//
// Pattern lifted from _probe_pnl_label_column.mjs (Kevin ruling
// 2026-09-08: "the label-column probe is the only thing that
// would have caught this; add the width check to the probe the
// way the P&L label column has one").
//
// What it protects:
//   1. The LEFT card's `Labor Budget` hero (.kpi-npp-v) does not
//      overrun the card at any sampled viewport. `$29,239.91` at
//      the +salary toggle is the longest string this cell can
//      hold; the hero's container-query step-downs (34 -> 28 -> 22
//      at 260 / 210 card-width) must fire before overflow.
//   2. Every per-week `Labor Budget` amount (.kpi-npp-wk-amt)
//      does not overrun its week card. Longest is `$10,451.77`
//      (TBJ P10 CP salary shape reused as fixture width).
//   3. Every `Forecast rev` value (.kpi-npp-wk-rev-v) does not
//      overrun its bottom row. `$19,389` is the longest realistic
//      value; the whole-dollar rounding introduced with this
//      probe drops it from `$19,388.76` (9 chars) to `$19,389`
//      (7 chars).
//   4. The `A week` / `A day` split values (.kpi-npp-split-v)
//      likewise clear their half-column.
//
// Fixtures: TBJ - FL and TBR - FL Next period, hourly + salary.
// TBJ +salary has the longest hero ($29,239.91); TBR +salary the
// longest week card amount ($8,449.66).
//
// Prereqs: `TEST_MODE=true npm start` running (default :3001 for
// the intranet's prod server; probe respects BASE env).
//
// Exit code: non-zero if any measured cell overflows at any
// sampled viewport.

import { chromium } from "playwright";

const BASE = process.env.BASE || "http://localhost:3001";
const HEADERS = { "x-test-user": "kevin@kitchfix.com" };

const FIXTURES = [
  { acct: "TBJ - FL", tog: "hourly" },
  { acct: "TBJ - FL", tog: "salary" },
  { acct: "TBR - FL", tog: "hourly" },
  { acct: "TBR - FL", tog: "salary" },
];

const VIEWPORTS = [1400, 1240, 1024, 900, 768, 700];

function urlFor(acct, tog) {
  const q = new URLSearchParams({
    account: acct,
    start: "2026-10-05",
    end: "2026-11-01",
  });
  if (tog === "salary") q.set("include_salary", "1");
  return `${BASE}/kpi/labor?${q.toString()}`;
}

async function measure(vw, acct, tog) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: vw, height: 1200 },
    extraHTTPHeaders: HEADERS,
  });
  const page = await ctx.newPage();
  // Mock the auth session so the useSession guard in the client
  // does not send us to /login. Same shape the P&L probe uses.
  await page.route("**/api/auth/session", route => {
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: { name: "T", email: "t@k.com", image: null },
        expires: new Date(Date.now() + 864e5).toISOString(),
      }),
    });
  });
  await page.goto(urlFor(acct, tog), { waitUntil: "domcontentloaded", timeout: 20000 });
  // Wait for the Labor payload to land + the plan card to mount.
  await page.waitForResponse(r => r.url().includes("/api/kpi/labor"), { timeout: 15000 }).catch(() => null);
  // Give React a beat to render.
  await page.waitForSelector(".kpi-npp-v", { timeout: 10000 }).catch(() => null);
  await page.waitForTimeout(400);

  const info = await page.evaluate(() => {
    const overflow = (el) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const scrollW = el.scrollWidth;
      const cellW = rect.width;
      // Also compare against the visible cell PLUS 1px slack to
      // absorb subpixel rounding noise, same pattern as the P&L
      // probe. Signal only when the content is genuinely wider
      // than the container.
      const clipped = scrollW > cellW + 1;
      return {
        text: el.innerText.replace(/\s+/g, " ").trim(),
        cellW: Math.round(cellW),
        scrollW: Math.round(scrollW),
        clipped,
      };
    };
    const hero = document.querySelector(".kpi-npp-v");
    const heroInfo = hero ? { role: "hero", ...overflow(hero) } : null;
    const splits = [...document.querySelectorAll(".kpi-npp-split-v")].map((el, i) => ({
      role: `split-${i}`,
      ...overflow(el),
    }));
    const amts = [...document.querySelectorAll(".kpi-npp-wk-amt")].map((el, i) => ({
      role: `wk${i + 1}-amt`,
      ...overflow(el),
    }));
    const revs = [...document.querySelectorAll(".kpi-npp-wk-rev-v")].map((el, i) => ({
      role: `wk${i + 1}-rev`,
      ...overflow(el),
    }));
    // Also record card widths so a report reads why a value
    // stepped down or didn't.
    const leftCard = document.querySelector(".kpi-npp-left");
    const rightCard = document.querySelector(".kpi-npp-right");
    const wkTiles = [...document.querySelectorAll(".kpi-npp-wk")];
    return {
      hero: heroInfo,
      splits,
      amts,
      revs,
      leftCardW: leftCard ? Math.round(leftCard.getBoundingClientRect().width) : null,
      rightCardW: rightCard ? Math.round(rightCard.getBoundingClientRect().width) : null,
      wkTileWs: wkTiles.map(t => Math.round(t.getBoundingClientRect().width)),
    };
  });
  await browser.close();
  return info;
}

let failures = 0;
for (const vw of VIEWPORTS) {
  console.log(`\n=== viewport ${vw}px`);
  for (const f of FIXTURES) {
    const info = await measure(vw, f.acct, f.tog);
    if (!info) { console.log(`  ${f.acct} ${f.tog}: NO INFO`); failures += 1; continue; }
    const cells = [info.hero, ...info.splits, ...info.amts, ...info.revs].filter(Boolean);
    const bad = cells.filter(c => c.clipped);
    const tag = `${f.acct} ${f.tog}`;
    console.log(`  ${tag.padEnd(20)}  left=${info.leftCardW}px right=${info.rightCardW}px tiles=[${info.wkTileWs.join(",")}]`);
    if (bad.length) {
      failures += 1;
      console.log(`    OVERFLOW (${bad.length}):`);
      for (const c of bad) {
        console.log(`      ${c.role.padEnd(12)} cellW=${c.cellW} scrollW=${c.scrollW}  "${c.text}"`);
      }
    } else {
      const heroTag = info.hero ? `hero="${info.hero.text}" (${info.hero.cellW}px)` : "no-hero";
      console.log(`    ok  ${heroTag}  ${info.amts.length} amts  ${info.revs.length} revs`);
    }
  }
}

console.log(`\n## Summary: ${failures === 0 ? "ALL PASS" : failures + " (viewport,fixture) COMBOS FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
