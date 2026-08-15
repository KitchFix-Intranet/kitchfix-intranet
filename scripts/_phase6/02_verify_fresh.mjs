// B2 verification: check fresh _augmented.json against:
//   TBR-FL: 2,077 / $129,507.43 (Fact 1)  - to the cent
//   STL-FL: 2,499 / $274,187.13 (Fact 1)  - to the cent
//   TBJ-FL: 2,202 / $183,851.55 (Fact 2 fresh figures)  - to the cent
//     May 630 / $58,588.95
//     Jun 778 / $64,691.26
//     Jul 794 / $60,571.34
// Read-only.

import fs from "node:fs";

const FRESH = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_augmented.json";
const round2 = (n) => Math.round(n * 100) / 100;

const EXP = {
  "TBR-FL": {
    total: { rows: 2077, spend: 129507.43 },
    monthly: {
      "2026-05": { rows: 512, spend: 31403.14 },
      "2026-06": { rows: 744, spend: 45662.40 },
      "2026-07": { rows: 821, spend: 52441.89 },
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
  "TBJ-FL": {
    total: { rows: 2202, spend: 183851.55 },
    monthly: {
      "2026-05": { rows: 630, spend: 58588.95 },
      "2026-06": { rows: 778, spend: 64691.26 },
      "2026-07": { rows: 794, spend: 60571.34 },
    },
  },
};

const fresh = JSON.parse(fs.readFileSync(FRESH, "utf8"));
console.log("[fresh] rows=", fresh.rows.length, "drift_recovered=", fresh.drift_recovered, "orphan_excluded=", fresh.orphan_excluded);

const bucket = {};
for (const r of fresh.rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  const a = (r.account_label || "").replace(" - ", "-");
  const m = r.month;
  if (!a || !m) continue;
  const k = `${a}::${m}`;
  if (!bucket[k]) bucket[k] = { rows: 0, spend: 0 };
  bucket[k].rows += 1;
  bucket[k].spend += Number(r.extended_price) || 0;
}

const perAcct = {};
for (const [k, v] of Object.entries(bucket)) {
  const [a, m] = k.split("::");
  if (!perAcct[a]) perAcct[a] = { rows: 0, spend: 0, monthly: {} };
  perAcct[a].rows += v.rows;
  perAcct[a].spend += v.spend;
  perAcct[a].monthly[m] = { rows: v.rows, spend: round2(v.spend) };
}
for (const a of Object.keys(perAcct)) perAcct[a].spend = round2(perAcct[a].spend);

let issues = 0;
for (const a of Object.keys(EXP)) {
  const g = perAcct[a] || { rows: 0, spend: 0, monthly: {} };
  const e = EXP[a];
  const drow = g.rows - e.total.rows;
  const dsp = round2(g.spend - e.total.spend);
  const mark = (drow === 0 && Math.abs(dsp) < 0.005) ? "OK" : "FAIL";
  console.log(`  ${a}  TOTAL  got ${g.rows}/$${g.spend}  exp ${e.total.rows}/$${e.total.spend}  drow=${drow} dspend=$${dsp}  [${mark}]`);
  if (mark !== "OK") issues++;
  for (const m of Object.keys(e.monthly)) {
    const gm = g.monthly[m] || { rows: 0, spend: 0 };
    const em = e.monthly[m];
    const dr = gm.rows - em.rows;
    const ds = round2(gm.spend - em.spend);
    const mm = (dr === 0 && Math.abs(ds) < 0.005) ? "OK" : "FAIL";
    console.log(`    ${m}  got ${gm.rows}/$${gm.spend}  exp ${em.rows}/$${em.spend}  drow=${dr} dspend=$${ds}  [${mm}]`);
    if (mm !== "OK") issues++;
  }
}

const OUT = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_verify_fresh.json";
fs.writeFileSync(OUT, JSON.stringify({
  ran_at: new Date().toISOString(),
  fresh_row_count: fresh.rows.length,
  fresh_orphan_excluded: fresh.orphan_excluded,
  fresh_drift_recovered: fresh.drift_recovered,
  per_account: perAcct,
  expected: EXP,
  issue_count: issues,
}, null, 2));
console.log(`\nwrote ${OUT}`);
console.log(`\nB2 VERIFY: ${issues === 0 ? "PASS" : `FAIL (${issues} mismatches)`}`);
process.exit(issues === 0 ? 0 : 3);
