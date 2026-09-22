#!/usr/bin/env node
// R-147 · impossible invoice_date exception list. Kevin: 22 rows have
// invoice dates outside FY2026 (years 0026, 23026, 72026, 2020s).
// They fall out of every FY range naturally so they are already
// invisible on the board. Surface them here for the PR body so the
// operators can correct them at source.
//
// Input validation on the capture form is a separate ticket.
//
//   node --env-file=.env.local scripts/probes/_probe_r147_bad_invoice_dates.mjs

import { createClient } from "@supabase/supabase-js";
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Consider "bad" as: invoice_date NOT within FY2026 fiscal window
// (2025-12-29 to 2027-01-02). Kevin's brief mentions years 0026,
// 23026, 72026 - all outside this window.
const FY_LOW  = "2025-12-29";
const FY_HIGH = "2027-01-02";

const rows = [];
let from = 0;
const PS = 1000;
while (true) {
  const q = await s.from("invoice_submissions")
    .select("id, account_key, vendor_name, invoice_number, invoice_date, total_amount, status, type")
    .or(`invoice_date.lt.${FY_LOW},invoice_date.gt.${FY_HIGH}`)
    .order("invoice_date", { ascending: true })
    .range(from, from + PS - 1);
  if (q.error) throw q.error;
  for (const r of q.data || []) rows.push(r);
  if ((q.data || []).length < PS) break;
  from += PS;
}

const live = rows.filter(r => r.status === "sent" || r.status === "returned");
const suppressed = rows.filter(r => r.status === "corrected" || r.status === "deleted");

console.log(`R-147 · invoice_submissions with invoice_date outside FY2026`);
console.log(`   ${rows.length} rows total · ${live.length} LIVE (sent+returned, would count if the date were valid) · ${suppressed.length} already suppressed (corrected/deleted)`);
console.log();
console.log(`── LIVE rows requiring correction at source ──`);
console.log();
function renderRows(list) {
  console.log(`| account_key     | vendor                          | invoice_number       | invoice_date | amount     | status     | type   |`);
  console.log(`|-----------------|---------------------------------|----------------------|--------------|------------|------------|--------|`);
  for (const r of list) {
    const v = String(r.vendor_name || "").slice(0, 30).padEnd(31);
    const n = String(r.invoice_number || "").slice(0, 20).padEnd(20);
    console.log(`| ${(r.account_key || "").padEnd(15)} | ${v} | ${n} | ${(r.invoice_date || "").padEnd(12)} | ${("$" + Number(r.total_amount || 0).toFixed(2)).padStart(10)} | ${(r.status || "").padEnd(10)} | ${(r.type || "").padEnd(6)} |`);
  }
}
renderRows(live);
console.log();
console.log(`── Suppressed rows (corrected/deleted, board never counted them) ──`);
renderRows(suppressed);
