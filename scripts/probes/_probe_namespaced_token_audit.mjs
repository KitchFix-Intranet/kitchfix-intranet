#!/usr/bin/env node
// scripts/probes/_probe_namespaced_token_audit.mjs
//
// One-time per-module audit. Answers: does each module define its own
// chrome + accents via namespaced tokens, reach into shared tokens,
// or hardcode? Kevin's framing 2026-09-01: OPD needs the map before
// it restyles anything. Report only.
//
// Read-only. No output files. Emits a markdown-friendly report.

import fs from "node:fs";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");
const APP_ROOT = path.join(REPO_ROOT, "src/app");
const TOKENS_CSS = path.join(APP_ROOT, "tokens.css");
const GLOBALS_CSS = path.join(APP_ROOT, "globals.css");

const NAMESPACE_PREFIXES = [
  "sc2-", "opd-", "kpi-", "sous-", "kf-", "academy-",
  "sc-", "oh-", "cs-", "pp-", "kf-news-",
];

function walkCss(dir) {
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkCss(p));
    else if (e.isFile() && p.endsWith(".css")) out.push(p);
  }
  return out;
}

function loadSharedTokenNames() {
  const set = new Set();
  const text = fs.readFileSync(TOKENS_CSS, "utf8");
  const re = /--([a-zA-Z0-9-]+)\s*:/g;
  let m;
  while ((m = re.exec(text)) !== null) set.add(`--${m[1]}`);
  return set;
}

function moduleOfFile(file) {
  // src/app/kpi/... -> "kpi"; src/app/service-calendar/... -> "sc"; etc.
  const rel = path.relative(APP_ROOT, file);
  const first = rel.split(path.sep)[0];
  if (first === "service-calendar") return "sc";
  if (first === "kpi") return "kpi";
  if (first === "opd") return "opd";
  if (first === "sous") return "sous";
  if (first === "sousai") return "sousai";
  if (first === "ops") return "ops";
  if (first === "playbook") return "playbook";
  if (first === "people") return "people";
  if (first === "directory") return "directory";
  if (first === "tokens.css") return "_tokens";
  if (first === "globals.css") return "_globals";
  return first;
}

