// Permanent audit: walk scripts/ and catch every class of relocation
// / alias-resolution bug where a probe's path assumption became stale.
//
// Post-#763 (probe-relocation into scripts/probes/) two shapes had
// silently broken:
//   1. Relative `import ... from "../src/..."` - path is correct
//      from the old scripts/ location, one dir too shallow from the
//      new scripts/probes/ location.
//   2. `REPO_ROOT = path.resolve(path.dirname(__filename), "..")` -
//      resolves to scripts/ instead of the actual repo root; every
//      `fs.readFileSync(path.join(REPO_ROOT, "src/..."))` call
//      downstream then hits a missing path.
//
// Cleanup-batch extension (2026-09-01, Kevin ruling): also flag every
// CLI-reachable module that imports through the `@/` alias without
// the `--import ./scripts/_setup/register-aliases.mjs` loader wired
// in its documented invocation or npm scripts. This is the shape that
// broke academy-issue.mjs during the migration-6 arc; the prior audit
// missed it for three reasons - it walked only scripts/probes/, it
// classified `@/*` as an absolute-and-skip specifier, and it did not
// follow imports transitively into src/.
//
// Runs as part of the standing sweep + can be invoked directly:
//   node scripts/_audit_probe_imports.mjs

import { promises as fs } from "node:fs";
import path from "node:path";
import url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const PROBE_DIR = path.join(HERE, "probes");
const SCRIPTS_DIR = HERE;
const REAL_REPO_ROOT = path.resolve(HERE, "..");
const SRC_DIR = path.join(REAL_REPO_ROOT, "src");
const PKG_JSON = path.join(REAL_REPO_ROOT, "package.json");
const LOADER_HINT = "register-aliases";

const IMPORT_RE = /(?:^|\s)(?:import\s+[^"']*from\s+|import\s+)(["'])([^"']+)\1/g;
const REPO_ROOT_RE = /REPO_ROOT\s*=\s*path\.resolve\s*\(\s*path\.dirname\s*\(\s*__filename\s*\)\s*,\s*((?:["'][^"']+["']\s*,?\s*)+)\)/g;

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules if we ever end up under one; skip _setup
      // (the alias loader itself).
      if (entry.name === "node_modules") continue;
      out.push(...await walk(p));
    } else if (entry.isFile() && (p.endsWith(".mjs") || p.endsWith(".js"))) {
      out.push(p);
    }
  }
  return out;
}

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

// Distinguishes files from directories - fs.access(dir) returns true
// for directories too, which bit the graph walker when `import x from
// "./foo"` had a same-name directory nearby (the audit tried to
// readFile the directory and threw EISDIR).
async function isFile(p) {
  try { const s = await fs.stat(p); return s.isFile(); } catch { return false; }
}

// Resolve one import specifier against a source file. Returns the
// absolute path to the target file if resolvable, or null.
async function resolveSpec(fromFile, spec) {
  const dir = path.dirname(fromFile);
  let base;
  if (spec.startsWith("@/")) {
    base = path.join(SRC_DIR, spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = path.resolve(dir, spec);
  } else {
    return null; // bare npm / node: - not our concern
  }
  const candidates = [
    base + ".js", base + ".mjs", base + ".jsx",
    path.join(base, "index.js"), path.join(base, "index.mjs"),
    base, // bare base last - only if it's an actual FILE, not a directory
  ];
  for (const c of candidates) {
    if (await isFile(c)) return c;
  }
  return null;
}

// Read every import specifier from a source file. Returns
// [{ spec, isAlias, isRelative, resolved }].
async function readImports(file) {
  const src = await fs.readFile(file, "utf8");
  const out = [];
  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[2];
    const isAlias = spec.startsWith("@/");
    const isRelative = spec.startsWith(".");
    let resolved = null;
    if (isAlias || isRelative) resolved = await resolveSpec(file, spec);
    out.push({ spec, isAlias, isRelative, resolved });
  }
  return out;
}

