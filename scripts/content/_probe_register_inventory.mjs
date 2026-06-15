#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/_probe_register_inventory.mjs
// Reads every doc in content/documents/ and emits the authoritative inventory
// used to reconcile against the OPD Document Review & Approval Register.
//
// Outputs:
//   .scratch/opd-audit/register-inventory.json  - per-doc full record
//   stdout                                       - status counts + sign-off set + flagged register claims
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { splitMdx } from "./lib/frontmatter.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const DOCS_DIR = join(REPO_ROOT, "content", "documents");
const OUT_DIR = join(REPO_ROOT, ".scratch", "opd-audit");
if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const inv = [];
for (const f of readdirSync(DOCS_DIR).filter((x) => x.endsWith(".mdx")).sort()) {
  const src = readFileSync(join(DOCS_DIR, f), "utf8");
  const { frontmatter } = splitMdx(src);
  const fm = frontmatter;
  const approval = fm.approval || null;
  const approvedBy = approval ? approval.approved_by || null : null;
  const approvedVersion = approval ? approval.approved_version || null : null;
  const approvedDate = approval ? approval.approved_date || null : null;
  inv.push({
    id: fm.id || basename(f, ".mdx"),
    file: f,
    title: fm.title || null,
    doc_class: fm.doc_class || null,
    status: fm.status || null,
    version: fm.version || null,
    owner: fm.owner || null,
    approver: fm.approver || null,
    in_corpus: fm.in_corpus !== false,
    audience: fm.audience || null,
    lang: fm.lang || "en",
    has_approval_block: !!approval,
    approved_version: approvedVersion,
    approved_by: approvedBy,
    approved_date: approvedDate ? String(approvedDate) : null,
    translation_of: fm.translation_of || null,
    supersedes: fm.supersedes || null,
  });
}

writeFileSync(join(OUT_DIR, "register-inventory.json"), JSON.stringify(inv, null, 2));

// Status counts
const statusCounts = {};
for (const d of inv) statusCounts[d.status || "(null)"] = (statusCounts[d.status || "(null)"] || 0) + 1;
console.log("─".repeat(78));
console.log(`Status counts across ${inv.length} files in content/documents/`);
console.log("─".repeat(78));
for (const [s, n] of Object.entries(statusCounts).sort()) {
  console.log(`  ${s.padEnd(15)} ${n}`);
}

// Excluding -ES translations
const enOnly = inv.filter((d) => !d.id.endsWith("-ES"));
const enCounts = {};
for (const d of enOnly) enCounts[d.status] = (enCounts[d.status] || 0) + 1;
console.log("");
console.log(`EN-only counts (excluding ${inv.length - enOnly.length} ES translations)`);
console.log("─".repeat(78));
for (const [s, n] of Object.entries(enCounts).sort()) {
  console.log(`  ${s.padEnd(15)} ${n}`);
}

// Approval gap set
const needSignOff = inv.filter((d) =>
  (d.status === "In Build" || d.status === "Pending") &&
  (!d.has_approval_block || !d.approved_by || !d.approved_date)
);
console.log("");
console.log("─".repeat(78));
console.log(`Docs needing sign-off (status In Build or Pending + no complete approval)`);
console.log("─".repeat(78));
console.log(`  count: ${needSignOff.length}`);
for (const d of needSignOff.sort((a, b) => a.id.localeCompare(b.id))) {
  console.log(`  ${(d.status || "").padEnd(10)} ${d.id.padEnd(16)} approver=${(d.approver || "(none)").slice(0, 30)}`);
}

// Live docs - confirm count
const live = inv.filter((d) => d.status === "Live");
console.log("");
console.log(`Live docs (${live.length}):`);
for (const d of live.sort((a, b) => a.id.localeCompare(b.id))) {
  console.log(`  ${d.id.padEnd(16)} ${(d.title || "").slice(0, 50)}`);
}

// Approver distribution
const apprDist = {};
for (const d of inv) {
  const a = d.approver || "(null)";
  apprDist[a] = (apprDist[a] || 0) + 1;
}
console.log("");
console.log("Approver distribution (frontmatter `approver:` value):");
for (const [a, n] of Object.entries(apprDist).sort((x, y) => y[1] - x[1])) {
  console.log(`  ${n.toString().padStart(3)}  ${a}`);
}
