// PR 2 audit - Sections E/H/I via Playwright pixel measurement.
//
// Loads /kpi/purchasing?account=ALL and /kpi/labor?account=ALL with FYTD.
// Measures typography (font-size, weight, color) for equivalent roles on
// both boards, dumps a comparison table.
// For E, probes URL updates + refetch by clicking each control group.

import { chromium } from "playwright";

const BASE = "http://localhost:3216";
const RANGE = "start=2025-12-29&end=2026-08-24";

async function measureRoles(page, board) {
  // Measure common roles. Each returns { selector, sample, styles }.
  return await page.evaluate((board) => {
    function stylesOf(el) {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        text: (el.textContent || "").trim().slice(0, 80),
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        color: cs.color,
        lineHeight: cs.lineHeight,
        letterSpacing: cs.letterSpacing,
        fontFamily: cs.fontFamily.split(",")[0].trim(),
        bg: cs.backgroundColor,
      };
    }
    const out = {};
    // Command bar
    out["kpi-cmd-title-brand"] = stylesOf(document.querySelector(".kpi-cmd-title-brand"));
    out["kpi-cmd-title-acct"] = stylesOf(document.querySelector(".kpi-cmd-title-acct"));
    out["kpi-ctl-k"] = stylesOf(document.querySelector(".kpi-ctl-k"));
    out["kpi-ctl-v"] = stylesOf(document.querySelector(".kpi-ctl-v"));
    out["kpi-rmenu-label-primary"] = stylesOf(document.querySelector(".kpi-rmenu-label-primary"));
    out["kpi-rmenu-label-dates"] = stylesOf(document.querySelector(".kpi-rmenu-label-dates"));
    out["kpi-meta-today"] = stylesOf(document.querySelector(".kpi-meta-today"));
    out["kpi-meta-period"] = stylesOf(document.querySelector(".kpi-meta-period"));
    out["kpi-fresh"] = stylesOf(document.querySelector(".kpi-fresh"));

    // Rail
    out["kpi-folio-title-h"] = stylesOf(document.querySelector(".kpi-folio-title-h"));
    out["kpi-folio-title-s"] = stylesOf(document.querySelector(".kpi-folio-title-s"));
    out["kpi-ghead-name"] = stylesOf(document.querySelector(".kpi-ghead-name"));
    out["kpi-ghead-sub"] = stylesOf(document.querySelector(".kpi-ghead-sub"));
    out["kpi-acct-key"] = stylesOf(document.querySelector(".kpi-acct-key"));
    out["kpi-acct-desc"] = stylesOf(document.querySelector(".kpi-acct-desc"));

    // Main / cards - purchasing-specific selectors + generic labor equivalents
    if (board === "purchasing") {
      out["kpi-p-cardtitle"] = stylesOf(document.querySelector(".kpi-p-cardtitle"));
      out["kpi-p-cardsub"] = stylesOf(document.querySelector(".kpi-p-cardsub"));
      out["kpi-p-cardmeta"] = stylesOf(document.querySelector(".kpi-p-cardmeta"));
      out["kpi-p-hero"] = stylesOf(document.querySelector(".kpi-p-hero"));
      out["kpi-p-label"] = stylesOf(document.querySelector(".kpi-p-label"));
      out["kpi-p-subline"] = stylesOf(document.querySelector(".kpi-p-subline"));
      out["kpi-p-value"] = stylesOf(document.querySelector(".kpi-p-value"));
      out["kpi-p-k"] = stylesOf(document.querySelector(".kpi-p-k"));
      out["kpi-p-v"] = stylesOf(document.querySelector(".kpi-p-v"));
      out["kpi-p-x"] = stylesOf(document.querySelector(".kpi-p-x"));
      // Pill
      out["kpi-p-pill"] = stylesOf(document.querySelector('[class*="kpi-p-pill"]'));
    } else {
      // Labor selectors - find equivalents
      // Titles / heros vary; probe common classes
      const q = (s) => document.querySelector(s);
      out["kpi-sb-title"] = stylesOf(q(".kpi-sb-title, .kpi-title"));
      out["kpi-sb-sub"] = stylesOf(q(".kpi-sb-sub"));
      out["kpi-sb-hero"] = stylesOf(q(".kpi-hero, .kpi-sb-hero, .kpi-sb-num"));
      out["kpi-sb-label"] = stylesOf(q(".kpi-sb-label"));
      out["kpi-sb-subline"] = stylesOf(q(".kpi-sb-subline"));
      // fallback: grab first .kpi-num pattern
      out["kpi-num"] = stylesOf(q(".num"));
    }

    return out;
  }, board);
}

