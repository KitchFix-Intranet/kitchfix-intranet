#!/usr/bin/env node
// R-147 loader smoke test. Run the new paginateActuals + paginateWeekly
// against a small window and confirm shapes.
//
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local \
//        scripts/probes/_probe_r147_loader_smoke.mjs

import { createClient } from "@supabase/supabase-js";
import { paginateActuals, paginateWeekly, paginateInvoiceSubmissions, CAPTURE_CUTOVER_ISO } from "../../src/lib/purchasing/loaders.js";

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MEMBERS = ["TBJ - FL","TBR - FL","CIN - AZ","TXR - AZ","STL - FL","STL - MO","CIN - KY","CIN - OH","TXR - TX - H","TXR - TX - V","TBJ - NY"];

console.log("R-147 loader smoke");
console.log(`  cutover: ${CAPTURE_CUTOVER_ISO}`);
console.log();

// P9 (pre-cutover, all 11 accounts). Nothing new, all rows source in
// billcom/billcom_credit/rippling_spend/upload.
{
  const start = "2026-08-10", end = "2026-09-06";
  console.log(`P9 [${start} .. ${end}] · pre-cutover half only`);
  const a = await paginateActuals(s, { members: MEMBERS, start, end, includeLines: true });
  if (a.error) throw a.error;
  const bySrc = new Map();
  for (const r of a.data) bySrc.set(r.source, (bySrc.get(r.source) || 0) + 1);
  console.log(`  paginateActuals: ${a.data.length} rows · sources:`, Object.fromEntries(bySrc));
  const w = await paginateWeekly(s, { members: MEMBERS, start, end });
  if (w.error) throw w.error;
  console.log(`  paginateWeekly: ${w.data.length} rows`);
}
console.log();

// P10 (post-cutover). Invoice_submissions active for 9 accounts,
// billcom+rippling+upload for CIN-KY / TBJ-NY.
{
  const start = "2026-09-07", end = "2026-10-04";
  console.log(`P10 [${start} .. ${end}] · post-cutover half only`);
  const a = await paginateActuals(s, { members: MEMBERS, start, end, includeLines: true });
  if (a.error) throw a.error;
  const bySrc = new Map();
  const byAcctSrc = new Map();
  for (const r of a.data) {
    bySrc.set(r.source, (bySrc.get(r.source) || 0) + 1);
    const k = `${r.account_key}|${r.source}`;
    byAcctSrc.set(k, (byAcctSrc.get(k) || 0) + 1);
  }
  console.log(`  paginateActuals: ${a.data.length} rows · sources:`, Object.fromEntries(bySrc));
  console.log("  by account × source:");
  for (const acct of MEMBERS) {
    const parts = [];
    for (const src of ["billcom","billcom_credit","rippling_spend","upload","invoice_submissions"]) {
      const n = byAcctSrc.get(`${acct}|${src}`) || 0;
      if (n > 0) parts.push(`${src}=${n}`);
    }
    if (parts.length) console.log(`    ${acct.padEnd(14)} ${parts.join("  ")}`);
  }
  const w = await paginateWeekly(s, { members: MEMBERS, start, end });
  if (w.error) throw w.error;
  console.log(`  paginateWeekly: ${w.data.length} rows`);
}
console.log();

// P8 through P10 (spans the cutover). Every row must be present.
{
  const start = "2026-07-13", end = "2026-10-04";
  console.log(`P8-P10 [${start} .. ${end}] · spans cutover`);
  const a = await paginateActuals(s, { members: MEMBERS, start, end, includeLines: true });
  if (a.error) throw a.error;
  const bySrc = new Map();
  for (const r of a.data) bySrc.set(r.source, (bySrc.get(r.source) || 0) + 1);
  console.log(`  paginateActuals: ${a.data.length} rows · sources:`, Object.fromEntries(bySrc));
  const w = await paginateWeekly(s, { members: MEMBERS, start, end });
  if (w.error) throw w.error;
  console.log(`  paginateWeekly: ${w.data.length} rows`);
}
console.log();

// Invoice submissions direct check.
{
  const start = "2026-09-07", end = "2026-10-04";
  console.log(`paginateInvoiceSubmissions direct [${start} .. ${end}]`);
  const a = await paginateInvoiceSubmissions(s, { members: MEMBERS, start, end, includeLines: true });
  if (a.error) throw a.error;
  console.log(`  ${a.data.length} rows`);
  const byAcct = new Map();
  const byType = new Map();
  const byStatus = new Map();
  let totalAmt = 0;
  for (const r of a.data) {
    byAcct.set(r.account_key, (byAcct.get(r.account_key) || 0) + 1);
    byType.set(r.type, (byType.get(r.type) || 0) + 1);
    byStatus.set(r.status, (byStatus.get(r.status) || 0) + 1);
    totalAmt += Number(r.amount || 0);
  }
  console.log(`  Σ amount = ${totalAmt.toFixed(2)}`);
  console.log("  by account:");
  for (const acct of MEMBERS) {
    const n = byAcct.get(acct) || 0;
    if (n > 0) console.log(`    ${acct.padEnd(14)} ${n}`);
  }
  console.log("  by type:", Object.fromEntries(byType));
  console.log("  by status:", Object.fromEntries(byStatus));
  const sample = a.data[0];
  if (sample) {
    console.log("  sample row keys:", Object.keys(sample).join(", "));
    console.log("  sample row:", JSON.stringify(sample, null, 2));
  }
}
