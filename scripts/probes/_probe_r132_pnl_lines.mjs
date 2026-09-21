#!/usr/bin/env node
// R-132 · probe pnl_actuals to establish whether it carries a 3100.1
// sub-line row. Kevin's ruling: verify before choosing mechanism.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log("SUPABASE_URL: " + (url ? "PRESENT" : "ABSENT"));
  console.log("SUPABASE_SERVICE_ROLE_KEY: " + (key ? "PRESENT" : "ABSENT"));
  process.exit(1);
}
const s = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// TBJ - FL P9 · every line_code that starts with "3100"
const q = await s
  .from("pnl_actuals")
  .select("account_key, period_no, line_code, actual, budget, fiscal_year")
  .eq("fiscal_year", 2026)
  .eq("account_key", "TBJ - FL")
  .eq("period_no", 9)
  .like("line_code", "3100%")
  .order("line_code");
if (q.error) { console.error(q.error); process.exit(1); }
console.log("TBJ - FL · P9 · fiscal_year=2026 · lines like '3100%':");
for (const r of q.data) {
  console.log("  " + r.line_code.padEnd(10) + " actual=$" + Number(r.actual).toFixed(2) + " budget=$" + (r.budget == null ? "null" : Number(r.budget).toFixed(2)));
}
console.log();

// All 4 audit accounts, all verified periods, all "3100%" lines
const auditAcct = ["TBJ - FL", "TBR - FL", "CIN - AZ", "TXR - AZ"];
console.log("Broader sweep · 4 audit accounts × verified periods (P1-P9) × line_code starting 3100:");
const q2 = await s
  .from("pnl_actuals")
  .select("account_key, period_no, line_code, actual")
  .eq("fiscal_year", 2026)
  .in("account_key", auditAcct)
  .lte("period_no", 9)
  .like("line_code", "3100%")
  .order("account_key")
  .order("period_no")
  .order("line_code");
if (q2.error) { console.error(q2.error); process.exit(1); }
const byAcct = new Map();
for (const r of q2.data) {
  if (!byAcct.has(r.account_key)) byAcct.set(r.account_key, new Set());
  byAcct.get(r.account_key).add(r.line_code);
}
for (const [acct, codes] of byAcct) {
  console.log("  " + acct + ": " + [...codes].sort().join(", "));
}
console.log();

// Distinct line codes across all pnl_actuals (any account, any period) starting with 3100
const q3 = await s
  .from("pnl_actuals")
  .select("line_code")
  .eq("fiscal_year", 2026)
  .like("line_code", "3100%");
if (q3.error) { console.error(q3.error); process.exit(1); }
const distinctCodes = new Set(q3.data.map(r => r.line_code));
console.log("Distinct '3100%' line codes across all of pnl_actuals FY2026:");
for (const c of [...distinctCodes].sort()) console.log("  " + c);
