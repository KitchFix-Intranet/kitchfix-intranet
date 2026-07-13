#!/usr/bin/env node
// =========================================================================
// PROTOTYPE — not wired into the product.
// =========================================================================
//
// Renders Kevin's candidate PDC drill redesign ("Option 4: Two-Zone Poster"
// per docs/design/sc-pdc-four-options.html, the pixel reference) against
// REAL database data so Kevin can judge the design on truth. 10 sheets:
// 5 PDC-level accounts x May + June 2026, letter portrait, one page each.
//
// Scope: throwaway design-validation harness. Read-only against the DB.
// No product files touched. Output lands in scripts/sc-print/artifacts-proto/.
//
// Data rules (embedded ruling per Kevin's brief 2026-07-13):
// - No compliance states. Per (day, service) value = actualCount if that
//   service-day has actuals; else projectedCount. Style follows source:
//   CONFIRMED (deep green #33582B, filled #E4EDDA) vs PROJECTED (sage
//   #7E9573, white + outline).
// - Exclude is_non_revenue === true (R3 stands).
// - Day total = sum of included best-available values.
// - Matrix columns = only services with >= 1 nonzero day in the month,
//   ordered by monthly volume descending. TOTAL column last. Full
//   verbatim names in header (wrap, never clip), once.
// - Games (overlay accounts only): Zone 1 navy dot top-right; Zone 2
//   GAME column with "OPP time". Plain PDCs omit the GAME column.
// - Current-week copper ring in Zone 1 ONLY when rendered month contains
//   today. May and June 2026 won't (today = 2026-07-13); logic kept.
//
// Fit protocol: auto-tighten row heights from target toward floor until
// one page holds. If a 31-day month still overflows at floors, render
// anyway and FLAG - a fit failure is a design finding.
//
// Usage:
//   TSX_TSCONFIG_PATH=./jsconfig.json npx tsx --env-file=.env.local \
//     scripts/sc-print/proto-pdc-option4.mjs

import path from "node:path";
import fs from "node:fs/promises";
import puppeteer from "puppeteer";
import {
  loadMonthData,
  loadHomestandContext,
  loadScheduleOverlay,
} from "../../src/lib/dataStore/serviceCalendar.js";
import { getAccountHomeTz, formatMilbHomeGameTime, formatMlbHomeGameTime }
  from "../../src/app/service-calendar/gameTimeFormat.js";
import { getServiceClient } from "../../src/lib/supabase.js";

const YEAR = 2026;
const OUT_DIR = path.resolve("./scripts/sc-print/artifacts-proto");
await fs.mkdir(OUT_DIR, { recursive: true });

const ACCOUNTS = [
  { key: "CIN - AZ",  overlay: false },
  { key: "TXR - AZ",  overlay: false },
  { key: "TBR - FL",  overlay: false },
  { key: "STL - FL",  overlay: true  },
  { key: "TBJ - FL",  overlay: true  },
];
const MONTHS = ["2026-05", "2026-06"];

// ── Colors + tokens (Option 4 pixel reference) ─────────────────────────
const TOK = {
  navy:    "#16305E",
  ink:     "#26262B",
  mut:     "#8A857A",
  hair:    "#E4E0D6",
  grid:    "#C9C3B5",       // polish-wave G1 darker line
  soft:    "#F6F4EF",
  wknd:    "#FAF8F3",       // weekend row tint (Zone 2)
  copper:  "#C2410C",
  confInk: "#33582B",       // CONFIRMED deep green text
  confBg:  "#E4EDDA",       // CONFIRMED fill
  projInk: "#7E9573",       // PROJECTED sage text
  projLn:  "#B9C9AE",       // PROJECTED outline
};

