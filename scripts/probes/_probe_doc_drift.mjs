#!/usr/bin/env node
// scripts/probes/_probe_doc_drift.mjs
//
// Doc-value drift probe. Read-only.
//
// PRINCIPLE (Kevin 2026-09-01)
//   Docs that restate values drift; docs that carry decisions do not.
//   Every value assertion in docs/ that is not inside a generated
//   block and not explicitly annotated is a drift risk. This probe
//   scans and reports.
//
// WHAT IT SCANS
//   All .md files under docs/. For each file:
//     - hex colours       #RGB, #RGBA, #RRGGBB, #RRGGBBAA
//     - pixel values      Ns, N.N followed by "px"
//     - font-family names 'Inter', 'JetBrains Mono', 'Oswald', 'Mulish', etc.
//
// GATES
//   OK   inside a `<!-- GENERATED:name START --> ... <!-- GENERATED:name END -->` block
//   OK   followed inline or on the previous line by `<!-- doc-value-ok: <reason> -->`
//   OK   the value matches a token declaration in src/app/tokens.css / kpi.css / opd.css
//   FAIL doc asserts a value the code does not carry (e.g. warm #F4F2EC for --surface-page)
//   FAIL value sits outside a generated block with no annotation
//
// FAIL-BUILD ONLY FOR THE GENERATED DOCS
//   docs/DESIGN_TOKENS.md and docs/DESIGN_SYSTEM_REFERENCE.md are
//   supposed to be generated. If they carry a value that the code
//   doesn't, that's a fail-the-build defect. All other docs report as
//   findings for triage but don't fail the build.
//
// SEEDED FAILURE (both directions)
//   SEEDED_FAILURE=wrong    injects a wrong value into a scratch file
//                           and verifies the probe FAILs on it.
//   SEEDED_FAILURE=ok       verifies an annotated value ACCEPTs.
//   SEEDED_FAILURE=1        runs both.
//
// USAGE
//   node scripts/probes/_probe_doc_drift.mjs
//   node scripts/probes/_probe_doc_drift.mjs --json > /tmp/drift.json
//   SEEDED_FAILURE=1 node scripts/probes/_probe_doc_drift.mjs

import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const DOCS_DIR = path.join(REPO_ROOT, "docs");
const TOKENS_CSS = path.join(REPO_ROOT, "src/app/tokens.css");
const KPI_CSS = path.join(REPO_ROOT, "src/app/kpi/kpi.css");
const OPD_CSS = path.join(REPO_ROOT, "src/app/opd/opd.css");
const GLOBALS_CSS = path.join(REPO_ROOT, "src/app/globals.css");

const GENERATED_DOCS = new Set([
  path.join(DOCS_DIR, "DESIGN_TOKENS.md"),
  path.join(DOCS_DIR, "DESIGN_SYSTEM_REFERENCE.md"),
]);

const ARGS = new Set(process.argv.slice(2));
const JSON_OUT = ARGS.has("--json");
const SEEDED = process.env.SEEDED_FAILURE || "";

// ─── Load code truth ──────────────────────────────────────────────

function loadCssValues() {
  const files = [TOKENS_CSS, KPI_CSS, OPD_CSS, GLOBALS_CSS].filter(f => fs.existsSync(f));
  const hexSet = new Set();
  const pxSet = new Set();
  const fontSet = new Set();
  const tokenByName = new Map();
  const HEX_RE = /#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b/g;
  const PX_RE = /\b\d+(?:\.\d+)?px\b/g;
  const FONT_RE = /'([^']+)'|"([^"]+)"/g;
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    (text.match(HEX_RE) || []).forEach(h => hexSet.add(h.toLowerCase()));
    (text.match(PX_RE) || []).forEach(p => pxSet.add(p));
    // Font names appear inside var(--font-*) definitions; parse them.
    for (const line of text.split("\n")) {
      if (/--font-|font-family/.test(line)) {
        let m;
        while ((m = FONT_RE.exec(line)) !== null) fontSet.add((m[1] || m[2]).trim());
      }
    }
    // Token declarations: --name: value;
    const decl = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/g;
    let dm;
    while ((dm = decl.exec(text)) !== null) {
      if (!tokenByName.has(`--${dm[1]}`)) tokenByName.set(`--${dm[1]}`, dm[2].trim());
    }
  }
  return { hexSet, pxSet, fontSet, tokenByName };
}

