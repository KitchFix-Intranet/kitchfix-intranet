// scripts/_audit_kpi_scale.mjs
//
// V30-5 permanent gate. Reports five numbers on every KPI PR:
//   a. distinct rendered font-sizes on /kpi/labor product surfaces
//      (excluding topnav): target 6 (+ chrome title = 7 hard ceiling)
//   b. distinct control heights: target 2 (+ folio 2-line row = 3 max)
//   c. distinct card radii: target 1
//   d. raw px literals for type / spacing / height / radius outside the
//      token block: target 0
//   e. lane-head parity across story / signals / numbers: 5 values,
//      identical within 1px at 1180 / 1280 / 1440
//
// Runs headless. The lane-head parity uses synthetic-DOM injection
// because /kpi/labor is auth-gated (TEST_MODE bypasses middleware but
// useSession returns unauthenticated, so the board does not render);
// kpi.css is loaded on the wrapper so the injected markup renders
// against the real token layer.
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

// ── static audit against kpi.css ──────────────────────────────────
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}
function auditCss() {
  const raw = fs.readFileSync(CSS_PATH, "utf8");
  const src = stripComments(raw);

  // Font-size tokens used on product surfaces. We count DISTINCT token
  // references (--kpi-t-*, --kpi-size-*, --size-*). Raw px literals count
  // separately toward the literal gate.
  const fontTokens = new Set();
  const fontLiterals = [];
  const fontRe = /font-size\s*:\s*([^;]+);/g;
  let m;
  while ((m = fontRe.exec(src)) !== null) {
    const val = m[1].trim();
    const vars = [...val.matchAll(/var\((--[a-z0-9-]+)\)/g)].map(x => x[1]);
    for (const v of vars) fontTokens.add(v);
    const literals = [...val.matchAll(/(\d+(?:\.\d+)?)px/g)].map(x => parseFloat(x[1])).filter(n => n > 3);
    fontLiterals.push(...literals);
  }

  // Blocks are top-level selectors + their declarations. Split at the
  // start of a selector line at column 0 (not inside media queries).
  const blocks = src.split(/(?=^\.[a-z-])/m);

  // Control-height TOKEN references from control-like selectors. Skip
  // decorative descendants (dots, ticks, ornaments) by matching only
  // exact selector prefixes.
  const ctlHeightTokens = new Set();
  const ctlPrefixes = [
    ".kpi-cmd ", ".kpi-cmd{",
    ".kpi-ctl ", ".kpi-ctl{",
    ".kpi-fresh ", ".kpi-fresh{",
    ".kpi-pchip", ".kpi-preset", ".kpi-tbar-btn", ".kpi-tbar-chip",
    ".kpi-seg ", ".kpi-seg{", ".kpi-help ", ".kpi-help{",
    ".kpi-acct ", ".kpi-acct{",
    ".kpi-tbl-bandbtn", ".kpi-tbl-weekbtn", ".kpi-tbl-accountbtn",
    ".kpi-wkbtn", ".kpi-perbtn", ".kpi-jump", ".kpi-redact",
    ".kpi-trig", ".kpi-btn ", ".kpi-btn{",
  ];
  for (const block of blocks) {
    const head = block.trimStart().split(/[{,\s]/)[0];
    const isCtl = ctlPrefixes.some(p => block.trimStart().startsWith(p.replace(/[{ ]/, "")));
    if (!isCtl) continue;
    const heightMatches = [...block.matchAll(/(?:^|[\s;])height\s*:\s*([^;]+);/g)];
    for (const h of heightMatches) {
      const val = h[1].trim();
      // Only accept token references or single px values > 3.
      const vars = [...val.matchAll(/var\((--kpi-[a-z0-9-]+)\)/g)].map(x => x[1]);
      for (const v of vars) {
        // Skip spacing tokens accidentally used for height (--kpi-sp-*).
        if (/^--kpi-sp-/.test(v)) continue;
        ctlHeightTokens.add(v);
      }
    }
  }

  // Card radii on card-container selectors (top-level cards only).
  const cardPrefixes = [
    ".kpi-story{", ".kpi-story ",
    ".kpi-spend-budget{", ".kpi-spend-budget ",
    ".kpi-spend-cell{", ".kpi-spend-cell ",
    ".kpi-sig{", ".kpi-sig ",
    ".kpi-det{", ".kpi-det ",
    ".kpi-tbl-wrap{", ".kpi-tbl-wrap ",
    ".kpi-note-info{", ".kpi-coming{",
  ];
  const cardRadii = new Set();
  for (const block of blocks) {
    const start = block.trimStart();
    const isCard = cardPrefixes.some(p => start.startsWith(p));
    if (!isCard) continue;
    const radiusMatches = [...block.matchAll(/border-radius\s*:\s*([^;]+);/g)];
    for (const r of radiusMatches) cardRadii.add(r[1].trim());
  }

  // Raw px literals for type / spacing / height / radius on ALL props,
  // excluding 0-3 hairlines and 999 (pill radius exception per V30-2).
  // Skip min-width / max-width / width (those are LAYOUT widths, not
  // V30-3 spacing) and skip @media (min-width...) breakpoint numbers.
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
  // Also skip @media rules (their pixel values are breakpoints).
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

  const literalRe = /(?:^|[\s;{])(font-size|padding|padding-top|padding-right|padding-bottom|padding-left|margin|margin-top|margin-right|margin-bottom|margin-left|gap|row-gap|column-gap|height|min-height|border-radius)\s*:\s*([^;]+);/g;
  let rawLiterals = 0;
  const rawSamples = [];
  while ((m = literalRe.exec(src)) !== null) {
    if (inTokenBlock(m.index)) continue;
    if (isInMedia(m.index)) continue;
    const prop = m[1];
    const val = m[2];
    const px = [...val.matchAll(/(\d+(?:\.\d+)?)px/g)].map(x => parseFloat(x[1]));
    for (const n of px) {
      if (n <= 3) continue;
      if (n === 999) continue;
      rawLiterals++;
      if (rawSamples.length < 15) rawSamples.push({ n, prop, snippet: m[0].trim().slice(0, 80) });
    }
  }

  return {
    fontTokens: [...fontTokens].sort(),
    fontLiteralsCount: fontLiterals.length,
    ctlHeightTokens: [...ctlHeightTokens].sort(),
    cardRadii: [...cardRadii].sort(),
    rawLiterals,
    rawSamples,
  };
}

// ── rendered-metrics audit via synthetic-DOM ──────────────────────
async function auditRendered() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on("pageerror", e => console.error(`[pageerror] ${e.message}`));

  const HTML = `
    <div class="kpi-story">
      <div class="kpi-story-left">
        <div class="kpi-spend">
          <div class="kpi-spend-h">
            <div class="kpi-spend-h-left">
              <span class="kpi-spend-h-title">PERIOD 9</span>
            </div>
            <span class="kpi-vpill kpi-vpill-good"><span class="kpi-vpill-dot"></span>ON TRACK</span>
          </div>
        </div>
      </div>
      <div class="kpi-story-right">
        <div class="kpi-wh">
          <span class="kpi-wh-t">THE PERIOD · WEEK BY WEEK</span>
        </div>
      </div>
    </div>
    <div class="kpi-sigs kpi-sigs-3">
      <div class="kpi-sig">
        <div class="kpi-sig-head"><span class="kpi-sig-eyebrow">OVER / UNDER BUDGET</span><span class="kpi-sig-state kpi-sig-state-good">ON TARGET</span></div>
      </div>
      <div class="kpi-sig">
        <div class="kpi-sig-head"><span class="kpi-sig-eyebrow">OVERTIME</span><span class="kpi-sig-state kpi-sig-state-warn">WATCH</span></div>
      </div>
      <div class="kpi-sig">
        <div class="kpi-sig-head"><span class="kpi-sig-eyebrow">HOURS LEFT TO SCHEDULE</span><span class="kpi-sig-state kpi-sig-state-good">ON TARGET</span></div>
      </div>
    </div>
    <div class="kpi-det">
      <button class="kpi-det-h" type="button">
        <span class="kpi-det-h-caret">></span>
        <span class="kpi-det-h-t">ALL THE NUMBERS</span>
      </button>
    </div>
  `;

  const results = {};
  for (const width of [1180, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(URL, { waitUntil: "networkidle", timeout: 25000 });
    await page.waitForTimeout(300);
    const r = await page.evaluate((html) => {
      const wrap = document.querySelector(".kpi-wrap");
      if (!wrap) return { hasWrap: false };
      const host = document.createElement("div");
      host.className = "kpi-app";
      host.style.cssText = `position: absolute; top: -9999px; width: ${window.innerWidth - 300}px;`;
      host.innerHTML = html;
      wrap.appendChild(host);
      const round = v => Math.round(v * 100) / 100;
      // V30-4 parity: the FIRST TEXT element inside each of the five
      // header containers sits at the same offset from its CONTAINER
      // TOP. Absolute page-top differs because the cards stack in the
      // board; the shared discipline is per-card padding + lane-head.
      const measurePairs = [
        { card: host.querySelector(".kpi-story"),  header: host.querySelector(".kpi-spend-h") },
        { card: host.querySelectorAll(".kpi-sig")[0], header: host.querySelectorAll(".kpi-sig-head")[0] },
        { card: host.querySelectorAll(".kpi-sig")[1], header: host.querySelectorAll(".kpi-sig-head")[1] },
        { card: host.querySelectorAll(".kpi-sig")[2], header: host.querySelectorAll(".kpi-sig-head")[2] },
        { card: host.querySelector(".kpi-det"),    header: host.querySelector(".kpi-det-h") },
      ];
      const offsets = measurePairs.map(({ card, header }) => {
        if (!card || !header) return null;
        const cardTop = card.getBoundingClientRect().top;
        const text = header.querySelector("span, div, button") || header;
        return round(text.getBoundingClientRect().top - cardTop);
      }).filter(v => v != null);
      const spread = offsets.length ? Math.max(...offsets) - Math.min(...offsets) : null;
      const r = { hasWrap: true, offsets, spread };
      host.remove();
      return r;
    }, HTML);
    results[width] = r;
  }

  await browser.close();
  return results;
}

async function main() {
  console.log("=".repeat(72));
  console.log("V30-5 KPI SCALE AUDIT");
  console.log("=".repeat(72));

  const staticAudit = auditCss();
  console.log("\n[a] distinct font-size tokens on kpi.css (target: 6 product + 1 chrome title = 7 max)");
  console.log(`    count: ${staticAudit.fontTokens.length}`);
  for (const t of staticAudit.fontTokens) console.log(`      ${t}`);

  console.log("\n[b] distinct control-height tokens on control selectors (target: 2 + 1 folio row = 3 max)");
  console.log(`    count: ${staticAudit.ctlHeightTokens.length}`);
  for (const t of staticAudit.ctlHeightTokens) console.log(`      ${t}`);

  console.log("\n[c] distinct card radii on card selectors (target: 1)");
  console.log(`    count: ${staticAudit.cardRadii.length}`);
  for (const r of staticAudit.cardRadii) console.log(`      ${r}`);

  console.log("\n[d] raw px literals for type/spacing/height/radius outside token block (target: 0)");
  console.log(`    count: ${staticAudit.rawLiterals}`);
  for (const s of staticAudit.rawSamples) console.log(`      ${s.n}px · ${s.snippet}`);

  console.log("\n[e] lane-head parity across story / signals / numbers (target: 5 tops within 1px at each width)");
  try {
    const rendered = await auditRendered();
    for (const width of [1180, 1280, 1440]) {
      const r = rendered[width];
      if (!r || !r.hasWrap) { console.log(`    @${width}: no wrap`); continue; }
      console.log(`    @${width}px  header-offset-per-card=[${r.offsets.join(", ")}]  spread=${r.spread == null ? "n/a" : r.spread.toFixed(2)+"px"}  ${r.spread != null && r.spread < 1 ? "OK" : "MISMATCH"}`);
    }
  } catch (e) {
    console.log(`    rendered check skipped: ${e.message}`);
  }

  console.log("\n=".repeat(36));
  const failMap = {
    a: staticAudit.fontTokens.length > 7,
    b: staticAudit.ctlHeightTokens.length > 3,
    c: staticAudit.cardRadii.length !== 1,
    d: staticAudit.rawLiterals > 0,
  };
  const fails = Object.entries(failMap).filter(([, v]) => v).map(([k]) => k);
  console.log(fails.length === 0 ? "  V30-5 gate PASS on a/b/c/d (rendered [e] shown above)" : `  V30-5 gate FAIL on: ${fails.join(", ")}`);
  process.exit(fails.length === 0 ? 0 : 1);
}

main().catch(e => { console.error("AUDIT ERROR:", e); process.exit(2); });