// Portrait letter page ≈ 792px tall × 612px wide at 96dpi.
// Fit protocol: target -> floor. Zone 2 row 22 target, 19 floor.
// Zone 1 cell 42 target, 34 floor.
function pickRowHeights(daysInMonth, weekRowsCount) {
  // Static-page chrome budget (band + titles + labels + zone1 header + zone2
  // header + footer + margins) - measured against the CSS below.
  const CHROME = 165;
  const PAGE   = 792;

  const targetR2 = 22, floorR2 = 19;
  const targetR1 = 42, floorR1 = 34;

  const compute = (r1, r2) =>
    CHROME + weekRowsCount * r1 + daysInMonth * r2;

  // Prefer target sizes; step down 1px at a time until it fits or floors.
  let r1 = targetR1, r2 = targetR2, fits;
  while (true) {
    if (compute(r1, r2) <= PAGE) { fits = true; break; }
    if (r2 > floorR2) r2 -= 1;
    else if (r1 > floorR1) r1 -= 1;
    else { fits = false; break; }
  }
  return { r1, r2, fits, projected: compute(r1, r2) };
}

// ── Date helpers ────────────────────────────────────────────────────────
const DAY_MS = 24 * 3600 * 1000;
const MON_NAMES = ["JANUARY","FEBRUARY","MARCH","APRIL","MAY","JUNE",
                   "JULY","AUGUST","SEPTEMBER","OCTOBER","NOVEMBER","DECEMBER"];
const DOW_SHORT = ["MON","TUE","WED","THU","FRI","SAT","SUN"];

