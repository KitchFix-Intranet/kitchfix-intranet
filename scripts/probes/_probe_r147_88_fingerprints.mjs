#!/usr/bin/env node
// R-147 · 88 payload fingerprints regression check.
//
// 11 accounts x 4 ranges (CY, P1, P5, P9) x 2 salary toggles = 88.
// None of those four ranges includes P10, so all 88 must come back
// unchanged post-R-147. If one moves, the purchasing change has
// leaked into the overview / labor payload and we stop.
//
// This is the leak detector, not the primary gate.
//
// Requires two dev servers:
//   - MAIN on http://localhost:3001  (kf-close-adjustment worktree
//     serving pre-R-147 main)
//   - R147 on http://localhost:3000  (this worktree serving R-147)
//
// Both must be running with TEST_MODE=true so /api/kpi/* is reachable
// without OAuth.
//
//   node --env-file=.env.local scripts/probes/_probe_r147_88_fingerprints.mjs
//
// Salary toggle: include_salary=1 vs no param. canSeeSalary gates the
// two accounts (CIN - KY, TBJ - NY); on those two the +salary payload
// equals the hourly payload by construction. The fingerprint still
// runs (Kevin's 88), and the equality is the point.

import { createHash } from "node:crypto";

const MEMBERS = ["TBJ - FL","TBR - FL","CIN - AZ","TXR - AZ","STL - FL","STL - MO","CIN - KY","CIN - OH","TXR - TX - H","TXR - TX - V","TBJ - NY"];
const MAIN_BASE = "http://localhost:3001";
const R147_BASE = "http://localhost:3000";

// Fiscal period boundaries.
const MS = 86400000;
const FY_START_MS = new Date("2025-12-29T00:00:00Z").getTime();
function periodStartISO(p) { return new Date(FY_START_MS + (p - 1) * 28 * MS).toISOString().slice(0, 10); }
function periodEndISO(p) { return new Date(FY_START_MS + (p * 28 - 1) * MS).toISOString().slice(0, 10); }

const CY_RANGE = { key: "CY", start: "2025-12-29", end: periodEndISO(9) };
const RANGES = [CY_RANGE, { key: "P1", start: periodStartISO(1), end: periodEndISO(1) },
                          { key: "P5", start: periodStartISO(5), end: periodEndISO(5) },
                          { key: "P9", start: periodStartISO(9), end: periodEndISO(9) }];
const SALARY = [{ key: "hourly", param: "" }, { key: "+salary", param: "&include_salary=1" }];

function hashPayload(o) {
  // Stable stringify - sort keys recursively so hash is field-order-
  // independent. Payloads can arrive with keys in any order without
  // producing a false-positive drift.
  const s = JSON.stringify(o, Object.keys(o).sort());
  return createHash("sha1").update(s).digest("hex").slice(0, 12);
}
function stableStringify(o) {
  if (o === null || typeof o !== "object") return JSON.stringify(o);
  if (Array.isArray(o)) return "[" + o.map(stableStringify).join(",") + "]";
  const keys = Object.keys(o).sort();
  return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}
function fp(o) { return createHash("sha1").update(stableStringify(o)).digest("hex").slice(0, 12); }

async function fetchJson(base, path) {
  const r = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(60_000) });
  if (!r.ok) return { error: `${r.status} on ${path}` };
  try { return { ok: r.headers.get("content-type")?.includes("json") ? await r.json() : { raw: (await r.text()).slice(0, 200) } }; }
  catch (e) { return { error: String(e) }; }
}

// Verify both servers are up.
{
  const test = "/api/kpi/overview?account=TBJ%20-%20FL&start=2026-08-10&end=2026-09-06";
  const m = await fetchJson(MAIN_BASE, test);
  const r = await fetchJson(R147_BASE, test);
  if (m.error) { console.error(`[fatal] MAIN server at ${MAIN_BASE} not reachable: ${m.error}`); process.exit(1); }
  if (r.error) { console.error(`[fatal] R147 server at ${R147_BASE} not reachable: ${r.error}`); process.exit(1); }
  console.log(`[env] both servers respond OK`);
}

// Strip volatile fields that would flip even without a real code drift.
function scrub(o) {
  if (Array.isArray(o)) return o.map(scrub);
  if (o && typeof o === "object") {
    const out = {};
    for (const [k, v] of Object.entries(o)) {
      if (k === "todayISO") continue;
      if (k === "generated_at" || k === "derived_at" || k === "fetched_at") continue;
      if (k === "freshness") continue;             // last_derive_at / cards_through move every request
      out[k] = scrub(v);
    }
    return out;
  }
  return o;
}

const results = [];
let drifted = 0;

for (const acct of MEMBERS) {
  for (const rng of RANGES) {
    for (const sal of SALARY) {
      const qs = `account=${encodeURIComponent(acct)}&start=${rng.start}&end=${rng.end}${sal.param}`;
      const [mOv, rOv, mLb, rLb] = await Promise.all([
        fetchJson(MAIN_BASE, `/api/kpi/overview?${qs}`),
        fetchJson(R147_BASE, `/api/kpi/overview?${qs}`),
        fetchJson(MAIN_BASE, `/api/kpi/labor?${qs}`),
        fetchJson(R147_BASE, `/api/kpi/labor?${qs}`),
      ]);
      const mainFp = fp({ overview: scrub(mOv.ok || null), labor: scrub(mLb.ok || null) });
      const r147Fp = fp({ overview: scrub(rOv.ok || null), labor: scrub(rLb.ok || null) });
      const ok = mainFp === r147Fp;
      if (!ok) drifted += 1;
      results.push({ label: `${acct.padEnd(14)} ${rng.key.padEnd(3)} ${sal.key.padEnd(8)}`, mainFp, r147Fp, ok });
      process.stdout.write(ok ? "." : "X");
    }
  }
}
console.log();
console.log();
console.log(`─── R-147 payload fingerprints (11 x 4 x 2 = 88) ───`);
for (const r of results) {
  if (!r.ok) console.log(`  DRIFT  ${r.label}  main=${r.mainFp}  r147=${r.r147Fp}`);
}
console.log();
console.log(`Result: ${88 - drifted}/88 unchanged · ${drifted} drift`);
if (drifted > 0) {
  console.log(`\nSample drifted tuples above. Investigate before merge.`);
  process.exit(1);
}