// Follow the transitive import graph from a set of CLI entry files.
// Returns Map<absolute file path, { entries: Set<entry> }> for every
// file reachable through relative + `@/` imports.
async function buildGraph(entries) {
  const graph = new Map();
  const queue = entries.map((e) => ({ file: e, root: e }));
  while (queue.length > 0) {
    const { file, root } = queue.shift();
    const seen = graph.get(file);
    if (seen) {
      seen.entries.add(root);
      continue;
    }
    graph.set(file, { entries: new Set([root]) });
    let imports;
    try {
      imports = await readImports(file);
    } catch {
      continue; // unreadable file - skip
    }
    for (const imp of imports) {
      if (imp.resolved) queue.push({ file: imp.resolved, root });
    }
  }
  return graph;
}

// Load package.json + find scripts whose command line touches the
// loader hint. Returns Set<absolute-file-path> of every .mjs/.js
// referenced in one of those loader-covered scripts.
async function loaderCoveredEntrypoints() {
  const covered = new Set();
  try {
    const pkg = JSON.parse(await fs.readFile(PKG_JSON, "utf8"));
    const scripts = pkg.scripts || {};
    for (const [, cmd] of Object.entries(scripts)) {
      if (!String(cmd).includes(LOADER_HINT)) continue;
      // Extract file arguments (crude - any token that looks like a path
      // to a .mjs / .js file and starts with `scripts/`).
      for (const token of String(cmd).split(/\s+/)) {
        if (/^scripts\//.test(token) && (token.endsWith(".mjs") || token.endsWith(".js"))) {
          covered.add(path.join(REAL_REPO_ROOT, token));
        }
      }
    }
  } catch { /* no package.json - covered stays empty */ }
  return covered;
}

// Does a file's own header comment document a loader-based invocation?
// Read the first ~60 lines and look for `--import ... register-aliases`.
async function headerDocumentsLoader(file) {
  try {
    const src = await fs.readFile(file, "utf8");
    const head = src.split("\n").slice(0, 80).join("\n");
    return head.includes(LOADER_HINT);
  } catch { return false; }
}

// ─── Original probe-relocation check ───────────────────────────────
// Kept intact from the pre-cleanup version. Walks scripts/probes/**
// specifically because probe relocation is what the check was born
// to catch.
async function probeRelocationCheck() {
  const files = await walk(PROBE_DIR);
  let brokenImports = 0, okImports = 0, absoluteImports = 0;
  let brokenRepoRoots = 0, okRepoRoots = 0;
  const brokenByFile = new Map();
  const noteBroken = (file, kind, detail) => {
    const key = path.relative(HERE, file);
    if (!brokenByFile.has(key)) brokenByFile.set(key, []);
    brokenByFile.get(key).push(`[${kind}] ${detail}`);
  };
  for (const f of files) {
    const src = await fs.readFile(f, "utf8");
    const dir = path.dirname(f);
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[2];
      if (!spec.startsWith(".")) { absoluteImports++; continue; }
      const resolved = path.resolve(dir, spec);
      const candidates = [
        resolved, resolved + ".js", resolved + ".mjs",
        path.join(resolved, "index.js"), path.join(resolved, "index.mjs"),
      ];
      let found = false;
      for (const c of candidates) if (await fileExists(c)) { found = true; break; }
      if (found) okImports++;
      else { brokenImports++; noteBroken(f, "import", spec); }
    }
    for (const m of src.matchAll(REPO_ROOT_RE)) {
      const args = m[1].split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      const resolvedRepoRoot = path.resolve(dir, ...args);
      if (resolvedRepoRoot === REAL_REPO_ROOT) okRepoRoots++;
      else {
        brokenRepoRoots++;
        noteBroken(f, "REPO_ROOT", `resolves to ${path.relative(REAL_REPO_ROOT, resolvedRepoRoot) || "."} - expected repo root`);
      }
    }
  }
  return { files, brokenImports, okImports, absoluteImports, brokenRepoRoots, okRepoRoots, brokenByFile };
}

