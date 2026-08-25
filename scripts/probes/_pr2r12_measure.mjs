// R12 measurement: bucket subtitles + VendorBreakdown columns + scroll snap
// at 1680, 1456 and 900.
//
// TEST_MODE=true assumed on dev server for auth bypass (per
// middleware.js:5 owner ruling). KPI_BASE optional (defaults to 3012).
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.KPI_BASE || "http://localhost:3012";
const OUT = "/tmp/kf-r12-measure.json";
const results = {};

async function measureAt(browser, w) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 1400 } });
  const page = await ctx.newPage();
  const url = `${BASE}/kpi/purchasing?account=ALL&start=2025-12-29&end=2026-08-24`;
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector(".kpi-p-flatrow-3up", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(600);

  const dims = await page.evaluate(() => {
    function box(el) {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || "").trim().slice(0, 80) };
    }
    const out = {};
    // Bucket card titles + subtitles (find every kpi-p-cardsub inside kpi-p-b-food/pkg/veh/equip/rm cards)
    out.card_subs = [];
    document.querySelectorAll(".kpi-p-b-food, .kpi-p-b-pkg, .kpi-p-b-veh, .kpi-p-b-equip, .kpi-p-b-rm").forEach(card => {
      const title = card.querySelector(".kpi-p-cardtitle");
      const sub = card.querySelector(".kpi-p-cardsub");
      if (title && sub) {
        const tR = title.getBoundingClientRect();
        const sR = sub.getBoundingClientRect();
        // A subtitle wraps when its offsetHeight is materially larger than its computed
        // line-height. Use a threshold of 24px (~single line) as a proxy for wrap detection.
        out.card_subs.push({
          title: (title.textContent || "").trim(),
          sub_text: (sub.textContent || "").trim(),
          sub_w: Math.round(sR.width),
          sub_h: Math.round(sR.height),
          wrapped: sR.height > 24,
        });
      }
    });
    // Bucket chart labels (item 1 verification)
    out.chart_labels = [];
    document.querySelectorAll(".kpi-p-b-food .kpi-p-label, .kpi-p-b-pkg .kpi-p-label, .kpi-p-b-veh .kpi-p-label").forEach(el => {
      out.chart_labels.push((el.textContent || "").trim().replace(/\s+/g, " "));
    });
    // Period card chart label
    const periodLabel = document.querySelector(".kpi-p-b-per + .kpi-p-card .kpi-p-lh .kpi-p-label, .kpi-p-card:not([class*='kpi-p-b-']) .kpi-p-lh .kpi-p-label");
    out.period_chart_label = periodLabel ? (periodLabel.textContent || "").trim().replace(/\s+/g, " ") : null;
    // Alt: get every .kpi-p-lh > .kpi-p-label text
    out.all_strip_labels = [...document.querySelectorAll(".kpi-p-lh .kpi-p-label")].map(el => (el.textContent || "").trim().replace(/\s+/g, " "));
    // Vendor breakdown (three-up) grid + scroll
    const vb = document.querySelector('[data-card="vendor-breakdown"]');
    if (vb) {
      const rows = vb.querySelector(".kpi-p-vbrows");
      const rowChildren = rows ? [...rows.querySelectorAll(".kpi-p-vbrow")] : [];
      const vbhead = vb.querySelector(".kpi-p-vbhead");
      const headSpans = vbhead ? [...vbhead.querySelectorAll(":scope > span")].map(box) : [];
      const firstRow = rowChildren[0];
      const rowChildrenBoxes = firstRow ? [...firstRow.children].map(box) : [];
      const cardR = vb.getBoundingClientRect();
      const scrollR = rows ? rows.getBoundingClientRect() : null;
      const lastVisibleRowH = rowChildren.length > 0 ? Math.round(rowChildren[0].getBoundingClientRect().height) : 0;
      const scrollHeight = rows ? rows.scrollHeight : 0;
      const clientHeight = rows ? rows.clientHeight : 0;
      out.vendor_breakdown = {
        card_w: Math.round(cardR.width),
        card_h: Math.round(cardR.height),
        row_scroll_client_h: clientHeight,
        row_scroll_content_h: scrollHeight,
        row_h_first: lastVisibleRowH,
        row_visible_count_estimate: lastVisibleRowH ? Math.floor(clientHeight / lastVisibleRowH) : 0,
        row_visible_pixel_leftover: lastVisibleRowH ? clientHeight - Math.floor(clientHeight / lastVisibleRowH) * lastVisibleRowH : 0,
        head_spans: headSpans,
        first_row_cells: rowChildrenBoxes,
      };
    }
    return out;
  });

  const path = `/tmp/kf-r12-fytd-${w}.png`;
  await page.screenshot({ path, fullPage: true });
  results[`w${w}`] = { dims, screenshot: path, url };
  console.log(`[${w}px] screenshot -> ${path}`);
  console.log(`[${w}px] chart labels:`, dims.all_strip_labels);
  const wrapped = dims.card_subs.filter(c => c.wrapped);
  console.log(`[${w}px] wrapped subtitles: ${wrapped.length}`, wrapped.map(c => `${c.title}: h=${c.sub_h}px`).join(", "));
  if (dims.vendor_breakdown) {
    const v = dims.vendor_breakdown;
    console.log(`[${w}px] vendor bd: card_w=${v.card_w}px  row_h=${v.row_h_first}px  scroll_client_h=${v.row_scroll_client_h}px  visible=${v.row_visible_count_estimate}rows  leftover=${v.row_visible_pixel_leftover}px`);
    console.log(`[${w}px] head col widths:`, v.head_spans.map(s => s.w));
  }
  await ctx.close();
}

async function main() {
  const browser = await chromium.launch();
  for (const w of [1680, 1456, 900]) {
    await measureAt(browser, w);
  }
  await browser.close();
  writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(`wrote ${OUT}`);
}
main().catch(e => { console.error(e); process.exit(2); });
