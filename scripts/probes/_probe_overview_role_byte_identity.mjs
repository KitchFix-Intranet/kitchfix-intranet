#!/usr/bin/env node
// scripts/probes/_probe_overview_role_byte_identity.mjs
//
// R-40 assertion. Read-only.
//
// The Overview retired its two-layout fork. This probe asserts that
// the board payload is byte-identical for the same account + range
// across roles - the only differences are the access-gated fields
// (portfolio panel visibility, revenue-source toggle, salary
// control). Any drift here means a layout fork has re-appeared.
//
// Permanent: run under CI + local. Seeded failure: point one role
// URL at a different range and the assertion must FAIL.
//
// USAGE:
//   Local TEST_MODE dev server on :3311.
//   node scripts/probes/_probe_overview_role_byte_identity.mjs
//   SEEDED_FAILURE=1 node scripts/probes/_probe_overview_role_byte_identity.mjs

import { createHash } from "node:crypto";

const BASE = "http://localhost:3311/api/kpi/overview";
const SEEDED_FAILURE = process.env.SEEDED_FAILURE === "1";

// Access-gated fields to strip before comparison. These are the
// fields that legitimately differ across roles (they gate WHAT
// controls the user sees, not the board layout).
const ACCESS_GATED_KEYS = new Set([
  "salary_toggle_visible",
  "revenue_toggle_visible",
  "landing_account",
  "preview_account",
  "sc_mode_test_data",   // ticker note; corporate only via effRevSource=sc, but callers with rev_source=planned share this key with site_leader
]);

// Strip access-gated fields from a payload recursively so we can
// diff apples to apples. Sorts object keys so JSON.stringify is
// order-stable.
function stripAndSort(x) {
  if (Array.isArray(x)) return x.map(stripAndSort);
  if (x && typeof x === "object") {
    const out = {};
    for (const k of Object.keys(x).sort()) {
      if (ACCESS_GATED_KEYS.has(k)) continue;
      out[k] = stripAndSort(x[k]);
    }
    return out;
  }
  return x;
}

async function fetchPayload(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

const cases = [
  { name: "CIN - AZ / P9 open",   corp: `${BASE}?account=CIN%20-%20AZ&range=period:9`, site: `${BASE}?account=CIN%20-%20AZ&range=period:9&_test_role=site_leader&_test_scope=CIN%20-%20AZ` },
  { name: "CIN - AZ / P8 closed", corp: `${BASE}?account=CIN%20-%20AZ&range=period:8`, site: `${BASE}?account=CIN%20-%20AZ&range=period:8&_test_role=site_leader&_test_scope=CIN%20-%20AZ` },
  { name: "CIN - AZ / FYTD",      corp: `${BASE}?account=CIN%20-%20AZ&range=fytd`,      site: `${BASE}?account=CIN%20-%20AZ&range=fytd&_test_role=site_leader&_test_scope=CIN%20-%20AZ` },
  { name: "TBR - FL / P9 open",   corp: `${BASE}?account=TBR%20-%20FL&range=period:9`, site: `${BASE}?account=TBR%20-%20FL&range=period:9&_test_role=site_leader&_test_scope=TBR%20-%20FL` },
];

async function main() {
  console.log(`# R-40 role byte-identity - ${new Date().toISOString()}`);
  console.log(`# For each single-account URL, corporate vs site_leader payload must be byte-identical`);
  console.log(`# after stripping access-gated fields: ${[...ACCESS_GATED_KEYS].join(", ")}`);
  console.log("");

  let pass = 0, fail = 0;
  for (const c of cases) {
    // Optional seeded-failure axis: point the site URL at a different
    // ACCOUNT (STL - MO) so the payloads MUST differ - a same-account
    // range swap can accidentally collapse when both sides normalise
    // to the same fiscal window. Verifies the probe fires.
    const siteUrl = SEEDED_FAILURE
      ? c.site.replace(/account=[^&]+/, "account=STL%20-%20MO").replace(/_test_scope=[^&]+/, "_test_scope=STL%20-%20MO")
      : c.site;
    const [corp, site] = await Promise.all([fetchPayload(c.corp), fetchPayload(siteUrl)]);
    const c1 = JSON.stringify(stripAndSort(corp));
    const c2 = JSON.stringify(stripAndSort(site));
    const h1 = createHash("sha256").update(c1).digest("hex").slice(0, 12);
    const h2 = createHash("sha256").update(c2).digest("hex").slice(0, 12);
    const ok = c1 === c2;
    if (ok) pass += 1; else fail += 1;
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.name}  corp=${h1}  site=${h2}  bytes=${c1.length}/${c2.length}`);
    if (!ok && !SEEDED_FAILURE) {
      // Print the first diverging keypath to help triage.
      const diffKey = firstDivergingKey(stripAndSort(corp), stripAndSort(site));
      if (diffKey) console.log(`         first divergence at: ${diffKey}`);
    }
  }
  console.log("");
  console.log(`Result: ${pass} PASS, ${fail} FAIL across ${cases.length} cases`);
  if (SEEDED_FAILURE) {
    // Under seed, every case should FAIL - that's the seed test.
    const seedOk = fail === cases.length;
    console.log(`Seeded failure axis: ${seedOk ? "PASS (all cases correctly failed under seed)" : "FAIL (seed did not force divergence on every case)"}`);
    process.exit(seedOk ? 0 : 1);
  }
  process.exit(fail === 0 ? 0 : 1);
}

function firstDivergingKey(a, b, path = "") {
  if (a === b) return null;
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const d = firstDivergingKey(a[k], b[k], path ? `${path}.${k}` : k);
      if (d) return d;
    }
    return null;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
      const d = firstDivergingKey(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    if (a.length !== b.length) return `${path}.length (${a.length} vs ${b.length})`;
    return null;
  }
  return `${path} (${JSON.stringify(a).slice(0, 80)} vs ${JSON.stringify(b).slice(0, 80)})`;
}

main().catch(e => { console.error(e); process.exit(1); });
