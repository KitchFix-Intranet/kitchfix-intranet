// scripts/probes/_probe_kpi_contrast.mjs
//
// KPI light-surface text contrast gate. Ships as a REGRESSION NET
// per owner ruling 2026-08-24: any future `color:` declaration on a
// light-surface selector that lands below 4.5:1 fails this probe.
//
// Origin: the muted-caption fix (PR-E polish 1) surfaced .kpi-wb-dates
// as a second contrast failure of the same class the .kpi-wb-d-mute
// fix had just addressed. Owner ruling: "We have now found two by
// accident; a third will exist" - do a sweep, do not fix instance by
// instance. The sweep found --n-500 / --text-subtle failing at 34
// sites (2.45:1) plus four placeholder token uses under 2:1. Fixes
// landed together with this gate.
//
// This script scans src/app/kpi/kpi.css for every `color: ...`
// declaration on selectors that render on a light card / white
// surface. Colors that resolve via CSS vars are looked up in the
// palette below (tokens.css + kpi.css :root overrides). Any change
// to a token value in tokens.css MUST be mirrored in PALETTE here -
// otherwise this gate goes stale silently.
//
// Output is grouped:
//   FAIL - contrast < 4.5:1 on white or --n-50; blocks merge
//   BORDERLINE - 4.5-5.0:1; passes but no headroom (informational)
//   PASS - 5.0:1 or better
//
// WAIVERS - a small named list of selectors that are decorative
// enough that the contrast rule does not apply. Adding to this list
// requires a comment saying why.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const kpiCssPath = join(__dirname, "..", "..", "src", "app", "kpi", "kpi.css");
// homestand-fixes round 2 addendum (2026-08-26): strip /* ... */
// comments from the input text before parsing. Prior parser only
// skipped comments at the exact position of `i`; a comment header
// preceding a rule was absorbed into the selector string, and the
// `isLightSurfaceSelector` prefix check silently rejected the rule.
// This missed .kpi-sig-fact-val-mute (color: var(--n-300), 1.27:1
// on white - a border token used as text) plus .kpi-det-v-mute and
// .kpi-vb-d-mute. Third silent-truncation-at-a-boundary this week;
// the pattern is guards that scan one shape while the defect lives
// on another. Comment stripping normalises the input so every rule
// presents its real selector to the surface check.
const cssRaw = readFileSync(kpiCssPath, "utf8");
const cssText = cssRaw.replace(/\/\*[\s\S]*?\*\//g, "");

// ─── Palette (resolved values) ────────────────────────────────────────
// tokens.css declares the base scale; kpi.css re-declares --n-50..-400
// with cool-grey values scoped to the KPI surfaces. --n-500 and above
// come from tokens.css unchanged. Values here mirror the RESOLVED value
// on any .kpi-* subtree.
const PALETTE = {
  // KPI-scoped cool greys (kpi.css :root overrides)
  "--n-50":  "#F8FAFC",
  "--n-100": "#F1F5F9",
  "--n-200": "#E7EDF4",
  "--n-300": "#DDE5EE",
  "--n-400": "#CBD5E1",
  // From tokens.css :root (not overridden)
  "--n-0":   "#FFFFFF",
  "--n-500": "#94A3B8",
  "--n-600": "#64748B",
  "--n-700": "#475569",
  "--n-800": "#334155",
  "--n-900": "#0A2548",
  // Semantic text tokens (tokens.css). --text-subtle retired 2026-08-24
  // as a distinct text tier - pointed at --n-600 alongside --text-muted
  // because the prior --n-500 (#94A3B8) mapping measured 2.45:1
  // (invisible), and fixing --n-500 in isolation would push it darker
  // than --n-600, inverting the scale. --n-500 stays available as a
  // primitive for borders / dividers / icons.
  "--text-heading": "#0A2548",
  "--text-strong":  "#334155",
  "--text-default": "#475569",
  "--text-muted":   "#64748B",
  "--text-subtle":  "#64748B",
  // Common non-neutrals text uses on white
  "--navy-700": "#153968",
  "--navy-800": "#092B55",
  "--amber-500": "#D97706",
  "--amber-600": "#B25800",
  "--amber-700": "#8C3A00",
  "--green-500": "#16A34A",
  "--green-600": "#008330",
  "--green-700": "#006515",
  "--red-500":   "#DC2626",
  "--red-600":   "#B9000C",
  "--red-700":   "#970000",
};

// ─── WCAG contrast ────────────────────────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace("#", "").toLowerCase();
  if (h.length === 3) return [0,1,2].map(i => parseInt(h[i]+h[i], 16));
  if (h.length === 6) return [0,2,4].map(i => parseInt(h.slice(i, i+2), 16));
  return null;
}
function relLum([r, g, b]) {
  const srgb = [r, g, b].map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
}
function contrast(hexA, hexB) {
  const [la, lb] = [hexA, hexB].map(h => relLum(hexToRgb(h)));
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// ─── Resolve any color value to a hex string, or null ─────────────────
function resolveColor(raw) {
  const s = raw.trim().replace(/;$/, "");
  if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s.startsWith("#") ? s : "#" + s;
  const m = s.match(/^var\((--[a-z0-9-]+)(?:,\s*(.+))?\)$/i);
  if (m) {
    const val = PALETTE[m[1]];
    if (val) return val;
    if (m[2]) return resolveColor(m[2]);
    return null;
  }
  return null;
}

// ─── Selectors that render on a WHITE/NEAR-WHITE surface ─────────────
// Prefix-based heuristics: everything under these class prefixes lives
// on a card / page surface with a light background. Excludes chrome
// that sits on the top navy bar / rail / scoreboard.
const LIGHT_SURFACE_PREFIXES = [
  ".kpi-sig", ".kpi-spend", ".kpi-wh", ".kpi-wb", ".kpi-wbars",
  ".kpi-tbl", ".kpi-tbar", ".kpi-story", ".kpi-cmp",
  ".kpi-hs-card", ".kpi-hs-pop", ".kpi-hs-qwrap", ".kpi-hs-qbtn", ".kpi-hs-rail", ".kpi-hs-th", ".kpi-hs-eyebrow", ".kpi-hs-note",
  ".kpi-day-range", ".kpi-help", ".kpi-workers",
  ".kpi-statebox", ".kpi-coming", ".kpi-state-",
  ".kpi-cal", ".kpi-rmenu",
  ".kpi-folio", ".kpi-perh", ".kpi-perbtn", ".kpi-wkbtn",
  ".kpi-vpill",
];
// Selectors known to render on a dark navy background - skip.
const DARK_SURFACE_PREFIXES = [
  ".kpi-cmd", ".kpi-cmd-",
  ".kpi-hs-sbar",
];
// Selector fragments that indicate the element sits on a DARK / non
// -white surface at render time - skip regardless of prefix.
//   .kpi-tbl-total    - navy grand-total row (white text on navy)
//   .on               - active tab / chip / dropdown item (navy fill)
//   .kpi-cal-cell-endpoint - selected date pill (navy fill)
//   .kpi-hs-rail-stand.pre - pre-floor rail bar; muted-on-card is
//                             design intent for "no detail" placeholder
const DARK_CONTEXT_FRAGMENTS = [
  ".kpi-tbl-total",
  ".on ", ".on:", ".on.", // active state on chips / items
  ".kpi-cal-cell-endpoint",
  ".kpi-hs-rail-stand.pre",
];

function isLightSurfaceSelector(sel) {
  const s = sel.trim();
  if (DARK_SURFACE_PREFIXES.some(p => s.startsWith(p))) return false;
  const padded = s + " ";
  if (DARK_CONTEXT_FRAGMENTS.some(f => padded.includes(f))) return false;
  if (/\.on(?:$|[\s.:])/.test(s)) return false;
  return LIGHT_SURFACE_PREFIXES.some(p => s.startsWith(p));
}

// ─── Waivers ──────────────────────────────────────────────────────────
// Selectors that are decorative enough that the AA text rule does not
// apply. Add a comment saying why for every entry. Waivers do NOT
// count toward the FAIL total.
//
//   .kpi-tbar-btn-dd::after
//     The dropdown caret (▾) sits inside a fully-labelled button. The
//     button's TEXT carries the affordance; the caret is a hint glyph
//     the eye picks up peripherally, not a value the operator reads.
//     Bumping it would compete with the button label for attention.
//     Owner ruling 2026-08-24.
const WAIVERS = new Set([
  ".kpi-tbar-btn-dd::after",
]);

// ─── Walk kpi.css, extract `selector { color: ...; }` pairs ──────────
// Simple parser: for each ruleset we grab the outer selector list and
// scan for the FIRST `color:` declaration (nested media queries etc.
// are handled naturally because we track brace depth).
const rules = [];
let i = 0;
while (i < cssText.length) {
  // Skip comments
  if (cssText.startsWith("/*", i)) {
    const end = cssText.indexOf("*/", i + 2);
    i = end === -1 ? cssText.length : end + 2;
    continue;
  }
  // Selector run - up to next `{` at depth 0
  const braceIdx = cssText.indexOf("{", i);
  if (braceIdx === -1) break;
  const selectorRaw = cssText.slice(i, braceIdx).trim();
  // Find matching close brace with depth tracking
  let depth = 1;
  let j = braceIdx + 1;
  while (j < cssText.length && depth > 0) {
    if (cssText[j] === "{") depth++;
    else if (cssText[j] === "}") depth--;
    j++;
  }
  const body = cssText.slice(braceIdx + 1, j - 1);
  // Extract color declarations in this ruleset (skip inside nested {} braces)
  const flatBody = body.replace(/\{[^}]*\}/g, "");
  const colorMatches = [...flatBody.matchAll(/(?:^|\s|;)color\s*:\s*([^;{}]+)/g)];
  for (const cm of colorMatches) {
    // A selector list can carry multiple comma-separated selectors; keep
    // each so the audit names every distinct call site.
    const sels = selectorRaw.split(",").map(s => s.trim()).filter(Boolean);
    for (const sel of sels) rules.push({ sel, raw: cm[1].trim() });
  }
  i = j;
}

