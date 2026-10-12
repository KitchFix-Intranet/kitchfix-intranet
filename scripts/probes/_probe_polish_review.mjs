// Localhost acceptance for the 4-item polish on labor + purchasing folds.
// Account: STL - MO P4 (first-goal-period on MO; carries labor fold +
// multi-week purchasing fold + the billed-back goal row with pre-season
// sub-row). 6-point checklist + 4 screenshots.
import { chromium } from "playwright";
const OUT = "/tmp/billback-review";

const url = "http://localhost:3000/kpi/overview?account=" + encodeURIComponent("STL - MO") + "&start=2026-03-23&end=2026-04-19";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1600 } });
const page = await ctx.newPage();

const warnings = [], errors = [];
page.on("console", m => { if (m.type() === "warning") warnings.push(m.text()); if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", err => errors.push("pageerror: " + err.message));

await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => {});
await page.waitForTimeout(2000);
await page.locator("[data-kpi-ov='billback-period']").first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
await page.locator("[data-kpi-ov='labor-ledger']").first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
await page.locator("[data-kpi-ov='purchasing-ledger']").first().waitFor({ state: "visible", timeout: 30000 }).catch(() => {});

// 1. Three distinct strips: measure border-top color on each fold card
// before anything is opened.
const strips = await page.evaluate(() => {
  const pnl = document.querySelector("[data-kpi-ov='pnl-statement']") || document.querySelector(".kpi-ov-card-cogs");
  const labor = document.querySelector("[data-kpi-ov='labor-ledger']");
  const purch = document.querySelector("[data-kpi-ov='purchasing-ledger']");
  const get = (el, name) => el ? ({
    name,
    classes: el.className,
    borderTop: getComputedStyle(el).borderTopWidth + " " + getComputedStyle(el).borderTopStyle + " " + getComputedStyle(el).borderTopColor,
  }) : { name, missing: true };
  return [get(pnl, "pnl"), get(labor, "labor"), get(purch, "purchasing")];
});

// 2. Collapsed-state helpop sweep (before opening any folds).
// Confirm the two fold ids are NOT present in the collapsed fold heads.
async function helpopIds() {
  const ids = await page.locator("[data-hs-help]").evaluateAll(ns => ns.map(n => n.getAttribute("data-hs-help")));
  const counts = {}; for (const id of ids) counts[id] = (counts[id] || 0) + 1;
  return { total: ids.length, ids: counts, dupes: Object.entries(counts).filter(([, c]) => c > 1) };
}
const collapsed = await helpopIds();

// Open all three folds (they share the chevron pattern: button inside .kpi-ov-fold-head).
async function openFold(dataAttr) {
  const fold = page.locator(`[data-kpi-ov='${dataAttr}']`).first();
  if ((await fold.count()) === 0) return null;
  const open = await fold.getAttribute("data-kpi-ov-open").catch(() => null);
  if (open !== "1") {
    const trig = fold.locator(".kpi-ov-fold-trigger").first();
    if ((await trig.count()) > 0) { await trig.click(); await page.waitForTimeout(600); }
  }
  return fold;
}
await openFold("pnl-statement");
await openFold("labor-ledger");
await openFold("purchasing-ledger");
await page.waitForTimeout(600);

// Opened state helpop sweep (the meta row should now carry each fold's help id).
const opened = await helpopIds();

// 3. For each open fold, confirm the help id sits inside .kpi-ov-fold-meta
// NOT inside .kpi-ov-fold-head.
const metaPlacement = await page.evaluate(() => {
  const check = (foldSel, expectedId) => {
    const fold = document.querySelector(foldSel);
    if (!fold) return { foldSel, missing: true };
    const inMeta  = fold.querySelector(`.kpi-ov-fold-meta [data-hs-help='${expectedId}']`);
    const inHead  = fold.querySelector(`.kpi-ov-fold-head [data-hs-help='${expectedId}']`);
    return { foldSel, inMetaCount: inMeta ? 1 : 0, inHeadCount: inHead ? 1 : 0, metaBorderTop: inMeta ? getComputedStyle(inMeta.closest(".kpi-ov-fold-meta")).borderTopColor : null };
  };
  return [
    check("[data-kpi-ov='labor-ledger']", "qLaborFold"),
    check("[data-kpi-ov='purchasing-ledger']", "qPurchasingFold"),
  ];
});

// 4. Purchasing week collapse / expand: pick the first week band.
const weekBefore = await page.evaluate(() => {
  const bands = Array.from(document.querySelectorAll("[data-kpi-ov='purchasing-week-band']"));
  const txns = document.querySelectorAll("[data-kpi-ov='purchasing-txn']");
  const first = bands[0];
  const btn = first?.querySelector(".kpi-ov-pf-wbandbtn");
  const chev = btn?.querySelector(".kpi-ov-pf-chev")?.textContent?.trim();
  const subtotalsVisible = first ? Array.from(first.querySelectorAll("td")).slice(1).map(t => t.textContent.trim()) : [];
  return { weekCount: bands.length, firstWeekOpen: first?.getAttribute("data-kpi-ov-open"), chev, subtotalsVisible, txnCountVisible: txns.length };
});
// Click the first week to expand
await page.locator("[data-kpi-ov='purchasing-week-band']").first().locator(".kpi-ov-pf-wbandbtn").click();
await page.waitForTimeout(400);
const weekAfterExpand = await page.evaluate(() => {
  const bands = Array.from(document.querySelectorAll("[data-kpi-ov='purchasing-week-band']"));
  const first = bands[0];
  const btn = first?.querySelector(".kpi-ov-pf-wbandbtn");
  const chev = btn?.querySelector(".kpi-ov-pf-chev")?.textContent?.trim();
  const subtotalsVisible = first ? Array.from(first.querySelectorAll("td")).slice(1).map(t => t.textContent.trim()) : [];
  const txns = document.querySelectorAll("[data-kpi-ov='purchasing-txn']");
  return { firstWeekOpen: first?.getAttribute("data-kpi-ov-open"), chev, subtotalsVisible, txnCountVisible: txns.length };
});
// Screenshot the expanded state
{
  const purch = page.locator("[data-kpi-ov='purchasing-ledger']").first();
  await purch.screenshot({ path: OUT + "/polish-purch-week-expanded.png" });
}
// Collapse back
await page.locator("[data-kpi-ov='purchasing-week-band']").first().locator(".kpi-ov-pf-wbandbtn").click();
await page.waitForTimeout(400);
const weekAfterCollapse = await page.evaluate(() => {
  const bands = Array.from(document.querySelectorAll("[data-kpi-ov='purchasing-week-band']"));
  const first = bands[0];
  const btn = first?.querySelector(".kpi-ov-pf-wbandbtn");
  const chev = btn?.querySelector(".kpi-ov-pf-chev")?.textContent?.trim();
  const txns = document.querySelectorAll("[data-kpi-ov='purchasing-txn']");
  return { firstWeekOpen: first?.getAttribute("data-kpi-ov-open"), chev, txnCountVisible: txns.length };
});

// 5. Text-style match: compare purchasing lrow + labor child row + the two headers.
// Open the first labor week band so a labor child row exists.
// First open the first worker/week row in the labor table.
const laborFirstWeekBtn = page.locator("[data-kpi-ov='labor-ledger'] .kpi-tbl-bandbtn, [data-kpi-ov='labor-ledger'] .kpi-tbl-weekbtn").first();
if ((await laborFirstWeekBtn.count()) > 0) {
  await laborFirstWeekBtn.click().catch(() => {});
  await page.waitForTimeout(400);
}
// Expand the first purchasing week again so we can measure a transaction row.
await page.locator("[data-kpi-ov='purchasing-week-band']").first().locator(".kpi-ov-pf-wbandbtn").click();
await page.waitForTimeout(400);

const textStyles = await page.evaluate(() => {
  const grab = (el) => el ? {
    size: getComputedStyle(el).fontSize,
    weight: getComputedStyle(el).fontWeight,
    color: getComputedStyle(el).color,
    letterSpacing: getComputedStyle(el).letterSpacing,
  } : null;
  // headers
  const purchTh = document.querySelector("[data-kpi-ov='purchasing-ledger'] .kpi-ov-cp-led-tbl th");
  const laborTh = document.querySelector("[data-kpi-ov='labor-ledger'] .kpi-tbl thead th");
  // lrow transaction row
  const purchLrowTd = document.querySelector("[data-kpi-ov='purchasing-txn'] td");
  const purchLrowFirst = document.querySelector("[data-kpi-ov='purchasing-txn'] td.kpi-ov-cp-led-l");
  const purchVname = document.querySelector("[data-kpi-ov='purchasing-txn'] .kpi-ov-pf-vname");
  const purchMute = document.querySelector("[data-kpi-ov='purchasing-txn'] td.kpi-ov-cp-led-mute");
  // labor child row (worker row)
  const laborChildTd = document.querySelector(".kpi-tbl-child > td, .kpi-tbl-worker > td");
  return {
    purchTh: grab(purchTh),
    laborTh: grab(laborTh),
    purchLrowTd: grab(purchLrowTd),
    purchLrowFirst: grab(purchLrowFirst),
    purchVname: grab(purchVname),
    purchMute: grab(purchMute),
    laborChildTd: grab(laborChildTd),
  };
});

// 6. PR-2 goal row still renders unchanged under the purchasing table.
const goalRow = await page.evaluate(() => {
  const r = document.querySelector("[data-kpi-ov='purchasing-billback-goal']");
  if (!r) return { present: false };
  const sub = r.querySelector(".kpi-ov-cp-led-goal-sub");
  return {
    present: true,
    state: r.getAttribute("data-kpi-ov-state"),
    eyebrow: r.querySelector(".kpi-ov-cp-led-goal-eb")?.textContent?.trim(),
    hasSub: !!sub,
    subText: sub ? sub.textContent?.trim().slice(0, 100) : null,
  };
});

// Screenshots
// Screenshot 1: full page with all three fold strips visible
await page.screenshot({ path: OUT + "/polish-three-strips.png", fullPage: true });

// Screenshot 2: open fold meta row (take the whole labor fold since the meta row is right under the trigger)
await page.locator("[data-kpi-ov='labor-ledger']").first().screenshot({ path: OUT + "/polish-labor-fold-meta.png" });

// Screenshot 3: purchasing + labor rows side by side - take the whole viewport so both are visible
// Also take the labor table on its own for the text-match reference
await page.locator("[data-kpi-ov='purchasing-ledger']").first().screenshot({ path: OUT + "/polish-purchasing-rows.png" });

// Already have polish-purch-week-expanded.png and the full page shot.
// Produce one more: collapsed state capture - click to collapse again then screenshot
await page.locator("[data-kpi-ov='purchasing-week-band']").first().locator(".kpi-ov-pf-wbandbtn").click();
await page.waitForTimeout(400);
await page.locator("[data-kpi-ov='purchasing-ledger']").first().screenshot({ path: OUT + "/polish-purch-week-collapsed.png" });

await browser.close();

console.log(JSON.stringify({
  strips, collapsed, opened, metaPlacement,
  weekBefore, weekAfterExpand, weekAfterCollapse,
  textStyles, goalRow,
}, null, 2));

console.log("── warnings ──");
console.log(JSON.stringify(warnings, null, 2));
console.log("── errors (first 160 chars each) ──");
console.log(JSON.stringify(errors.map(e => e.slice(0, 160)), null, 2));
