// Print assets - fonts + seal + shared CSS + shared day-state helper.
// Loaded once per cold start and reused across every PDF the process
// renders.
//
// #422 (Wave 3, 2026-07-13): rewritten to the SC_PRINT_SPEC_v2 grammar.
// v1's simpler service/game grammar is superseded. Cell-state names and
// hex tokens verbatim from docs/design/SC_PRINT_SPEC_v2.html; that spec
// is the pixel authority (v1 kept in docs/design/SC_PRINT_SPEC_v1.html
// for history only).
//
// State model, single vocabulary across every service-bearing sheet:
//   SERVED       - actuals row exists for the date (never keyed on
//                  date-is-past). Fill --svc.
//   PROJECTED    - no actuals + projection exists / date upcoming.
//                  Fill --proj + 1.5px inset --projline border.
//   NO ACTUALS   - service was expected, date is past account-local,
//                  no actuals row. Fill --nd, day number + micro
//                  "NO ACTUALS" label in --ndink. THIS IS THE
//                  COMPLIANCE SIGNAL.
//   NO SERVICE   - soft --soft fill + micro "NO SERVICE" label.
//                  One name everywhere; "OFF" is retired.

import fs from "node:fs";
import path from "node:path";

// ── Font loader ──────────────────────────────────────────────────────

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

let cachedFontFaceBlock = null;
function fontFaceBlock() {
  if (cachedFontFaceBlock !== null) return cachedFontFaceBlock;
  const rules = FONT_MANIFEST.map(({ family, weight, file }) => {
    const b64 = fs.readFileSync(file).toString("base64");
    return `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2');}`;
  }).join("");
  cachedFontFaceBlock = rules;
  return rules;
}

// ── Seal loader ──────────────────────────────────────────────────────
let cachedSealDataUri = null;
function sealDataUri() {
  if (cachedSealDataUri !== null) return cachedSealDataUri;
  const p = path.join(process.cwd(), "public", "PFS_PrimaryLogo_White_Circle.png");
  const b64 = fs.readFileSync(p).toString("base64");
  cachedSealDataUri = `data:image/png;base64,${b64}`;
  return cachedSealDataUri;
}

// ── Shared CSS ───────────────────────────────────────────────────────
// Verbatim class grammar from SC_PRINT_SPEC_v2.html plus @page geometry.
// The spec's browser-preview scaffolding (body background CFCBC2, sheet
// max-width, box-shadow) is dropped - PDF renders straight to the page.
//
// #422 print-tuned green pair: --svc (#D3E2C8) + --proj (#EBF3E4) +
// --projline (#A8C796). These diverge INTENTIONALLY from the app's
// on-screen --status-entered-bg (#7DC78B). The screen green survives
// backlit rendering but blows out under grayscale laser and kills the
// day-number contrast on paper. Do NOT sweep these to the screen
// tokens - the divergence is print-survival.

