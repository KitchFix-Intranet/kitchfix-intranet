// Print assets - fonts + seal + shared CSS - loaded ONCE per cold
// start and reused across every PDF the process renders. Fonts are
// self-hosted per Kevin's guardrail (no runtime Google Fonts fetch);
// the seal is the KitchFix primary mark from /public/.
//
// Data URIs are inlined directly into the <head> so the rendered HTML
// is self-contained - no network I/O, no filesystem paths embedded in
// the PDF, no font-fallback risk between environments.

import fs from "node:fs";
import path from "node:path";

// ── Font loader ──────────────────────────────────────────────────────
// Fontsource ships one WOFF2 per script per weight per style. We only
// use Latin + normal style. Bebas Neue has one weight; Mulish uses
// 400 / 600 / 700 / 800.

const FONTSOURCE_ROOT = path.join(process.cwd(), "node_modules", "@fontsource");

const FONT_MANIFEST = [
  {
    family: "Bebas Neue",
    weight: 400,
    file: path.join(FONTSOURCE_ROOT, "bebas-neue", "files", "bebas-neue-latin-400-normal.woff2"),
  },
  {
    family: "Mulish",
    weight: 400,
    file: path.join(FONTSOURCE_ROOT, "mulish", "files", "mulish-latin-400-normal.woff2"),
  },
  {
    family: "Mulish",
    weight: 600,
    file: path.join(FONTSOURCE_ROOT, "mulish", "files", "mulish-latin-600-normal.woff2"),
  },
  {
    family: "Mulish",
    weight: 700,
    file: path.join(FONTSOURCE_ROOT, "mulish", "files", "mulish-latin-700-normal.woff2"),
  },
  {
    family: "Mulish",
    weight: 800,
    file: path.join(FONTSOURCE_ROOT, "mulish", "files", "mulish-latin-800-normal.woff2"),
  },
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
// PNG at /public/PFS_PrimaryLogo_White_Circle.png. Read once and cached
// as a data URI.

let cachedSealDataUri = null;
function sealDataUri() {
  if (cachedSealDataUri !== null) return cachedSealDataUri;
  const p = path.join(process.cwd(), "public", "PFS_PrimaryLogo_White_Circle.png");
  const b64 = fs.readFileSync(p).toString("base64");
  cachedSealDataUri = `data:image/png;base64,${b64}`;
  return cachedSealDataUri;
}

// ── Shared CSS ───────────────────────────────────────────────────────
// Verbatim from docs/design/SC_PRINT_SPEC_v1.html plus @page geometry
// (letter landscape for Month/Period/Season; portrait comes in Wave 2's
// Year sheet) and print-color-adjust. The spec's non-@page defaults
// (body background:#CFCBC2 + max-width:960px) are dropped from the
// print output - the browser view has a page frame, the PDF renders
// straight to the page.

function sheetCss({ orientation = "landscape" } = {}) {
  return `
${fontFaceBlock()}
@page{size:letter ${orientation};margin:0;}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{
  font-family:'Mulish',sans-serif;
  color:#26262B;
  background:#ffffff;
  -webkit-print-color-adjust:exact;
  print-color-adjust:exact;
}
:root{
  --navy:#16305E; --ink:#26262B; --mut:#8A857A; --hair:#E4E0D6;
  --soft:#F6F4EF; --copper:#C2410C; --svc:#E9E6DC; --cop2:#EFC5A9;
  --copl:#F3B48C;
}
.sheet{background:#fff;}
.pad{padding:0 44px 26px;}
.band{background:var(--navy);color:#fff;display:flex;align-items:center;padding:11px 44px;gap:14px;}
.band .seal{width:34px;height:34px;display:block;}
.band .bk{font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:.09em;}
.band .ba{font-size:9.5px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;opacity:.92;margin-left:auto;}
.trow{display:flex;align-items:baseline;gap:16px;margin:26px 0 18px;}
.mo{font-family:'Bebas Neue',sans-serif;font-size:66px;line-height:.9;letter-spacing:.01em;}
.yr{font-family:'Bebas Neue',sans-serif;font-size:66px;line-height:.9;color:#D8D4CA;margin-left:auto;}
.ptag{font-size:9px;font-weight:800;letter-spacing:.14em;color:var(--navy);border:1.5px solid var(--navy);border-radius:3px;padding:3px 7px;position:relative;top:-6px;}
table.cal{width:100%;border-collapse:collapse;table-layout:fixed;}
.cal th{font-size:9px;font-weight:800;letter-spacing:.14em;color:var(--mut);text-align:left;padding:0 0 6px 8px;border-bottom:1.5px solid var(--ink);}
.cal td{height:78px;border-bottom:1px solid var(--hair);border-right:1px solid var(--hair);vertical-align:top;padding:7px 8px;position:relative;font-variant-numeric:tabular-nums;}
.cal td:last-child{border-right:none;}
.cal tr:last-child td{border-bottom:1.5px solid var(--ink);}
.cal tr.pb td{border-top:2px solid var(--navy);}
.pmark{position:absolute;top:5px;right:6px;font-size:7px;font-weight:800;letter-spacing:.1em;color:var(--navy);}
.d{font-size:13px;font-weight:700;}
.blank{background:#FCFBF8;} .blank .d{color:#D8D4CA;font-weight:600;}
.ns{background:var(--soft);} .ns .d{color:var(--mut);}
.ns .nst{position:absolute;bottom:8px;left:8px;font-size:7px;font-weight:800;letter-spacing:.14em;color:#B7B2A5;}
.opp{position:absolute;bottom:19px;left:8px;font-size:11.5px;font-weight:800;letter-spacing:.04em;color:var(--navy);min-width:34px;}
.tm{position:absolute;bottom:7px;left:8px;font-size:9px;font-weight:700;color:var(--mut);}
.tm.day{color:var(--copper);font-weight:800;}
.spr td{box-shadow:inset 0 -3px 0 var(--copper);} .spr td.blank{box-shadow:none;}
.ft{display:flex;justify-content:space-between;align-items:center;margin-top:14px;font-size:8.5px;color:var(--mut);font-weight:700;}
.ft .k{display:flex;gap:16px;align-items:center;letter-spacing:.06em;}
.knavy{display:inline-block;width:9px;height:9px;background:var(--navy);border-radius:2px;margin-right:5px;vertical-align:-1px;}
.ksoft{display:inline-block;width:9px;height:9px;background:var(--soft);border:1px solid var(--hair);border-radius:2px;margin-right:5px;vertical-align:-1px;}
.kcop{display:inline-block;width:14px;height:3px;background:var(--copper);margin-right:5px;vertical-align:2px;}
.kct{color:var(--copper);font-weight:800;}
.smos{display:grid;grid-template-columns:repeat(3,1fr);gap:0 26px;margin-top:4px;}
.smo{padding:12px 0 4px;}
.smo h4{font-family:'Bebas Neue',sans-serif;font-size:17px;letter-spacing:.06em;margin:0 0 7px;border-bottom:1.5px solid var(--ink);padding-bottom:4px;display:flex;justify-content:space-between;align-items:baseline;}
.smo h4 s{text-decoration:none;font-family:'Mulish',sans-serif;font-size:7.5px;font-weight:800;letter-spacing:.08em;color:var(--mut);}
.sg{display:grid;grid-template-columns:repeat(7,1fr);gap:2.5px;}
.sg b{font-size:6.5px;font-weight:800;letter-spacing:.1em;color:var(--mut);text-align:center;padding-bottom:2px;}
.sg span{height:30px;border-radius:3px;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.15;font-variant-numeric:tabular-nums;}
.sg .h{background:var(--navy);color:#fff;} .sg .h em{font-style:normal;font-size:8px;font-weight:800;letter-spacing:.03em;} .sg .h i{font-style:normal;font-size:7px;font-weight:600;opacity:.88;}
.sg .h i.day{color:var(--copl);opacity:1;font-weight:800;}
.sg .a{background:#EFEDE6;} .sg .a em{font-style:normal;font-size:7.5px;font-weight:700;color:#8A857A;letter-spacing:.03em;}
.sg .o{background:#fff;border:1px solid #F0EDE5;}
.seasend{font-size:7px;font-weight:800;letter-spacing:.1em;color:var(--mut);text-align:right;margin-top:5px;}
/* ── Year sheet (Wave 2) ────────────────────────────────────────
   The Year sheet reuses the shared band + trow but swaps the calendar
   for a 3-column grid of 28-cell sparklines per month. Cell classes:
   svc default = tan (--svc), .sp = copper wash (--cop2),
   .gm = navy fill (--navy), .of = hollow hairline. .offpanel spans
   the grid full-width and carries the offseason label when trailing
   empty months collapse. Verbatim from the spec's Sheet 3. */
.ymos{display:grid;grid-template-columns:repeat(3,1fr);gap:16px 22px;margin-top:4px;}
.ymo h5{font-family:'Bebas Neue',sans-serif;font-size:13.5px;letter-spacing:.07em;margin:0 0 5px;border-bottom:1px solid var(--ink);padding-bottom:3px;}
.ygg{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;}
.ygg i{height:15px;border-radius:2.5px;background:var(--svc);font-style:normal;display:block;}
.ygg i.sp{background:var(--cop2);}
.ygg i.gm{background:var(--navy);}
.ygg i.of{background:#fff;border:1px solid #EFECE3;}
.offpanel{grid-column:1/-1;border:1px solid var(--hair);border-radius:4px;padding:10px;text-align:center;font-family:'Bebas Neue',sans-serif;font-size:14px;letter-spacing:.14em;color:#B7B2A5;}
`;
}

// ── HTML utilities ───────────────────────────────────────────────────
export function esc(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

// Build the <head> that every sheet uses.
export function sheetHead({ title, orientation = "landscape" } = {}) {
  return `<meta charset="utf-8" />
<title>${esc(title || "KitchFix schedule")}</title>
<style>${sheetCss({ orientation })}</style>`;
}

export function loadSealDataUri() {
  return sealDataUri();
}

// Uppercase-safe ASCII footer date "12 JUL 2026" - matches the spec.
export function footerDate(d = new Date()) {
  const MON = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
}
