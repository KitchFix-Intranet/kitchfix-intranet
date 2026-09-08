// STANDING PROBE - run before every PR that touches .kpi-ov-pnl.
//
// Kevin ruling 2026-09-08: "the label-column probe [is] the only thing
// that would have caught this, and it is the only thing that will
// catch the next one." Added to the standing set with the P&L one-
// table PRs (#1080 + this follow-up).
//
// What it protects:
//   1. Sub-rows must obey the parent row's column widths (broke when
//      display:block from a retired RunningPeriodPnl caption span
//      matched the <tr class="kpi-ov-pnl-sub"> selector and pulled
//      sub-rows out of table layout entirely - Kevin measured 3100
//      parent label 772px, 3100.1 sub label 142px in the same tbody).
//   2. Label column does not clip at narrow viewports (broke when a
//      raw 590px numeric-column budget left the label column at 59px
//      at 700px viewport - single word "Maintenance" overflowed).
//   3. Numeric cells do not clip at narrow viewports ("not active"
//      italic text at 54px overflowed the two narrowest columns
//      after a naive 15% shrink; caught by this probe before it
//      shipped).
//   4. Every GM row cell is either legible against its background
//      or hatched (.kpi-ov-pnl-na-cell). Kevin ruling 2026-09-08
//      (Option B post-#1083): the row's reversal-on-navy is
//      removed - text now reads n-900 on the default background,
//      plan cells on the plan tint, variance cell in green/red.
//      The invariant that used to read "painted or hatched" (from
//      the reversed treatment) now reads "legible or hatched":
//      hatched, OR text colour is NOT white (which would signal
//      the reversal was accidentally re-introduced OR a white-on-
//      transparent leak like #1083). Kevin: "Update it to describe
//      the new rule. Do not delete the check."
//
// Fixture: TBJ - FL Current year, Full view (all 13 sub rows visible).
// Prereqs: `TEST_MODE=true npm run dev` running on :3000, Chromium
// installed via `npx playwright install chromium`.
//
// Exit code: non-zero if any label OR numeric cell clips at any of
// the six sampled viewports (1400 / 1240 / 1024 / 900 / 768 / 700).

import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const URL = `${BASE}/kpi/overview?account=TBJ%20-%20FL&start=2025-12-29&end=2026-08-09&include_salary=1`;
const HEADERS = { "x-test-user": "kevin@kitchfix.com" };

async function measure(viewportWidth) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: viewportWidth, height: 1200 },
    extraHTTPHeaders: HEADERS,
  });
  // Route the auth endpoint so useSession settles quickly.
  const page = await ctx.newPage();
  await page.route("**/api/auth/session", route => {
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ user: { name: "T", email: "t@k.com", image: null },
                             expires: new Date(Date.now() + 864e5).toISOString() }) });
  });
  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForResponse(r => r.url().includes("/api/kpi/overview"), { timeout: 15000 }).catch(() => null);
  await page.waitForTimeout(800);
  // Open the P&L fold.
  await page.evaluate(() => {
    const btn = document.querySelector('[data-kpi-ov="fold-pnl"]');
    if (btn && btn.getAttribute("aria-expanded") !== "true") btn.click();
  });
  await page.waitForTimeout(400);
  // Switch to Full so sub-rows render (default is Summary).
  await page.evaluate(() => {
    const btn = document.querySelector('[data-kpi-ov="dense-full"]');
    if (btn) btn.click();
  });
  await page.waitForTimeout(400);

  const info = await page.evaluate(() => {
    const tbl = document.querySelector('.kpi-ov-pnl');
    if (!tbl) return null;
    const tblWidth = tbl.getBoundingClientRect().width;
    // Sample every parent line-row and the sub-rows within.
    const rows = [...tbl.querySelectorAll('tbody tr')];
    const samples = [];
    let subCount = 0;
    for (const tr of rows) {
      const tds = tr.querySelectorAll('td');
      if (tds.length !== 7) continue;
      const labelTd = tds[0];
      const label = labelTd.innerText.replace(/\s+/g, ' ').trim();
      const labelW = labelTd.getBoundingClientRect().width;
      const scrollW = labelTd.scrollWidth;
      const heightPx = Math.round(labelTd.getBoundingClientRect().height);
      // With white-space: normal, overflow wraps and scrollW === labelW.
      // Clip signal is when scrollW > labelW (single-line overflow).
      // But a MORE useful signal on narrow viewports is `height > oneLine`
      // - the label wrapped, which is usually the wrong outcome for a
      // financial row. Approximate one-line height: 1.4 × fontSize.
      const cs = window.getComputedStyle(labelTd);
      const fs = parseFloat(cs.fontSize) || 12.5;
      const oneLineH = Math.ceil(fs * 1.65);
      const wraps = heightPx > oneLineH + 2;
      const clipped = scrollW > labelW + 1;
      const isSub = tr.className.includes("kpi-ov-pnl-sub");
      if (isSub) subCount += 1;
      samples.push({ label, labelW: Math.round(labelW), scrollW: Math.round(scrollW),
                     heightPx, wraps, clipped, isSub });
    }
    // Numeric column measurements: budget / target / adjusted /
    // actual / % of rev / vs adjusted (tds 1..6). nowrap + fixed
    // layout means content > col width visually overflows -
    // check for it explicitly.
    const numericSamples = [];
    for (const tr of rows) {
      const tds = tr.querySelectorAll('td');
      if (tds.length !== 7) continue;
      const label = tds[0]?.innerText.replace(/\s+/g, ' ').trim();
      for (let i = 1; i < 7; i += 1) {
        const td = tds[i];
        const text = td.innerText.replace(/\s+/g, ' ').trim();
        if (!text || text === '—' || text === '') continue;
        const cellW = td.getBoundingClientRect().width;
        const scrollW = td.scrollWidth;
        if (scrollW > cellW + 1) {
          numericSamples.push({
            label, colIdx: i, text,
            cellW: Math.round(cellW), scrollW: Math.round(scrollW),
          });
        }
      }
    }
    // GM-row legibility check. Kevin ruling 2026-09-08 (Option B
    // post-#1083): the row's reversal-on-navy came out - text now
    // reads n-900 on default bg, plan on plan tint, variance in
    // green/red. Prior invariant "painted or hatched" is retired;
    // new invariant is "legible or hatched".
    //
    // Practical heuristic: `legible` = text colour is NOT white
    // (rgb(255,255,255)). White text signals either the reversal
    // was accidentally re-introduced (white on new light bg =
    // invisible) OR a #1083-style var(--navy)-resolves-transparent
    // leak (white on transparent = invisible). Hatched cells are
    // allowed to have any text colour because they render no text
    // (visually just the diagonal fill).
    const gmPaintSamples = [];
    const gmRow = tbl.querySelector('.kpi-ov-pnl-gm');
    if (gmRow) {
      const gmCells = [...gmRow.querySelectorAll('td')];
      for (let i = 0; i < gmCells.length; i += 1) {
        const td = gmCells[i];
        const cs = window.getComputedStyle(td);
        const color = cs.color;
        const isHatched = td.classList.contains('kpi-ov-pnl-na-cell');
        const isWhiteText = color === 'rgb(255, 255, 255)' || color === '#fff' || color === '#ffffff';
        if (!isHatched && isWhiteText) {
          gmPaintSamples.push({
            colIdx: i,
            cls: td.className,
            text: td.innerText.replace(/\s+/g, ' ').trim(),
            color,
          });
        }
      }
    }
    return { tblWidth: Math.round(tblWidth), samples, subCount, numericSamples, gmPaintSamples };
  });
  await browser.close();
  return info;
}

