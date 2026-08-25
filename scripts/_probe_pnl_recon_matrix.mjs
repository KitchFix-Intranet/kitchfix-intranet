// scripts/_probe_pnl_recon_matrix.mjs
// Merge finance file (from _probe_pnl_recon_extract) with DB snapshot
// (from _probe_pnl_recon_db) and produce a per-account-period matrix
// plus summary counts and variance lists.
//
// No worker names or individual pay amounts appear here - both input
// snapshots are account-period aggregates only.

import fs from "node:fs";

const FIN = JSON.parse(fs.readFileSync("/tmp/pnl_finance.json", "utf8"));
const DB  = JSON.parse(fs.readFileSync("/tmp/pnl_db.json", "utf8"));

// Explicit sheet -> account_key mapping. Kevin's rule: no fuzzy-match,
// enumerate. TBJ-BUF vs TBJ-NY and TXR-HOME / TXR-VISTOR are the
// non-identity mappings; every other pair differs only in spacing
// around the dash.
const SHEET_TO_ACCT = {
  "CIN-AZ":     "CIN - AZ",
  "CIN-KY":     "CIN - KY",
  "CIN-OH":     "CIN - OH",
  "STL-FL":     "STL - FL",
  "STL-MO":     "STL - MO",
  "TBJ-BUF":    "TBJ - NY",       // Buffalo, NY
  "TBJ-FL":     "TBJ - FL",
  "TBR-FL":     "TBR - FL",
  "TXR-AZ":     "TXR - AZ",
  "TXR-HOME":   "TXR - TX - H",   // Home
  "TXR-VISTOR": "TXR - TX - V",   // Visitor (finance-file spelling)
};

const rows = [];
for (const sheet of Object.keys(FIN)) {
  const acct = SHEET_TO_ACCT[sheet];
  if (!acct) { console.error(`WARN: no acct mapping for sheet ${sheet}`); continue; }
  const finPer = FIN[sheet].periods;
  const dbPer  = DB[acct] || {};
  for (let p = 1; p <= 8; p++) {
    const f = finPer[`P${p}`] || {};
    const d = dbPer[`P${p}`] || {};
    rows.push({
      account: acct,
      sheet,
      period: `P${p}`,
      db_hourly: d.hourly_actual,
      fin_hourly: f.hourly_actual,
      delta_hourly: d.hourly_actual != null && f.hourly_actual != null ? +(d.hourly_actual - f.hourly_actual).toFixed(2) : null,
      db_salary: d.salary_actual,
      fin_salary: f.salary_actual,
      delta_salary: d.salary_actual != null && f.salary_actual != null ? +(d.salary_actual - f.salary_actual).toFixed(2) : null,
      db_budget_h: d.hourly_budget,
      fin_budget_h: f.hourly_budget,
      delta_budget_h: d.hourly_budget != null && f.hourly_budget != null ? +(d.hourly_budget - f.hourly_budget).toFixed(2) : null,
      db_budget_s: d.salary_budget,
      fin_budget_s: f.salary_budget,
      delta_budget_s: d.salary_budget != null && f.salary_budget != null ? +(d.salary_budget - f.salary_budget).toFixed(2) : null,
    });
  }
}

// Emit the matrix as JSON.
fs.writeFileSync("/tmp/pnl_matrix.json", JSON.stringify(rows, null, 2));

