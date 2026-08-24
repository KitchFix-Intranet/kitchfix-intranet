// PR 2 R2 revision - full acceptance battery.
// Measures every acceptance-table item on the live dev server.
// Uses TEST_MODE=true bypass on the middleware for auth.

import { chromium } from "playwright";

const BASE = "http://localhost:3219";
const RANGE_FYTD = "start=2025-12-29&end=2026-08-24";
const RANGE_P9 = "start=2026-08-10&end=2026-09-06";
const RANGE_P8 = "start=2026-07-13&end=2026-08-09";

function log(k, v) {
  console.log(`[${k}]`, v);
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  // Surface page errors (the dev assertion throws in dev).
  const pageErrors = [];
  page.on("pageerror", e => pageErrors.push(String(e?.message || e)));
  page.on("console", m => {
    if (m.type() === "error") pageErrors.push("console.error: " + m.text());
  });

  // Load ALL FYTD.
  await page.goto(`${BASE}/kpi/purchasing?account=ALL&${RANGE_FYTD}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector('[data-card="bucket-food"]', { timeout: 30000 });
  await page.waitForTimeout(500);

  // === HERO + PILL ON FOOD BUCKET ==============================
  const foodHero = await page.$eval('[data-card="bucket-food"] .kpi-p-hero',
    el => (el.textContent || "").trim());
  const foodPillLabel = await page.$eval('[data-card="bucket-food"] .kpi-p-pill',
    el => (el.textContent || "").trim());
  const foodPillTone = await page.$eval('[data-card="bucket-food"] .kpi-p-pill',
    el => el.className);
  log("food_hero", foodHero);
  log("food_pill_label", foodPillLabel);
  log("food_pill_tone", foodPillTone);

  // Sub-rows (From bills, From cards)
  const foodSubs = await page.$$eval('[data-card="bucket-food"] .kpi-p-sub .kpi-p-v',
    els => els.map(e => (e.textContent || "").trim()));
  log("food_subs", foodSubs.join(" | "));

  // === REMAINING ▲ SWEEP =======================================
  const remArrows = await page.$$eval('.kpi-p-label',
    els => els.filter(e => /Remaining\s*[▲▼]/.test(e.textContent || ""))
              .map(e => e.textContent));
  log("remaining_arrow_occurrences", remArrows.length);

  // === NEGATIVE DOLLAR ANYWHERE ================================
  const negDollarSpots = await page.$$eval('.num',
    els => els.filter(e => /^\-\s*\$/.test((e.textContent || "").trim()))
              .map(e => e.textContent.trim()));
  log("negative_dollar_spots", negDollarSpots.length + " (" + negDollarSpots.join(", ") + ")");

  // === LEDGER EMPTY-STATE COPY ==================================
  // Check each ledger for "no purchases recorded" beside a non-zero hero.
  const ledgerAudit = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[data-card^="ledger-"]').forEach(card => {
      const hero = card.querySelector(".kpi-p-hero");
      const empty = card.querySelector(".kpi-p-empty, .kpi-p-emptycopy");
      const copy = empty ? empty.textContent : (card.textContent.match(/No purchases recorded[^.]*\.|Line detail lands with the drill route\./) || [""])[0];
      out.push({
        key: card.getAttribute("data-card"),
        hero: hero ? hero.textContent : "",
        copy: (copy || "").trim(),
      });
    });
    return out;
  });
  log("ledger_audit", JSON.stringify(ledgerAudit));

  // === RAIL META 11 of 11 ======================================
  const railMeta = await page.evaluate(() => {
    const items = [...document.querySelectorAll('.kpi-acct')];
    const withMeta = items.filter(el => {
      const desc = el.querySelector('.kpi-acct-desc');
      const txt = (desc?.textContent || "").trim();
      return txt.length > 0 && txt !== "";
    }).length;
    return { total: items.length, withMeta };
  });
  log("rail_meta", JSON.stringify(railMeta));

  // === PRINT HEADER ============================================
  // The print header is inserted via Shell.js on print. Look for its
  // element and verify string.
  const printHeader = await page.evaluate(() => {
    const el = document.getElementById('kpi-printhdr') || document.querySelector('.kpi-printhdr');
    return el ? (el.textContent || "").trim() : null;
  });
  log("print_header_kpi_printhdr", printHeader ?? "(not found)");

  // === TODAY DATE FORMAT =======================================
  const todayText = await page.evaluate(() => {
    const el = document.querySelector('.kpi-meta-today');
    return el ? (el.textContent || "").trim() : null;
  });
  log("today", todayText);

  // === RANGE TRIGGER LABEL - FYTD ==============================
  const rangeTriggerFYTD = await page.evaluate(() => {
    const el = document.querySelector('.kpi-rmenu-label-primary') ||
      document.querySelector('[data-role="range-trigger"] .kpi-ctl-v') ||
      document.querySelector('.kpi-ctl-v');
    return el ? (el.textContent || "").trim() : null;
  });
  log("range_trigger_fytd", rangeTriggerFYTD);

  // === PRESETS - cycle five ===================================
  // Five presets per resolvedPreset in page.js line 427-441:
  // fytd, this_period, last_period, last_4wk, last_13wk
  // last_4wk = addDaysISO(today, -27) -> today; today=2026-08-24 -> start=2026-07-28
  // last_13wk = addDaysISO(today, -90) -> today; today=2026-08-24 -> start=2026-05-26
  const presets = [
    { label: "FYTD",           url: `${BASE}/kpi/purchasing?account=ALL&${RANGE_FYTD}` },
    { label: "This period",    url: `${BASE}/kpi/purchasing?account=ALL&${RANGE_P9}` },
    { label: "Last period",    url: `${BASE}/kpi/purchasing?account=ALL&${RANGE_P8}` },
    { label: "Last 4 weeks",   url: `${BASE}/kpi/purchasing?account=ALL&start=2026-07-28&end=2026-08-24` },
    { label: "Last 13 weeks",  url: `${BASE}/kpi/purchasing?account=ALL&start=2026-05-26&end=2026-08-24` },
  ];
  const presetResults = [];
  for (const p of presets) {
    await page.goto(p.url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(500);
    const trig = await page.evaluate(() => {
      const el = document.querySelector('.kpi-rmenu-label-primary') ||
        document.querySelector('.kpi-ctl-v');
      return el ? (el.textContent || "").trim() : null;
    });
    presetResults.push({ label: p.label, trigger: trig });
  }
  log("presets", JSON.stringify(presetResults));

  // === PORTFOLIO P9 BUDGET =====================================
  await page.goto(`${BASE}/kpi/purchasing?account=ALL&${RANGE_P9}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector('[data-card="period"]', { timeout: 30000 });
  const p9Budget = await page.evaluate(() => {
    // Period card shows KPI budget in the subline "of $<budget>"
    const el = document.querySelector('[data-card="period"] .kpi-p-subline b');
    return el ? (el.textContent || "").trim() : null;
  });
  log("portfolio_p9_budget", p9Budget);

  // === RED HATCH ON BUCKET BAR =================================
  // R2 hatch removal - bucket over-state must be solid, no repeating-linear-gradient
  await page.goto(`${BASE}/kpi/purchasing?account=ALL&${RANGE_FYTD}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector('[data-card="bucket-food"]', { timeout: 30000 });
  const hatchAudit = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('[data-card^="bucket-"] .kpi-p-bar, [data-card^="bucket-"] .kpi-p-bar-over').forEach(el => {
      const bg = getComputedStyle(el).backgroundImage;
      if (/repeating-linear-gradient/.test(bg)) out.push({ card: el.closest('[data-card]').getAttribute('data-card'), bg });
    });
    return out;
  });
  log("hatch_occurrences", hatchAudit.length);

  // === HERO-VS-PILL ASSERTION =================================
  // Should NOT fire on happy path. Report captured errors.
  log("page_errors_on_happy_path", pageErrors.length + (pageErrors.length ? " -- " + JSON.stringify(pageErrors) : ""));

  await browser.close();
  console.log("=== ACCEPTANCE DONE ===");
}

main().catch(e => {
  console.error("FATAL:", e);
  process.exit(2);
});
