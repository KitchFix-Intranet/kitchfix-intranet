// PR 2 R6 Part A - measurement sweep BEFORE fix.
// Sweeps viewport widths from 1600 to 700 in 25px steps and detects
// per-failure onset. Reports the exact width where each of the five
// documented failures first appears.
//
// Failure detection:
//   F1 Period card hero overlap   -> bounding rects of the two heroes
//                                    on the period card intersect on Y
//   F2 Bucket sub-line truncation -> scrollWidth > clientWidth on any
//                                    .kpi-p-subline in the period card
//   F3 Chart caption collision    -> for each pair of adjacent captions
//                                    on the period card, their bounding
//                                    boxes overlap on X
//   F4 Folio horizontal scroll    -> .kpi-folio scrollWidth > clientWidth
//   F5 Card title wraps           -> .kpi-p-cardtitle offsetHeight >
//                                    line-height * 1
import { chromium } from 'playwright';

const BASE = process.env.KPI_BASE || 'http://localhost:3221';

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/kpi/purchasing?account=ALL&start=2025-12-29&end=2026-08-24`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.kpi-p-wks', { timeout: 30000 });

  const widths = [];
  for (let w = 1600; w >= 700; w -= 25) widths.push(w);

  const results = [];
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 900 });
    // Allow reflow.
    await page.waitForTimeout(150);
    const m = await page.evaluate(() => {
      const out = { F1: false, F2: false, F3: false, F4: false, F5: false, notes: {} };
      // Locate period card.
      const periodRow = document.querySelector('[data-card="period"]');
      if (!periodRow) { out.notes.err = 'no period row'; return out; }
      const heroes = periodRow.querySelectorAll('.kpi-p-hero, .kpi-p-value');
      // F1: hero overflows its clientWidth (nowrap spill) - the number
      // literally paints past its grid cell into the neighbor. Same
      // page failure the spec describes at 847px: $2,380,257.84 nowrap
      // + fixed 1fr 1fr grid = scrollWidth > clientWidth.
      if (heroes.length >= 2) {
        const a = heroes[0];
        const b = heroes[1];
        const ar = a.getBoundingClientRect();
        const br = b.getBoundingClientRect();
        const aOver = a.scrollWidth > a.clientWidth + 1;
        const bOver = b.scrollWidth > b.clientWidth + 1;
        // If the first hero visually spills past the start of the
        // second hero's rect on the same line, they render on top.
        const sameLine = Math.abs(ar.top - br.top) < 2;
        const spillsIntoNeighbor = ar.left + a.scrollWidth > br.left + 1;
        out.F1 = aOver || bOver || (sameLine && spillsIntoNeighbor);
        out.notes.heroes = [
          { text: a.textContent.trim(), rectW: ar.width, scrollW: a.scrollWidth, clientW: a.clientWidth, left: ar.left },
          { text: b.textContent.trim(), rectW: br.width, scrollW: b.scrollWidth, clientW: b.clientWidth, left: br.left },
          { sameLine, spillsIntoNeighbor },
        ];
      }
      // F2: subline overflow inside period card (of $X · Y% used)
      const sublines = periodRow.querySelectorAll('.kpi-p-subline');
      for (const s of sublines) {
        if (s.scrollWidth > s.clientWidth + 1) { out.F2 = true; out.notes.sublineOverflow = s.textContent.trim(); break; }
      }
      // F3: chart caption collision (right-side chart card). Two
      // failure modes: (a) any caption $ value overflows its container
      // (scrollWidth > clientWidth), OR (b) an adjacent pair's boxes
      // overlap on X on the same row.
      const chartCard = periodRow.querySelectorAll('.kpi-p-card')[1];
      if (chartCard) {
        const caps = chartCard.querySelectorAll('.kpi-p-cap .kpi-p-v');
        for (const c of caps) {
          if (c.scrollWidth > c.clientWidth + 1) { out.F3 = true; out.notes.capOverflow = { text: c.textContent.trim(), sw: c.scrollWidth, cw: c.clientWidth }; break; }
        }
        if (!out.F3) {
          for (let i = 0; i < caps.length - 1; i += 1) {
            const a = caps[i].getBoundingClientRect();
            const b = caps[i + 1].getBoundingClientRect();
            const sameLine = Math.abs(a.top - b.top) < 2;
            if (sameLine && a.right > b.left + 0.5) { out.F3 = true; out.notes.capsCollide = [caps[i].textContent, caps[i+1].textContent]; break; }
          }
        }
      }
      // F4: folio rail scrollWidth > clientWidth
      const folio = document.querySelector('.kpi-folio');
      if (folio) {
        out.F4 = folio.scrollWidth > folio.clientWidth + 1;
        out.notes.folio = { scroll: folio.scrollWidth, client: folio.clientWidth };
      }
      // F5: card title wraps -> compare offsetHeight vs lineHeight
      const titles = periodRow.querySelectorAll('.kpi-p-cardtitle');
      for (const t of titles) {
        const lh = parseFloat(getComputedStyle(t).lineHeight);
        const h = t.offsetHeight;
        if (Number.isFinite(lh) && h > lh * 1.5) { out.F5 = true; out.notes.title = { text: t.textContent.trim(), h, lh }; break; }
      }
      return out;
    });
    results.push({ w, ...m });
  }

  // First-onset per failure - the LARGEST width at which the failure is true
  const onset = {};
  for (const key of ['F1', 'F2', 'F3', 'F4', 'F5']) {
    // sweep from widest -> narrowest; onset = the first width where key becomes true (largest width)
    for (const r of results) {
      if (r[key]) { onset[key] = { w: r.w, notes: r.notes }; break; }
    }
  }

  console.log('SWEEP RESULTS (before fix)');
  console.log('width  F1 F2 F3 F4 F5');
  for (const r of results) {
    console.log(String(r.w).padEnd(6), (r.F1?'X':'.'), (r.F2?'X':'.'), (r.F3?'X':'.'), (r.F4?'X':'.'), (r.F5?'X':'.'));
  }
  console.log('\nONSET (largest width where failure first appears):');
  for (const [k, v] of Object.entries(onset)) {
    console.log(k, '->', v ? `${v.w}px` : 'never seen in [700..1600]');
  }
  console.log('\nDetails at first-seen:');
  for (const [k, v] of Object.entries(onset)) {
    console.log(k, JSON.stringify(v?.notes));
  }
  await browser.close();
}
main().catch(e => { console.error(e); process.exit(2); });
