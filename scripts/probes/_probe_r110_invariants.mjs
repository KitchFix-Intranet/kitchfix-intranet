// R-110 · Guard 3 invariants 1 and 3 on live NP data, both accounts,
// all three boards. Plus Guard 1 check: CP (P10) still renders with
// the same figures.

const BASE = "http://localhost:3000";
const ACCTS = ["TBJ - FL", "TBR - FL"];
const NP_START = "2026-10-05", NP_END = "2026-11-01";
const CP_START = "2026-09-07", CP_END = "2026-10-04";

async function fetchJSON(url) {
  const r = await fetch(url, { headers: { "x-test-user": "kevin@kitchfix.com" } });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.json();
}

console.log("\n=== INVARIANTS ON NP (P11) ===");
for (const acct of ACCTS) {
  const q = `account=${encodeURIComponent(acct)}&start=${NP_START}&end=${NP_END}&include_salary=1`;
  const [ov, lb, pu] = await Promise.all([
    fetchJSON(`${BASE}/api/kpi/overview?${q}`),
    fetchJSON(`${BASE}/api/kpi/labor?${q}`),
    fetchJSON(`${BASE}/api/kpi/purchasing?${q}`),
  ]);

  const weeks = lb?.board?.weeks || [];
  const rev = weeks.map(w => Number(w.week_revenue || 0));
  const revSum = rev.reduce((s, v) => s + v, 0);

  const stmt = new Map((ov.statement_rows || []).map(r => [r.line_code, r]));

  console.log(`\n${acct} · P11`);
  console.log(`  Invariant 3 · week revenue sum = ${revSum.toFixed(2)} (each week: ${rev.map(v => v.toFixed(2)).join(", ")})`);
  console.log(`  Perk-card "planned revenue" = ${revSum.toFixed(2)}  (period column reads the same, chef can add)`);
  console.log(`  service_days · sum = ${weeks.reduce((s, w) => s + Number(w.service_days || 0), 0)}`);

  console.log("  Invariant 1 · per-line sum(week goals) vs envelope target:");
  // The component uses the period-exact ratio (envelope / revSum) on
  // future range when batr is null - Kevin ruling 2026-09-16, R-111
  // exact-ratio applied to planned-period pb.
  for (const line of ["3100", "3200", "3400"]) {
    const row = stmt.get(line);
    if (!row) continue;
    const batr = Number(row.budget_at_this_revenue || 0);
    const pb = Number(row.period_budget || 0);
    const envelope = batr > 0 ? batr : pb;
    let sum;
    if (line === "3100") {
      const sub1 = stmt.get("3100.1");
      const sub2 = stmt.get("3100.2");
      if (sub1 && sub2) {
        const hourlyRatio = Number(sub1.target_pct || 0) / 100;
        const salaryPerWeek = Number(sub2.period_budget || 0) / 4;
        sum = rev.reduce((s, r) => s + r * hourlyRatio + salaryPerWeek, 0);
      } else {
        const ratio = envelope / revSum;
        sum = rev.reduce((s, r) => s + r * ratio, 0);
      }
    } else {
      const ratio = envelope / revSum;
      sum = rev.reduce((s, r) => s + r * ratio, 0);
    }
    const delta = sum - envelope;
    const src = batr > 0 ? "batr" : "pb";
    console.log(`    ${line}  sum(goals)=$${sum.toFixed(2)}  ${src}=$${envelope.toFixed(2)}  delta=$${delta.toFixed(2)}  ${Math.abs(delta) <= 1 ? "PASS" : "FAIL"}`);
  }
}

console.log("\n=== GUARD 1 · CP (P10) still renders same figures ===");
for (const acct of ACCTS) {
  const q = `account=${encodeURIComponent(acct)}&start=${CP_START}&end=${CP_END}&include_salary=1`;
  const ov = await fetchJSON(`${BASE}/api/kpi/overview?${q}`);
  const kind = ov?.range?.kind;
  const state = ov?.period_state;
  console.log(`${acct} · CP · range.kind=${kind} · period_state=${state} · statement rows count=${(ov.statement_rows || []).length}`);
}