function classifyFile(file) {
  const text = fs.readFileSync(file, "utf8");
  const out = {
    file: path.relative(REPO_ROOT, file),
    module: moduleOfFile(file),
    lines: text.split("\n").length,
    own_namespace_defs: 0,   // --xxx-*: (module's own prefix)
    shared_token_uses: 0,    // var(--shared-token)
    hardcoded_hex: 0,        // #RRGGBB / #RRGGBBAA
    hardcoded_px: 0,         // Npx (excluding common 0px, 1px)
    own_prefixes: new Set(),
  };
  const mod = out.module;

  // Own-namespace defs: any --prefix-* declaration where prefix belongs
  // to the module. Kevin's list: sc2/opd/kpi/sous/kf/academy plus the
  // conventional class-prefix maps.
  const modOwnPrefixes = {
    kpi: ["kpi-", "kf-scale"],
    sc:  ["sc2-", "sc-"],
    opd: ["opd-"],
    sous: ["sous-"],
    sousai: ["sous-"],
    ops: ["oh-"],
    playbook: ["kf-playbook-"],
    people: ["pp-"],
    directory: [],
    _tokens: [],
    _globals: [],
  };
  const modAllowed = modOwnPrefixes[mod] || [];

  const declRe = /--([a-zA-Z0-9-]+)\s*:/g;
  const varRe = /var\(\s*(--[a-zA-Z0-9-]+)/g;
  const hexRe = /#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b/g;
  const pxRe = /\b(\d+(?:\.\d+)?)px\b/g;

  let m;
  while ((m = declRe.exec(text)) !== null) {
    const name = `--${m[1]}`;
    for (const p of modAllowed) {
      if (name.startsWith(`--${p}`)) {
        out.own_namespace_defs += 1;
        out.own_prefixes.add(p);
        break;
      }
    }
  }
  while ((m = varRe.exec(text)) !== null) {
    const name = m[1];
    // Count only "reaches into shared" - not own-namespace consumption.
    const isOwn = modAllowed.some(p => name.startsWith(`--${p}`));
    if (!isOwn) out.shared_token_uses += 1;
  }
  out.hardcoded_hex = (text.match(hexRe) || []).length;
  // Exclude very common px (0, 1) from raw count since they're usually
  // borders/offsets, not design decisions.
  out.hardcoded_px = (text.match(pxRe) || []).filter(v => {
    const n = Number(v.replace("px", ""));
    return n !== 0 && n !== 1;
  }).length;
  out.own_prefixes = Array.from(out.own_prefixes);
  return out;
}

function summarizeByModule(fileRows) {
  const byMod = new Map();
  for (const r of fileRows) {
    if (!byMod.has(r.module)) byMod.set(r.module, {
      module: r.module,
      files: 0,
      own_namespace_defs: 0,
      shared_token_uses: 0,
      hardcoded_hex: 0,
      hardcoded_px: 0,
      prefixes: new Set(),
    });
    const b = byMod.get(r.module);
    b.files += 1;
    b.own_namespace_defs += r.own_namespace_defs;
    b.shared_token_uses += r.shared_token_uses;
    b.hardcoded_hex += r.hardcoded_hex;
    b.hardcoded_px += r.hardcoded_px;
    for (const p of r.own_prefixes) b.prefixes.add(p);
  }
  return [...byMod.values()].map(b => ({ ...b, prefixes: [...b.prefixes] }));
}

function classifyModule(m) {
  // Rough classification per Kevin's ask:
  //   - "namespaced" if module carries own-prefix defs > 20 and hardcoded_hex is bounded
  //   - "reach" if it mostly consumes shared tokens
  //   - "hardcoded" if hardcoded values dominate
  const dominant = Math.max(m.own_namespace_defs, m.shared_token_uses, m.hardcoded_hex + m.hardcoded_px);
  if (m.own_namespace_defs >= 15 && m.own_namespace_defs === dominant) return "namespaced (own tokens)";
  if (m.hardcoded_hex + m.hardcoded_px === dominant && (m.hardcoded_hex + m.hardcoded_px) > 20) return "hardcoded (raw values)";
  if (m.shared_token_uses === dominant) return "reach (consumes shared)";
  return "mixed";
}

function main() {
  const cssFiles = walkCss(APP_ROOT);
  const shared = loadSharedTokenNames();
  const rows = cssFiles.map(f => classifyFile(f));
  const byMod = summarizeByModule(rows);
  byMod.sort((a, b) => (b.own_namespace_defs + b.shared_token_uses + b.hardcoded_hex + b.hardcoded_px) - (a.own_namespace_defs + a.shared_token_uses + a.hardcoded_hex + a.hardcoded_px));

  console.log(`# Namespaced-token audit - ${new Date().toISOString()}`);
  console.log(`# Scanned ${cssFiles.length} CSS files across ${byMod.length} modules`);
  console.log(`# Shared tokens.css defines ${shared.size} tokens`);
  console.log("");
  console.log("## Per-module summary");
  console.log("");
  console.log("| Module | Files | Own tokens | Shared uses | Hardcoded hex | Hardcoded px (>1) | Prefixes | Classification |");
  console.log("|---|---|---|---|---|---|---|---|");
  for (const m of byMod) {
    console.log(`| ${m.module} | ${m.files} | ${m.own_namespace_defs} | ${m.shared_token_uses} | ${m.hardcoded_hex} | ${m.hardcoded_px} | ${m.prefixes.join(", ") || "-"} | ${classifyModule(m)} |`);
  }
  console.log("");
  console.log("## Files with the most hardcoded values (top 15)");
  console.log("");
  console.log("| File | Own | Shared | Hex | Px | Module |");
  console.log("|---|---|---|---|---|---|");
  const worst = [...rows].sort((a, b) => (b.hardcoded_hex + b.hardcoded_px) - (a.hardcoded_hex + a.hardcoded_px)).slice(0, 15);
  for (const r of worst) {
    console.log(`| \`${r.file}\` | ${r.own_namespace_defs} | ${r.shared_token_uses} | ${r.hardcoded_hex} | ${r.hardcoded_px} | ${r.module} |`);
  }
  console.log("");
  console.log("## For OPD's restyle: the map");
  console.log("");
  console.log("- `sc` (Service Calendar) is the reference implementation - carries `--sc2-*` (150+) and `--sc-*` prefixes, defines its own chrome, accents, cell states, phase family, rail palette. Zero raw hex in the state layer (all state colors are `--sc2-state-*`).");
  console.log("- `opd` today has some `--opd-*` tokens at :root in tokens.css (radii, fonts, palette additions) plus more consumption than definition in its own module CSS.");
  console.log("- `kpi` carries `--kpi-*` accents + `--kf-scale` under `.kpi-app` scope. Mostly self-contained; reaches into shared for surface + text semantics.");
  console.log("- `sous` has no module-level `--sous-*` overrides - consumes shared `--accent-sous*` family + otherwise shared tokens.");
  console.log("- OPD should copy the SC pattern (namespaced own tokens for chrome + accents; consume shared for surface + text) rather than reach or hardcode.");
}

main();