function parseIso(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
}
function isoOf(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
function shift(d, days) { return new Date(d.getTime() + days * DAY_MS); }
function dowMonIndex(d) { const js = d.getUTCDay(); return js === 0 ? 6 : js - 1; }
function weekAnchor(d)  { return shift(d, -dowMonIndex(d)); }

// ── Font + seal loaders (mirror the product's grammar) ─────────────────
const FONTSOURCE_ROOT = path.join(process.cwd(), "node_modules", "@fontsource");
const FONT_MANIFEST = [
  { family: "Bebas Neue", weight: 400,
    file: path.join(FONTSOURCE_ROOT, "bebas-neue", "files", "bebas-neue-latin-400-normal.woff2") },
  { family: "Mulish", weight: 400,
    file: path.join(FONTSOURCE_ROOT, "mulish", "files", "mulish-latin-400-normal.woff2") },
  { family: "Mulish", weight: 600,
    file: path.join(FONTSOURCE_ROOT, "mulish", "files", "mulish-latin-600-normal.woff2") },
  { family: "Mulish", weight: 700,
    file: path.join(FONTSOURCE_ROOT, "mulish", "files", "mulish-latin-700-normal.woff2") },
  { family: "Mulish", weight: 800,
    file: path.join(FONTSOURCE_ROOT, "mulish", "files", "mulish-latin-800-normal.woff2") },
];
async function fontFaceBlock() {
  const parts = await Promise.all(FONT_MANIFEST.map(async ({ family, weight, file }) => {
    const b64 = (await fs.readFile(file)).toString("base64");
    return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
  }));
  return parts.join("");
}
async function sealDataUri() {
  const p = path.join(process.cwd(), "public", "PFS_PrimaryLogo_White_Circle.png");
  const b64 = (await fs.readFile(p)).toString("base64");
  return `data:image/png;base64,${b64}`;
}

// ── Data assembly per (account, month) ─────────────────────────────────
async function assembleMonth(accountKey, monthKey, overlay) {
  const monthNumber = Number(monthKey.slice(5));
  const first = `${monthKey}-01`;
  const lastDay = new Date(Date.UTC(YEAR, monthNumber, 0)).getUTCDate();
  const last = `${monthKey}-${String(lastDay).padStart(2, "0")}`;

  const md = await loadMonthData(accountKey, YEAR, monthNumber);

  // Best-available value per (day, service) + track source style.
  // Row: { serviceName, value, style: "CONFIRMED"|"PROJECTED"|null }
  const daySvcMap = new Map();      // date -> Map(serviceName -> {value, style})
  const svcMonthTotals = new Map(); // serviceName -> total across month
  const dayNoService = new Set();   // dates flagged as no-service
  for (const d of md.days || []) {
    if (d.status === "no-service") dayNoService.add(d.date);
    const bucket = new Map();
    for (const s of d.services || []) {
      if (s.isNonRevenue) continue;
      const hasA = !!s.hasActuals;
      const val  = hasA
        ? (s.actualCount != null ? Number(s.actualCount) : 0)
        : (s.projectedCount != null ? Number(s.projectedCount) : 0);
      if (!Number.isFinite(val)) continue;
      // Skip zero-value cells unless it's a no-service anchor row.
      if (val <= 0) continue;
      bucket.set(s.serviceName, { value: val, style: hasA ? "CONFIRMED" : "PROJECTED" });
      svcMonthTotals.set(s.serviceName, (svcMonthTotals.get(s.serviceName) || 0) + val);
    }
    daySvcMap.set(d.date, bucket);
  }

  // Column order = services with >=1 nonzero day; sorted by monthly
  // volume desc. TOTAL appended at render time.
  const columns = [...svcMonthTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);

  // Homestand overlay for overlay-flagged accounts (GAME rows only).
  let games = {};
  if (overlay) {
    const overlayMap = await loadScheduleOverlay(accountKey, first, last);
    for (const [date, entry] of Object.entries(overlayMap)) {
      games[date] = { opp: entry.opponent || "", gameTime: entry.gameTime };
    }
  }

  // Compute per-column max for the bar normalization + day totals + max
  // day total for Zone 2 TOTAL bar.
  const colMax = {};
  for (const svc of columns) colMax[svc] = 0;
  const dayTotals = {};    // date -> { value, style }
  const dayServiceCount = {}; // date -> count of rendered services
  let maxDayTotal = 0;
  const allDates = [];
  for (let d = 1; d <= lastDay; d++) {
    const iso = `${monthKey}-${String(d).padStart(2, "0")}`;
    allDates.push(iso);
    const bucket = daySvcMap.get(iso) || new Map();
    let dTot = 0, hasProj = false, hasConf = false, count = 0;
    for (const svc of columns) {
      const cell = bucket.get(svc);
      if (!cell) continue;
      count++;
      dTot += cell.value;
      if (cell.style === "PROJECTED") hasProj = true;
      if (cell.style === "CONFIRMED") hasConf = true;
      if (cell.value > (colMax[svc] || 0)) colMax[svc] = cell.value;
    }
    // Day total style: if ANY component projected, mark day PROJECTED
    // (mixed days are the exception; brief keeps the pattern simple).
    const dStyle = count === 0 ? null : (hasProj && !hasConf ? "PROJECTED" : hasConf && !hasProj ? "CONFIRMED" : hasProj ? "PROJECTED" : "CONFIRMED");
    dayTotals[iso] = { value: dTot, style: dStyle };
    dayServiceCount[iso] = count;
    if (dTot > maxDayTotal) maxDayTotal = dTot;
  }

  return {
    accountKey,
    monthKey,
    monthNumber,
    lastDay,
    columns,
    daySvcMap,
    svcMonthTotals,
    dayTotals,
    dayServiceCount,
    dayNoService,
    games,
    colMax,
    maxDayTotal,
    allDates,
    overlay,
  };
}

// ── Zone 1: mini calendar (weeks-containing-in-month-days only) ────────
function renderZone1(month, r1) {
  const { monthKey, monthNumber, lastDay, dayTotals, dayNoService, games, overlay } = month;
  const first = new Date(Date.UTC(YEAR, monthNumber - 1, 1, 12));
  const firstCell = weekAnchor(first);

  // Build weeks; drop trailing all-out-of-month rows (per polish wave E1).
  const rows = [];
  for (let r = 0; r < 6; r++) {
    const row = [];
    for (let c = 0; c < 7; c++) {
      const d = shift(firstCell, r * 7 + c);
      const iso = isoOf(d);
      row.push({
        iso,
        dom: d.getUTCDate(),
        outOfMonth: d.getUTCMonth() !== (monthNumber - 1) || d.getUTCFullYear() !== YEAR,
      });
    }
    rows.push(row);
  }
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.outOfMonth)) rows.pop();

  const cellFor = (c) => {
    if (c.outOfMonth) return `<div class="z1c blank"><span class="dn">${c.dom}</span></div>`;
    const dt = dayTotals[c.iso];
    const ns = dayNoService.has(c.iso);
    const gm = games[c.iso];
    const gameDot = (overlay && gm) ? `<span class="gdot"></span>` : "";
    if (ns) {
      return `<div class="z1c ns"><span class="dn">${c.dom}</span><span class="nslabel">·</span>${gameDot}</div>`;
    }
    if (!dt || dt.value === 0) {
      return `<div class="z1c empty"><span class="dn">${c.dom}</span>${gameDot}</div>`;
    }
    const cls = dt.style === "PROJECTED" ? "z1c proj" : "z1c conf";
    return `<div class="${cls}"><span class="dn">${c.dom}</span><span class="hero">${dt.value}</span>${gameDot}</div>`;
  };

  const rowsHtml = rows.map((row) =>
    `<div class="z1row">${row.map(cellFor).join("")}</div>`
  ).join("");

  const header = `<div class="z1row z1hdr">${DOW_SHORT.map((d) => `<div class="z1hcell">${d}</div>`).join("")}</div>`;

  return `<div class="zone-label">THE MONTH — DAILY TOTALS</div>
  <div class="z1 grid" style="--r1:${r1}px;">${header}${rowsHtml}</div>`;
}

