// FIN-2027 W5 · snapshot writer. READ ONLY on Supabase.
// Writes a per-cell (account_key, fiscal_year, period_no, line_code) →
// { budget, actual } JSON snapshot to ~/Downloads/kf-fin2027-w5-baseline-snapshot.json.
//
// Path is OUTSIDE the kitchfix-intranet repo. The repo is public and
// the snapshot is the entire multi-year company P&L, keyed for easy
// reconstruction. Kevin ruling 2026-09-23: no dollar figures in the
// repo. Snapshot survives session boundaries locally without ever
// being commit-eligible.
//
// Env override: FIN2027_SNAPSHOT_PATH=/some/other/path.json
//
// Run this AFTER an approved load lands, to lock the new state as
// the reference the next Stage 4 CHECK 4 compares against.
//
// Usage: node --env-file=.env.local scripts/probes/_probe_fin2027_w5_snapshot.mjs

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const OUT = process.env.FIN2027_SNAPSHOT_PATH
  || path.join(homedir(), "Downloads", "kf-fin2027-w5-baseline-snapshot.json");

const rows = [];
let from = 0;
while (true) {
  const r = await s.from("pnl_actuals")
    .select("account_key, fiscal_year, period_no, line_code, budget, actual")
    .range(from, from + 999);
  if (r.error) { console.error(r.error); process.exit(1); }
  rows.push(...r.data);
  if (r.data.length < 1000) break;
  from += 1000;
}

const snap = {};
for (const r of rows) {
  const k = `${r.account_key}|${r.fiscal_year}|${r.period_no}|${r.line_code}`;
  snap[k] = { budget: Number(r.budget || 0), actual: Number(r.actual || 0) };
}

writeFileSync(OUT, JSON.stringify(snap, null, 0));
console.log(`wrote ${rows.length} cells to ${OUT}`);
const distinctAccounts = new Set(rows.map(r => r.account_key));
console.log(`  covers ${distinctAccounts.size} accounts: ${[...distinctAccounts].sort().join(", ")}`);