async function collectPurchasingChrome(page) {
  return await page.evaluate(() => {
    const out = {};
    // Header today
    const today = document.querySelector(".kpi-meta-today");
    out.today_text = today ? (today.textContent || "").trim() : "MISSING";
    const period = document.querySelector(".kpi-meta-period");
    out.period_text = period ? (period.textContent || "").trim() : "MISSING";
    const week = document.querySelector(".kpi-meta-week");
    out.week_text = week ? (week.textContent || "").trim() : "MISSING";
    // Export button
    out.has_export = !!document.querySelector('a.kpi-ctl[href*="/api/kpi"], a.kpi-ctl[download]');
    // Freshness label
    const fresh = document.querySelector(".kpi-fresh");
    out.freshness_text = fresh ? (fresh.textContent || "").trim() : "MISSING";
    // Folio SYSTEM block
    out.has_system_block = !!document.querySelector(".kpi-folio-foot, .kpi-folio-push + *");
    // Period header content
    const periodTitle = document.querySelector('[data-card="period"] .kpi-p-cardtitle');
    const rangeLbl = document.querySelector('[data-card="period"] .kpi-p-cardsub');
    const periodMeta = document.querySelector('[data-card="period"] .kpi-p-cardmeta');
    out.periodcard_title = periodTitle ? periodTitle.textContent.trim() : "MISSING";
    out.periodcard_range = rangeLbl ? rangeLbl.textContent.trim() : "MISSING";
    out.periodcard_meta = periodMeta ? periodMeta.textContent.trim() : "MISSING";
    return out;
  });
}

async function collectLaborChrome(page) {
  return await page.evaluate(() => {
    const out = {};
    const today = document.querySelector(".kpi-meta-today");
    out.today_text = today ? (today.textContent || "").trim() : "MISSING";
    const period = document.querySelector(".kpi-meta-period");
    out.period_text = period ? (period.textContent || "").trim() : "MISSING";
    const week = document.querySelector(".kpi-meta-week");
    out.week_text = week ? (week.textContent || "").trim() : "MISSING";
    out.has_export = !!document.querySelector('a.kpi-ctl[href*="/api/kpi"], a.kpi-ctl[download]');
    const fresh = document.querySelector(".kpi-fresh");
    out.freshness_text = fresh ? (fresh.textContent || "").trim() : "MISSING";
    out.has_system_block = !!document.querySelector(".kpi-folio-foot, .kpi-folio-push + *");
    return out;
  });
}