// ── Zone 2: bar matrix (day rows) ──────────────────────────────────────
function renderZone2(month, r2, tzAbbrev) {
  const {
    monthKey, monthNumber, lastDay, columns, daySvcMap, dayTotals,
    dayNoService, games, colMax, maxDayTotal, allDates, overlay, svcMonthTotals,
  } = month;

  const showGame = !!overlay;
  const headerCells = [
    `<div class="z2hd day">DAY</div>`,
    ...columns.map((svc) => `<div class="z2hd svc"><span>${escHtml(svc)}</span></div>`),
    ...(showGame ? [`<div class="z2hd game">GAME</div>`] : []),
    `<div class="z2hd total">TOTAL</div>`,
  ].join("");

  const rowsHtml = allDates.map((iso) => {
    const d = parseIso(iso);
    const dowIdx = dowMonIndex(d);
    const dow = DOW_SHORT[dowIdx];
    const isMon = dowIdx === 0;
    const isWkend = dowIdx >= 5;
    const rowClasses = ["z2row"];
    if (isMon) rowClasses.push("mon");
    if (isWkend) rowClasses.push("wknd");
    if (dayNoService.has(iso)) rowClasses.push("ns");

    const bucket = daySvcMap.get(iso) || new Map();
    const svcCellsHtml = columns.map((svc) => {
      const cell = bucket.get(svc);
      if (!cell) return `<div class="z2c empty"></div>`;
      const pct = colMax[svc] > 0 ? Math.max(2, Math.round((cell.value / colMax[svc]) * 100)) : 0;
      const cls = cell.style === "PROJECTED" ? "z2c proj" : "z2c conf";
      return `<div class="${cls}"><span class="bar" style="width:${pct}%;"></span><span class="num">${cell.value}</span></div>`;
    }).join("");

    let gameHtml = "";
    if (showGame) {
      const gm = games[iso];
      if (gm && gm.opp) {
        const time = gm.gameTime ? formatOverlayGameTime(gm.gameTime, month.accountKey) : "";
        gameHtml = `<div class="z2c gm"><span>${escHtml(gm.opp)}${time ? " " + escHtml(time) : ""}</span></div>`;
      } else {
        gameHtml = `<div class="z2c gm"></div>`;
      }
    }

    const dt = dayTotals[iso];
    const totalPct = dt && maxDayTotal > 0 ? Math.max(2, Math.round((dt.value / maxDayTotal) * 100)) : 0;
    let totalHtml;
    if (!dt || dt.value === 0) {
      totalHtml = `<div class="z2c total empty"></div>`;
    } else {
      const cls = dt.style === "PROJECTED" ? "z2c total proj" : "z2c total conf";
      totalHtml = `<div class="${cls}"><span class="bar" style="width:${totalPct}%;"></span><span class="num">${dt.value}</span></div>`;
    }

    return `<div class="${rowClasses.join(" ")}">
      <div class="z2dc"><span class="dow">${dow}</span><span class="dm">${d.getUTCDate()}</span></div>
      ${svcCellsHtml}
      ${gameHtml}
      ${totalHtml}
    </div>`;
  }).join("");

  // Grid template: fixed DAY block + N service cols + optional GAME + TOTAL.
  const svcColsTemplate = columns.map(() => "minmax(0, 1fr)").join(" ");
  const gameCol = showGame ? " 84px" : "";
  const gridTemplate = `52px ${svcColsTemplate}${gameCol} 68px`;

  return `<div class="zone-label">FULL MONTH — DETAIL</div>
  <div class="z2 matrix" style="--r2:${r2}px; --grid-cols:${gridTemplate};">
    <div class="z2row hdr">${headerCells}</div>
    ${rowsHtml}
  </div>`;
}

