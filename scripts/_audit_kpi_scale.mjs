// scripts/_audit_kpi_scale.mjs
//
// V30-5 permanent gate. V31 item 2 - measures RENDERED PIXELS via
// synthetic-DOM injection so a class that never got converted (like
// V30's .kpi-seg at 25px beside 27px chips) cannot slip past by having
// a token-name that resolves to something else.
//
// Reports:
//   [a] distinct rendered font-size values on /kpi/labor product
//       surfaces: target 6 (+ chrome title = 7 max)
//   [b] distinct rendered CONTROL HEIGHTS (getBoundingClientRect):
//       target 2 (+ folio 2-line row = 3 max)
//   [c] distinct rendered CARD RADII (computed border-radius): target 1
//   [d] raw px literals for type / spacing in kpi.css outside the
//       token block: target 0
//   [e] lane-head parity across story / signals / numbers: 5 first-text
//       tops within 1px at 1180 / 1280 / 1440
//
// Usage: TEST_MODE=true node scripts/_audit_kpi_scale.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");
const CSS_PATH = path.join(REPO_ROOT, "src/app/kpi/kpi.css");
const BASE = process.env.PLAYWRIGHT_BASE_URL || "http://localhost:3001";
const URL = `${BASE}/kpi/labor?account=ALL`;

