// Permanent audit: walk scripts/probes/ and catch every class of
// relocation bug where a probe's path assumption became stale.
// Post-#763 (probe-relocation into scripts/probes/) two shapes had
// silently broken:
//   1. Relative `import ... from "../src/..."` - path is correct
//      from the old scripts/ location, one dir too shallow from the
//      new scripts/probes/ location.
//   2. `REPO_ROOT = path.resolve(path.dirname(__filename), "..")` -
//      resolves to scripts/ instead of the actual repo root; every
//      `fs.readFileSync(path.join(REPO_ROOT, "src/..."))` call
//      downstream then hits a missing path.
// The next relocation must not do this quietly - this file is what
// prevents that. Runs as part of the standing sweep + can be invoked
// directly: `node scripts/_audit_probe_imports.mjs`.

import { promises as fs } from "node:fs";
import path from "node:path";
import url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const PROBE_DIR = path.join(HERE, "probes");

const IMPORT_RE = /(?:^|\s)(?:import\s+[^"']*from\s+|import\s+)(["'])([^"']+)\1/g;

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(p));
    else if (entry.isFile() && (p.endsWith(".mjs") || p.endsWith(".js"))) out.push(p);
  }
  return out;
}

async function fileExists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

// Detect `REPO_ROOT = path.resolve(path.dirname(__filename), "..")`
// where the resolved path is not the actual repo root (heuristic:
// look for package.json at the resolved location).
const REPO_ROOT_RE = /REPO_ROOT\s*=\s*path\.resolve\s*\(\s*path\.dirname\s*\(\s*__filename\s*\)\s*,\s*((?:["'][^"']+["']\s*,?\s*)+)\)/g;

const REAL_REPO_ROOT = path.resolve(HERE, "..");

const files = await walk(PROBE_DIR);
let brokenImports = 0, okImports = 0, absoluteImports = 0;
let brokenRepoRoots = 0, okRepoRoots = 0;
const brokenByFile = new Map();

function noteBroken(file, kind, detail) {
  const key = path.relative(HERE, file);
  if (!brokenByFile.has(key)) brokenByFile.set(key, []);
  brokenByFile.get(key).push(`[${kind}] ${detail}`);
}

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
    // Reconstruct what the code resolves to.
    const args = m[1].split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    const resolvedRepoRoot = path.resolve(dir, ...args);
    if (resolvedRepoRoot === REAL_REPO_ROOT) okRepoRoots++;
    else {
      brokenRepoRoots++;
      noteBroken(f, "REPO_ROOT", `resolves to ${path.relative(REAL_REPO_ROOT, resolvedRepoRoot) || "."} - expected repo root`);
    }
  }
}

console.log(`scripts/probes/  scanned: ${files.length} files`);
console.log(`  relative imports OK:       ${okImports}`);
console.log(`  bare/absolute imports:     ${absoluteImports}  (node: / @ / bare - not checked)`);
console.log(`  relative imports BROKEN:   ${brokenImports}`);
console.log(`  REPO_ROOT resolves OK:     ${okRepoRoots}`);
console.log(`  REPO_ROOT resolves WRONG:  ${brokenRepoRoots}`);
console.log(`  total broken across:       ${brokenByFile.size} file(s)`);
console.log("");
if (brokenByFile.size > 0) {
  console.log("Broken by file:");
  for (const [f, entries] of [...brokenByFile.entries()].sort()) {
    console.log(`  ${f}`);
    for (const e of entries) console.log(`    -> ${e}`);
  }
  process.exit(1);
}