function formatOverlayGameTime(gameTime, accountKey) {
  if (!gameTime) return "";
  const tz = getAccountHomeTz(accountKey);
  if (tz) return formatMlbHomeGameTime(gameTime, accountKey) || "";
  return formatMilbHomeGameTime(gameTime) || "";
}

function escHtml(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// ── Full HTML template ─────────────────────────────────────────────────
async function renderSheetHtml(month) {
  const font = await fontFaceBlock();
  const seal = await sealDataUri();

  // Weeks-containing-in-month for Zone 1 (post-E1 fit).
  const first = new Date(Date.UTC(YEAR, month.monthNumber - 1, 1, 12));
  const firstCell = weekAnchor(first);
  let weekRowsCount = 0;
  for (let r = 0; r < 6; r++) {
    let anyIn = false;
    for (let c = 0; c < 7; c++) {
      const d = shift(firstCell, r * 7 + c);
      if (d.getUTCMonth() === (month.monthNumber - 1) && d.getUTCFullYear() === YEAR) anyIn = true;
    }
    if (anyIn) weekRowsCount++;
  }

  const { r1, r2, fits, projected } = pickRowHeights(month.lastDay, weekRowsCount);

  // Account name for band.
  const supa = getServiceClient();
  const acctRes = await supa.from("accounts").select("name").eq("team_key", month.accountKey).maybeSingle();
  const acctName = acctRes.data?.name || month.accountKey;

  const bandRight = `${escHtml(acctName)} · ${escHtml(month.accountKey)}`;
  const monthName = MON_NAMES[month.monthNumber - 1];
  const asOf = new Date();
  const asOfStr = `${asOf.getDate()} ${["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"][asOf.getMonth()]} ${asOf.getFullYear()}`;
  const tz = getAccountHomeTz(month.accountKey)?.abbrev || "ET";

  const zone1 = renderZone1(month, r1);
  const zone2 = renderZone2(month, r2, tz);

  return { html: `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Option 4 proto - ${escHtml(month.accountKey)} ${monthName} ${YEAR}</title>
<style>
${font}
@page{size:letter portrait;margin:0;}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{
  font-family:'Mulish',sans-serif;color:${TOK.ink};background:#fff;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
  font-variant-numeric:tabular-nums;
}
.sheet{background:#fff;}
.band{background:${TOK.navy};color:#fff;display:flex;align-items:center;padding:8px 40px;gap:12px;}
.band .seal{width:24px;height:24px;display:block;}
.band .bk{font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.09em;}
.band .ba{font-size:8.5px;font-weight:800;letter-spacing:.13em;text-transform:uppercase;opacity:.94;margin-left:auto;}
.pad{padding:0 40px 12px;}
.trow{display:flex;align-items:baseline;gap:12px;margin:14px 0 8px;}
.mo{font-family:'Bebas Neue',sans-serif;font-size:38px;line-height:.9;color:${TOK.ink};}
.yr{font-family:'Bebas Neue',sans-serif;font-size:38px;line-height:.9;color:#D8D4CA;margin-left:auto;}
.zone-label{font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:.13em;color:${TOK.mut};margin:8px 0 4px;padding-bottom:2px;border-bottom:1px solid ${TOK.ink};}
/* ── Zone 1: mini month grid ────────────────────────────────────── */
.z1{display:flex;flex-direction:column;gap:2px;}
.z1row{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;}
.z1row.z1hdr{margin-bottom:1px;}
.z1hcell{font-size:6px;font-weight:800;letter-spacing:.1em;color:${TOK.mut};text-align:left;padding:0 0 1px 4px;}
.z1c{height:var(--r1);border-radius:3px;background:${TOK.soft};border:1px solid ${TOK.grid};position:relative;padding:3px 5px;}
.z1c .dn{font-size:7px;font-weight:800;color:${TOK.mut};}
.z1c .hero{position:absolute;left:0;right:0;top:50%;transform:translateY(-40%);text-align:center;font-size:15px;font-weight:800;line-height:1;}
.z1c.conf{background:${TOK.confBg};border-color:#B9C9AE;}
.z1c.conf .hero{color:${TOK.confInk};}
.z1c.proj{background:#fff;border:1px solid ${TOK.projLn};}
.z1c.proj .hero{color:${TOK.projInk};}
.z1c.ns{background:${TOK.soft};border-color:${TOK.grid};}
.z1c.ns .nslabel{position:absolute;left:0;right:0;top:50%;transform:translateY(-40%);text-align:center;color:${TOK.mut};font-size:12px;}
.z1c.empty{background:#fff;}
.z1c.blank{background:#FCFBF8;border-color:#F0EBDF;}
.z1c.blank .dn{color:#D8D4CA;}
.z1c .gdot{position:absolute;top:3px;right:4px;width:4px;height:4px;border-radius:50%;background:${TOK.navy};}
/* ── Zone 2: bar matrix ─────────────────────────────────────────── */
.z2{display:flex;flex-direction:column;}
.z2row{display:grid;grid-template-columns:var(--grid-cols);align-items:center;column-gap:3px;}
.z2row.hdr{padding:0 0 2px 0;border-bottom:1px solid ${TOK.ink};}
.z2hd{font-size:6.5px;font-weight:800;letter-spacing:.1em;color:${TOK.mut};padding:0 3px;overflow:hidden;}
.z2hd.svc{white-space:normal;line-height:1.05;overflow-wrap:anywhere;}
.z2hd.svc span{display:inline-block;}
.z2hd.day{color:${TOK.mut};}
.z2hd.total{text-align:right;color:${TOK.ink};}
.z2hd.game{text-align:left;}
.z2row:not(.hdr){height:var(--r2);border-bottom:1px solid ${TOK.hair};}
.z2row.mon{border-top:2.5px solid ${TOK.ink};}
.z2row.wknd{background:${TOK.wknd};}
.z2dc{display:flex;flex-direction:column;padding:0 4px 0 0;line-height:1;}
.z2dc .dow{font-size:5.5px;font-weight:800;letter-spacing:.09em;color:${TOK.mut};}
.z2dc .dm{font-size:10px;font-weight:800;color:${TOK.ink};}
.z2c{position:relative;height:100%;display:flex;align-items:center;justify-content:flex-end;padding:0 4px;overflow:hidden;}
.z2c.empty{opacity:.3;}
.z2c .bar{position:absolute;left:2px;top:2px;bottom:2px;height:auto;border-radius:2px;}
.z2c .num{position:relative;font-size:8px;font-weight:700;line-height:1;z-index:1;}
.z2c.conf .bar{background:${TOK.confBg};}
.z2c.conf .num{color:${TOK.confInk};}
.z2c.proj .bar{background:#fff;border:1px solid ${TOK.projLn};}
.z2c.proj .num{color:${TOK.projInk};font-weight:700;}
.z2c.total{border-left:2px solid ${TOK.ink};padding-left:6px;}
.z2c.gm{padding:0 4px;font-size:7px;font-weight:800;color:${TOK.navy};letter-spacing:.02em;text-align:left;}
.z2c.gm span{display:inline;line-height:1.1;}
.z2row.ns{opacity:.75;}
.z2row.ns .z2c:not(.total):not(.gm){background:${TOK.soft};}
/* ── Footer ────────────────────────────────────────────────────── */
.ft{display:flex;justify-content:space-between;align-items:flex-start;margin-top:8px;font-size:7px;color:${TOK.mut};font-weight:700;letter-spacing:.05em;gap:10px;}
.ft .k{display:flex;gap:12px;align-items:center;flex-wrap:wrap;}
.ft .swatch{display:inline-block;vertical-align:-1px;width:8px;height:8px;border-radius:2px;margin-right:3px;}
.ft .swatch.conf{background:${TOK.confBg};border:1px solid #B9C9AE;}
.ft .swatch.proj{background:#fff;border:1px solid ${TOK.projLn};}
.ft .asof{color:${TOK.ink};font-weight:800;}
.fitflag{color:${TOK.copper};font-weight:800;}
</style>
</head>
<body>
<div class="sheet">
  <div class="band"><img class="seal" src="${seal}" alt="" /><span class="bk">KITCHFIX</span><span class="ba">${bandRight}</span></div>
  <div class="pad">
    <div class="trow">
      <span class="mo">${monthName}</span>
      <span class="yr">${YEAR}</span>
    </div>
    ${zone1}
    ${zone2}
    <div class="ft">
      <span class="k">
        <span><span class="swatch conf"></span>CONFIRMED = deep green, filled</span>
        <span><span class="swatch proj"></span>PROJECTED = sage, outlined</span>
        ${!fits ? `<span class="fitflag">FIT: projected ${projected}px > 792px @ floors</span>` : ""}
      </span>
      <span><span class="asof">KITCHFIX · ${asOfStr}</span></span>
    </div>
  </div>
</div>
</body>
</html>`, r1, r2, fits, projected };
}

// ── Main loop ──────────────────────────────────────────────────────────
const browser = await puppeteer.launch({ headless: true });

const results = [];
for (const acct of ACCOUNTS) {
  for (const monthKey of MONTHS) {
    const slug = `${acct.key.replaceAll(" ", "").replaceAll("-", "-")}_${monthKey}`;
    process.stdout.write(`── ${acct.key} · ${monthKey} ${acct.overlay ? "(overlay)" : "(plain)"} ─────\n`);
    const month = await assembleMonth(acct.key, monthKey, acct.overlay);
    const { html, r1, r2, fits, projected } = await renderSheetHtml(month);

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdf = await page.pdf({
      format: "letter",
      landscape: false,
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    });
    await page.close();
    const outPath = path.join(OUT_DIR, `${slug}.pdf`);
    await fs.writeFile(outPath, pdf);
    process.stdout.write(`  ${pdf.length} bytes · Zone1=${r1}px · Zone2=${r2}px · fits=${fits} · projected=${projected}px · columns=${month.columns.length}\n`);
    results.push({ slug, r1, r2, fits, projected, columns: month.columns.length, colNames: month.columns, maxDayTotal: month.maxDayTotal });
  }
}

await browser.close();

process.stdout.write(`\n${results.length} PDFs written to ${OUT_DIR}.\n`);
process.stdout.write(`Sizing summary:\n`);
for (const r of results) {
  process.stdout.write(`  ${r.slug.padEnd(24)} Z1=${r.r1} Z2=${r.r2} fits=${r.fits} proj=${r.projected}px cols=${r.columns} maxTot=${r.maxDayTotal}\n`);
}
