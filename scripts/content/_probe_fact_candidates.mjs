#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/_probe_fact_candidates.mjs
// F3 fact-candidate finder. Per-fact scanner that surfaces every occurrence
// of a plausible literal across content/documents/, with line context, so
// CC can review and tokenize SURGICALLY (per F3 rule "this is a per-fact,
// reviewed pass - not a global find-replace").
//
// Hard exclusions (the script flags but does NOT include in tokenizable
// candidates):
//   - lines inside SOP-015 §03 (preserved-error table)
//   - JD TEMPLATE TPL-101 / TPL-102 / TPL-103 / TPL-104 brand-promise drift
//     (canonical wording only - drifted "best-in-class hospitality through
//     exceptional food and unmatched service" is preserved literal)
//   - lines inside <NonCanonical>...</NonCanonical> blocks
//   - lines that are already a <Fact id="..." /> token
//
// Usage:
//   node scripts/content/_probe_fact_candidates.mjs <fact_id>
//   node scripts/content/_probe_fact_candidates.mjs --all
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");
const DOCS_DIR = join(REPO_ROOT, "content", "documents");

// Patterns to find for each Tier 1 + Tier 2 floor-confirmed fact.
// Each pattern is a regex applied LINE-BY-LINE. Already-tokenized lines and
// lines inside NonCanonical blocks are filtered.
const PATTERNS = {
  // Food safety temps
  cold_hold_temp: /[≤≥<>]\s*=?\s*41\s*F\b|\b41F\s+(?:or below|cold|cold-hold|refrigerator)\b/i,
  hot_hold_temp: /[≤≥<>]\s*=?\s*135\s*F\b|\b135F\s+(?:or above|hot|hot-hold)\b/i,
  frozen_temp: /[≤≥<>]\s*=?\s*0\s*F\b|\b0F\s+frozen\b/i,
  danger_zone: /\b41\s*F\s*[–—\-]\s*135\s*F\b/i,
  cook_temp_poultry: /\b165\s*F\s*\(\s*15\s*s\b|\b165F\s+poultry\b/i,
  cook_temp_ground: /\b155\s*F\s*\(\s*17\s*s\b|\b155F\s+ground\b/i,
  cook_temp_wholemuscle_fish: /\b145\s*F\s*\(\s*15\s*s\b|\b145F\s+(?:whole|fish)\b/i,
  cooling_rule: /135F\s*(?:to|→|->)\s*70F\s+in\s+2\s*(?:h|hour)|70F\s*(?:to|→|->)\s*41F\s+in\s+4\s*(?:h|hour)/i,
  reheat_rule: /\b165\s*F\s+within\s+2\s*(?:h|hour)/i,
  tphc_clock: /\bTPHC.*?4[\s-]?hour|\b4\s*-?\s*hour\s+(?:TPHC|clock|discard)/i,
  date_mark_max: /\b7\s+days?\s+at\s+41\s*F\b/i,
  quat_ppm: /\b200\s*[–—\-]\s*400\s*ppm\b/i,
  warewash_rinse: /\b180F\s+manifold\b/i,
  threecomp_wash_temp: /\b[≤≥<>]?\s*=?\s*110\s*F\b.*wash/i,
  storage_off_floor: /\b6\s+inches?\s+off\s+(?:the\s+)?floor\b/i,

  // Brand + company
  brand_promise: /\bBest\s+Food,?\s+Best\s+Service,?\s+Best\s+Hospitality\b/i,
  operating_states: /\b(?:eight|8)\s+states?\b/i,

  // HR / classification
  ft_threshold_hours: /\b30\+?\s*(?:hrs?|hours?)\s*\/\s*(?:wk|week)\b|\b30\+?\s*(?:hrs?|hours?)\s+per\s+week\b/i,

  // Workers comp
  wc_carrier: /\bThe\s+Hartford\b/,

  // Incident windows
  incident_S1_window: /\b15\s+minutes?\b/i,
  incident_S2_window: /\b30\s+minutes?\b/i,
  incident_S3_window: /\b4\s+hours?\b/i,

  // Substance / leave / discipline
  bac_limit: /\b0\.08\s*%\b/i,
  fmla_worksite_threshold: /\b50\s+employees?\s+within\s+75\s+miles?\b/i,
  pip_standard_days: /\b30\s+days?\s+(?:default\s+)?(?:PIP|standard)\b|\bPIP.*?30\s+days?\b/i,

  // Tier 2 floor-confirmed
  sick_accrual: /\b1\s+hour\s+per\s+30\s+(?:hours\s+)?worked\b/i,
  overtime_threshold: /\b40\s+(?:hrs|hours)\s*\/\s*(?:wk|week)\b|\bover\s+40\s+(?:hrs|hours)\b/i,
  record_retention_disciplinary: /\b3\s+years?\s+retention\b|\bretention.*?3\s+years?\b/i,
};

// Lines / sections to exclude (flagged as preserved findings)
function isInNonCanonical(lines, idx) {
  let depth = 0;
  for (let i = 0; i <= idx; i++) {
    if (/<NonCanonical>/.test(lines[i])) depth++;
    if (/<\/NonCanonical>/.test(lines[i])) depth--;
  }
  return depth > 0;
}

function isInSOP015Sec3(docId, body, idx) {
  if (docId !== "SOP-015") return false;
  // Find the §03 heading; the table is until the next H1
  const lines = body.split("\n");
  let in3 = false;
  let n3line = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^#\s+0?3\b/.test(lines[i])) { in3 = true; n3line = i; }
    else if (in3 && /^#\s+0?4\b/.test(lines[i])) {
      return idx >= n3line && idx < i;
    }
  }
  return in3 && idx >= n3line;
}

function isAlreadyToken(line) {
  return /<Fact\s+id\s*=\s*"[^"]+"\s*\/>/.test(line);
}

const args = process.argv.slice(2);
const wantAll = args.includes("--all");
const factIds = wantAll ? Object.keys(PATTERNS) : args;

if (factIds.length === 0) {
  console.error("Usage: node scripts/content/_probe_fact_candidates.mjs <fact_id> | --all");
  process.exit(1);
}

const docFiles = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".mdx")).sort();