function sheetCss({ orientation = "landscape" } = {}) {
  return `
${fontFaceBlock()}
@page{size:letter ${orientation};margin:0;}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{
  font-family:'Mulish',sans-serif;color:#26262B;background:#ffffff;
  -webkit-print-color-adjust:exact;print-color-adjust:exact;
}
:root{
  --navy:#16305E; --ink:#26262B; --mut:#8A857A; --hair:#E4E0D6;
  --soft:#F6F4EF; --copper:#C2410C; --copl:#F3B48C;
  --homefill:#DCE5F3; --awayfill:#EFEDE6;
  /* #422 print-tuned green pair. Do NOT sweep to --status-entered-bg
     screen token - divergence is print-survival (paler for paper). */
  --svc:#D3E2C8; --proj:#EBF3E4; --projline:#A8C796;
  --mlsv:#33582B; --mlsv2:#5F7A55; --mlpj:#7E9573; --mlpj2:#9DB292;
  --nd:#FBF1EA; --ndink:#B45327;
}
.sheet{background:#fff;}
.pad{padding:0 40px 22px;}
.band{background:var(--navy);color:#fff;display:flex;align-items:center;padding:10px 40px;gap:13px;}
.band .seal{width:30px;height:30px;display:block;}
.band .bk{font-family:'Bebas Neue',sans-serif;font-size:18px;letter-spacing:.09em;}
.band .ba{font-size:9px;font-weight:800;letter-spacing:.15em;text-transform:uppercase;opacity:.92;margin-left:auto;}
.trow{display:flex;align-items:baseline;gap:12px;margin:22px 0 14px;}
.mo{font-family:'Bebas Neue',sans-serif;font-size:48px;line-height:.9;}
.yr{font-family:'Bebas Neue',sans-serif;font-size:48px;line-height:.9;color:#D8D4CA;margin-left:auto;}
.ptag{font-size:8.5px;font-weight:800;letter-spacing:.13em;color:var(--navy);border:1.5px solid var(--navy);border-radius:3px;padding:3px 7px;position:relative;top:-5px;}
.schip{font-size:8.5px;font-weight:800;letter-spacing:.13em;color:var(--copper);border:1.5px solid var(--copper);border-radius:3px;padding:3px 7px;position:relative;top:-5px;}
/* ── Month / Period calendar (Drill sheets 5-8) ───────────────── */
table.cal{width:100%;border-collapse:collapse;table-layout:fixed;}
.cal th{font-size:8.5px;font-weight:800;letter-spacing:.13em;color:var(--mut);text-align:left;padding:0 0 5px 8px;border-bottom:1.5px solid var(--ink);}
.cal td{height:84px;border-bottom:1px solid var(--hair);border-right:1px solid var(--hair);vertical-align:top;padding:6px 8px;position:relative;font-variant-numeric:tabular-nums;background:#fff;}
.cal td:last-child{border-right:none;}
.cal tr:last-child td{border-bottom:1.5px solid var(--ink);}
.cal td.hm{background:var(--homefill);}
.cal td.aw{background:var(--awayfill);}
.cal td.sv{background:var(--svc);}
.cal td.pj{background:var(--proj);box-shadow:inset 0 0 0 1.5px var(--projline);}
.cal td.ns{background:var(--soft);}
.cal td.nd{background:var(--nd);}
.d{font-size:12px;font-weight:700;}
.blank{background:#FCFBF8 !important;} .blank .d{color:#D8D4CA;font-weight:600;}
.ns .d{color:var(--mut);}
.nd .d{color:var(--ndink);}
.nst{position:absolute;bottom:7px;left:8px;font-size:6.5px;font-weight:800;letter-spacing:.13em;color:#B7B2A5;}
.ndt{position:absolute;bottom:7px;left:8px;font-size:6.5px;font-weight:800;letter-spacing:.13em;color:var(--ndink);}
.opp{position:absolute;bottom:17px;left:8px;font-size:10.5px;font-weight:800;letter-spacing:.04em;color:var(--navy);}
.tm{position:absolute;bottom:6px;left:8px;font-size:8.5px;font-weight:700;color:#5A6B8C;}
.tm.day{color:var(--copper);font-weight:800;}
/* Meal stack (PDC drill only). Right-aligned; one line per service
   offered that day (B/L etc), hairline rule under the last service,
   bold total below. .mls = SERVED tone; .mls.pj = PROJECTED tone. */
.mls{position:absolute;top:17px;right:8px;text-align:right;line-height:1.45;}
.mls i{display:block;font-style:normal;font-size:7.5px;font-weight:700;color:var(--mlsv2);}
.mls b{display:block;font-size:10px;font-weight:800;color:var(--mlsv);margin-top:2px;border-top:1px solid #B9C9AE;padding-top:2px;}
.mls.pj i{color:var(--mlpj2);}
.mls.pj b{color:var(--mlpj);border-top-color:#CCD9C2;}
/* ── Season mini-grid (sheets 1-3) ─────────────────────────────── */
.smos{display:grid;grid-template-columns:repeat(3,1fr);gap:0 24px;}
.smo h4{font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.06em;margin:10px 0 6px;border-bottom:1.5px solid var(--ink);padding-bottom:4px;display:flex;justify-content:space-between;align-items:baseline;}
.smo h4 s{text-decoration:none;font-family:'Mulish',sans-serif;font-size:7px;font-weight:800;letter-spacing:.07em;color:var(--mut);}
.sg{display:grid;grid-template-columns:repeat(7,1fr);gap:2.5px;}
.sg b{font-size:6px;font-weight:800;letter-spacing:.08em;color:var(--mut);text-align:center;padding-bottom:2px;}
.sg span{height:32px;border-radius:3px;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.12;font-variant-numeric:tabular-nums;position:relative;padding-top:4px;}
/* Day number tag (top-left) inside a season cell. */
.sg span u{position:absolute;top:2px;left:3.5px;font-size:5.5px;font-weight:800;text-decoration:none;color:#B0AB9F;}
.sg .h{background:var(--navy);color:#fff;}
.sg .h u{color:rgba(255,255,255,.7);}
.sg .h em{font-style:normal;font-size:7.5px;font-weight:800;}
.sg .h i{font-style:normal;font-size:6.5px;font-weight:600;opacity:.88;}
.sg .h i.day{color:var(--copl);opacity:1;font-weight:800;}
.sg .a{background:var(--awayfill);}
.sg .a em{font-style:normal;font-size:7px;font-weight:700;color:#8A857A;}
.sg .s{background:var(--svc);}
.sg .s u{color:#7E9573;}
.sg .o{background:var(--soft);}
.sg .x{background:#FCFBF8;}
.seasend{font-size:7px;font-weight:800;letter-spacing:.1em;color:var(--mut);text-align:right;margin-top:5px;}
/* ── Ops Calendar mini-grid (sheet 4 - all accounts) ──────────── */
.ymos{display:grid;grid-template-columns:repeat(3,1fr);gap:12px 18px;}
.ymo h5{font-family:'Bebas Neue',sans-serif;font-size:12.5px;letter-spacing:.07em;margin:0 0 4px;border-bottom:1px solid var(--ink);padding-bottom:3px;}
.yg{display:grid;grid-template-columns:repeat(7,1fr);gap:1.5px;}
.yg b{font-size:5.5px;font-weight:800;color:var(--mut);text-align:center;padding-bottom:1.5px;}
.yg b.hd{color:#fff;background:var(--ink);border-radius:2px;padding:1px 0;}
.yg span{height:16px;border-radius:2.5px;display:flex;align-items:center;justify-content:center;font-size:6px;font-weight:700;color:#9B968A;background:var(--soft);border:1px solid var(--soft);font-variant-numeric:tabular-nums;position:relative;}
.yg .x{background:#FCFBF8;border-color:#FCFBF8;}
.yg .sv{background:var(--svc);border-color:var(--svc);color:#5F7A55;}
.yg .pj{background:var(--proj);border:1px solid var(--projline);color:#7E9573;}
.yg .nd{background:#fff;border:1.5px dashed var(--copper);color:var(--ndink);}
.yg .spb::after{content:"";position:absolute;top:0;left:0;right:0;height:2.5px;background:var(--copper);border-radius:2px 2px 0 0;}
.yg .ps{background:var(--navy);border:1px solid var(--navy);color:#fff;font-weight:800;font-size:7px;border-radius:2.5px;}
/* .yg .inv - inventory-due ring, DEFERRED per Kevin's Option A ruling.
   period_data lives in Sheets HUB (not PG); wiring the copper ring
   waits for the period_data -> PG migration. No legend entry for it
   either (legend matches reality). */
/* ── Footer + legend ──────────────────────────────────────────── */
.ft{display:flex;justify-content:space-between;align-items:flex-start;margin-top:12px;font-size:8px;color:var(--mut);font-weight:700;letter-spacing:.05em;gap:10px;}
.ft .k{display:flex;gap:12px;align-items:center;flex-wrap:wrap;}
.asof{color:var(--ink);font-weight:800;}
.kk{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:-1px;}
.km{display:inline-block;background:var(--ink);color:#fff;border-radius:2px;font-size:6px;font-weight:800;padding:1px 3px;margin-right:4px;}
.kct{color:var(--copper);font-weight:800;}
`;
}

