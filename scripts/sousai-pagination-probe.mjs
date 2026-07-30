#!/usr/bin/env node
// scripts/sousai-pagination-probe.mjs
// Row-count probe for the SousAI tool pagination audit. Reads only.
// Run when re-auditing pagination posture on the tool registry.
//
// Referenced from docs/audits/SOUSAI_TOOL_PAGINATION_AUDIT_2026-07-30.md.
//
// Run: node --env-file=.env.local scripts/sousai-pagination-probe.mjs

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE;
if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("SUPABASE_URL and service role required");

const sb = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

async function countExact(table, filter) {
  let q = sb.from(table).select("*", { count: "exact", head: true });
  if (filter) q = filter(q);
  const { count, error } = await q;
  if (error) throw new Error(`count ${table}: ${error.message}`);
  return count;
}

const today = new Date().toISOString().slice(0, 10);
const yearStart = `${new Date().getUTCFullYear()}-01-01`;

console.log(`\nProbe date: ${today}\n`);

console.log("Small tables");
console.log("  contacts               ", await countExact("contacts"));
console.log("  accounts               ", await countExact("accounts"));
console.log("  vendors                ", await countExact("vendors", (q) => q.is("deleted_at", null)));
console.log("  vendor_aliases         ", await countExact("vendor_aliases"));
console.log("  sc_services            ", await countExact("sc_services", (q) => q.is("deleted_at", null)));
console.log("  sc_service_prices      ", await countExact("sc_service_prices"));
console.log("  documents (Live)       ", await countExact("documents", (q) => q.eq("archived", false).eq("status", "Live")));

console.log("\nLarger tables");
console.log("  ai_line_items          ", await countExact("ai_line_items"));
console.log("  ai_line_items YTD      ", await countExact("ai_line_items", (q) => q.gte("invoice_date", yearStart).lte("invoice_date", today)));
console.log("  v_invoice_submissions_current    ", await countExact("v_invoice_submissions_current"));
console.log("  v_invoice_submissions_current YTD", await countExact("v_invoice_submissions_current", (q) => q.gte("invoice_date", yearStart).lte("invoice_date", today)));

console.log("\nsc_daily_revenue by account (YTD)");
const accts = ["TBJ - FL", "STL - FL", "CIN - OH", "CIN - AZ", "TBR - FL"];
for (const a of accts) {
  const n = await countExact("sc_daily_revenue", (q) => q.eq("account_key", a).gte("service_date", yearStart).lte("service_date", today));
  console.log(`  ${a.padEnd(15)}`, n);
}

console.log("\nsc_daily_revenue by account, 28-day slice");
const pd = new Date(); pd.setUTCDate(pd.getUTCDate() - 28);
const pdStart = pd.toISOString().slice(0, 10);
for (const a of accts) {
  const n = await countExact("sc_daily_revenue", (q) => q.eq("account_key", a).gte("service_date", pdStart).lte("service_date", today));
  console.log(`  ${a.padEnd(15)}`, n);
}

console.log("\nsc_homestand_schedule per account (non-null homestand_id only)");
for (const a of ["STL - FL", "CIN - OH", "TXR - TX - H"]) {
  const n = await countExact("sc_homestand_schedule", (q) => q.eq("account_key", a).not("homestand_id", "is", null));
  console.log(`  ${a.padEnd(15)}`, n);
}
console.log();
