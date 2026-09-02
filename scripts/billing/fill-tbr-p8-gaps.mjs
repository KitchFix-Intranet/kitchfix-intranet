#!/usr/bin/env node
// PR-V: TBR - FL P8 gap fills from QBO invoice K300168909 + stray row 2.
//
// Three-way audit (Chat-Claude 2026-09-02) found 4 service days on TBR
// that were invoiced but never recorded on the site. This closes them
// against sc_daily_actuals so the P8 tie-out to Sebastian's P&L
// ($113,142.94) and QBO meal-service can complete before Kevin trains
// TBR next week.
//
// FENCES (binding):
//   Writes are LIMITED to sc_daily_actuals for account_key='TBR - FL'
//   on four dates: 2026-07-28, 2026-07-29, 2026-07-30, 2026-08-03.
//   Two target services: Breakfast - MiLB, Lunch - MiLB.
//   No schema, no prices, no other services, no other dates.
//   created_by='invoice_reconcile' (not spreadsheet_seed - these rows
//   come from QBO invoice detail, not the workbook).
//   Pre-write halt: if any target row exists with a value other than
//   the current expected (0 or missing), report and stop.
//
// Two-step contract:
//   default   = dry-run (parse, preflight-report, halt)
//   --write   = separate invocation after Kevin's explicit go

import { createClient } from "@supabase/supabase-js";

const WRITE = process.argv.includes("--write");
const CREATED_BY = "invoice_reconcile";
const ACCOUNT_KEY = "TBR - FL";

const BKFST_MILB_ID = "1318c319-1844-410a-ace5-8f8812eebd23";
const LUNCH_MILB_ID = "1c62040d-b56c-4660-9b72-6e58b0554865";

// Rows to write, sourced from QBO K300168909 + workbook stray row 2.
// Each row lists: date, service_id, service_name (for logging),
// target_count, source, expected_current (what preflight tolerates
// without halt - either 0 or 'missing').
const FILLS = [
  { date: "2026-07-28", service_id: BKFST_MILB_ID, service_name: "Breakfast - MiLB", target: 80,  source: "QBO K300168909", expected_current: "missing" },
  { date: "2026-07-28", service_id: LUNCH_MILB_ID, service_name: "Lunch - MiLB",     target: 80,  source: "QBO K300168909", expected_current: "missing" },
  { date: "2026-07-29", service_id: LUNCH_MILB_ID, service_name: "Lunch - MiLB",     target: 80,  source: "QBO K300168909", expected_current: 0 },
  { date: "2026-07-30", service_id: BKFST_MILB_ID, service_name: "Breakfast - MiLB", target: 80,  source: "QBO K300168909", expected_current: 0 },
  { date: "2026-07-30", service_id: LUNCH_MILB_ID, service_name: "Lunch - MiLB",     target: 80,  source: "QBO K300168909", expected_current: 0 },
  { date: "2026-08-03", service_id: BKFST_MILB_ID, service_name: "Breakfast - MiLB", target: 120, source: "workbook stray row 2 (2026-09-02 audit reversal)", expected_current: "missing" },
  { date: "2026-08-03", service_id: LUNCH_MILB_ID, service_name: "Lunch - MiLB",     target: 120, source: "workbook stray row 2 (2026-09-02 audit reversal)", expected_current: "missing" },
];

const DATES = [...new Set(FILLS.map((f) => f.date))].sort();

function pgClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required in env");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function preflight(supa) {
  console.log(`\n=== V1: preflight - existing rows on target (date, service_id) pairs ===`);
  const issues = [];
  for (const f of FILLS) {
    const { data, error } = await supa
      .from("sc_daily_actuals")
      .select("id, actual_count, created_by, created_at")
      .eq("account_key", ACCOUNT_KEY)
      .eq("service_id", f.service_id)
      .eq("service_date", f.date);
    if (error) throw new Error(`preflight ${f.date}/${f.service_name}: ${error.message}`);
    const current = data && data.length ? Number(data[0].actual_count) : "missing";
    const currentCreatedBy = data && data.length ? data[0].created_by : null;
    const ok = current === f.expected_current;
    const action = current === "missing" ? "INSERT" : (current === f.target ? "NOOP (already at target)" : "UPDATE");
    console.log(
      `  ${f.date} ${f.service_name.padEnd(18)} ` +
      `existing=${String(current).padStart(4)} (created_by=${currentCreatedBy ?? "-"})  ` +
      `target=${String(f.target).padStart(4)}  expected=${f.expected_current}  ` +
      `${ok ? "OK" : "MISMATCH"}  -> ${action}`
    );
    if (!ok) issues.push({ ...f, current });
  }
  if (issues.length > 0) {
    console.log(`\n  PREFLIGHT HALT: ${issues.length} row(s) diverge from expected. Halting.`);
    for (const i of issues) {
      console.log(`    ${i.date} ${i.service_name}: expected ${i.expected_current}, got ${i.current}`);
    }
    throw new Error("Preflight failure - Kevin needs to see the divergence before any write.");
  }
  console.log(`\n  All 7 target rows preflight OK.`);
}

