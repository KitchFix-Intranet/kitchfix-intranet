#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/_export_review_packet.mjs
// One-shot: read every doc in the three reviewer sets, resolve Includes and
// Facts using the same pipeline the corpus projection uses, transform
// <NonCanonical> wrappers into clearly-labeled [EXAMPLE] blocks (a reviewer
// wants to see examples but should know they are not policy), strip
// <SourceGoverns> into a one-line preamble, then emit one combined Markdown
// file with three sections.
//
// No content changes, no frontmatter changes. Read-only export.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { splitMdx, loadYaml } from "./lib/frontmatter.mjs";
import { resolveFactTokens, resolveIncludeTokens } from "./resolver.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const DOCS_DIR = join(REPO_ROOT, "content", "documents");
const FACTS_FILE = join(REPO_ROOT, "content", "facts", "operational-facts.yaml");
const OUT_FILE = join(REPO_ROOT, "docs", "opd", "foundation", "REVIEW_PACKET_SOURCE.md");

// ── Reviewer sets ────────────────────────────────────────────────────────────
const BRITT = [
  "SOP-008", "SOP-009", "SOP-012", "SOP-014", "SOP-015",
  "TPL-019", "CHK-003", "PB-006",
];
const COUNSEL = [
  "POL-001", "POL-002", "POL-003", "POL-006", "POL-008",
  "POL-010", "POL-011", "POL-013", "POL-014", "POL-015",
  "POL-019", "SOP-004", "SOP-005", "AGR-002",
  "TPL-101", "TPL-102", "TPL-103", "TPL-104",
];
const FINANCE = [
  "REF-006", "REF-007", "PB-009",
  "POL-019", // pointer-only - full body is in the Counsel section above
];
const POL_019_NOTE = "POL-019 appears in both Counsel and Finance reviews - the full resolved body is in the Counsel section; this entry is a pointer.";

// ── Load every doc into a map (for Include resolution) + the facts file ──────
const facts = loadYaml(readFileSync(FACTS_FILE, "utf8"));
const docs = {};
for (const f of readdirSync(DOCS_DIR).filter((x) => x.endsWith(".mdx")).sort()) {
  const src = readFileSync(join(DOCS_DIR, f), "utf8");
  const { frontmatter, body } = splitMdx(src);
  if (frontmatter.id) docs[frontmatter.id] = { frontmatter, body };
}
const docsMap = {};
for (const [id, d] of Object.entries(docs)) docsMap[id] = d.body;

// ── Per-doc resolved-export builder ──────────────────────────────────────────
function transformForReview(body) {
  // Replace <NonCanonical>...</NonCanonical> with labeled [EXAMPLE] block.
  // Keep the inner content so a reviewer sees the illustration; flag it clearly.
  let count = 0;
  const out = body.replace(/<NonCanonical>([\s\S]*?)<\/NonCanonical>/g, (_, inner) => {
    count++;
    const trimmed = inner.trim();
    return `\n> [EXAMPLE - not policy text]\n>\n${trimmed.split("\n").map((l) => l ? "> " + l : ">").join("\n")}\n> [/EXAMPLE]\n`;
  });
  return { body: out, nonCanonicalCount: count };
}

function expandSourceGoverns(body) {
  // Same expansion the resolver uses for the corpus path - one-line preamble.
  let count = 0;
  const out = body.replace(/<SourceGoverns\s+doc\s*=\s*"([^"]+)"(?:\s+section\s*=\s*"([^"]+)")?\s*\/>/g, (_, doc, section) => {
    count++;
    const ref = section ? `${doc} ${section}` : doc;
    return `> This document derives from ${ref}. Where the two differ, ${doc} governs.\n`;
  });
  return { body: out, sourceGovernsCount: count };
}

