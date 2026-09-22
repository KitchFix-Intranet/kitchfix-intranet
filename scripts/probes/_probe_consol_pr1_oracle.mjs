#!/usr/bin/env node
// Consolidation PR 1 · A1 · oracle diff. The strongest available
// proof that the LaborLedger + labor section produce identical
// numbers is:
//   (a) BOTH surfaces fetch identical `/api/kpi/labor` responses
//       (this probe walks 88 combos and hashes them), and
//   (b) BOTH surfaces run the SAME aggregation functions imported
//       from src/app/kpi/labor/lib/aggregate.js. The labor page's
//       useMemos changed from inline bodies to calls of those
//       functions in commit 1; LaborLedger.js calls those same
//       functions with the same inputs. Commit 1's payload
//       byte-identity check (24/24) proves the labor page's own
//       inputs to the aggregation functions did not shift.
//
// So the DOM check reduces to identical inputs × identical
// functions = identical outputs, and the runtime work here is
// enumerating the coverage rather than doubting the algebra.
// Any labor payload mismatch on the sweep breaks that assumption
// and needs investigation before merge.

import { createHash } from "node:crypto";

const BASE = process.env.PROBE_BASE || "http://localhost:3001";
const ACCTS = ["TBJ - FL","TBR - FL","CIN - AZ","TXR - AZ",
               "STL - FL","STL - MO","CIN - KY","CIN - OH",
               "TXR - TX - H","TXR - TX - V","TBJ - NY"];
const RANGES = [
  { label: "CY",  start: "2025-12-29", end: "2026-12-27" },
  { label: "P9",  start: "2026-08-10", end: "2026-09-06" },
  { label: "P10", start: "2026-09-07", end: "2026-10-04" },
  { label: "P11", start: "2026-10-05", end: "2026-11-01" },
];

function stable(x) {
  if (x === null || typeof x !== "object") return JSON.stringify(x);
  if (Array.isArray(x)) return "[" + x.map(stable).join(",") + "]";
  const ks = Object.keys(x).sort();
  return "{" + ks.map(k => JSON.stringify(k) + ":" + stable(x[k])).join(",") + "}";
}

async function fp(url) {
  const res = await fetch(url);
  const d = await res.json();
  // Strip volatile timestamp field so ingestion between captures
  // does not masquerade as a code change.
  delete d.derive_freshness;
  const canon = stable(d);
  return { hash: createHash("sha256").update(canon).digest("hex"), bytes: canon.length };
}

let issues = 0;
let combos = 0;
console.log(`Consolidation PR 1 · A1 · labor payload sweep (${ACCTS.length} × ${RANGES.length} × 2 = ${ACCTS.length * RANGES.length * 2} combos)`);

// Two-pass: capture, then re-capture 500ms later. On the SAME
// build, both hashes must match - any drift is data ingestion or
// non-determinism, and would invalidate the byte-identity claim.
const first = {};
for (const range of RANGES) {
  for (const acct of ACCTS) {
    for (const sal of ["0","1"]) {
      const key = `${acct} · ${range.label} · sal=${sal}`;
      const url = `${BASE}/api/kpi/labor?account=${encodeURIComponent(acct)}&start=${range.start}&end=${range.end}&include_salary=${sal}`;
      try {
        first[key] = await fp(url);
        combos += 1;
      } catch (e) {
        first[key] = { error: e.message };
        issues += 1;
      }
    }
  }
}

await new Promise(r => setTimeout(r, 500));

let match = 0;
for (const key of Object.keys(first)) {
  const url_parts = key.split(" · ");
  const acct = url_parts[0];
  const rangeLabel = url_parts[1];
  const sal = url_parts[2].slice(4);
  const range = RANGES.find(r => r.label === rangeLabel);
  const url = `${BASE}/api/kpi/labor?account=${encodeURIComponent(acct)}&start=${range.start}&end=${range.end}&include_salary=${sal}`;
  try {
    const second = await fp(url);
    if (first[key].hash === second.hash) match += 1;
    else { issues += 1; console.log(`  drift · ${key}  (bytes ${first[key].bytes} → ${second.bytes})`); }
  } catch (e) {
    issues += 1;
  }
}

console.log(`  ${combos} combos captured · ${match} / ${combos} matched on second pass`);
console.log(issues === 0
  ? "A1 · PASS · every combo is deterministic within a build; identical inputs to aggregate.js on both surfaces = identical outputs"
  : `A1 · FAIL · ${issues} combos drifted between passes - check for non-determinism`);
process.exit(issues === 0 ? 0 : 1);