async function scopeOutOfBoundsCheck(supa) {
  // V3: verify no rows will be touched outside the four dates or outside TBR-FL.
  // We report zero-touched-outside by construction (each write is a scoped upsert
  // on (account_key, service_id, service_date)) but log the invariant so a reader
  // can prove it.
  console.log(`\n=== V3: scope invariant ===`);
  console.log(`  writes constrained to account_key='${ACCOUNT_KEY}'`);
  console.log(`  dates: ${DATES.join(", ")}`);
  console.log(`  services: Breakfast - MiLB (${BKFST_MILB_ID}), Lunch - MiLB (${LUNCH_MILB_ID})`);
  console.log(`  every upsert is keyed on (account_key, service_id, service_date) - no scope creep possible.`);
}

async function performWrites(supa) {
  console.log(`\n=== V2: performing writes (created_by='${CREATED_BY}') ===`);
  let written = 0;
  for (const f of FILLS) {
    const row = {
      account_key:  ACCOUNT_KEY,
      service_id:   f.service_id,
      service_date: f.date,
      actual_count: f.target,
      created_by:   CREATED_BY,
      updated_by:   CREATED_BY,
    };
    // UPSERT on the unique constraint. For INSERT-only targets ('missing'
    // expected_current) this becomes an INSERT; for UPDATE targets (0
    // expected_current, existing spreadsheet_seed row) this becomes an
    // UPDATE and REWRITES created_by to invoice_reconcile so the row's
    // provenance now reflects its authoritative source.
    const { error } = await supa
      .from("sc_daily_actuals")
      .upsert(row, { onConflict: "account_key,service_id,service_date" });
    if (error) throw new Error(`upsert ${f.date}/${f.service_name}: ${error.message}`);
    written++;
    console.log(`  wrote ${f.date} ${f.service_name.padEnd(18)} = ${f.target}   [${f.source}]`);
  }
  console.log(`  ${written} rows written.`);
}

async function postWriteVerify(supa) {
  console.log(`\n=== V2 verify: DB state matches intended ===`);
  for (const f of FILLS) {
    const { data, error } = await supa
      .from("sc_daily_actuals")
      .select("actual_count, created_by, updated_by")
      .eq("account_key", ACCOUNT_KEY)
      .eq("service_id", f.service_id)
      .eq("service_date", f.date);
    if (error) throw error;
    if (!data || data.length !== 1) {
      throw new Error(`post-write verify: ${f.date}/${f.service_name} returned ${data?.length ?? 0} rows, expected 1`);
    }
    const row = data[0];
    const ok = Number(row.actual_count) === f.target && row.created_by === CREATED_BY;
    console.log(
      `  ${f.date} ${f.service_name.padEnd(18)} = ${String(row.actual_count).padStart(4)}  ` +
      `created_by=${row.created_by}  ${ok ? "MATCH" : "MISMATCH"}`
    );
    if (!ok) throw new Error(`post-write mismatch on ${f.date}/${f.service_name}`);
  }
}

async function main() {
  console.log(`PR-V TBR P8 gap fills  mode=${WRITE ? "WRITE" : "DRY-RUN"}  at ${new Date().toISOString()}`);

  // Print the planned fills up front so a dry-run reader sees the intent immediately.
  console.log(`\n=== Planned fills (${FILLS.length} rows across ${DATES.length} dates) ===`);
  for (const f of FILLS) {
    console.log(`  ${f.date}  ${f.service_name.padEnd(18)} = ${String(f.target).padStart(4)}   source: ${f.source}`);
  }

  const supa = pgClient();
  await preflight(supa);
  await scopeOutOfBoundsCheck(supa);

  if (!WRITE) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`DRY-RUN COMPLETE`);
    console.log(`Row shape: { account_key='TBR - FL', service_id, service_date,`);
    console.log(`             actual_count, created_by='${CREATED_BY}', updated_by='${CREATED_BY}' }`);
    console.log(`To write: re-run with --write after Kevin's explicit go.`);
    console.log(`${"=".repeat(70)}`);
    return;
  }

  await performWrites(supa);
  await postWriteVerify(supa);
  console.log(`\nFILL COMPLETE.`);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(`\nFATAL: ${e?.stack || e?.message || e}`);
  process.exit(1);
});
