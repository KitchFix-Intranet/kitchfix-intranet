#!/usr/bin/env node
// scripts/gen_design_docs.mjs
//
// Generates the VALUE sections of the design docs from the code so
// they cannot drift. Prose outside GENERATED markers is preserved
// untouched. Kevin's principle: docs that restate values will always
// drift; docs that carry decisions do not. Values are generated;
// prose is hand-maintained.
//
// Reads:
//   src/app/tokens.css                    - the canonical source
//   src/app/kpi/kpi.css                   - --kpi-* + --kf-scale overrides
//   (add module stylesheets here as they claim their own namespaces)
//
// Writes:
//   docs/DESIGN_TOKENS.md
//   docs/DESIGN_SYSTEM_REFERENCE.md
//
// Marker convention:
//   <!-- GENERATED:<block-name> START - do not edit by hand, run scripts/gen_design_docs.mjs -->
//   ... generated content ...
//   <!-- GENERATED:<block-name> END -->
//
// USAGE:
//   node scripts/gen_design_docs.mjs
//   node scripts/gen_design_docs.mjs --check   (fails if generated blocks differ from disk)

import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const TOKENS_CSS = path.join(REPO_ROOT, "src/app/tokens.css");
const KPI_CSS = path.join(REPO_ROOT, "src/app/kpi/kpi.css");
const OPD_CSS = path.join(REPO_ROOT, "src/app/opd/opd.css");
const DOC_TOKENS = path.join(REPO_ROOT, "docs/DESIGN_TOKENS.md");
const DOC_REF = path.join(REPO_ROOT, "docs/DESIGN_SYSTEM_REFERENCE.md");

const CHECK_MODE = process.argv.includes("--check");

// ─── CSS parsing ──────────────────────────────────────────────────

function readFile(p) {
  return fs.readFileSync(p, "utf8");
}

// Extract all --var: value; declarations from a CSS text. Returns an
// array of { name, value, line, scope } - scope is the nearest
// enclosing selector (`:root`, `.scv2`, `.kpi-app`, etc.) or "root"
// as a fallback. Multi-line rules are handled by pairing braces.
function extractDeclarations(css) {
  const out = [];
  const lines = css.split("\n");
  const scopeStack = ["root"];
  let inComment = false;

  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    // Strip comments (very rough - only handles single-line).
    if (inComment) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      line = line.slice(end + 2);
      inComment = false;
    }
    // Strip inline /* ... */ that fits on one line.
    line = line.replace(/\/\*[^]*?\*\//g, "");
    if (line.includes("/*")) {
      line = line.slice(0, line.indexOf("/*"));
      inComment = true;
    }

    // Scope tracking: match `selector {` starts and `}` ends.
    // We only care about the last opened scope for attribution.
    const openMatch = line.match(/([.:#\[\]a-zA-Z0-9_ -]+)\s*\{/);
    if (openMatch) scopeStack.push(openMatch[1].trim());
    if (/^\s*\}/.test(line)) scopeStack.pop();

    // --var: value; declarations. Multiple can appear on one line.
    const declRe = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
    let m;
    while ((m = declRe.exec(line)) !== null) {
      out.push({
        name: `--${m[1]}`,
        value: m[2].trim(),
        line: i + 1,
        scope: scopeStack[scopeStack.length - 1] || "root",
      });
    }
  }
  return out;
}

// Resolve one level of var() references. e.g. `var(--navy-700)` -> `#153968`.
// Loops until stable or 10 iterations. Not a full CSS resolver; enough
// for the two-tier semantic model.
function resolveVar(value, byName, seen = new Set()) {
  const varRe = /var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([^)]*))?\)/g;
  let out = value;
  let changed = true;
  let iters = 0;
  while (changed && iters < 10) {
    changed = false; iters += 1;
    out = out.replace(varRe, (_, name, fallback) => {
      if (seen.has(name)) return `[[cycle:${name}]]`;
      const dep = byName.get(name);
      if (dep) { changed = true; return dep.value; }
      if (fallback) { changed = true; return fallback.trim(); }
      return `[[unresolved:${name}]]`;
    });
  }
  return out;
}

// Given a token map, produce a resolved value view (best-effort).
function buildResolvedMap(decls) {
  const byName = new Map();
  for (const d of decls) if (!byName.has(d.name)) byName.set(d.name, d);
  const resolved = new Map();
  for (const d of decls) {
    resolved.set(d.name, resolveVar(d.value, byName, new Set([d.name])));
  }
  return { byName, resolved };
}

// ─── Emitters ─────────────────────────────────────────────────────

function fmtTable(headers, rows) {
  const lines = [];
  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(`|${headers.map(() => "---").join("|")}|`);
  for (const r of rows) lines.push(`| ${r.map(x => String(x).replaceAll("|", "\\|")).join(" | ")} |`);
  return lines.join("\n");
}

function extractRamp(decls, prefix) {
  // Returns an ordered list of {name, hex} for tokens matching --{prefix}-{step}.
  const re = new RegExp(`^--${prefix}-([0-9]+)$`);
  const rows = [];
  for (const d of decls) {
    if (d.scope !== "root" && d.scope !== ":root") continue;
    const m = d.name.match(re);
    if (!m) continue;
    rows.push({ step: Number(m[1]), name: d.name, value: d.value });
  }
  rows.sort((a, b) => a.step - b.step);
  return rows;
}

