// B1: Stale-proof test. Reconcile the TBJ dollar set against published figures
// using the STALE on-disk _augmented_v5stale.json (frozen 2026-08-13 snapshot).
//
// Acceptance: TBJ dollar set = 2,219 rows / $171,222.23 by month:
//   May 930 / $79,383.13, Jun 715 / $54,653.71, Jul 574 / $37,185.39
// For orientation, also reproduce TBR-FL and STL-FL published figures.
//
// Dollar set = rows where review_reason != 'invoice_over_extracted'.
// Read-only.

import fs from "node:fs";

const STALE = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_augmented_v5stale.json";
const FRESH = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_augmented.json";

const round2 = (n) => Math.round(n * 100) / 100;

function tally(rows) {
  const acc = {};
  for (const r of rows) {
    if (r.review_reason === "invoice_over_extracted") continue;
    const a = (r.account_label || "").replace(" - ", "-");
    const m = r.month;
    if (!a || !m) continue;
    const k = `${a}::${m}`;
    if (!acc[k]) acc[k] = { rows: 0, spend: 0 };
    acc[k].rows += 1;
    acc[k].spend += Number(r.extended_price) || 0;
  }
  return acc;
}

function summarizeByAcct(bucket) {
  const out = {};
  for (const [k, v] of Object.entries(bucket)) {
    const [a, m] = k.split("::");
    if (!out[a]) out[a] = { rows: 0, spend: 0, monthly: {} };
    out[a].rows += v.rows;
    out[a].spend += v.spend;
    out[a].monthly[m] = { rows: v.rows, spend: round2(v.spend) };
  }
  for (const a of Object.keys(out)) out[a].spend = round2(out[a].spend);
  return out;
}

const PUBLISHED = {
  "TBR-FL": {
    total: { rows: 2077, spend: 129507.43 },
    monthly: {
      "2026-05": { rows: 512, spend: 31403.14 },
      "2026-06": { rows: 744, spend: 45662.40 },
      "2026-07": { rows: 821, spend: 52441.89 },
    },
  },
  "TBJ-FL": {
    total: { rows: 2219, spend: 171222.23 },
    monthly: {
      "2026-05": { rows: 930, spend: 79383.13 },
      "2026-06": { rows: 715, spend: 54653.71 },
      "2026-07": { rows: 574, spend: 37185.39 },
    },
  },
  "STL-FL": {
    total: { rows: 2499, spend: 274187.13 },
    monthly: {
      "2026-05": { rows: 305, spend: 40456.67 },
      "2026-06": { rows: 1061, spend: 105735.53 },
      "2026-07": { rows: 1133, spend: 127994.93 },
    },
  },
};

function compare(label, got, pub) {
  console.log(`\n----- ${label} -----`);
  const issues = [];
  for (const a of Object.keys(pub)) {
    const g = got[a];
    if (!g) { console.log(`  ${a}: MISSING in tallied set`); issues.push({ acct: a, issue: "missing" }); continue; }
    const gRowsTot = g.rows;
    const gSpendTot = round2(g.spend);
    const pRowsTot = pub[a].total.rows;
    const pSpendTot = pub[a].total.spend;
    const dRows = gRowsTot - pRowsTot;
    const dSpend = round2(gSpendTot - pSpendTot);
    console.log(`  ${a}  rows ${gRowsTot} (pub ${pRowsTot}, delta ${dRows})  spend $${gSpendTot} (pub $${pSpendTot}, delta $${dSpend})`);
    for (const m of Object.keys(pub[a].monthly)) {
      const gm = g.monthly[m] || { rows: 0, spend: 0 };
      const pm = pub[a].monthly[m];
      const dr = gm.rows - pm.rows;
      const ds = round2(gm.spend - pm.spend);
      const mark = (dr === 0 && Math.abs(ds) < 0.005) ? "OK" : "MISMATCH";
      console.log(`    ${m}  ${gm.rows}/$${gm.spend}  vs pub ${pm.rows}/$${pm.spend}  drow=${dr} dspend=$${ds}  [${mark}]`);
      if (mark === "MISMATCH") issues.push({ acct: a, month: m, delta_rows: dr, delta_spend: ds });
    }
    if (dRows !== 0 || Math.abs(dSpend) > 0.005) issues.push({ acct: a, level: "total", delta_rows: dRows, delta_spend: dSpend });
  }
  return issues;
}

const stale = JSON.parse(fs.readFileSync(STALE, "utf8"));
console.log("[stale] rows=", stale.rows.length, "orphan_excluded=", stale.orphan_excluded, "drift_recovered=", stale.drift_recovered);

const staleBucket = tally(stale.rows);
const staleByAcct = summarizeByAcct(staleBucket);

const staleIssues = compare("STALE _augmented_v5stale.json vs PUBLISHED v5", staleByAcct, PUBLISHED);

let freshIssues = null;
if (fs.existsSync(FRESH)) {
  // Only compare fresh if it exists AND its mtime differs from stale (i.e. it has been refreshed).
  const sSta = fs.statSync(STALE);
  const sFre = fs.statSync(FRESH);
  if (sSta.mtimeMs !== sFre.mtimeMs) {
    const fresh = JSON.parse(fs.readFileSync(FRESH, "utf8"));
    console.log("\n[fresh] rows=", fresh.rows.length, "orphan_excluded=", fresh.orphan_excluded, "drift_recovered=", fresh.drift_recovered);
    const freshBucket = tally(fresh.rows);
    const freshByAcct = summarizeByAcct(freshBucket);
    freshIssues = compare("FRESH _augmented.json vs PUBLISHED v5 (for reference)", freshByAcct, PUBLISHED);
  } else {
    console.log("\n[fresh] file is byte-identical to stale (not yet refreshed); skipping fresh comparison");
  }
}

// Emit machine-readable summary
const OUT = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_stale_proof.json";
fs.writeFileSync(OUT, JSON.stringify({
  ran_at: new Date().toISOString(),
  stale_file: STALE,
  stale_file_mtime: fs.statSync(STALE).mtime.toISOString(),
  fresh_file: FRESH,
  stale_by_account: staleByAcct,
  stale_issues: staleIssues,
  fresh_issues: freshIssues,
  published: PUBLISHED,
}, null, 2));
console.log("\nwrote", OUT);

const staleTbjOk = !staleIssues.some(i => i.acct === "TBJ-FL");
if (!staleTbjOk) {
  console.log("\nSTALE-PROOF: FAIL - TBJ does not reproduce on stale AUG.");
  process.exit(2);
}
console.log("\nSTALE-PROOF: PASS - TBJ reproduces published v5 figures on the stale AUG snapshot.");
