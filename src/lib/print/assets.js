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
  /* G1 (2026-07-13, polish wave): darker print-only grid-line token,
     ~2 shades below --hair. Applied to inter-cell borders + mini-grid
     definition wherever days need to read as separated on paper.
     Screen tokens untouched - same print-divergence doctrine as the
     green pair below (print-survival, not on-screen legibility). */
  --grid:#C9C3B5;
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
/* Polish-wave compact title for portrait overview sheets (ops calendar,
   season MLB/AAA). Halves the title bar so 12 mini-months + 6-cell-row
   months fit one letter portrait page. */
.trow.compact{margin:10px 0 8px;}
.trow.compact .mo,.trow.compact .yr{font-size:32px;}
.ptag{font-size:8.5px;font-weight:800;letter-spacing:.13em;color:var(--navy);border:1.5px solid var(--navy);border-radius:3px;padding:3px 7px;position:relative;top:-5px;}
.schip{font-size:8.5px;font-weight:800;letter-spacing:.13em;color:var(--copper);border:1.5px solid var(--copper);border-radius:3px;padding:3px 7px;position:relative;top:-5px;}
/* ── Month / Period calendar (Drill sheets 5-8) ───────────────── */
table.cal{width:100%;border-collapse:collapse;table-layout:fixed;}
.cal th{font-size:8.5px;font-weight:800;letter-spacing:.13em;color:var(--mut);text-align:left;padding:0 0 5px 8px;border-bottom:1.5px solid var(--ink);}
.cal td{height:108px;border-bottom:1px solid var(--grid);border-right:1px solid var(--grid);vertical-align:top;padding:6px 8px;position:relative;font-variant-numeric:tabular-nums;background:#fff;}
/* D1 (2026-07-13, polish wave): variant-specific cell heights so every
   drill sheet fits letter landscape at both 5- and 6-row months. MLB
   has no stacks so cells go shortest; AAA needs headroom for the
   AAA-shape meal stack; PDC + PDCO use a slightly-shorter 100px cell
   ONLY as a page-fit accommodation (Kevin's brief scopes PDC + PDCO
   drill styling out of this wave pending design-side redesign - the
   height change is not a restyle, just enough to keep 6-row months
   like Mar / Aug / Nov 2026 on one page). */
.cal.mlb td{height:78px;}
.cal.aaa td{height:88px;}
.cal.pdc td,.cal.pdco td{height:100px;}
/* .msl reservation for stack variants scales with the smaller cells:
   at 100px cell, .hm reserves 26px and .aw reserves 18px to keep the
   game info anchored at the bottom without crowding the stack. */
.cal.pdc .hm .msl,.cal.pdco .hm .msl{bottom:26px;}
.cal.pdc .aw .msl,.cal.pdco .aw .msl{bottom:18px;}
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
/* Away opponent label - spec Sheet 5 grammar, greyed and with @OPP
   format. Do NOT reuse .opp (navy) for away cells - the greyscale
   contrast between home navy and away grey is the load-bearing
   home/away signal on paper. */
.awy{position:absolute;bottom:7px;left:8px;font-size:9.5px;font-weight:700;letter-spacing:.04em;color:#A9A499;}
.tm{position:absolute;bottom:6px;left:8px;font-size:8.5px;font-weight:700;color:#5A6B8C;}
.tm.day{color:var(--copper);font-weight:800;}
/* Meal stack (PDC + PDCO + AAA drill). Grammar per
   docs/design/SC_PRINT_MEALSTACK_ADDENDUM.html:
   - Full-cell-width flex rows: <n>service name</n> left, <v>count</v> right.
   - service_name printed verbatim (case preserved - "Pre-game" ne
     "Pre-Game"; census I.3 collision case).
   - Long names wrap to two lines, never clip.
   - Hairline rule + bold Total row (same name-left/value-right shape).
   - Included services = every row with a non-zero count for the state's
     key (actualCount SERVED, projectedCount PROJECTED) AND is_non_revenue
     = false. No name-based exclusions - the pre-corrective wave name
     regex is retired (R3, 2026-07-13).
   - .msl = SERVED tone; .msl.pj = PROJECTED tone.
   - When the month's densest day pushes past the 7px comfort ceiling
     the loader adds .dense to the table root and steps to 6.5px + a
     console.warn identifies the month (R4 6.5px floor).
   Rebuild replaces the pre-corrective single-letter shortLabel() grammar
   which collided on real data - Continental Plus/Coffee Service both
   mapped to C on CIN - AZ; Arrival/Post BP/Post-Game all mapped to
   ambiguous single-letter labels on MLB accounts. */
/* .msl uses absolute positioning so it can safely coexist with the
   absolute-positioned .opp / .tm / .awy game-info spans on AAA / PDCO
   game + away cells (R4). On plain state cells the bottom:6px reservation
   is a no-op; on .hm / .aw cells the .hm .msl / .aw .msl overrides push
   bottom up to leave room for the game-info spans. Content that exceeds
   the reserved area clips instead of overflowing into game info; the
   .dense variant + 6.5px floor is the density mitigation. */
.msl{position:absolute;top:22px;left:8px;right:8px;bottom:6px;overflow:hidden;}
.msl .r{display:flex;justify-content:space-between;align-items:baseline;gap:6px;font-size:7px;font-weight:700;line-height:1.32;color:var(--mlsv);}
.msl .r n{font-style:normal;text-align:left;overflow-wrap:anywhere;}
.msl .r v{font-style:normal;font-variant-numeric:tabular-nums;flex:none;}
.msl .t{display:flex;justify-content:space-between;font-size:8.5px;font-weight:800;color:var(--mlsv);border-top:1px solid #B9C9AE;margin-top:2px;padding-top:2px;}
.msl.pj .r,.msl.pj .t{color:var(--mlpj);}
.msl.pj .t{border-top-color:#CCD9C2;}
/* On home game cells .opp (bottom:17px, 10.5px) + .tm (bottom:6px, 8.5px)
   claim ~27px of bottom room; reserve 30px for safe clearance. On away
   cells .awy (bottom:7px, 9.5px) claims ~17px; reserve 20px. */
.hm .msl{bottom:30px;}
.aw .msl{bottom:20px;}
/* Dense months: step to 6.5px line size when max rendered services on
   any single day exceed the 7px ceiling. Loader sets .dense on the
   table root + emits a console.warn identifying the month. */
.cal.dense .msl .r{font-size:6.5px;line-height:1.28;}
.cal.dense .msl .t{font-size:7.5px;}
/* ── Season mini-grid (sheets 1-3) ─────────────────────────────── */
.smos{display:grid;grid-template-columns:repeat(3,1fr);gap:0 24px;}
/* M1 (2026-07-13, polish wave): season MLB/AAA renders portrait with
   a 3-column month-block grid so the full schedule (up to 7 months
   for AAA) fits one letter portrait page with square tiles. 2-column
   overflowed - cells at that width were too tall to hold 3-4 rows of
   month blocks. The overlay variant (STL - FL, TBJ - FL SERVICE
   CALENDAR) also flips to portrait 3-col via the same class
   (landscape with square tiles overflowed to 2 pages). */
.smos.p2{grid-template-columns:repeat(3,1fr);gap:10px 18px;}
.smo h4{font-family:'Bebas Neue',sans-serif;font-size:16px;letter-spacing:.06em;margin:10px 0 6px;border-bottom:1.5px solid var(--ink);padding-bottom:4px;display:flex;justify-content:space-between;align-items:baseline;}
.smo h4 s{text-decoration:none;font-family:'Mulish',sans-serif;font-size:7px;font-weight:800;letter-spacing:.07em;color:var(--mut);}
.sg{display:grid;grid-template-columns:repeat(7,1fr);gap:2.5px;}
.sg b{font-size:6px;font-weight:800;letter-spacing:.08em;color:var(--mut);text-align:center;padding-bottom:2px;}
/* S3 (2026-07-13, polish wave): square tiles - aspect-ratio 1/1 - so
   the season mini-grid reads as a real weekly calendar instead of
   squat rectangles. Cells auto-size from column width. */
.sg span{aspect-ratio:1/1;border-radius:3px;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.12;font-variant-numeric:tabular-nums;position:relative;padding-top:4px;}
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
/* 4-col × 3-row layout so 12 mini-months + 6-cell-row months hold one
   letter portrait page with square tiles. 3-col × 4-row overflowed by
   ~17px per iteration; 4-col compresses column width to ~120px so
   square cells land at ~15px and the whole year fits comfortably. */
.ymos{display:grid;grid-template-columns:repeat(4,1fr);gap:10px 12px;}
.ymo h5{font-family:'Bebas Neue',sans-serif;font-size:11px;letter-spacing:.07em;margin:0 0 3px;border-bottom:1px solid var(--ink);padding-bottom:2px;}
.yg{display:grid;grid-template-columns:repeat(7,1fr);gap:1.5px;}
.yg b{font-size:5.5px;font-weight:800;color:var(--mut);text-align:center;padding-bottom:1px;}
.yg b.hd{color:#fff;background:var(--ink);border-radius:2px;padding:1px 0;}
/* O3 (2026-07-13, polish wave): square tiles - aspect-ratio 1/1 - so the
   ops calendar reads as a real grid instead of squat cells. Grid-line
   token (G1) applied via border for cell definition on paper. Sized to
   fit 12 mini-months on one letter portrait page - font + gap tuning
   above compresses the year block enough that 6-row months hold. */
.yg span{aspect-ratio:1/1;border-radius:2px;display:flex;align-items:center;justify-content:center;font-size:6px;font-weight:700;color:#9B968A;background:var(--soft);border:1px solid var(--grid);font-variant-numeric:tabular-nums;position:relative;}
.yg .x{background:#FCFBF8;border-color:#F0EBDF;}
/* O1 (2026-07-13, polish wave): single SERVICE DAY green (opsServiceState).
   No projected inset, no copper NO ACTUALS on the ops calendar overview
   surface. Drill sheets keep the 4-state model. */
.yg .svc{background:var(--svc);border-color:#B9C9AE;color:#5F7A55;}
.yg .spb::after{content:"";position:absolute;top:0;left:0;right:0;height:2.5px;background:var(--copper);border-radius:2px 2px 0 0;}
.yg .ps{background:var(--navy);border:1px solid var(--navy);color:#fff;font-weight:800;font-size:7px;border-radius:2.5px;}
/* O4 (2026-07-13, polish wave): inventory-due ring, LIVE. Copper open
   ring layered as an overlay so it composes cleanly on top of any cell
   state - SERVICE DAY green, plain soft, or period-start navy. The
   ring uses a pseudo-element positioned inside the cell padding so
   the day number stays legible in the center. This retires the prior
   Option A deferral - Kevin's supplied 2026 schedule lives in
   src/lib/print/inventoryCalendar.js as INVENTORY_DUE_2026. */
.yg .inv::before{content:"";position:absolute;inset:1.5px;border-radius:50%;border:1.5px solid var(--copper);pointer-events:none;}
.yg .ps.inv::before{inset:0.5px;border-color:var(--copl);}
/* O2 mini spring swatch for the legend: a proxy of the actual per-cell
   treatment (soft baseline tile with a 2.5px copper bar across the top).
   Renders inline in the legend with the same aspect ratio as a real
   ops calendar cell. */
.kk-spring{display:inline-block;position:relative;width:12px;height:12px;background:var(--soft);border:1px solid var(--grid);border-radius:2px;vertical-align:-2px;margin-right:4px;overflow:hidden;}
.kk-spring::after{content:"";position:absolute;top:0;left:0;right:0;height:2.5px;background:var(--copper);}
/* O4 mini ring swatch for the legend: outline circle over a plain
   soft cell so the legend matches the render. */
.kk-inv{display:inline-block;position:relative;width:12px;height:12px;background:var(--soft);border:1px solid var(--grid);border-radius:2px;vertical-align:-2px;margin-right:4px;}
.kk-inv::before{content:"";position:absolute;inset:1.5px;border-radius:50%;border:1.5px solid var(--copper);}
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
//
// Corrective wave (2026-07-13): resolver is now EXHAUSTIVE against the
// classifier statuses observed in the wild per PRINT_DATA_CENSUS.md §F
// ("entered", "no-service", "overdue", "needs-entry", "future", "away").
// Every status is explicitly handled; unknown statuses console.warn.
// The prior fallthrough silently dropped "future" (Bug 4) and "away".
//
// R5 superseded (2026-07-13): MLB accounts get NO state layer on any
// print surface. Any actuals on MLB accounts are Kevin's test entries
// and don't reflect real operations - the intranet has no actuals-owed
// concept for MLB accounts. Route around the state mapping explicitly
// here (via opts.accountLevel === "MLB"), not via a silent fallthrough
// downstream. Applies to every print consumer (Ops Calendar, Season,
// Month/Period), so MLB sheets stay games-only + period-start markers.
export function resolveDayState(day, opts = {}) {
  if (opts.accountLevel === "MLB") return null;
  if (!day) return null;
  const s = day.status;
  switch (s) {
    case "entered":
      return "SERVED";
    case "no-service":
      return "NO_SERVICE";
    case "overdue":
    case "needs-entry":
      return "NO_ACTUALS";
    case "future":
      // Future day: PROJECTED when a projection exists on the day
      // (day-level hasProjection is the R2 additive flag - see
      // dataStore/serviceCalendar.js). No projection AND no actuals
      // returns null and renders as the default soft cell.
      return (day.hasProjection && !day.hasActuals) ? "PROJECTED" : null;
    case "away":
      // Away days: the .awy label + --awayfill are driven by
      // homestandByDate at the render site, not by the state fill.
      // Returning null here means an away cell never gets a state
      // fill on top of the away visual.
      return null;
    default:
      // Unknown classifier status - warn so this cannot silently drop
      // again the way "future" did pre-corrective-wave.
      if (typeof console !== "undefined" && console.warn) {
        console.warn(`[print/resolveDayState] unknown status "${s}" on ${day?.date || "?"} - returning null`);
      }
      return null;
  }
}

// Season-scale collapse: served OR projected -> single .s (green) cell.
// The season mini-grid is dense enough that the projected-inset border
// reads as noise; the spec Sheet 3 shows one green for both. Per-day
// discrimination survives on the Month / Period / Ops Calendar surfaces.
//
// Polish wave (2026-07-13): season now uses the SERVICE DAY collapse
// (opsServiceState) which folds NO_ACTUALS into SERVICE so the green
// runs continuously from season start to end. Kevin's ruling: overview
// surfaces don't split the four states - one green means "there was
// (or will be) service that day."
export function seasonServiceState(day, opts = {}) {
  return opsServiceState(day, opts);
}

// Polish-wave overview collapse (O1, 2026-07-13). Used by the Ops
// Calendar (non-MLB) + the blended-overlay Season sheet. Single state
// on these overview surfaces:
//
//   SERVICE_DAY - the day is entered OR past-and-expected (overdue /
//                 needs-entry) OR future-with-projection.
//   NO_SERVICE  - explicit no-service.
//   null        - baseline soft (nothing to signal).
//
// Drill sheets keep the 4-state model (SERVED / PROJECTED / NO ACTUALS /
// NO SERVICE) pending a design-side redesign discussion; do NOT change
// resolveDayState. MLB accounts get null throughout (R5 superseded).
export function opsServiceState(day, opts = {}) {
  if (opts.accountLevel === "MLB") return null;
  if (!day) return null;
  const s = day.status;
  switch (s) {
    case "entered":
    case "overdue":
    case "needs-entry":
      return "SERVICE_DAY";
    case "future":
      return day.hasProjection ? "SERVICE_DAY" : null;
    case "no-service":
      return "NO_SERVICE";
    case "away":
      return null;
    default:
      return null;
  }
}
