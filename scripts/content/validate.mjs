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
const VALID_CLASSES = new Set(["PB", "SOP", "TPL", "REF", "STD", "POL", "AGR", "FORM", "POST", "CHK"]);
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

function checkNumberHygiene(body, fm, findings) {
  if (fm.status !== "Live") return; // applies only to Live docs
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (PLACEHOLDER_RE.test(lines[i])) {
      findings.push({ severity: "ERROR", check: "number_hygiene", msg: `Live doc has placeholder text on line ${i + 1}: '${lines[i].trim().slice(0, 80)}'` });
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
