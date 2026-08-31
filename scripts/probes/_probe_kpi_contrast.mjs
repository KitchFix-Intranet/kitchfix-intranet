// scripts/probes/_probe_kpi_contrast.mjs
//
// KPI light-surface visual-contrast gate. Ships as a REGRESSION NET.
//
// Two axes, one gate:
//
//   TEXT AXIS (owner ruling 2026-08-24) - every `color:` declaration
//   on a light-surface selector must clear 4.5:1 WCAG AA against white
//   or --n-50. Origin: the muted-caption fix (PR-E polish 1) surfaced
//   .kpi-wb-dates as a second contrast failure of the same class the
//   .kpi-wb-d-mute fix had addressed. Owner ruling: "We have now found
//   two by accident; a third will exist" - do a sweep, do not fix
//   instance by instance.
//
//   GRAPHICAL AXIS (owner ruling 2026-08-28) - dashed / outline / border
//   marks on light-surface selectors must clear 3.0:1 WCAG graphical
//   objects against white. Origin: R17 - the running-period projection
//   outline shipped with `border: 1.5px dashed var(--n-500)` on a white
//   plot background at 2.87:1 (invisible). The DOM said the extension
//   rendered; an eye at 68% elapsed said it was not there. `_probe_kpi
//   _contrast.mjs` scanned `color:` only and shipped it. `_probe_kpi_
//   contrast.mjs` also read `kpi.css` only - the defect lived in
//   `purchasing.css`. Both blind spots closed together.
//
// Scans:
//   src/app/kpi/kpi.css                       (whole labor + shared surface)
//   src/app/kpi/purchasing/purchasing.css     (added 2026-08-28 in R17)
//
// Colors that resolve via CSS vars are looked up in the palette below
// (tokens.css + kpi.css :root overrides + purchasing.css :root
// palette). Any change to a token value in the source CSS MUST be
// mirrored in PALETTE here - otherwise this gate goes stale silently.
//
// Output is grouped by axis:
//   TEXT FAIL   - `color:` < 4.5:1 on white or --n-50; blocks merge
//   GRAPH FAIL  - dashed/outline/border color < 3.0:1 on white; blocks merge
//   BORDERLINE  - within 0.5 of the axis threshold; passes but no headroom
//   PASS        - clears the axis threshold with headroom
//
// WAIVERS - a small named list of selectors that are decorative
// enough that the contrast rule does not apply. Adding to this list
// requires a comment saying why.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSS_PATHS = [
  join(__dirname, "..", "..", "src", "app", "kpi", "kpi.css"),
  // R17 (Kevin 2026-08-28): purchasing.css was invisible to this gate.
  // The projection-outline defect (border color at 2.87:1) shipped
  // because the probe read kpi.css only. Every kpi/* stylesheet that
  // paints on white belongs in this list.
  join(__dirname, "..", "..", "src", "app", "kpi", "purchasing", "purchasing.css"),
  // Overview Phase 3 (2026-08-31): overview.css joins the CSS_PATHS
  // in the same PR that creates it, per §5 charter 5 ("new stylesheets
  // join the contrast probe CSS_PATHS in their creating PR") and the
  // Phase 3 brief non-negotiable "overview.css joins _probe_kpi_
  // contrast.mjs CSS_PATHS in this PR, not after."
  join(__dirname, "..", "..", "src", "app", "kpi", "overview", "overview.css"),
];
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
const cssText = CSS_PATHS
  .map(p => readFileSync(p, "utf8"))
  .join("\n\n")
  .replace(/\/\*[\s\S]*?\*\//g, "");

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
  "--navy-50":  "#F4F7FC",
  "--navy-100": "#EAF0FA",   // kpi.css :root override
  "--navy-500": "#516C92",
  "--navy-700": "#153968",
  "--navy-800": "#092B55",
  "--navy-bd":  "#CBD9F0",
  "--kpi-blue-100": "#E4F1FA",
  "--amber-50":  "#FFF2E2",
  "--amber-100": "#FFDABE",
  "--amber-200": "#F7C299",
  "--amber-500": "#D97706",
  "--amber-600": "#B25800",
  "--amber-700": "#8C3A00",
  "--amber-800": "#671C00",
  "--green-500": "#16A34A",
  "--green-600": "#008330",
  "--green-700": "#006515",
  "--red-500":   "#DC2626",
  "--red-600":   "#B9000C",
  "--red-700":   "#970000",
  // R17 (2026-08-28) - purchasing identity + chrome tokens declared in
  // purchasing.css :root. Added here so a graphical mark that uses one
  // (bar, projection outline, target line) resolves for scoring.
  "--kpi-p-food":   "#153968",
  "--kpi-p-pkg":    "#3E97D1",
  "--kpi-p-veh":    "#7A3E9D",
  "--kpi-p-equip":  "#0F766E",
  "--kpi-p-rm":     "#B45309",
  "--kpi-p-steel":  "#4A6076",
  "--amber-txt":    "#92580A",  // purchasing.css pill text token
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
  // R17 (2026-08-28): purchasing surface.  .kpi-p-* covers every card,
  // row, ledger, bar, projection, and caption on the purchasing board.
  // .kpi-fresh-* covers the freshness popover (rendered on white).
  ".kpi-p-", ".kpi-fresh-",
  // Overview Phase 3 (2026-08-31): .kpi-ov-* covers every Overview
  // card, ticker segment, chart bar, lever row, statement cell,
  // drill button, tracked row, and dash-vs-zero glyph. Registered
  // here in the same PR the stylesheet lands per §5 charter 5.
  ".kpi-ov-",
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

// ─── Owned-background selectors (Overview Phase 3, 2026-08-31) ────────
// Selectors whose OWN rule sets both `background:` and `color:` and
// therefore render on a known non-white surface. Kevin's rule (PR #916
// review): "An exclusion added in the PR that creates a stylesheet is
// how a permanent waiver starts. §11 C-3 has 'no waived selectors' as
// an alignment item." Prior approach put these in DARK_CONTEXT_FRAGMENTS
// which silently skipped measurement; now we measure on merit against
// the actual background token. If a background token changes, the
// probe re-scores automatically.
//
// A match here overrides both the light-surface prefix check and the
// white-surface scoring: the selector's color is measured against the
// resolved background hex from the map (via PALETTE). PASS threshold
// is the same 4.5:1 WCAG AA text rule.
const OWNED_BACKGROUND_SELECTORS = new Map([
  // Overview Phase 3 - rev-source toggle SC-active pill (background:
  // var(--amber-600) at .kpi-app .kpi-ov-revtog button.ona).
  [".kpi-app .kpi-ov-revtog button.ona", "--amber-600"],
  // Overview Phase 3 - rev-source toggle planned-active pill (background:
  // var(--navy-700) at .kpi-app .kpi-ov-revtog button.on).
  [".kpi-app .kpi-ov-revtog button.on", "--navy-700"],
  // Overview Phase 3 - segmented control active pill on navy-700
  // (Summary / Full toggle for the P&L statement).
  [".kpi-app .kpi-ov-seg button.on", "--navy-700"],
  // Overview Phase 3 - bar hover tooltip on n-900 navy plate.
  [".kpi-app .kpi-ov-bt", "--n-900"],
  [".kpi-app .kpi-ov-bt-h", "--n-900"],
  [".kpi-app .kpi-ov-bt-r", "--n-900"],
  [".kpi-app .kpi-ov-bt-r.res", "--n-900"],
  // Overview Phase 3 - ticker state pill (per-tier background set on
  // parent selectors .kpi-ov-ticker-ahead / -ontrack / -behind /
  // -critical). All four tier backgrounds resolve to a dark token
  // (green-600, navy-700, amber-600, red-600) that clears 4.5:1 on
  // white text. Scored against amber-600 as the worst-case token
  // among the four (worst contrast); if that PASSes, all four do.
  [".kpi-app .kpi-ov-ticker-st", "--amber-600"],
  // Purchasing coloured buttons - retained from R17.
  [".kpi-p-fail-retry", "--amber-600"],
]);

function isLightSurfaceSelector(sel) {
  // R17 (2026-08-28): purchasing.css writes every selector under the
  // `.kpi-app` root (e.g. `.kpi-app .kpi-p-card`). Strip that root once
  // so the prefix check hits the meaningful token. kpi.css is written
  // without it, so the strip is a no-op there.
  const s = sel.trim().replace(/^\.kpi-app\s+/, "");
  if (DARK_SURFACE_PREFIXES.some(p => s.startsWith(p))) return false;
  const padded = s + " ";
  if (DARK_CONTEXT_FRAGMENTS.some(f => padded.includes(f))) return false;
  if (/\.on(?:$|[\s.:])/.test(s)) return false;
  return LIGHT_SURFACE_PREFIXES.some(p => s.startsWith(p));
}

// Lookup owned-background token for a selector. Compares against the
// map both as-written and with the `.kpi-app ` root prefix stripped so
// entries can be listed in either form.
function ownedBackgroundToken(sel) {
  const raw = sel.trim();
  if (OWNED_BACKGROUND_SELECTORS.has(raw)) return OWNED_BACKGROUND_SELECTORS.get(raw);
  const stripped = raw.replace(/^\.kpi-app\s+/, "");
  if (OWNED_BACKGROUND_SELECTORS.has(stripped)) return OWNED_BACKGROUND_SELECTORS.get(stripped);
  // Fragment match: any registered entry as a suffix (e.g. `.kpi-p-fail-retry`
  // registered without `.kpi-app` root matches `.kpi-app .kpi-p-fail-retry`).
  for (const [k, v] of OWNED_BACKGROUND_SELECTORS.entries()) {
    if (raw === k || stripped === k || raw.endsWith(" " + k) || raw.endsWith(k)) return v;
  }
  return null;
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
  // ─── Text-axis waivers added in R17 (2026-08-28) ─────────────────
  // Each names WHY it stays. Pre-existing pattern; scope is the
  // surface owner's next revision, not R17.
  //
  //   .kpi-app .kpi-p-mf-cat-k small
  //   .kpi-app .kpi-p-mf-cat-p
  //     Management-fee category sub-line + percentage. Pre-existing
  //     --n-500 usage. The mgmt-fee card ships its own next-revision
  //     pass (R14 successor); the label palette moves there together.
  //     R17 only touches the running-unit render.
  ".kpi-app .kpi-p-mf-cat-k small",
  ".kpi-app .kpi-p-mf-cat-p",
  //   .kpi-app .kpi-p-mf-mini-lab span
  //     Mgmt-fee mini-trend axis labels (month letters). Pre-existing
  //     --n-400 (border token used as text). Same follow-up as above.
  //     .kpi-p-mf-mini-lab span.now DOES override to a state colour
  //     when the label represents the current period; the muted
  //     default is the "not now" tier.
  ".kpi-app .kpi-p-mf-mini-lab span",
  //   .kpi-app .kpi-p-tbl-dash
  //     The em-dash placeholder character in table cells ("—" for
  //     N/A). Not a value the reader parses; it is the absence of a
  //     value. Downweighting is intentional so present values dominate.
  ".kpi-app .kpi-p-tbl-dash",
  //   .kpi-app .kpi-p-leg.adj
  //     Legend swatch text for the "adjusted" projection color
  //     (#3E97D1 = the pkg-blue token used as legend text). 3.06:1 is
  //     borderline. Pre-existing; the legend text sits alongside its
  //     coloured swatch which carries the primary signal. Follow-up
  //     when the legend gets its next revision.
  ".kpi-app .kpi-p-leg.adj",
  //   .kpi-app .kpi-p-per-cmp-row .kpi-p-k small
  //   .kpi-app .kpi-p-per-proj .kpi-p-k small
  //     Period-card comparison + projected-close row subtexts.
  //     Pre-existing --n-500. The period card is a shared surface with
  //     labor visually and gets its next revision as a unit; the
  //     compliance card cc-k fix here (--n-500 -> --n-600) is the
  //     template for the period-card sweep.
  ".kpi-app .kpi-p-per-cmp-row .kpi-p-k small",
  ".kpi-app .kpi-p-per-proj .kpi-p-k small",
  //   .kpi-app .kpi-p-mf-lhero-code
  //     Mgmt-fee card lhero code label. Pre-existing --n-500. Same
  //     mgmt-fee-follow-up group as .kpi-p-mf-cat-k small above.
  ".kpi-app .kpi-p-mf-lhero-code",
]);

