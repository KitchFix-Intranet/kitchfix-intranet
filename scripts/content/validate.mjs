// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/validate.mjs
// The merge gate. Per brief §6. F1.5 production-grade: ajv against the JSON
// Schemas + @mdx-js/mdx parseability check + the audit-specific checks
// (retired-pointer block, chk_live_complete extended, number hygiene, heading
// hierarchy, audience scope).
//
// Stubs still pending the pilot set (will be wired at F1.5 close + F2 start):
//   - blast-radius (needs the whole corpus + an approval-tracking layer)
//   - staleness report (needs the whole corpus)
//   - -ES parity report (needs both EN + ES docs converted)
//
// Usage:
//   node scripts/content/validate.mjs path/to/doc.mdx
//   node scripts/content/validate.mjs   (no arg -> walks /content/documents/)
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { splitMdx, loadYaml } from "./lib/frontmatter.mjs";
import { validateFrontmatter, validateFactsFile, mdxParseable } from "./lib/schema_validator.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const CONTENT_DIR = join(REPO_ROOT, "content");
const DOCS_DIR = join(CONTENT_DIR, "documents");
const FACTS_FILE = join(CONTENT_DIR, "facts", "operational-facts.yaml");

// Retired set from the audit (DEPENDENCY_MAP.md + REMEDIATION_WORKLIST.md)
const RETIRED_IDS = new Set([
  "POL-005", "POL-012", "POL-016", "POL-017", "POL-018",
  "SOP-003", "SOP-011", "SOP-013", "SOP-016",
  "REF-005-A", "REF-005-B", "REF-008", "REF-009",
  "TPL-015", "TPL-017",
  "LEGACY-PR", "LEGACY-WOW", "LEGACY-PFS-CONF",
]);

// pr-7-8 dropped Draft. The 6-set is now canonical.
const VALID_STATUSES = new Set(["Live", "In Build", "Pending", "Placeholder", "Blocked", "Retired"]);
const VALID_CLASSES = new Set(["PB", "SOP", "TPL", "REF", "STD", "POL", "AGR", "FORM", "POST", "CHK", "REC"]);
const VALID_SHELVES = new Set([
  "Safety, Health & Incident",
  "Operations & Leadership",
  "Service Delivery & Client Accounts",
  "People & Conduct",
  "Culinary & Kitchen Operations",
  "Brand & Documentation Standards",
]);
const LEGAL_CLASSES = new Set(["POL", "AGR"]);

const FACT_TOKEN_RE = /<Fact\s+id\s*=\s*"([^"]+)"\s*\/>/g;
const PLACEHOLDER_RE = /\b(TODO|TBD|XXX|<KEVIN[^>]*>|<AUDIT[^>]*>|\[placeholder\])\b/i;

function loadFacts() {
  return loadYaml(readFileSync(FACTS_FILE, "utf8"));
}