// ─── Score each light-surface color declaration against white ─────────
const WHITE = "#FFFFFF";
const NEAR_WHITE = "#F8FAFC"; // --n-50 in kpi scope
// Border tokens - these carry a divider / outline visual weight and
// must NEVER be used as text color. --n-100 through --n-400 are the
// border scale; using any of them for `color:` produces < 3:1 on
// white (usually < 2:1) and is invisible. Third guard added
// 2026-08-26 after the .kpi-sig-fact-val-mute defect landed with
// color: var(--n-300) (1.27:1) that WCAG-scoring alone catches but
// the "why" is clearer when named: border token used as text.
const BORDER_TOKENS = new Set(["--n-100", "--n-200", "--n-300", "--n-400"]);
function borderTokenName(raw) {
  const m = raw.match(/^var\((--n-[1234]00)(?:,|\))/);
  return m ? m[1] : null;
}
const findings = [];
for (const { sel, raw } of rules) {
  if (!isLightSurfaceSelector(sel)) continue;
  const hex = resolveColor(raw);
  if (!hex) continue;
  const cWhite = contrast(hex, WHITE);
  const cNear = contrast(hex, NEAR_WHITE);
  const worst = Math.min(cWhite, cNear);
  const waived = WAIVERS.has(sel);
  const borderToken = borderTokenName(raw);
  let tier;
  let reason = null;
  if (waived) tier = "WAIVER";
  else if (borderToken) { tier = "FAIL"; reason = `border token ${borderToken} used as text (never valid regardless of contrast)`; }
  else if (worst < 4.5) tier = "FAIL";
  else if (worst < 5.0) tier = "BORDERLINE";
  else tier = "PASS";
  findings.push({ sel, raw, hex, cWhite, cNear, worst, tier, reason });
}