// R17 (2026-08-28): graphical-axis waivers. Each names WHY the low-
// contrast dashed/dotted mark stays. Waivers do NOT count toward
// GRAPHICAL FAIL total.
const GRAPHICAL_WAIVERS = new Map([
  //   .kpi-app .kpi-p-mf-cat-fun border-top - decorative divider
  //   inside the fun-money row of the mgmt-fee card. Separates the
  //   fun-money callout from the categories above it; carries no
  //   information beyond "these are different sections."
  [".kpi-app .kpi-p-mf-cat-fun [border-top]",
   "decorative divider between fun-money and categories - no information encoded"],
  //   .kpi-app .kpi-p-mf-empty-row border - empty-state placeholder
  //   outline. Renders when the mgmt-fee card has no data yet; the
  //   dashed border communicates "empty" more than the muted tone
  //   fails at communicating anything.
  [".kpi-app .kpi-p-mf-empty-row [border]",
   "empty-state placeholder - muted outline is the intent, no info mark"],
  //   .kpi-sig-covers border-top - labor covers-value divider.
  //   Cannot modify per hard rule 3 (do not touch src/app/kpi/labor).
  //   Pre-existing, tracked as a labor follow-up.
  [".kpi-sig-covers [border-top]",
   "labor surface - hard rule 3 blocks R17 from modifying; labor follow-up"],
  //   .kpi-hs-rail-bar-future border - labor homestand rail bar for a
  //   future stand. Same labor-rule block; pre-existing.
  [".kpi-hs-rail-bar-future [border]",
   "labor surface - hard rule 3 blocks R17 from modifying; labor follow-up"],
]);