// ── HTML utilities ───────────────────────────────────────────────────
export function esc(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

export function sheetHead({ title, orientation = "landscape" } = {}) {
  return `<meta charset="utf-8" />
<title>${esc(title || "KitchFix schedule")}</title>
<style>${sheetCss({ orientation })}</style>`;
}

export function loadSealDataUri() {
  return sealDataUri();
}

// Uppercase-safe ASCII date "12 JUL 2026" for footer + as-of lines.
export function footerDate(d = new Date()) {
  const MON = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}

// ── #422 day-state resolver ──────────────────────────────────────────
// The single mapping from classifier day.status (+ isPast fallback) to
// the v2 print cell state. Used by every service-bearing sheet so the
// state name in the code IS the state name in the spec.
//
// Inputs:
//   day       - the loadMonthData / loadYearSummary day row
//               (has: status, hasActuals, hasProjection, date)
//   opts      - { today: 'YYYY-MM-DD', accountHasSchedule?: boolean }
//
// Returns one of "SERVED" | "PROJECTED" | "NO_ACTUALS" | "NO_SERVICE"
// | null (null = don't apply a state - the caller decides fallback,
// used for out-of-month cells).
//
// Collapses the classifier's amber-vs-red (needs-entry vs overdue)
// into ONE compliance signal per Kevin's ruling 2026-07-13. The print
// doesn't split the two - both surface as NO ACTUALS.
export function resolveDayState(day, opts = {}) {
  if (!day) return null;
  const s = day.status;
  if (s === "entered")     return "SERVED";
  if (s === "no-service")  return "NO_SERVICE";
  if (s === "overdue" || s === "needs-entry") return "NO_ACTUALS";
  // "upcoming" or projection-only future days classify as PROJECTED
  // when a projection exists (hasProjection). Days with no projection
  // AND no actuals fall through to null (renderer picks the default,
  // typically white).
  if (day.hasProjection && !day.hasActuals) return "PROJECTED";
  return null;
}

// Season-scale collapse: served OR projected -> single .s (green) cell.
// The season mini-grid is dense enough that the projected-inset border
// reads as noise; the spec Sheet 3 shows one green for both. Per-day
// discrimination survives on the Month / Period / Ops Calendar surfaces.
export function seasonServiceState(day, opts = {}) {
  const st = resolveDayState(day, opts);
  if (st === "SERVED" || st === "PROJECTED") return "SERVICE";
  if (st === "NO_ACTUALS") return "NO_ACTUALS";
  if (st === "NO_SERVICE") return "NO_SERVICE";
  return null;
}