function emitColorRamps(decls) {
  const families = [
    ["Navy (brand, 700)", "navy"],
    ["Amber (accent, 500)", "amber"],
    ["Green (success, 500)", "green"],
    ["Red (danger, 500)", "red"],
    ["Neutral (n)", "n"],
  ];
  const parts = [];
  for (const [label, prefix] of families) {
    const rows = extractRamp(decls, prefix);
    if (rows.length === 0) continue;
    parts.push(`**${label}**`);
    parts.push("");
    parts.push(fmtTable(
      ["Token", "Hex"],
      rows.map(r => [`\`${r.name}\``, r.value])
    ));
    parts.push("");
  }
  // Also emit the single-token "mint" + fill-* families.
  const others = decls.filter(d =>
    (d.scope === "root" || d.scope === ":root") &&
    (/^--mint-/.test(d.name) || /^--fill-/.test(d.name))
  );
  if (others.length) {
    parts.push(`**Named neutrals / soft fills**`);
    parts.push("");
    parts.push(fmtTable(["Token", "Value"], others.map(d => [`\`${d.name}\``, d.value])));
    parts.push("");
  }
  return parts.join("\n");
}

function emitTypeScale(decls, resolved) {
  const rows = decls
    .filter(d => (d.scope === "root" || d.scope === ":root") && /^--size-/.test(d.name))
    .map(d => [`\`${d.name}\``, d.value]);
  const weightRows = decls
    .filter(d => (d.scope === "root" || d.scope === ":root") && /^--wt-/.test(d.name))
    .map(d => [`\`${d.name}\``, d.value]);
  const leadingRows = decls
    .filter(d => (d.scope === "root" || d.scope === ":root") && /^--(lead|lb|track)-/.test(d.name))
    .map(d => [`\`${d.name}\``, d.value, resolved.get(d.name) || d.value]);
  const parts = [];
  parts.push(`**Type sizes**`);
  parts.push("");
  parts.push(fmtTable(["Token", "Value"], rows));
  parts.push("");
  parts.push(`**Weights**`);
  parts.push("");
  parts.push(fmtTable(["Token", "Value"], weightRows));
  parts.push("");
  parts.push(`**Leading + tracking**`);
  parts.push("");
  parts.push(fmtTable(["Token", "Declared", "Resolved"], leadingRows));
  parts.push("");
  return parts.join("\n");
}

function emitSpacing(decls) {
  const rows = decls
    .filter(d => (d.scope === "root" || d.scope === ":root") && /^--space-[0-9]+$/.test(d.name))
    .sort((a, b) => Number(a.name.replace(/[^0-9]/g, "")) - Number(b.name.replace(/[^0-9]/g, "")))
    .map(d => [`\`${d.name}\``, d.value]);
  return fmtTable(["Token", "Value"], rows);
}

function emitRadius(decls) {
  const rows = decls
    .filter(d => (d.scope === "root" || d.scope === ":root") && /^--rad-/.test(d.name))
    .map(d => [`\`${d.name}\``, d.value]);
  return fmtTable(["Token", "Value"], rows);
}

function emitFontStacks(decls) {
  const rows = decls
    .filter(d => (d.scope === "root" || d.scope === ":root") && /^--font-/.test(d.name))
    .map(d => [`\`${d.name}\``, d.value]);
  return fmtTable(["Token", "Value"], rows);
}

function emitSemanticTokens(decls, resolved) {
  const groups = [
    ["Text", /^--text-/],
    ["Surface", /^--surface-/],
    ["Border", /^--border-/],
    ["Action", /^--action-/],
    ["Accent", /^--accent(-|$)/],
    ["Feedback + status", /^--(feedback|status)-/],
  ];
  const parts = [];
  for (const [label, re] of groups) {
    const rows = decls
      .filter(d => (d.scope === "root" || d.scope === ":root") && re.test(d.name))
      .map(d => {
        const rez = resolved.get(d.name) || d.value;
        const shown = rez === d.value ? d.value : `${d.value} → ${rez}`;
        return [`\`${d.name}\``, shown];
      });
    if (rows.length === 0) continue;
    parts.push(`**${label}**`);
    parts.push("");
    parts.push(fmtTable(["Token", "Resolved"], rows));
    parts.push("");
  }
  return parts.join("\n");
}