// ─── Scan a doc ───────────────────────────────────────────────────

const ANNOT_RE = /<!--\s*doc-value-ok:\s*([^-]+?)\s*-->/;
const GEN_START_RE = /<!-- GENERATED:([a-zA-Z0-9_-]+) START/;
const GEN_END_RE = /<!-- GENERATED:([a-zA-Z0-9_-]+) END/;

function scanDoc(filePath, code) {
  const rel = path.relative(REPO_ROOT, filePath);
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split("\n");
  const findings = [];
  const inGeneratedStack = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const prev = i > 0 ? lines[i - 1] : "";

    if (GEN_START_RE.test(line)) inGeneratedStack.push(line.match(GEN_START_RE)[1]);
    if (GEN_END_RE.test(line)) inGeneratedStack.pop();
    const inGenerated = inGeneratedStack.length > 0;

    const annotOnLine = ANNOT_RE.test(line);
    const annotOnPrev = ANNOT_RE.test(prev);
    const annotated = annotOnLine || annotOnPrev;

    // Hex colours
    for (const m of line.matchAll(/#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b/g)) {
      const hex = m[0].toLowerCase();
      const kind = "hex";
      const status = classify({ inGenerated, annotated, value: hex, kind, code });
      if (status !== "OK-code" || GENERATED_DOCS.has(filePath) === false) {
        findings.push({ file: rel, line: i + 1, kind, value: m[0], status, inGenerated, annotated });
      }
    }

    // Pixel values
    for (const m of line.matchAll(/\b(\d+(?:\.\d+)?)px\b/g)) {
      const kind = "px";
      const status = classify({ inGenerated, annotated, value: m[0], kind, code });
      if (status !== "OK-code" || GENERATED_DOCS.has(filePath) === false) {
        findings.push({ file: rel, line: i + 1, kind, value: m[0], status, inGenerated, annotated });
      }
    }

    // Font-family names: 'JetBrains Mono', "Inter", `Oswald`
    for (const m of line.matchAll(/'([^']+)'|"([^"]+)"|`([^`]+)`/g)) {
      const name = (m[1] || m[2] || m[3] || "").trim();
      if (!/^(Inter|JetBrains Mono|SF Mono|Menlo|Oswald|Mulish|monospace|sans-serif|serif|system-ui|-apple-system|ui-monospace|SFMono-Regular)$/.test(name)) continue;
      const kind = "font";
      const status = classify({ inGenerated, annotated, value: name, kind, code });
      findings.push({ file: rel, line: i + 1, kind, value: name, status, inGenerated, annotated });
    }
  }
  return findings;
}

function classify({ inGenerated, annotated, value, kind, code }) {
  if (inGenerated) return "OK-generated";
  if (annotated) return "OK-annotated";
  if (kind === "hex" && code.hexSet.has(value.toLowerCase())) return "OK-code";
  if (kind === "px" && code.pxSet.has(value)) return "OK-code";
  if (kind === "font" && code.fontSet.has(value)) return "OK-code";
  // Value is asserted but code contradicts / doesn't carry it.
  return "FAIL-drift";
}

function walkDocsMd(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      out.push(...walkDocsMd(p));
    } else if (e.isFile() && p.endsWith(".md")) {
      out.push(p);
    }
  }
  return out;
}

// ─── Seeded failure runners ───────────────────────────────────────