let failures = 0;
for (const vw of [1400, 1240, 1024, 900, 768, 700]) {
  console.log(`\n=== viewport ${vw}px`);
  const info = await measure(vw);
  if (!info) { console.log("  (no .kpi-ov-pnl found)"); failures += 1; continue; }
  if (info.samples.some(s => s.clipped)) failures += 1;
  if ((info.numericSamples || []).length) failures += 1;
  if ((info.gmPaintSamples || []).length) failures += 1;
  console.log(`  table width: ${info.tblWidth}px · sub rows: ${info.subCount}`);
  const clippers = info.samples.filter(s => s.clipped);
  const wrappers = info.samples.filter(s => s.wraps);
  // Longest labels by content length (proxy: scrollW when it exceeds
  // labelW, else char count).
  const longest = [...info.samples].sort((a, b) => b.label.length - a.label.length).slice(0, 5);
  console.log(`  five longest labels:`);
  for (const s of longest) {
    const status = s.clipped ? "CLIP" : (s.wraps ? "wrap" : "ok  ");
    console.log(`    ${status} labelW=${s.labelW} scrollW=${s.scrollW} h=${s.heightPx}px  ${s.isSub ? "  · " : ""}${s.label}`);
  }
  if (clippers.length) {
    console.log(`  CLIPPED LABELS (${clippers.length}):`);
    for (const s of clippers) {
      console.log(`    labelW=${s.labelW} scrollW=${s.scrollW}  ${s.label}`);
    }
  } else if (wrappers.length) {
    console.log(`  no label clipping; ${wrappers.length} labels wrap to 2+ lines`);
  } else {
    console.log(`  no label clipping, no wrapping across ${info.samples.length} rows`);
  }
  if (info.numericSamples?.length) {
    console.log(`  CLIPPED NUMERIC CELLS (${info.numericSamples.length}):`);
    for (const s of info.numericSamples.slice(0, 10)) {
      console.log(`    col${s.colIdx} cellW=${s.cellW} scrollW=${s.scrollW}  "${s.text}"  @ ${s.label}`);
    }
  } else {
    console.log(`  no numeric-cell clipping`);
  }
  if (info.gmPaintSamples?.length) {
    console.log(`  GM-ROW ILLEGIBLE (${info.gmPaintSamples.length}):`);
    for (const s of info.gmPaintSamples) {
      console.log(`    col${s.colIdx} cls="${s.cls}" color=${s.color} text="${s.text}"`);
    }
  } else {
    console.log(`  GM row: every cell legible or hatched`);
  }
}

console.log(`\n## Summary: ${failures === 0 ? "ALL PASS" : failures + " VIEWPORT/CHECK COMBOS FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