for (const factId of factIds) {
  const pat = PATTERNS[factId];
  if (!pat) {
    console.error(`No pattern defined for '${factId}'`);
    continue;
  }
  console.log(`\n────────────────────────────────────────────────────────────────`);
  console.log(`  ${factId}    /${pat.source}/${pat.flags}`);
  console.log(`────────────────────────────────────────────────────────────────`);

  let total = 0;
  let tokenizable = 0;
  let excluded = 0;
  let preserved = 0;

  for (const f of docFiles) {
    const src = readFileSync(join(DOCS_DIR, f), "utf8");
    const docId = basename(f, ".mdx");
    // strip frontmatter for body-only search
    const fmEnd = src.indexOf("\n---\n", 4);
    const body = fmEnd >= 0 ? src.slice(fmEnd + 5) : src;
    const lines = body.split("\n");

    for (let i = 0; i < lines.length; i++) {
      if (!pat.test(lines[i])) continue;
      total++;
      const excluded_token = isAlreadyToken(lines[i]);
      const excluded_nc = isInNonCanonical(lines, i);
      const excluded_sop015 = isInSOP015Sec3(docId, body, i);
      // JD TEMPLATE drift: skip brand_promise hits in TPL-101..104 (preserves the drift)
      const excluded_jd_drift = factId === "brand_promise" && /^TPL-10[1-4]$/.test(docId) === false ? false : (factId === "brand_promise" && /^TPL-10[1-4]$/.test(docId));

      const flag = excluded_token ? "[tok]" : excluded_nc ? "[nc]" : excluded_sop015 ? "[SOP-015 §03]" : excluded_jd_drift ? "[JD drift]" : "    ";
      if (excluded_token || excluded_nc || excluded_sop015 || excluded_jd_drift) {
        if (excluded_sop015 || excluded_jd_drift) preserved++;
        else excluded++;
      } else {
        tokenizable++;
      }
      const snippet = lines[i].trim().slice(0, 100);
      console.log(`  ${flag}  ${docId}:${(i + 1).toString().padStart(4)}  ${snippet}`);
    }
  }

  console.log(`  -- totals: ${total} matches, ${tokenizable} tokenizable, ${excluded} excluded (already token / NonCanonical), ${preserved} preserved (SOP-015 §03 / JD drift)`);
}