async function probeDatePicker(page) {
  const out = {};
  // Open the range menu - allow a longer wait for labor which
  // gates range mount on payload arrival.
  try {
    await page.waitForSelector(".kpi-rmenu-trigger", { timeout: 20000 });
  } catch {
    out.rangeMenuMissing = true;
    return out;
  }
  await page.click(".kpi-rmenu-trigger");
  await page.waitForSelector(".kpi-rmenu-pop", { timeout: 5000 });
  await page.waitForTimeout(200);

  // Enumerate all buttons in the pop
  const groups = await page.evaluate(() => {
    const scope = document.querySelector(".kpi-rmenu-pop");
    const presets = [...scope.querySelectorAll(".kpi-rmenu-list .kpi-rmenu-item")].map(b => ({
      label: b.textContent.trim(),
      disabled: b.disabled || b.getAttribute("aria-disabled") === "true",
      isActive: b.classList.contains("on"),
    }));
    const periods = [...scope.querySelectorAll(".kpi-rmenu-col:nth-child(2) .kpi-rmenu-gp")].map(b => ({
      label: b.textContent.trim(),
      disabled: b.disabled || b.getAttribute("aria-disabled") === "true",
      isActive: b.classList.contains("on"),
    }));
    const months = [...scope.querySelectorAll(".kpi-rmenu-col:nth-child(3) .kpi-rmenu-gp")].map(b => ({
      label: b.textContent.trim(),
      disabled: b.disabled || b.getAttribute("aria-disabled") === "true",
      isActive: b.classList.contains("on"),
    }));
    const customBtn = scope.querySelector(".kpi-rmenu-custom-btn");
    return { presets, periods, months, hasCustomBtn: !!customBtn };
  });
  out.groups = groups;
  return out;
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await context.newPage();

  page.on("console", msg => {
    if (msg.type() === "error") console.log("[browser err]", msg.text().slice(0, 200));
  });

  // ---- PURCHASING ----
  const purl = `${BASE}/kpi/purchasing?account=ALL&${RANGE}`;
  console.log("Loading", purl);
  await page.goto(purl, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector('[data-card="period"]', { timeout: 20000 });
  await page.waitForTimeout(500);
  const purchasingRoles = await measureRoles(page, "purchasing");
  const purchasingChrome = await collectPurchasingChrome(page);
  const purchasingDatePicker = await probeDatePicker(page);
  // Close the popup for the next screenshot
  await page.click(".kpi-cmd-title", { timeout: 3000 }).catch(()=>{});

  // Also probe date picker click behavior: try clicking "This period" preset
  await page.click(".kpi-rmenu-trigger");
  await page.waitForSelector(".kpi-rmenu-pop");
  const beforeUrl = page.url();
  // Click FYTD preset - should update URL
  const fytdBtn = await page.$('.kpi-rmenu-list .kpi-rmenu-item:has-text("FYTD")');
  if (fytdBtn) {
    await fytdBtn.click();
    await page.waitForTimeout(600);
    const afterUrl = page.url();
    purchasingDatePicker.fytdBeforeUrl = beforeUrl;
    purchasingDatePicker.fytdAfterUrl = afterUrl;
    purchasingDatePicker.fytdUrlChanged = beforeUrl !== afterUrl;
  }

  // Try This period
  await page.click(".kpi-rmenu-trigger");
  await page.waitForSelector(".kpi-rmenu-pop");
  const beforeUrl2 = page.url();
  const thisPeriodBtn = await page.$('.kpi-rmenu-list .kpi-rmenu-item:has-text("This period")');
  const thisPeriodDisabled = thisPeriodBtn ? await thisPeriodBtn.isDisabled() : null;
  if (thisPeriodBtn && !thisPeriodDisabled) {
    await thisPeriodBtn.click();
    await page.waitForTimeout(600);
    const afterUrl2 = page.url();
    purchasingDatePicker.thisPeriodBeforeUrl = beforeUrl2;
    purchasingDatePicker.thisPeriodAfterUrl = afterUrl2;
    purchasingDatePicker.thisPeriodUrlChanged = beforeUrl2 !== afterUrl2;
    purchasingDatePicker.thisPeriodDisabled = false;
  } else {
    purchasingDatePicker.thisPeriodDisabled = thisPeriodDisabled;
  }

  // Try P3 period button
  await page.goto(purl, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector('[data-card="period"]');
  await page.click(".kpi-rmenu-trigger");
  await page.waitForSelector(".kpi-rmenu-pop");
  const beforeUrl3 = page.url();
  const p3Btn = await page.$('.kpi-rmenu-col:nth-child(2) .kpi-rmenu-gp:has-text("P3")');
  if (p3Btn) {
    await p3Btn.click();
    await page.waitForTimeout(600);
    const afterUrl3 = page.url();
    purchasingDatePicker.p3BeforeUrl = beforeUrl3;
    purchasingDatePicker.p3AfterUrl = afterUrl3;
    purchasingDatePicker.p3UrlChanged = beforeUrl3 !== afterUrl3;
  }

  // Try JAN month
  await page.goto(purl, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector('[data-card="period"]');
  await page.click(".kpi-rmenu-trigger");
  await page.waitForSelector(".kpi-rmenu-pop");
  const beforeUrl4 = page.url();
  const janBtn = await page.$('.kpi-rmenu-col:nth-child(3) .kpi-rmenu-gp:has-text("JAN")');
  if (janBtn) {
    await janBtn.click();
    await page.waitForTimeout(600);
    const afterUrl4 = page.url();
    purchasingDatePicker.janBeforeUrl = beforeUrl4;
    purchasingDatePicker.janAfterUrl = afterUrl4;
    purchasingDatePicker.janUrlChanged = beforeUrl4 !== afterUrl4;
  }

  // Screenshot
  await page.goto(purl, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForSelector('[data-card="period"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/tmp/pr2_purchasing_all.png", fullPage: false });

  // Probe: bar heights vs captions on period card (Section C)
  const barVsCaption = await page.evaluate(() => {
    const out = { cards: [] };
    for (const card of document.querySelectorAll('.kpi-p-row[data-card]')) {
      const dc = card.getAttribute("data-card");
      const wks = card.querySelectorAll(".kpi-p-wc");
      const cardOut = { card: dc, weeks: [] };
      for (const wk of wks) {
        const barEl = wk.querySelector(".kpi-p-bar");
        const capValue = wk.querySelector(".kpi-p-cap .kpi-p-v");
        const capNote = wk.querySelectorAll(".kpi-p-cap .kpi-p-x");
        cardOut.weeks.push({
          barHeightStyle: barEl ? barEl.style.height : null,
          barVisible: !!barEl,
          hasBarClass: barEl ? barEl.className : null,
          capValueText: capValue ? capValue.textContent.trim() : null,
          capNoteText: [...capNote].map(n => n.textContent.trim()),
        });
      }
      out.cards.push(cardOut);
    }
    return out;
  });

  // Section D check: ledger card contents
  const ledgerCards = await page.evaluate(() => {
    const out = [];
    for (const card of document.querySelectorAll('[data-card^="ledger-"]')) {
      const dc = card.getAttribute("data-card");
      const heroEl = card.querySelector(".kpi-p-hero");
      const emptyMsg = card.querySelector(".kpi-p-ledger-empty");
      out.push({
        card: dc,
        heroText: heroEl ? heroEl.textContent.trim() : null,
        emptyMsg: emptyMsg ? emptyMsg.textContent.trim() : null,
        ledgerRowCount: card.querySelectorAll(".kpi-p-lr").length,
      });
    }
    return out;
  });

  // Section G check: folio rail per-account desc
  const railRows = await page.evaluate(() => {
    const rows = [];
    for (const acct of document.querySelectorAll(".kpi-acct")) {
      const key = acct.querySelector(".kpi-acct-key")?.textContent?.trim();
      const desc = acct.querySelector(".kpi-acct-desc")?.textContent?.trim();
      rows.push({ key, descNonEmpty: !!desc && desc.length > 0, desc });
    }
    return rows;
  });

  // ---- LABOR ----
  const lurl = `${BASE}/kpi/labor?account=ALL&${RANGE}`;
  console.log("Loading", lurl);
  await page.goto(lurl, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(1000);
  const laborRoles = await measureRoles(page, "labor");
  const laborChrome = await collectLaborChrome(page);
  const laborRailRows = await page.evaluate(() => {
    const rows = [];
    for (const acct of document.querySelectorAll(".kpi-acct")) {
      const key = acct.querySelector(".kpi-acct-key")?.textContent?.trim();
      const desc = acct.querySelector(".kpi-acct-desc")?.textContent?.trim();
      rows.push({ key, descNonEmpty: !!desc && desc.length > 0, desc });
    }
    return rows;
  });
  const laborDatePicker = await probeDatePicker(page);

  await page.screenshot({ path: "/tmp/pr2_labor_all.png", fullPage: false });

  await browser.close();

  console.log("\n=== PURCHASING CHROME ===");
  console.log(JSON.stringify(purchasingChrome, null, 2));
  console.log("\n=== LABOR CHROME ===");
  console.log(JSON.stringify(laborChrome, null, 2));

  console.log("\n=== PURCHASING DATE PICKER ===");
  console.log(JSON.stringify(purchasingDatePicker, null, 2));
  console.log("\n=== LABOR DATE PICKER (control groups) ===");
  console.log(JSON.stringify(laborDatePicker, null, 2));

  console.log("\n=== SECTION C: bars vs captions ===");
  console.log(JSON.stringify(barVsCaption, null, 2));

  console.log("\n=== SECTION D: ledger cards ===");
  console.log(JSON.stringify(ledgerCards, null, 2));

  console.log("\n=== SECTION G: rail rows PURCHASING ===");
  for (const r of railRows) console.log(`  ${r.key}: descNonEmpty=${r.descNonEmpty} desc="${r.desc}"`);

  console.log("\n=== SECTION G: rail rows LABOR ===");
  for (const r of laborRailRows) console.log(`  ${r.key}: descNonEmpty=${r.descNonEmpty} desc="${r.desc}"`);

  console.log("\n=== SECTION I: typography roles ===");
  console.log("\n-- purchasing --");
  for (const [k, v] of Object.entries(purchasingRoles)) console.log(k, JSON.stringify(v));
  console.log("\n-- labor --");
  for (const [k, v] of Object.entries(laborRoles)) console.log(k, JSON.stringify(v));

  console.log("\n=== SIDE-BY-SIDE type table (shared roles only) ===");
  const shared = ["kpi-cmd-title-brand", "kpi-cmd-title-acct", "kpi-ctl-k", "kpi-ctl-v",
                  "kpi-rmenu-label-primary", "kpi-rmenu-label-dates", "kpi-meta-today", "kpi-meta-period",
                  "kpi-fresh", "kpi-folio-title-h", "kpi-folio-title-s", "kpi-ghead-name",
                  "kpi-ghead-sub", "kpi-acct-key", "kpi-acct-desc"];
  for (const role of shared) {
    const p = purchasingRoles[role];
    const l = laborRoles[role];
    if (!p && !l) continue;
    if (!p || !l) {
      console.log(`  ${role}: purchasing=${p ? "present" : "MISSING"} labor=${l ? "present" : "MISSING"}`);
      continue;
    }
    const diffs = [];
    if (p.fontSize !== l.fontSize) diffs.push(`size ${p.fontSize} vs ${l.fontSize}`);
    if (p.fontWeight !== l.fontWeight) diffs.push(`weight ${p.fontWeight} vs ${l.fontWeight}`);
    if (p.color !== l.color) diffs.push(`color ${p.color} vs ${l.color}`);
    if (p.lineHeight !== l.lineHeight) diffs.push(`lh ${p.lineHeight} vs ${l.lineHeight}`);
    if (diffs.length) console.log(`  ${role}: ${diffs.join("; ")}`);
    else console.log(`  ${role}: MATCH (size ${p.fontSize} / weight ${p.fontWeight} / color ${p.color})`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