// ─── New alias-in-CLI-graph check ──────────────────────────────────
// Walks all of scripts/**, builds the transitive import graph
// (resolving @/ -> src/), and flags every file in the graph that
// carries a `from "@/..."` import. Classifies each flagged file as
// COVERED (loader wired via package.json or its own header documents
// the invocation) or EXPOSED (no loader coverage found; running the
// entry that reaches this file with a bare `node ...` will fail with
// ERR_MODULE_NOT_FOUND).
async function aliasInCliGraphCheck() {
  const entries = await walk(SCRIPTS_DIR);
  // Exclude the alias loader itself + this audit script (they are
  // infrastructure, not CLI entrypoints in the sense the check cares
  // about).
  const filteredEntries = entries.filter((f) => {
    const rel = path.relative(SCRIPTS_DIR, f);
    return !rel.startsWith("_setup/") && rel !== "_audit_probe_imports.mjs";
  });
  const graph = await buildGraph(filteredEntries);
  const coveredEntries = await loaderCoveredEntrypoints();

  // Find every file in the graph that uses @/ in its own imports.
  const flagged = [];
  for (const [file] of graph) {
    const imports = await readImports(file);
    const aliasImports = imports.filter((i) => i.isAlias).map((i) => i.spec);
    if (aliasImports.length === 0) continue;
    // Classify by looking at every entry that reaches this file: if
    // ANY reaching entry is loader-covered (either via package.json
    // OR via the entry's own header documenting the invocation), the
    // usage is safe. Only when NO reaching entry has coverage does
    // the alias-import become a runtime-fail risk.
    const reaching = [...graph.get(file).entries];
    let covered = false;
    for (const ent of reaching) {
      if (coveredEntries.has(ent) || await headerDocumentsLoader(ent)) {
        covered = true;
        break;
      }
    }
    flagged.push({
      file: path.relative(REAL_REPO_ROOT, file),
      aliasImports,
      reaching: reaching.map((r) => path.relative(REAL_REPO_ROOT, r)),
      covered,
    });
  }

  return {
    entriesScanned: filteredEntries.length,
    graphSize: graph.size,
    coveredEntries: coveredEntries.size,
    flagged,
  };
}

// ─── Run + report ──────────────────────────────────────────────────
const probeCheck = await probeRelocationCheck();
console.log(`scripts/probes/  scanned: ${probeCheck.files.length} files`);
console.log(`  relative imports OK:       ${probeCheck.okImports}`);
console.log(`  bare/absolute imports:     ${probeCheck.absoluteImports}  (node: / @ / bare - not checked in this pass)`);
console.log(`  relative imports BROKEN:   ${probeCheck.brokenImports}`);
console.log(`  REPO_ROOT resolves OK:     ${probeCheck.okRepoRoots}`);
console.log(`  REPO_ROOT resolves WRONG:  ${probeCheck.brokenRepoRoots}`);
console.log(`  total broken across:       ${probeCheck.brokenByFile.size} file(s)`);
console.log("");

const aliasCheck = await aliasInCliGraphCheck();
const highRisk = aliasCheck.flagged.filter((f) => !f.covered);
console.log(`scripts/**       alias-in-CLI-graph check:`);
console.log(`  script entries scanned:    ${aliasCheck.entriesScanned}`);
console.log(`  files in CLI graph:        ${aliasCheck.graphSize}`);
console.log(`  package.json loader-covered entries: ${aliasCheck.coveredEntries}`);
console.log(`  files with @/ imports:     ${aliasCheck.flagged.length}`);
console.log(`  high-risk (no loader coverage): ${highRisk.length}`);
console.log("");

if (probeCheck.brokenByFile.size > 0) {
  console.log("Broken by file (probe-relocation check):");
  for (const [f, entries] of [...probeCheck.brokenByFile.entries()].sort()) {
    console.log(`  ${f}`);
    for (const e of entries) console.log(`    -> ${e}`);
  }
}

if (aliasCheck.flagged.length > 0) {
  console.log("Files using @/ imports in CLI-reachable graph:");
  for (const item of aliasCheck.flagged.sort((a, b) => a.file.localeCompare(b.file))) {
    const tag = item.covered ? "[COVERED]" : "[EXPOSED]";
    console.log(`  ${tag} ${item.file}`);
    for (const spec of item.aliasImports) console.log(`             import "${spec}"`);
  }
}

// Only fail the audit on genuine breakage. Alias-in-CLI-graph is
// REPORT-ONLY: a brand-new lint that fails CI on day one gets
// disabled rather than fixed. Establish signal first; wire in
// separately after the false-positive rate is known.
if (probeCheck.brokenByFile.size > 0) process.exit(1);