// ── static audit (raw px literals in kpi.css, [d] only) ───────────
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}
function auditCssLiterals() {
  const raw = fs.readFileSync(CSS_PATH, "utf8");
  const src = stripComments(raw);

  const inTokenBlock = (() => {
    const idx = src.indexOf(".kpi-app");
    if (idx < 0) return () => false;
    const brace = src.indexOf("{", idx);
    let depth = 0;
    let i = brace;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
    }
    const start = brace, end = i;
    return (pos) => pos >= start && pos < end;
  })();
  const isInMedia = (() => {
    const media = [...src.matchAll(/@media[^{]*\{/g)].map(m => {
      const openAt = m.index + m[0].length - 1;
      let depth = 0;
      let i = openAt;
      for (; i < src.length; i++) {
        if (src[i] === "{") depth++;
        else if (src[i] === "}") { depth--; if (depth === 0) { i++; break; } }
      }
      return { start: m.index, end: i };
    });
    return (pos) => media.some(m => pos >= m.start && pos < m.end);
  })();

  const literalRe = /(?:^|[\s;{])(font-size|padding|padding-top|padding-right|padding-bottom|padding-left|margin|margin-top|margin-right|margin-bottom|margin-left|gap|row-gap|column-gap)\s*:\s*([^;]+);/g;
  let rawLiterals = 0;
  const rawSamples = [];
  let m;
  while ((m = literalRe.exec(src)) !== null) {
    if (inTokenBlock(m.index)) continue;
    if (isInMedia(m.index)) continue;
    const val = m[2];
    const px = [...val.matchAll(/(\d+(?:\.\d+)?)px/g)].map(x => parseFloat(x[1]));
    for (const n of px) {
      if (n <= 3) continue;
      if (n === 999) continue;
      rawLiterals++;
      if (rawSamples.length < 15) rawSamples.push({ n, snippet: m[0].trim().slice(0, 80) });
    }
  }
  return { rawLiterals, rawSamples };
}

// ── rendered audit via synthetic-DOM ──────────────────────────────
// Injects a representative sample of KPI product surfaces into
// .kpi-wrap so the real kpi.css cascade applies. Measures:
//   font-sizes on every product text role
//   heights on every control element (rounded to 0.1px)
//   border-radii on every card container (computed style)
//   lane-head parity: first-text offset per container top

const PROBE_HTML = `
  <div id="__kpi_probe" class="kpi-app">
    <!-- font-size roles: sample one element per role -->
    <div class="__probe-fonts">
      <span class="kpi-spend-h-title">EYEBROW</span>
      <span class="kpi-spend-cell-lab">CARD LABEL</span>
      <span class="kpi-sig-sub">meta sub</span>
      <span class="kpi-wb-cap-value">body sample</span>
      <span class="kpi-spend-cell-val num">$42,190</span>
      <span class="kpi-spend-budget-val num">$127,510</span>
      <span class="kpi-spend-budget-val num" data-long="true">$1,637,503.83</span>
      <span class="kpi-det-v num">15px value</span>
    </div>

    <!-- control heights: chip, btn, seg (with buttons), help, tbl bandbtn, folio row, gcard folio card wrap -->
    <div class="__probe-ctls">
      <div class="kpi-tbar">
        <button class="kpi-tbar-chip">P9</button>
        <button class="kpi-tbar-btn">Expand all</button>
        <span class="kpi-seg"><button class="on">A</button><button>B</button></span>
        <button class="kpi-help">?</button>
      </div>
      <button class="kpi-acct" style="width: 240px">
        <span class="kpi-acct-key">CIN - OH</span>
      </button>
      <div class="kpi-ghead" style="width: 240px;">
        <span class="kpi-ghead-name">EAST</span>
      </div>
    </div>

    <!-- card radii (V30-3 named cards only: story, spend-budget,
         spend-cell, sig, det, tbl-wrap, gcard). .kpi-note-info is a
         banner with an intentional partial-corner radius and is not in
         the V30-3 card list. -->
    <div class="__probe-cards" style="width: 900px">
      <div class="kpi-story"><div class="kpi-story-left"></div><div class="kpi-story-right"></div></div>
      <div class="kpi-spend-budget"></div>
      <div class="kpi-spend-cell"></div>
      <div class="kpi-sig"></div>
      <div class="kpi-det"></div>
      <div class="kpi-tbl-wrap"></div>
      <div class="kpi-gcard"></div>
    </div>

    <!-- lane-head parity: story + 3 signals + det -->
    <div class="__probe-lanes" style="width: 900px;">
      <div class="kpi-story">
        <div class="kpi-story-left">
          <div class="kpi-spend">
            <div class="kpi-spend-h">
              <div class="kpi-spend-h-left"><span class="kpi-spend-h-title">PERIOD 9</span></div>
            </div>
          </div>
        </div>
        <div class="kpi-story-right"></div>
      </div>
      <div class="kpi-sigs">
        <div class="kpi-sig"><div class="kpi-sig-head"><span class="kpi-sig-eyebrow">SPENDING PACE</span></div></div>
        <div class="kpi-sig"><div class="kpi-sig-head"><span class="kpi-sig-eyebrow">OVERTIME</span></div></div>
        <div class="kpi-sig"><div class="kpi-sig-head"><span class="kpi-sig-eyebrow">HOURS LEFT TO SCHEDULE</span></div></div>
        <div class="kpi-sig"><div class="kpi-sig-head"><span class="kpi-sig-eyebrow">PAYROLL DATA</span></div></div>
      </div>
      <div class="kpi-det">
        <button class="kpi-det-h" type="button"><span class="kpi-det-h-caret">></span><span class="kpi-det-h-t">ALL THE NUMBERS</span></button>
      </div>
    </div>
  </div>
`;

async function auditRendered() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", e => console.error(`[pageerror] ${e.message}`));

  const results = {};
  for (const width of [1180, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(URL, { waitUntil: "networkidle", timeout: 25000 });
    await page.waitForTimeout(300);
    const r = await page.evaluate((html) => {
      const wrap = document.querySelector(".kpi-wrap");
      if (!wrap) return { hasWrap: false };
      const host = document.createElement("div");
      host.style.cssText = "position: absolute; top: -9999px; left: 0;";
      host.innerHTML = html;
      wrap.appendChild(host);
      const round = v => Math.round(v * 100) / 100;

      // [a] distinct rendered font-size values
      const fontEls = host.querySelectorAll(".__probe-fonts > *");
      const fontSizes = new Set();
      for (const el of fontEls) fontSizes.add(round(parseFloat(getComputedStyle(el).fontSize)));

      // [b] distinct rendered control heights
      const ctlEls = host.querySelectorAll(".__probe-ctls .kpi-tbar-chip, .__probe-ctls .kpi-tbar-btn, .__probe-ctls .kpi-seg, .__probe-ctls .kpi-help, .__probe-ctls .kpi-acct, .__probe-ctls .kpi-ghead");
      const ctlHeights = new Set();
      for (const el of ctlEls) ctlHeights.add(round(el.getBoundingClientRect().height));

      // [c] distinct rendered card radii
      const cardEls = host.querySelectorAll(".__probe-cards > *");
      const cardRadii = new Set();
      for (const el of cardEls) cardRadii.add(getComputedStyle(el).borderTopLeftRadius);

      // [e] lane-head parity
      // V32-8 - four signal cards now, so parity spans 6 containers.
      const laneCards = [
        host.querySelector(".__probe-lanes .kpi-story"),
        ...host.querySelectorAll(".__probe-lanes .kpi-sig"),
        host.querySelector(".__probe-lanes .kpi-det"),
      ];
      // First inner TEXT span so parity measures the eyebrow baseline,
      // not the outer wrapper (which sits at card padding regardless
      // of lane structure).
      const laneOffsets = laneCards.map(card => {
        if (!card) return null;
        const spans = card.querySelectorAll("span");
        const text = spans[0] || card;
        return round(text.getBoundingClientRect().top - card.getBoundingClientRect().top);
      }).filter(v => v != null);
      const laneSpread = laneOffsets.length ? Math.max(...laneOffsets) - Math.min(...laneOffsets) : null;

      const r = {
        hasWrap: true,
        fontSizes: [...fontSizes].sort((a, b) => a - b),
        ctlHeights: [...ctlHeights].sort((a, b) => a - b),
        cardRadii: [...cardRadii],
        laneOffsets, laneSpread,
      };
      host.remove();
      return r;
    }, PROBE_HTML);
    results[width] = r;
  }

  await browser.close();
  return results;
}

async function main() {
  console.log("=".repeat(72));
  console.log("V30-5 KPI SCALE AUDIT · V31 item 2 · measures RENDERED pixels");
  console.log("=".repeat(72));

  const literals = auditCssLiterals();
  const rendered = await auditRendered();
  const at1440 = rendered[1440] || {};

  console.log("\n[a] distinct rendered font-size values on product surfaces (target: 6 + chrome title = 7 max)");
  console.log(`    values: [${(at1440.fontSizes || []).map(v => v + "px").join(", ")}]  count=${(at1440.fontSizes || []).length}`);

  console.log("\n[b] distinct rendered control heights (target: 2 + 1 folio row = 3 max)");
  console.log(`    values: [${(at1440.ctlHeights || []).map(v => v + "px").join(", ")}]  count=${(at1440.ctlHeights || []).length}`);

  console.log("\n[c] distinct rendered card radii (target: 1)");
  console.log(`    values: [${(at1440.cardRadii || []).join(", ")}]  count=${(at1440.cardRadii || []).length}`);

  console.log("\n[d] raw px literals for type/spacing in kpi.css outside token block (target: 0)");
  console.log(`    count: ${literals.rawLiterals}`);
  for (const s of literals.rawSamples) console.log(`      ${s.n}px · ${s.snippet}`);

  console.log("\n[e] lane-head parity across story / 3 signals / numbers (target: 5 tops within 1px @ each width)");
  for (const width of [1180, 1280, 1440]) {
    const r = rendered[width] || {};
    if (!r.hasWrap) { console.log(`    @${width}: no wrap`); continue; }
    const spread = r.laneSpread == null ? "n/a" : r.laneSpread.toFixed(2) + "px";
    console.log(`    @${width}px  offsets=[${(r.laneOffsets || []).join(", ")}]  spread=${spread}  ${r.laneSpread != null && r.laneSpread < 1 ? "OK" : "MISMATCH"}`);
  }

  console.log("\n" + "=".repeat(36));
  const failMap = {
    a: (at1440.fontSizes || []).length > 7,
    b: (at1440.ctlHeights || []).length > 3,
    c: (at1440.cardRadii || []).length !== 1,
    d: literals.rawLiterals > 0,
  };
  const fails = Object.entries(failMap).filter(([, v]) => v).map(([k]) => k);
  console.log(fails.length === 0 ? "  V30-5 gate PASS on a/b/c/d (rendered [e] shown above)" : `  V30-5 gate FAIL on: ${fails.join(", ")}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch(e => { console.error("AUDIT ERROR:", e); process.exit(2); });