function emitNamespacedTokens(decls) {
  const namespaces = [
    ["`--sc2-*`", /^--sc2-/],
    ["`--opd-*`", /^--opd-/],
    ["`--kpi-*`", /^--kpi-/],
    ["`--kf-*`", /^--kf-/],
  ];
  const parts = [];
  for (const [label, re] of namespaces) {
    const set = decls.filter(d => re.test(d.name));
    if (set.length === 0) continue;
    parts.push(`**${label}** (${set.length} declarations)`);
    parts.push("");
    // Group by scope
    const byScope = new Map();
    for (const d of set) {
      const s = d.scope === "root" ? ":root" : d.scope;
      if (!byScope.has(s)) byScope.set(s, []);
      byScope.get(s).push(d);
    }
    for (const [scope, rows] of byScope) {
      parts.push(`*Scope \`${scope}\`:* ${rows.length} tokens`);
    }
    parts.push("");
    parts.push(fmtTable(
      ["Token", "Scope", "Value"],
      set.map(d => [`\`${d.name}\``, `\`${d.scope}\``, d.value.length > 60 ? d.value.slice(0, 57) + "..." : d.value])
    ));
    parts.push("");
  }
  return parts.join("\n");
}

// ─── Marker replacement ───────────────────────────────────────────

function replaceMarkerBlock(doc, blockName, newBody) {
  const startMarker = `<!-- GENERATED:${blockName} START - do not edit by hand, run scripts/gen_design_docs.mjs -->`;
  const endMarker = `<!-- GENERATED:${blockName} END -->`;
  const startIdx = doc.indexOf(startMarker);
  const endIdx = doc.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) {
    // Block not present yet; append at end.
    return doc.trimEnd() + "\n\n" + startMarker + "\n" + newBody.trim() + "\n" + endMarker + "\n";
  }
  return (
    doc.slice(0, startIdx + startMarker.length) +
    "\n" + newBody.trim() + "\n" +
    doc.slice(endIdx)
  );
}

// ─── Main ─────────────────────────────────────────────────────────

function main() {
  const tokensCss = readFile(TOKENS_CSS);
  const kpiCss = fs.existsSync(KPI_CSS) ? readFile(KPI_CSS) : "";
  const opdCss = fs.existsSync(OPD_CSS) ? readFile(OPD_CSS) : "";
  const declsTokens = extractDeclarations(tokensCss).map(d => ({ ...d, source: "tokens.css" }));
  const declsKpi = extractDeclarations(kpiCss).map(d => ({ ...d, source: "kpi.css" }));
  const declsOpd = extractDeclarations(opdCss).map(d => ({ ...d, source: "opd.css" }));
  const allDecls = [...declsTokens, ...declsKpi, ...declsOpd];
  const { resolved } = buildResolvedMap(allDecls);

  // ─── DESIGN_TOKENS.md ───
  //
  // NO wall-clock timestamp in the emitted body. The generator runs
  // on every stylesheet change under CI (--check); a timestamp would
  // make `--check` fail on clean state because the timestamp always
  // changes. The commit SHA that produced this file lives in git.
  const tokensBody = [
    "> Generated from `src/app/tokens.css` (+ `src/app/kpi/kpi.css`, `src/app/opd/opd.css` where namespaced). Run `node scripts/gen_design_docs.mjs` to refresh. Prose outside this marker is hand-maintained.",
    "",
    "### Color ramps",
    "",
    emitColorRamps(allDecls),
    "### Type scale",
    "",
    emitTypeScale(allDecls, resolved),
    "### Spacing",
    "",
    emitSpacing(allDecls),
    "",
    "### Radius",
    "",
    emitRadius(allDecls),
    "",
    "### Font stacks",
    "",
    emitFontStacks(allDecls),
    "",
    "### Semantic tokens (Tier 2)",
    "",
    emitSemanticTokens(allDecls, resolved),
  ].join("\n");

  const tokensDoc = readFile(DOC_TOKENS);
  const tokensOut = replaceMarkerBlock(tokensDoc, "tokens", tokensBody);

  // ─── DESIGN_SYSTEM_REFERENCE.md ───
  const refBody = [
    "> Generated from the module stylesheets. Run `node scripts/gen_design_docs.mjs` to refresh. Prose outside this marker is hand-maintained.",
    "",
    "### Namespaced token sets (per-module identity)",
    "",
    emitNamespacedTokens(allDecls),
    "### Font stacks in use",
    "",
    emitFontStacks(allDecls),
    "",
    "### Type scale (root) with resolved values",
    "",
    emitTypeScale(allDecls, resolved),
  ].join("\n");

  const refDoc = readFile(DOC_REF);
  const refOut = replaceMarkerBlock(refDoc, "reference", refBody);

  // ─── Write or check ───
  if (CHECK_MODE) {
    const drift = [];
    if (tokensOut !== tokensDoc) drift.push("docs/DESIGN_TOKENS.md");
    if (refOut !== refDoc) drift.push("docs/DESIGN_SYSTEM_REFERENCE.md");
    if (drift.length === 0) {
      console.log("[gen_design_docs] no drift; generated blocks match disk");
      return 0;
    }
    console.error(`[gen_design_docs] DRIFT in ${drift.length} file(s):\n  ${drift.join("\n  ")}`);
    console.error("Run: node scripts/gen_design_docs.mjs   (then commit)");
    return 1;
  }
  fs.writeFileSync(DOC_TOKENS, tokensOut);
  fs.writeFileSync(DOC_REF, refOut);
  console.log(`[gen_design_docs] wrote ${DOC_TOKENS}`);
  console.log(`[gen_design_docs] wrote ${DOC_REF}`);
  return 0;
}

process.exit(main());