function loadAllDocs(dir) {
  const out = [];
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isFile() && f.endsWith(".mdx")) {
      const src = readFileSync(p, "utf8");
      try {
        const { frontmatter, body } = splitMdx(src);
        out.push({ path: p, basename: f, frontmatter, body });
      } catch (e) {
        out.push({ path: p, basename: f, parseError: e.message });
      }
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual gate checks
// ─────────────────────────────────────────────────────────────────────────────

function checkFrontmatterShape(fm, findings) {
  // F1.5: delegate to Ajv against content/schema/frontmatter.schema.json.
  // The schema enforces required fields + enum constraints + the
  // applies_to / approval / relationships / obligations shape.
  const { ok, errors } = validateFrontmatter(fm);
  if (!ok) {
    for (const e of errors) {
      findings.push({ severity: "ERROR", check: "schema", msg: `${e.path}: ${e.msg}` });
    }
  }
}

function checkChkLiveCompleteExtended(fm, findings) {
  if (fm.status !== "Live") return;
  if (!fm.version) findings.push({ severity: "ERROR", check: "chk_live_complete", msg: "Live doc missing 'version'" });
  if (!fm.card_line) findings.push({ severity: "ERROR", check: "chk_live_complete", msg: "Live doc missing 'card_line'" });
  if (LEGAL_CLASSES.has(fm.doc_class) && !fm.approval) {
    findings.push({ severity: "ERROR", check: "chk_live_complete", msg: `Live ${fm.doc_class}-class doc missing 'approval' block` });
  }
}

function checkFactsResolve(body, facts, fm, findings) {
  // every Fact token in the body resolves
  let m;
  while ((m = FACT_TOKEN_RE.exec(body)) !== null) {
    const id = m[1];
    if (!facts[id]) {
      findings.push({ severity: "ERROR", check: "fact_resolves", msg: `<Fact id="${id}" /> not found in operational-facts.yaml` });
    }
  }
  FACT_TOKEN_RE.lastIndex = 0;
  // every override-bearing fact has a default with declared dimensions
  for (const [id, fact] of Object.entries(facts)) {
    if (fact.scope === "override-bearing") {
      if (!fact.default) {
        findings.push({ severity: "ERROR", check: "fact_resolves", msg: `fact '${id}' is override-bearing but has no default` });
      }
      if (!fact.dimensions || fact.dimensions.length === 0) {
        findings.push({ severity: "ERROR", check: "fact_resolves", msg: `fact '${id}' is override-bearing but declares no dimensions` });
      }
      for (const ov of fact.overrides || []) {
        for (const dim of Object.keys(ov.when || {})) {
          if (!fact.dimensions.includes(dim)) {
            findings.push({ severity: "ERROR", check: "fact_resolves", msg: `fact '${id}' override 'when' uses '${dim}' but declared dimensions are [${fact.dimensions.join(", ")}]` });
          }
        }
      }
    }
  }
}

function checkRelationships(fm, allDocIds, findings) {
  for (const rel of fm.relationships || []) {
    if (!rel.to) {
      findings.push({ severity: "ERROR", check: "relationships", msg: "relationship missing 'to'" });
      continue;
    }
    if (RETIRED_IDS.has(rel.to)) {
      findings.push({ severity: "ERROR", check: "relationships_retired", msg: `relationship -> retired doc '${rel.to}' (audit CRITICAL)` });
    }
    if (allDocIds.size > 0 && !allDocIds.has(rel.to)) {
      findings.push({ severity: "WARN", check: "relationships", msg: `relationship -> '${rel.to}' but that doc does not exist in /content/documents/ yet (F1 expected: only the sample is converted)` });
    }
  }
}

// A line records source text rather than authoring its own when its first
// non-whitespace character is `>` (blockquote) or the line begins with `|`
// (table row). Those shapes legitimately carry contract or tracker text a
// document cannot rewrite.
function isSourceOfRecordLine(line) {
  const trimmed = line.trimStart();
  if (trimmed.startsWith(">")) return true;
  if (line.startsWith("|")) return true;
  return false;
}

// A placeholder-token match is also legitimate when it sits inside a
// double-quoted span on the same line - the token is being quoted, not
// authored. Same principle as the blockquote and table-row skips, expressed
// with quotation marks instead of a line-shape marker.
// Test: count straight double quotes strictly before the match position; an
// odd count means the match is inside an open `"..."` span. REF-123's L95
// parenthesises a Louisville agreement snippet containing "Exact end date
// TBD"; REC-111's L109 quotes the visiting-team roster's own "TBD" cell.
function isMatchInsideQuotedSpan(line, matchIndex) {
  let count = 0;
  for (let i = 0; i < matchIndex; i++) {
    if (line.charCodeAt(i) === 0x22) count++; // straight double quote
  }
  return count % 2 === 1;
}

// Same principle as the quoted-span skip, applied to inline backtick spans.
// An author writing `TBD` in code voice is referring to the token as a
// literal (documenting the convention or quoting a source system's cell
// value), not marking their own text as incomplete.
function isMatchInsideBacktickSpan(line, matchIndex) {
  let count = 0;
  for (let i = 0; i < matchIndex; i++) {
    if (line.charCodeAt(i) === 0x60) count++; // grave accent (backtick)
  }
  return count % 2 === 1;
}

function checkNumberHygiene(body, fm, findings) {
  if (fm.status !== "Live") return; // applies only to Live docs
  const lines = body.split("\n");
  const globalRe = new RegExp(PLACEHOLDER_RE.source, "gi");
  for (let i = 0; i < lines.length; i++) {
    if (isSourceOfRecordLine(lines[i])) continue;
    // Flag the line only if at least one match sits outside every kind of
    // quoting span. If every match is inside `"..."` or inline backticks,
    // the line is recording source text or referring to the token as a
    // literal, not authoring its own placeholder.
    const line = lines[i];
    globalRe.lastIndex = 0;
    let m;
    let flagged = false;
    while ((m = globalRe.exec(line)) !== null) {
      if (isMatchInsideQuotedSpan(line, m.index)) continue;
      if (isMatchInsideBacktickSpan(line, m.index)) continue;
      flagged = true;
      break;
    }
    if (flagged) {
      findings.push({ severity: "ERROR", check: "number_hygiene", msg: `Live doc has placeholder text on line ${i + 1}: '${line.trim().slice(0, 80)}'` });
    }
  }
}

function checkHeadingHierarchy(body, fm, findings) {
  // a multi-section doc must have real markdown headings (# / ## / ###)
  const headingCount = (body.match(/^#{1,6}\s+/gm) || []).length;
  if (fm.doc_class === "FORM") return; // single-page forms exempt
  if (fm.doc_class === "POST") return; // POST class takes stub path
  if (headingCount < 2) {
    findings.push({ severity: "WARN", check: "heading_hierarchy", msg: `only ${headingCount} markdown headings found - multi-section docs need real headings for clean chunking (Charter §5E)` });
  }
}

function checkAudienceScope(fm, findings) {
  if (!fm.audience) {
    findings.push({ severity: "WARN", check: "audience_scope", msg: "no 'audience' set - corpus projection will default to operator (review)" });
  }
}

// The <NonCanonical> markup must always appear as a matched pair in body
// prose. An orphan opening tag survives the reader-side markNonCanonical
// pass and renders as an escaped literal in the browser (harmless to Sous
// via the corpus paranoid sweep, but cosmetically broken). This check
// fires on any body-level open/close imbalance. The whole-body pair count
// is sufficient: NonCanonical blocks never nest and the projection's own
// stray counter uses the same shape.
export function checkNonCanonicalOrphan(body, fm, findings) {
  const opens = (body.match(/<NonCanonical>/g) || []).length;
  const closes = (body.match(/<\/NonCanonical>/g) || []).length;
  if (opens !== closes) {
    findings.push({
      severity: "ERROR",
      check: "noncanonical_orphan",
      msg: `<NonCanonical> body markup is unbalanced: ${opens} open vs ${closes} close. Every <NonCanonical> needs a matching </NonCanonical> - orphan opens render as escaped literal text in the reader. To refer to the tag by name in prose without invoking it, use \`NonCanonical\` markup instead of \`<NonCanonical>\`.`,
    });
  }
}

// The # Related Documents table's third column must not be Status. The
// column has no machine consumer (the reader, print pipeline, chunker,
// and projection all treat it as ordinary body text) and every value in
// it is a hand-typed claim about a target doc's lifecycle that drifts
// silently the moment the target changes. Ruled 2026-07-29: delete the
// column, keep the version annotation as `Reviewed against`. Notes-column
// tables and versionless two-column tables both pass. Fires ERROR per
// Kevin's ruling that a warn no one runs into is a rule that doesn't
// exist.
export function checkRelatedDocumentsStatus(body, fm, findings) {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^# Related Documents\s*$/.test(l));
  if (start === -1) return;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^# /.test(lines[i])) return; // end of section
    if (!lines[i].startsWith("|")) continue;
    if (/^\|[\s:|-]+$/.test(lines[i])) continue; // separator
    // First non-separator table row is the header.
    const cells = lines[i].split("|").slice(1, -1).map((c) => c.trim().toLowerCase());
    if (cells[2] === "status" || cells[2] === "current status" || cells[2] === "state") {
      findings.push({
        severity: "ERROR",
        check: "related_documents_status_col",
        msg: `# Related Documents table has a '${cells[2]}' column. Delete it - the column has no machine consumer and hand-typed values drift from the target's real status. Use two columns (Document ID + Title), three columns with 'Reviewed against' for versioned annotations, or three columns with 'Notes' for descriptive prose.`,
      });
    }
    return; // header inspected, done
  }
}

// Stubs - implemented at F1.5 against the full corpus

function checkBlastRadius(_fm, _body, _findings) {
  // F1.5: when operational-facts.yaml changes, list every doc that references
  // each changed fact and flag approved Live docs for re-approval. F1: no-op.
}

function checkStaleness(_fm, _findings) {
  // F1.5: warn (not fail) on docs past last_reviewed + review_interval_months.
}

function checkEsParity(_fm, _docs, _findings) {
  // F1.5: warn on translations whose source_version lags the English current version.
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation runner
// ─────────────────────────────────────────────────────────────────────────────

export async function validateOne(doc, facts, allDocIds) {
  const findings = [];
  if (doc.parseError) {
    findings.push({ severity: "ERROR", check: "parse", msg: doc.parseError });
    return findings;
  }
  const fm = doc.frontmatter;
  checkFrontmatterShape(fm, findings);
  checkChkLiveCompleteExtended(fm, findings);
  // F1.5: validate that the MDX body parses as MDX (catches JSX syntax errors
  // that regex-based scanning would miss). Skip on POST class (stub-path docs
  // have minimal bodies; brief §3.2.)
  if (fm.doc_class !== "POST") {
    const mdxRes = await mdxParseable(doc.body);
    if (!mdxRes.ok) {
      findings.push({ severity: "ERROR", check: "mdx_parse", msg: `MDX parse failed: ${mdxRes.error}` });
    }
  }
  checkFactsResolve(doc.body, facts, fm, findings);
  checkRelationships(fm, allDocIds, findings);
  checkNumberHygiene(doc.body, fm, findings);
  checkHeadingHierarchy(doc.body, fm, findings);
  checkAudienceScope(fm, findings);
  checkNonCanonicalOrphan(doc.body, fm, findings);
  checkRelatedDocumentsStatus(doc.body, fm, findings);
  checkBlastRadius(fm, doc.body, findings);
  checkStaleness(fm, findings);
  return findings;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  const facts = loadFacts();
  // F1.5: validate the facts file itself against its schema before anything else.
  const factsValidation = validateFactsFile(facts);
  if (!factsValidation.ok) {
    console.log(`── facts/operational-facts.yaml ──`);
    for (const e of factsValidation.errors) {
      console.log(`  [ERROR] (facts_schema) ${e.path}: ${e.msg}`);
    }
    process.exit(1);
  }
  let docs;
  if (arg) {
    const src = readFileSync(arg, "utf8");
    const { frontmatter, body } = splitMdx(src);
    docs = [{ path: arg, basename: basename(arg), frontmatter, body }];
  } else {
    docs = loadAllDocs(DOCS_DIR);
  }
  const allIds = new Set(docs.map((d) => d?.frontmatter?.id).filter(Boolean));
  let errors = 0;
  let warns = 0;
  for (const d of docs) {
    const findings = await validateOne(d, facts, allIds);
    console.log(`── ${d.basename} ──`);
    if (findings.length === 0) {
      console.log("  PASS");
    } else {
      for (const f of findings) {
        console.log(`  [${f.severity}] (${f.check}) ${f.msg}`);
        if (f.severity === "ERROR") errors++;
        else warns++;
      }
    }
  }
  console.log();
  console.log(`Summary: ${errors} errors, ${warns} warnings across ${docs.length} doc(s).`);
  process.exit(errors > 0 ? 1 : 0);
}
