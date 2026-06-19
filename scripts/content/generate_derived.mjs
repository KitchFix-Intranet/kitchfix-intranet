// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/generate_derived.mjs
// Aggregates `obligations` data across all /content/documents/*.mdx into
// derived outputs in /content/derived/.
// Per brief §3.5.
//
// F1 STUB: walks docs, collects obligations, emits two .generated.mdx files
// with a `derived: true` frontmatter flag. F1.5+ expands the matrix shapes
// (group by owner, by type, by state).
//
// Usage:
//   node scripts/content/generate_derived.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import yaml from "js-yaml"; // eslint-disable-line no-unused-vars
import { splitMdx } from "./lib/frontmatter.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const DOCS_DIR = join(REPO_ROOT, "content", "documents");
const DERIVED_DIR = join(REPO_ROOT, "content", "derived");

const CALENDAR_FILE = join(DERIVED_DIR, "compliance-calendar.generated.mdx");
const MATRIX_FILE = join(DERIVED_DIR, "cert-matrix.generated.mdx");

function loadAllDocs() {
  if (!statSync(DOCS_DIR, { throwIfNoEntry: false })) return [];
  const out = [];
  for (const f of readdirSync(DOCS_DIR)) {
    const p = join(DOCS_DIR, f);
    if (statSync(p).isFile() && f.endsWith(".mdx")) {
      try {
        const { frontmatter, body } = splitMdx(readFileSync(p, "utf8"));
        out.push({ path: p, basename: f, frontmatter, body });
      } catch (e) {
        console.error(`generate_derived: skipping ${f}: ${e.message}`);
      }
    }
  }
  return out;
}

function collectObligations(docs) {
  const rows = [];
  for (const d of docs) {
    const fm = d.frontmatter;
    if (fm.derived) continue; // do not aggregate from generated docs
    for (const ob of fm.obligations || []) {
      rows.push({
        doc_id: fm.id,
        title: fm.title,
        type: ob.type,
        cadence: ob.cadence,
        next_due: ob.next_due,
        owner: ob.owner,
        section: ob.source_section,
        description: ob.description,
        applies_to: ob.applies_to ?? fm.applies_to ?? "company-wide",
      });
    }
  }
  return rows;
}

function fmtAppliesTo(a) {
  if (!a) return "company-wide";
  if (typeof a === "string") return a;
  const parts = [];
  if (a.states) parts.push(`states: ${a.states.join(", ")}`);
  if (a.account) parts.push(`account: ${a.account}`);
  if (a.role) parts.push(`role: ${a.role}`);
  return parts.length ? parts.join("; ") : "company-wide";
}

function buildCalendar(obligations) {
  const today = new Date().toISOString().slice(0, 10);
  const sorted = [...obligations].sort((a, b) => (a.next_due || "9999").localeCompare(b.next_due || "9999"));
  const rows = sorted
    .map(
      (o) =>
        `| ${o.next_due || "n/a"} | ${o.cadence} | ${o.type} | ${o.owner} | ${o.doc_id} (${o.section || "—"}) | ${fmtAppliesTo(o.applies_to)} | ${o.description || ""} |`
    )
    .join("\n");
  return `---
id: DERIVED-COMPLIANCE-CALENDAR
title: Compliance Calendar
doc_class: REF
shelf: Operations
status: Live
version: "1.0"
card_line: "Generated compliance calendar - every deadline, renewal, and recurring obligation across the library."
summary: "Auto-generated from the \`obligations\` block on every source document. Regenerated on every build. Do not edit."
audience: corporate
classification: KitchFix Internal
lang: en
in_corpus: false
applies_to: company-wide
derived: true
last_reviewed: ${today}
review_interval_months: 1
---

# Compliance Calendar

Generated ${today}. Do not edit - regenerate via \`node scripts/content/generate_derived.mjs\`.

| Next due | Cadence | Type | Owner | Source | Scope | Description |
|---|---|---|---|---|---|---|
${rows || "| (no obligations yet) | | | | | | |"}
`;
}

function buildCertMatrix(obligations) {
  const today = new Date().toISOString().slice(0, 10);
  const certs = obligations.filter((o) => o.type === "cert_renewal" || o.type === "training");
  const rows = certs
    .map((o) => `| ${o.doc_id} | ${o.cadence} | ${o.owner} | ${fmtAppliesTo(o.applies_to)} | ${o.description || ""} |`)
    .join("\n");
  return `---
id: DERIVED-CERT-MATRIX
title: Cert and Training Matrix
doc_class: REF
shelf: HR & People
status: Live
version: "1.0"
card_line: "Generated cert and training matrix - role-based learning paths across the library."
summary: "Auto-generated from cert_renewal and training obligations on source documents. Regenerated on every build. Do not edit."
audience: corporate
classification: KitchFix Internal
lang: en
in_corpus: false
applies_to: company-wide
derived: true
last_reviewed: ${today}
review_interval_months: 1
---

# Cert and Training Matrix

Generated ${today}. Do not edit - regenerate via \`node scripts/content/generate_derived.mjs\`.

| Source | Cadence | Owner | Scope | Notes |
|---|---|---|---|---|
${rows || "| (no cert/training obligations yet) | | | | |"}
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(DERIVED_DIR, { recursive: true });
  const docs = loadAllDocs();
  const obligations = collectObligations(docs);
  writeFileSync(CALENDAR_FILE, buildCalendar(obligations), "utf8");
  writeFileSync(MATRIX_FILE, buildCertMatrix(obligations), "utf8");
  console.log(`Generated ${CALENDAR_FILE} (${obligations.length} obligations)`);
  console.log(`Generated ${MATRIX_FILE} (${obligations.filter((o) => o.type === "cert_renewal" || o.type === "training").length} cert/training)`);
}

export { collectObligations, buildCalendar, buildCertMatrix };