// Reconciliation classifier - three buckets:
//   RECON      |delta| <= $1.00   (rounding noise; either-side rounded to
//                                   nearest cent + finance file is
//                                   rounded to whole dollars in the
//                                   Actual column, so up to $0.99 delta
//                                   is arithmetic parity)
//   MIDBAND    $1.00 < |delta| <= $100 AND <= 1%
//   SIGNIFICANT |delta| > $100 OR > 1%
// Null handling: both null OR one null + other |v| <= $1 = RECON.
// One null + other > $1 = SIGNIFICANT.
function absCentClose(a, b) {
  if (a == null && b == null) return true;
  if (a == null) return Math.abs(b) <= 1;
  if (b == null) return Math.abs(a) <= 1;
  return Math.abs(a - b) <= 1;
}
function classify(db, fin) {
  if (absCentClose(db, fin)) return "recon";
  const delta = (db ?? 0) - (fin ?? 0);
  const absMax = Math.max(Math.abs(db ?? 0), Math.abs(fin ?? 0));
  if (Math.abs(delta) > 100) return "significant";
  if (absMax > 0 && Math.abs(delta) / absMax > 0.01) return "significant";
  return "midband";
}

const stats = {
  hourly:   { recon: 0, midband: 0, significant: 0 },
  salary:   { recon: 0, midband: 0, significant: 0 },
  budget_h: { recon: 0, midband: 0, significant: 0 },
  budget_s: { recon: 0, midband: 0, significant: 0 },
};

const variances = [];
for (const r of rows) {
  const clsH = classify(r.db_hourly, r.fin_hourly);
  const clsS = classify(r.db_salary, r.fin_salary);
  const clsBh = classify(r.db_budget_h, r.fin_budget_h);
  const clsBs = classify(r.db_budget_s, r.fin_budget_s);
  stats.hourly[clsH]++;
  stats.salary[clsS]++;
  stats.budget_h[clsBh]++;
  stats.budget_s[clsBs]++;
  if (clsH === "significant") variances.push({ account: r.account, period: r.period, kind: "hourly", db: r.db_hourly, fin: r.fin_hourly, delta: r.delta_hourly, dir: (r.delta_hourly ?? 0) > 0 ? "DB > P&L" : "DB < P&L" });
  if (clsS === "significant") variances.push({ account: r.account, period: r.period, kind: "salary", db: r.db_salary, fin: r.fin_salary, delta: r.delta_salary, dir: (r.delta_salary ?? 0) > 0 ? "DB > P&L" : "DB < P&L" });
  if (clsBh === "significant") variances.push({ account: r.account, period: r.period, kind: "budget_hourly", db: r.db_budget_h, fin: r.fin_budget_h, delta: r.delta_budget_h, dir: (r.delta_budget_h ?? 0) > 0 ? "DB > P&L" : "DB < P&L" });
  if (clsBs === "significant") variances.push({ account: r.account, period: r.period, kind: "budget_salary", db: r.db_budget_s, fin: r.fin_budget_s, delta: r.delta_budget_s, dir: (r.delta_budget_s ?? 0) > 0 ? "DB > P&L" : "DB < P&L" });
}

fs.writeFileSync("/tmp/pnl_summary.json", JSON.stringify({ stats, variances }, null, 2));

// Pretty print for the report.
console.log("═══ RECON SUMMARY ═══");
console.log(`total account-periods: ${rows.length}`);
console.log("");
console.log("kind      | recon | midband | significant");
console.log("hourly    | " + String(stats.hourly.recon).padStart(5) + " | " + String(stats.hourly.midband).padStart(7) + " | " + String(stats.hourly.significant).padStart(11));
console.log("salary    | " + String(stats.salary.recon).padStart(5) + " | " + String(stats.salary.midband).padStart(7) + " | " + String(stats.salary.significant).padStart(11));
console.log("budget-h  | " + String(stats.budget_h.recon).padStart(5) + " | " + String(stats.budget_h.midband).padStart(7) + " | " + String(stats.budget_h.significant).padStart(11));
console.log("budget-s  | " + String(stats.budget_s.recon).padStart(5) + " | " + String(stats.budget_s.midband).padStart(7) + " | " + String(stats.budget_s.significant).padStart(11));
console.log("");
console.log(`variances flagged (>$100 or >1%): ${variances.length}`);
console.log(`written /tmp/pnl_matrix.json + /tmp/pnl_summary.json`);