function seedTests(code) {
  const results = [];
  if (SEEDED === "wrong" || SEEDED === "1") {
    // Inject a wrong hex into a scratch file; probe must FAIL on it.
    const scratch = path.join(DOCS_DIR, "_probe_seed_wrong.md");
    fs.writeFileSync(scratch, "# seed wrong\n\nThe cool ground colour is `#DEADBE`.\n");
    const f = scanDoc(scratch, code);
    fs.unlinkSync(scratch);
    const failed = f.some(x => x.status === "FAIL-drift" && x.value.toLowerCase() === "#deadbe");
    results.push({ name: "seed wrong -> FAIL", pass: failed, detail: `findings=${f.length} failed_on_deadbe=${failed}` });
  }
  if (SEEDED === "ok" || SEEDED === "1") {
    // Inject a wrong hex ANNOTATED; probe must ACCEPT.
    const scratch = path.join(DOCS_DIR, "_probe_seed_ok.md");
    fs.writeFileSync(scratch, "# seed ok\n\n<!-- doc-value-ok: annotated for the seed test -->\nA colour: `#DEADBE`.\n");
    const f = scanDoc(scratch, code);
    fs.unlinkSync(scratch);
    const accepted = f.every(x => x.status !== "FAIL-drift");
    results.push({ name: "seed ok -> ACCEPT", pass: accepted, detail: `findings=${f.length} accepted=${accepted}` });
  }
  return results;
}

// ─── Main ─────────────────────────────────────────────────────────

function main() {
  const code = loadCssValues();
  const files = walkDocsMd(DOCS_DIR);
  const all = [];
  for (const f of files) {
    // Skip the seed scratch files if they exist from a prior crash.
    if (path.basename(f).startsWith("_probe_seed_")) continue;
    all.push(...scanDoc(f, code));
  }

  const byFile = new Map();
  for (const f of all) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }

  const summary = {
    total_files_scanned: files.length,
    files_with_findings: byFile.size,
    total_findings: all.length,
    by_status: {
      "OK-generated": all.filter(x => x.status === "OK-generated").length,
      "OK-annotated": all.filter(x => x.status === "OK-annotated").length,
      "OK-code": all.filter(x => x.status === "OK-code").length,
      "FAIL-drift": all.filter(x => x.status === "FAIL-drift").length,
    },
    by_kind: {
      hex: all.filter(x => x.kind === "hex").length,
      px: all.filter(x => x.kind === "px").length,
      font: all.filter(x => x.kind === "font").length,
    },
    generated_doc_failures: all.filter(x =>
      x.status === "FAIL-drift" &&
      GENERATED_DOCS.has(path.join(REPO_ROOT, x.file))
    ).length,
  };

  if (JSON_OUT) {
    console.log(JSON.stringify({ summary, findings: all }, null, 2));
    return 0;
  }

  // Text report
  console.log(`# Doc-value drift probe - ${new Date().toISOString()}`);
  console.log(`# Scanned ${summary.total_files_scanned} .md files under docs/`);
  console.log("");
  console.log(`## Summary`);
  console.log(`  total findings: ${summary.total_findings}`);
  console.log(`  by status:`);
  for (const [k, v] of Object.entries(summary.by_status)) console.log(`    ${k.padEnd(14)}: ${v}`);
  console.log(`  by kind:`);
  for (const [k, v] of Object.entries(summary.by_kind)) console.log(`    ${k.padEnd(6)}: ${v}`);
  console.log("");
  console.log(`  generated-doc failures (fail-build gate): ${summary.generated_doc_failures}`);
  console.log("");

  // Top-20 offender files
  const sorted = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 20);
  console.log(`## Top 20 files by finding count`);
  for (const [file, findings] of sorted) {
    const failed = findings.filter(f => f.status === "FAIL-drift").length;
    console.log(`  ${String(findings.length).padStart(4)} findings (${failed} FAIL) - ${file}`);
  }
  console.log("");

  // The FAIL-drift set, top 30
  const fails = all.filter(x => x.status === "FAIL-drift");
  console.log(`## FAIL-drift sample (first 30 of ${fails.length})`);
  for (const f of fails.slice(0, 30)) {
    console.log(`  ${f.file}:${f.line}  ${f.kind}=${f.value}`);
  }

  // Seeded failure results
  const seedResults = seedTests(code);
  if (seedResults.length) {
    console.log("");
    console.log(`## Seeded failure runs`);
    for (const r of seedResults) console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}  ${r.detail}`);
  }

  // Exit code
  if (summary.generated_doc_failures > 0) {
    console.log("");
    console.log(`FAIL: ${summary.generated_doc_failures} finding(s) in generated docs. Fix by re-running scripts/gen_design_docs.mjs.`);
    return 1;
  }
  return 0;
}

process.exit(main());