// ─── Report ───────────────────────────────────────────────────────────
console.log("=".repeat(78));
console.log("KPI light-surface text contrast sweep (PR-E polish 2 report)");
console.log("=".repeat(78));

const fails = findings.filter(f => f.tier === "FAIL")
  .sort((a, b) => a.worst - b.worst);
const borderline = findings.filter(f => f.tier === "BORDERLINE")
  .sort((a, b) => a.worst - b.worst);

console.log("");
console.log(`FAIL (< 4.5:1 on white or --n-50):  ${fails.length}`);
console.log("-".repeat(78));
// Deduplicate by (raw, hex) so 15 uses of --n-500 don't spam the report.
const grouped = new Map();
for (const f of fails) {
  const key = `${f.raw} → ${f.hex}`;
  const g = grouped.get(key) || { raw: f.raw, hex: f.hex, worst: f.worst, reason: f.reason, sels: new Set() };
  g.sels.add(f.sel);
  grouped.set(key, g);
}
for (const [key, g] of [...grouped.entries()].sort((a, b) => a[1].worst - b[1].worst)) {
  const reasonNote = g.reason ? `   [${g.reason}]` : "";
  console.log(`  ${key}   contrast ${g.worst.toFixed(2)}:1   (${g.sels.size} selectors)${reasonNote}`);
  const sample = [...g.sels].sort().slice(0, 6);
  for (const s of sample) console.log(`      ${s}`);
  if (g.sels.size > sample.length) console.log(`      ...+${g.sels.size - sample.length} more`);
}

console.log("");
console.log(`BORDERLINE (4.5-5.0:1 on white):  ${borderline.length}`);
console.log("-".repeat(78));
const groupedBL = new Map();
for (const f of borderline) {
  const key = `${f.raw} → ${f.hex}`;
  const g = groupedBL.get(key) || { raw: f.raw, hex: f.hex, worst: f.worst, sels: new Set() };
  g.sels.add(f.sel);
  groupedBL.set(key, g);
}
for (const [key, g] of [...groupedBL.entries()].sort((a, b) => a[1].worst - b[1].worst)) {
  console.log(`  ${key}   contrast ${g.worst.toFixed(2)}:1   (${g.sels.size} selectors)`);
  const sample = [...g.sels].sort().slice(0, 4);
  for (const s of sample) console.log(`      ${s}`);
  if (g.sels.size > sample.length) console.log(`      ...+${g.sels.size - sample.length} more`);
}

const waivers = findings.filter(f => f.tier === "WAIVER");
console.log("");
console.log(`WAIVER:  ${waivers.length}`);
console.log("-".repeat(78));
for (const w of waivers) {
  console.log(`  ${w.sel}   ${w.raw} → ${w.hex}   contrast ${w.worst.toFixed(2)}:1`);
  console.log(`      (waived - see WAIVERS constant for justification)`);
}

console.log("");
console.log(`PASS (>= 5.0:1 on white):  ${findings.length - fails.length - borderline.length - waivers.length}`);
console.log("=".repeat(78));
console.log(`total light-surface color declarations scanned: ${findings.length}`);
console.log("=".repeat(78));

// Regression net: non-zero exit if any FAIL survives after waivers.
process.exit(fails.length > 0 ? 1 : 0);