function exportDoc(id, pointerOnly = false) {
  const d = docs[id];
  if (!d) return { id, missing: true };
  const fm = d.frontmatter;
  const factCtx = { applies_to: fm.applies_to || "company-wide" };

  if (pointerOnly) {
    return {
      id,
      pointerOnly: true,
      fm,
    };
  }

  // Pipeline: Includes first (so Fact tokens carried in by an Include resolve
  // in the calling doc's ctx), then Facts. Mirrors the corpus projection
  // pipeline after F6.5.
  const r1 = resolveIncludeTokens(d.body, docsMap, factCtx);
  const r2 = resolveFactTokens(r1.mdx, facts, factCtx);
  const sg = expandSourceGoverns(r2.mdx);
  const tr = transformForReview(sg.body);

  // Detect stray Fact/Include tokens that did not resolve
  const strayFacts = (tr.body.match(/<Fact\s+id\s*=\s*"[^"]+"\s*\/>/g) || []);
  const strayIncludes = (tr.body.match(/<Include\s+[^>]*>/g) || []);
  const strayNonCanonical = (tr.body.match(/<NonCanonical>/g) || []);
  const stray = [...strayFacts, ...strayIncludes, ...strayNonCanonical];

  return {
    id,
    fm,
    body: tr.body,
    resolutions: {
      facts: r2.resolutions, // each: { sourceFact, value, resolution, ... }
      includes: r1.includes, // each: { doc, section, resolved }
      sourceGoverns: sg.sourceGovernsCount,
      nonCanonical: tr.nonCanonicalCount,
    },
    stray,
  };
}

// ── Format one doc as Markdown ───────────────────────────────────────────────
function fmt(exp) {
  if (exp.missing) {
    return `### ${exp.id}\n\n_Not in repo. Skipped._\n\n---\n`;
  }
  if (exp.pointerOnly) {
    const fm = exp.fm;
    return `### ${exp.id} - ${fm.title}\n\n` +
      `**Status:** ${fm.status} | **Version:** ${fm.version || "-"} | **Owner:** ${fm.owner || "(null)"} | **Approver:** ${fm.approver || "(null)"}\n\n` +
      `_${POL_019_NOTE}_\n\n---\n`;
  }
  const fm = exp.fm;
  const r = exp.resolutions;
  const header = `### ${exp.id} - ${fm.title}\n\n` +
    `**Status:** ${fm.status} | **Version:** ${fm.version || "-"} | **Owner:** ${fm.owner || "(null)"} | **Approver:** ${fm.approver || "(null)"}` +
    (fm.shelf ? ` | **Shelf:** ${fm.shelf}` : "") +
    (fm.in_corpus === false ? ` | **in_corpus:** no` : "") +
    `\n\n`;

  // PB-006 is the Placeholder Britt delivers - not a review target
  let deliveryNote = "";
  if (exp.id === "PB-006") {
    deliveryNote = `> **DELIVERED BY BRITT, not for review.** This Placeholder catalog row is awaiting the Culinary OS Handbook hand-off from Britt (~90% built). Included so the packet is complete and Britt sees what is open on her side.\n\n`;
  }

  // Resolution note (only if something resolved)
  let resNote = "";
  const hasResolution = r.facts.length > 0 || r.includes.length > 0 || r.sourceGoverns > 0 || r.nonCanonical > 0;
  if (hasResolution) {
    const factSummary = {};
    for (const f of r.facts) factSummary[f.sourceFact] = `${f.value}${f.resolution !== "default" ? ` (${f.resolution})` : ""}`;
    const incs = r.includes.map((i) => `${i.doc} §${i.section}${i.resolved ? "" : " [NOT RESOLVED]"}`);
    const parts = [];
    if (Object.keys(factSummary).length) {
      parts.push(`Facts resolved: ${Object.entries(factSummary).map(([k, v]) => `${k} -> ${v}`).join("; ")}`);
    }
    if (incs.length) parts.push(`Includes inlined: ${incs.join("; ")}`);
    if (r.sourceGoverns) parts.push(`SourceGoverns expanded: ${r.sourceGoverns}`);
    if (r.nonCanonical) parts.push(`Example blocks marked: ${r.nonCanonical}`);
    resNote = `> **Resolution note.** ${parts.join(" | ")}\n\n`;
  }

  // Stray-token warning
  let strayNote = "";
  if (exp.stray.length) {
    strayNote = `> **WARNING: stray tokens remain in export.** ${exp.stray.slice(0, 5).join(", ")}${exp.stray.length > 5 ? "..." : ""}\n\n`;
  }

  return header + deliveryNote + resNote + strayNote + exp.body.trim() + "\n\n---\n";
}

// ── Build the output ─────────────────────────────────────────────────────────
const exports = {
  britt: BRITT.map((id) => exportDoc(id)),
  counsel: COUNSEL.map((id) => exportDoc(id)),
  finance: FINANCE.map((id) => exportDoc(id, id === "POL-019")),
};

const sections = [
  {
    label: "Section 1 - Britt (Director of Culinary)",
    blurb: "Director of Culinary is the owner or co-approver on these. Real temperatures, real cooling rules, real TPHC clock - all Facts resolved. SOP-009 §03 inlines POL-003 §06 (the supplement protocol). PB-006 is the Placeholder Britt delivers; it is included so the packet is complete but is NOT for review.",
    exports: exports.britt,
  },
  {
    label: "Section 2 - Counsel",
    blurb: "Counsel review set. Every doc with Counsel in the approver field after the F6.6 sign-off-path correction. Includes the universal policies + the docs where state annexes or legal-language passes were flagged in the register. State annexes (POL-008, POL-015) and the records-retention policy are drafted separately as samples; the bodies below are the universal-applicability content already in repo.",
    exports: exports.counsel,
  },
  {
    label: "Section 3 - Finance (Sebastian)",
    blurb: "Pay bands (REF-006 / REF-007) carry draft values awaiting Rippling validation; both are out of corpus (`in_corpus: false`) until Finance confirms. PB-009 is the Financial Operations Manual framework. POL-019 §05 permit-register tool is the Finance touchpoint on POL-019; the full body lives in Counsel - pointer only here.",
    exports: exports.finance,
  },
];

let md = `# OPD Review Packet - Resolved Source Content\n\n`;
md += `**Built:** ${new Date().toISOString().slice(0, 10)}\n`;
md += `**Source:** ${DOCS_DIR.replace(REPO_ROOT + "/", "")}/ - frontmatter, body, with Facts resolved against \`content/facts/operational-facts.yaml\` and Includes inlined from peer docs.\n`;
md += `**For:** rendering into per-reviewer packets (Britt, Counsel, Finance). Reviewers approve content, not tokens - so every \`<Fact />\` is substituted with its real value and every \`<Include />\` is inlined.\n\n`;
md += `**Resolution path:** mirrors \`project_pilot.mjs\` (post-F6.5): Includes resolve first (so any Fact carried in by an Include resolves in the calling doc's ctx), then Facts. \`<NonCanonical>\` blocks are kept and clearly labeled "[EXAMPLE - not policy text]" so reviewers see illustrations but know they are not binding. \`<SourceGoverns>\` expands to its one-line preamble. No content changes were made to the source MDX.\n\n`;
md += `---\n\n`;

const totals = { docs: 0, facts: 0, includes: 0, nonCanonical: 0, sourceGoverns: 0, stray: 0, missing: 0, pointer: 0 };
for (const sec of sections) {
  md += `## ${sec.label}\n\n${sec.blurb}\n\n`;
  for (const exp of sec.exports) {
    md += fmt(exp);
    if (exp.missing) totals.missing++;
    else if (exp.pointerOnly) totals.pointer++;
    else {
      totals.docs++;
      totals.facts += exp.resolutions.facts.length;
      totals.includes += exp.resolutions.includes.length;
      totals.nonCanonical += exp.resolutions.nonCanonical;
      totals.sourceGoverns += exp.resolutions.sourceGoverns;
      totals.stray += exp.stray.length;
    }
  }
}

writeFileSync(OUT_FILE, md, "utf8");

// ── Summary to stdout ────────────────────────────────────────────────────────
const sizeKB = (Buffer.byteLength(md) / 1024).toFixed(1);
console.log(`Wrote ${OUT_FILE.replace(REPO_ROOT + "/", "")} (${sizeKB} KB)`);
console.log("");
console.log("Per-section totals:");
for (const [name, set] of Object.entries(exports)) {
  const docCount = set.filter((e) => !e.missing).length;
  const factDocs = set.filter((e) => !e.missing && !e.pointerOnly && e.resolutions.facts.length > 0).length;
  const includeDocs = set.filter((e) => !e.missing && !e.pointerOnly && e.resolutions.includes.length > 0).length;
  const ncDocs = set.filter((e) => !e.missing && !e.pointerOnly && e.resolutions.nonCanonical > 0).length;
  console.log(`  ${name.padEnd(8)} ${docCount} docs | Facts resolved in ${factDocs} | Includes inlined in ${includeDocs} | NonCanonical marked in ${ncDocs}`);
}
console.log("");
console.log(`Totals: ${totals.docs} full exports, ${totals.pointer} pointer, ${totals.missing} missing`);
console.log(`        ${totals.facts} fact-token resolutions, ${totals.includes} include resolutions, ${totals.sourceGoverns} SourceGoverns expansions, ${totals.nonCanonical} NonCanonical blocks labeled`);
if (totals.stray > 0) {
  console.log(`        WARNING: ${totals.stray} stray token(s) remain - check the report for [WARNING: stray tokens remain] markers.`);
} else {
  console.log(`        Stray tokens: 0`);
}

// Per-doc Include detail (so the verification matches the brief's ask)
console.log("");
console.log("Per-doc Include resolutions (only docs with includes):");
for (const sec of sections) {
  for (const exp of sec.exports) {
    if (!exp.missing && !exp.pointerOnly && exp.resolutions.includes.length > 0) {
      const inc = exp.resolutions.includes.map((i) => `${i.doc} §${i.section}${i.resolved ? " ✓" : " ✗"}`).join(", ");
      console.log(`  ${exp.id.padEnd(10)} ${inc}`);
    }
  }
}