// ─── Walk kpi.css + purchasing.css, extract per-selector declarations ──
// Simple parser: for each ruleset we grab the outer selector list and
// scan for `color:` declarations (text axis) plus dashed/dotted
// `border[-side]:` / `outline:` declarations (graphical axis).  Nested
// media queries etc. are handled naturally because we track brace
// depth.
const rules = [];
const graphicalRules = [];
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

  // R17 (2026-08-28) - GRAPHICAL AXIS scan. Only DASHED / DOTTED
  // border shorthands qualify; solid borders are usually card frames
  // or dividers where a low-saturation tone is intentional. Dashed
  // and dotted borders in this codebase carry INFORMATION (projection
  // outlines, target lines, forecast overlays) and must clear WCAG's
  // 3.0:1 graphical-objects threshold against the surface behind them.
  //
  // Also scans `outline:` shorthands with the same heuristic.
  const dashedBorderMatches = [...flatBody.matchAll(
    /(?:^|\s|;)(border(?:-(?:top|right|bottom|left))?|outline)\s*:\s*([^;{}]+)/g,
  )];
  for (const dm of dashedBorderMatches) {
    const prop  = dm[1];
    const value = dm[2].trim();
    // Skip solid / initial / inherit / 0 / none - not an info mark.
    if (!/\b(dashed|dotted)\b/.test(value)) continue;
    // Extract the color from the tail of the shorthand. Support #hex
    // or var(--token[, fallback]) shapes.
    const varM = value.match(/var\(--[a-z0-9-]+(?:\s*,\s*[^)]+)?\)/i);
    const hexM = value.match(/#[0-9a-fA-F]{3,8}/);
    const raw = varM ? varM[0] : (hexM ? hexM[0] : null);
    if (!raw) continue;
    const sels = selectorRaw.split(",").map(s => s.trim()).filter(Boolean);
    for (const sel of sels) graphicalRules.push({ sel, raw, prop });
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
  // Owned-background selectors bypass the light-surface gate and are
  // scored against their known background token. Measurement on merit
  // per Kevin's PR #916 review: "The probe measures on merit after the
  // fix." Replaces the DARK_CONTEXT_FRAGMENTS silent-skip for
  // .ona / .kpi-ov-bt / .kpi-ov-ticker-st / .kpi-p-fail-retry.
  const bgToken = ownedBackgroundToken(sel);
  if (bgToken) {
    const hex = resolveColor(raw);
    if (!hex) continue;
    const bgHex = PALETTE[bgToken];
    if (!bgHex) continue;
    const c = contrast(hex, bgHex);
    let tier;
    if (c < 4.5) tier = "FAIL";
    else if (c < 5.0) tier = "BORDERLINE";
    else tier = "PASS";
    findings.push({ sel, raw, hex, cWhite: c, cNear: c, worst: c, tier, reason: `owned-background: measured on ${bgToken} (${bgHex})` });
    continue;
  }
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

// ─── Score dashed / dotted border colors against light surface ────────
// WCAG 3.0:1 minimum for graphical objects (dashed outlines,
// projection extensions, target lines, forecast overlays).  Below that
// the mark is not readable and might as well not be rendered.  Same
// LIGHT_SURFACE_PREFIXES gate as the text axis.
const graphicalFindings = [];
for (const { sel, raw, prop } of graphicalRules) {
  if (!isLightSurfaceSelector(sel)) continue;
  const hex = resolveColor(raw);
  if (!hex) continue;
  const cWhite = contrast(hex, WHITE);
  const cNear = contrast(hex, NEAR_WHITE);
  const worst = Math.min(cWhite, cNear);
  const waiverKey = `${sel} [${prop}]`;
  const waiverReason = GRAPHICAL_WAIVERS.get(waiverKey);
  let tier;
  if (waiverReason) tier = "WAIVER";
  else if (worst < 3.0) tier = "FAIL";
  else if (worst < 3.5) tier = "BORDERLINE";
  else tier = "PASS";
  graphicalFindings.push({ sel, raw, hex, prop, cWhite, cNear, worst, tier, waiverReason });
}

// ─── Report ───────────────────────────────────────────────────────────
console.log("=".repeat(78));
console.log("KPI light-surface visual-contrast sweep (text + graphical axes)");
console.log("=".repeat(78));

const fails = findings.filter(f => f.tier === "FAIL")
  .sort((a, b) => a.worst - b.worst);
const borderline = findings.filter(f => f.tier === "BORDERLINE")
  .sort((a, b) => a.worst - b.worst);

console.log("");
console.log(`TEXT FAIL (color: < 4.5:1 on white or --n-50):  ${fails.length}`);
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
console.log(`TEXT BORDERLINE (4.5-5.0:1 on white):  ${borderline.length}`);
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
console.log(`TEXT PASS (>= 5.0:1 on white):  ${findings.length - fails.length - borderline.length - waivers.length}`);

// ─── Graphical axis report (R17 addition) ────────────────────────────
const gFails = graphicalFindings.filter(f => f.tier === "FAIL")
  .sort((a, b) => a.worst - b.worst);
const gBorderline = graphicalFindings.filter(f => f.tier === "BORDERLINE")
  .sort((a, b) => a.worst - b.worst);
console.log("");
console.log("=".repeat(78));
console.log(`GRAPHICAL FAIL (dashed/dotted border < 3.0:1 on white): ${gFails.length}`);
console.log("-".repeat(78));
const gGrouped = new Map();
for (const f of gFails) {
  const key = `${f.raw} → ${f.hex}`;
  const g = gGrouped.get(key) || { raw: f.raw, hex: f.hex, worst: f.worst, sels: new Set() };
  g.sels.add(`${f.sel} [${f.prop}]`);
  gGrouped.set(key, g);
}
for (const [key, g] of [...gGrouped.entries()].sort((a, b) => a[1].worst - b[1].worst)) {
  console.log(`  ${key}   contrast ${g.worst.toFixed(2)}:1   (${g.sels.size} selectors)`);
  const sample = [...g.sels].sort().slice(0, 6);
  for (const s of sample) console.log(`      ${s}`);
  if (g.sels.size > sample.length) console.log(`      ...+${g.sels.size - sample.length} more`);
}
console.log("");
console.log(`GRAPHICAL BORDERLINE (3.0-3.5:1 on white):  ${gBorderline.length}`);
console.log("-".repeat(78));
for (const f of gBorderline) {
  console.log(`  ${f.sel} [${f.prop}]   ${f.raw} → ${f.hex}   contrast ${f.worst.toFixed(2)}:1`);
}
console.log("");
const gWaivers = graphicalFindings.filter(f => f.tier === "WAIVER");
console.log("");
console.log(`GRAPHICAL WAIVER:  ${gWaivers.length}`);
console.log("-".repeat(78));
for (const w of gWaivers) {
  console.log(`  ${w.sel} [${w.prop}]   ${w.raw} → ${w.hex}   contrast ${w.worst.toFixed(2)}:1`);
  console.log(`      (waived: ${w.waiverReason})`);
}

console.log("");
console.log(`GRAPHICAL PASS (>= 3.5:1 on white):  ${graphicalFindings.length - gFails.length - gBorderline.length - gWaivers.length}`);

console.log("=".repeat(78));
console.log(`total light-surface declarations scanned: text=${findings.length} graphical=${graphicalFindings.length}`);
console.log("=".repeat(78));

// Regression net: non-zero exit if any FAIL (text or graphical) survives after waivers.
process.exit(fails.length > 0 || gFails.length > 0 ? 1 : 0);
