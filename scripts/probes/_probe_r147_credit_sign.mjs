#!/usr/bin/env node
// R-147 pre-build check · does invoice_submissions store credit amounts
// as positive (needs negation at emit) or already negative? Q4 finding
// was "-$9,266.17 FY to date" but did not name the storage sign.
//
//   node --env-file=.env.local scripts/probes/_probe_r147_credit_sign.mjs

import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const q = await s.from("invoice_submissions")
  .select("id, type, total_amount, gl_breakdown, invoice_date, account_key, vendor_name")
  .eq("type", "credit")
  .gte("invoice_date", "2025-12-29")
  .order("invoice_date", { ascending: false })
  .limit(10);

if (q.error) { console.error(q.error); process.exit(1); }
console.log(`  ${q.data.length} credit-type rows in sample`);
for (const r of q.data) {
  const totalRaw = Number(r.total_amount);
  const sumGl = (r.gl_breakdown || []).reduce((s, l) => s + Number(l.amount || 0), 0);
  console.log(`  ${r.invoice_date}  ${r.account_key.padEnd(14)}  vendor=${(r.vendor_name || "").slice(0, 30).padEnd(30)}  total=${totalRaw.toFixed(2).padStart(10)}  Σgl=${sumGl.toFixed(2).padStart(10)}`);
}
const sumAll = q.data.reduce((s, r) => s + Number(r.total_amount || 0), 0);
console.log(`  Σ total_amount over sample: ${sumAll.toFixed(2)}`);
console.log();
console.log("If total_amount and Σgl are POSITIVE: credits stored positive, we negate at emit.");
console.log("If total_amount and Σgl are NEGATIVE: credits stored negative, we pass through.");
