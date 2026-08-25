// scripts/probes/_probe_kpi_class_audit.mjs
//
// Owner ruling 2026-08-24 after live verify caught .kpi-wh-tgt-basis:
// a className rendered in JSX with ZERO matching rule in kpi.css
// inherits body defaults and looks broken in a place designed for a
// smaller scale. That specific one shipped in #718 (salary PR 3),
// only surfaced with salary on, and slipped past every live verify
// until it did.
//
// This audit walks every className token used in JSX under
// src/app/kpi/labor and src/app/kpi/purchasing and reports any that
// have no `.<class>` definition in src/app/kpi/kpi.css. Purchasing's
// module CSS (purchasing.css) is also loaded so a class defined there
// does not trigger a false positive.
//
// Note: this is a REPORT probe, not a gate. Some unstyled classes
// are intentional - probe / test hooks, semantic markers used only
// for JS queries. Owner decides per-class: style it, delete it, or
// declare it as a known hook. Add hooks to WAIVERS below with a
// one-line reason.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

// ─── Waivers ──────────────────────────────────────────────────────────
// Classes intentionally unstyled - hooks for JS queries, Playwright
// selectors, or hover-only pseudo-state markers. Add with a comment
// naming the consumer.
const WAIVERS = new Set([
  // Homestand DOM probe hooks (see tests/kpi-hs-popovers.spec.ts:50)
  // - data-hs-help is preferred, but .on toggle stays.
]);

// Framework / third-party class prefixes that legitimately have no
// kpi.css definition (styled elsewhere or by libraries).
const IGNORE_PREFIXES = [
  "sr-only",   // Tailwind-style screen-reader helper
];

// ─── Read + scan ─────────────────────────────────────────────────────
function walkFiles(dir, exts) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walkFiles(full, exts));
    else if (exts.some(e => name.endsWith(e))) out.push(full);
  }
  return out;
}

const jsxFiles = [
  ...walkFiles(join(REPO_ROOT, "src/app/kpi/labor"), [".js", ".jsx"]),
  ...walkFiles(join(REPO_ROOT, "src/app/kpi/purchasing"), [".js", ".jsx"]),
];
const cssFiles = [
  join(REPO_ROOT, "src/app/kpi/kpi.css"),
  join(REPO_ROOT, "src/app/kpi/purchasing/purchasing.css"),
];

// Extract classNames from a JSX source. Handles:
//   className="literal one two"
//   className={`literal ${expr} literal2`}
//   className={cond ? "yes" : "no"}
//   className={"literal " + expr}
// Strategy: find every "..."-delimited string within a `className=` window
// or between backticks in template literals following `className=`.
function extractClassNames(src) {
  const classes = new Set();
  // Match className followed by = and then any string literals (single,
  // double, or backtick). Walk each className expression's ENTIRE
  // right-hand side to catch nested strings in ternaries and templates.
  const re = /className\s*=\s*(\{[^{}]*(?:\{[^}]*\}[^{}]*)*\}|"[^"]*"|'[^']*')/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const expr = m[1];
    // Pull every quoted or backticked string from the expression.
    const strRe = /"([^"]*)"|'([^']*)'|`([^`]*)`/g;
    let sm;
    while ((sm = strRe.exec(expr)) !== null) {
      const raw = sm[1] ?? sm[2] ?? sm[3] ?? "";
      // A template segment can contain interpolations that ARE class
      // tokens themselves (e.g. `kpi-tbl-band-${suffix}`). Skip the
      // `${...}` portions; the surrounding literal chunks are kept.
      const literal = raw.replace(/\$\{[^}]*\}/g, " ");
      for (const tok of literal.split(/\s+/)) {
        const t = tok.trim();
        if (!t) continue;
        classes.add(t);
      }
    }
  }
  return classes;
}

// Extract class names DEFINED in a CSS source. Class selectors are any
// `.name` occurrence outside comments + string literals. Simplified
// parser: strip comments, then match `\.[a-zA-Z_-][\w-]*`.
function extractDefinedClasses(src) {
  const defined = new Set();
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /\.([a-zA-Z_-][\w-]*)/g;
  let m;
  while ((m = re.exec(noComments)) !== null) defined.add(m[1]);
  return defined;
}

// ─── Build the two sets ─────────────────────────────────────────────
const usedByFile = new Map(); // class -> Set<file>
for (const f of jsxFiles) {
  const src = readFileSync(f, "utf8");
  const relFile = f.replace(REPO_ROOT + "/", "");
  for (const cls of extractClassNames(src)) {
    if (!usedByFile.has(cls)) usedByFile.set(cls, new Set());
    usedByFile.get(cls).add(relFile);
  }
}

const defined = new Set();
for (const f of cssFiles) {
  const src = readFileSync(f, "utf8");
  for (const cls of extractDefinedClasses(src)) defined.add(cls);
}

// ─── Diff ───────────────────────────────────────────────────────────
const unstyled = [];
for (const [cls, files] of usedByFile) {
  if (defined.has(cls)) continue;
  if (WAIVERS.has(cls)) continue;
  if (IGNORE_PREFIXES.some(p => cls.startsWith(p))) continue;
  // Report only kpi-* classes; others may be library-scoped and are
  // handled by their own stylesheets outside this audit.
  if (!cls.startsWith("kpi-")) continue;
  // Skip tokens ending with '-' - those are template-literal prefix
  // fragments left behind after the `${...}` interpolation was
  // stripped (e.g. `kpi-sig-state-${state}` -> `kpi-sig-state-`).
  // The resolved class name (e.g. kpi-sig-state-good) is what CSS
  // actually needs to match against.
  if (cls.endsWith("-")) continue;
  unstyled.push({ cls, files: [...files].sort() });
}
unstyled.sort((a, b) => a.cls.localeCompare(b.cls));

// ─── Report ─────────────────────────────────────────────────────────
console.log("=".repeat(78));
console.log("KPI JSX classNames without a matching kpi.css / purchasing.css rule");
console.log("=".repeat(78));
console.log("");
console.log(`scanned:  ${jsxFiles.length} JSX files, ${cssFiles.length} CSS files`);
console.log(`kpi-*     ${[...usedByFile.keys()].filter(c => c.startsWith("kpi-")).length} distinct class tokens used in JSX`);
console.log(`defined:  ${defined.size} distinct class selectors in CSS`);
console.log(`waivers:  ${WAIVERS.size}`);
console.log("");
console.log(`UNDEFINED (${unstyled.length}):`);
console.log("-".repeat(78));
if (unstyled.length === 0) {
  console.log("  none");
} else {
  for (const { cls, files } of unstyled) {
    console.log(`  .${cls}`);
    for (const f of files) console.log(`      ${f}`);
  }
}
console.log("");
console.log("=".repeat(78));
// Report probe (not a gate): exit 0 regardless so a CI wiring stays
// advisory. Promote to gate once the list is triaged and every
// remaining entry has a home in WAIVERS.
process.exit(0);
