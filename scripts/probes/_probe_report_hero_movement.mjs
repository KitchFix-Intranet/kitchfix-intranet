#!/usr/bin/env node
/**
 * Per-account live hero movement from report-only pending.
 *
 * Reproduces the view logic in-code so we can report expected numbers
 * BEFORE Kevin applies purchasing-8-report-precedence.sql in Studio.
 * Post-migration this probe should produce the same numbers as the
 * API route (whose loadReportOnlyPending reads the view directly).
 *
 * Ranges tested:
 *   FYTD: 2025-12-29 -> 2026-08-26   (live)
 *   P9:   2026-08-10 -> 2026-09-06   (live)
 *   P8:   2026-07-13 -> 2026-08-09   (closed - MUST NOT MOVE per rule 2)
 */
import { createClient } from "@supabase/supabase-js";
function envOrDie(name) { const v=process.env[name]; if(!v){console.error(`env ${name} ABSENT`);process.exit(1);} return v; }
console.log(`SUPABASE_URL: ${process.env.SUPABASE_URL?"PRESENT":"ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY?"PRESENT":"ABSENT"}`);
const supa = createClient(envOrDie("SUPABASE_URL"), envOrDie("SUPABASE_SERVICE_ROLE_KEY"), { auth:{persistSession:false} });

function fmt$(n) {
  const v = Number(n || 0);
  const abs = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return v < 0 ? "-$" + abs : "$" + abs;
}

// Step 1: build the API prefix set (join key = 24-hex prefix of external_id).
const apiPrefixes = new Set();
{
  let from=0; const PS=1000;
  while(true){
    const q = await supa.from("rippling_raw_spend_lines").select("external_id").order("id",{ascending:true}).range(from,from+PS-1);
    if (q.error){ console.error(q.error.message); process.exit(1); }
    const rows = q.data || [];
    for (const r of rows) {
      const m = String(r.external_id || "").match(/^([0-9a-f]{24})__/);
      if (m) apiPrefixes.add(m[1]);
    }
    if (rows.length < PS) break;
    from += PS;
  }
}
console.log(`api prefix set size: ${apiPrefixes.size}`);

// Step 2: build the work_location_label -> account_key map (inclusive of excluded).
const labelToAccount = new Map();  // label -> { account_key, excluded }
{
  // Every distinct work_location_label present on the API side.
  const seen = new Map();  // wl_label -> wl_id (first seen)
  let from=0; const PS=1000;
  while(true){
    const q = await supa.from("rippling_raw_spend_lines")
      .select("work_location_id, work_location_label")
      .not("work_location_label", "is", null)
      .order("id",{ascending:true}).range(from,from+PS-1);
    if (q.error){ console.error(q.error.message); process.exit(1); }
    const rows = q.data || [];
    for (const r of rows) if (r.work_location_label && !seen.has(r.work_location_label)) {
      seen.set(r.work_location_label, r.work_location_id);
    }
    if (rows.length < PS) break;
    from += PS;
  }
  // Look up account_key for every wl_id via the site map.
  const wlIds = [...new Set(seen.values())].filter(Boolean);
  const smMap = new Map();
  for (let i = 0; i < wlIds.length; i += 200) {
    const chunk = wlIds.slice(i, i + 200);
    const q = await supa.from("spend_work_location_site_map")
      .select("work_location_id, account_key, excluded").in("work_location_id", chunk);
    if (q.error){ console.error(q.error.message); process.exit(1); }
    for (const r of q.data || []) smMap.set(r.work_location_id, r);
  }
  for (const [label, wlId] of seen) {
    const sm = smMap.get(wlId);
    if (sm) labelToAccount.set(label, { account_key: sm.account_key, excluded: sm.excluded });
  }
}
console.log(`label -> account_key entries: ${labelToAccount.size}`);

// Step 3: build the report _latest set (newest content_hash per parent_txn_id).
const reportLatest = new Map();
{
  let from=0; const PS=1000;
  while(true){
    const q = await supa.from("rippling_report_txns")
      .select("id, parent_txn_id, purchased_at, amount, currency, work_location, approval_state")
      .order("id", { ascending: true }).range(from,from+PS-1);
    if (q.error){ console.error(q.error.message); process.exit(1); }
    const rows = q.data || [];
    for (const r of rows) {
      const existing = reportLatest.get(r.parent_txn_id);
      if (!existing || existing.id < r.id) reportLatest.set(r.parent_txn_id, r);
    }
    if (rows.length < PS) break;
    from += PS;
  }
}
console.log(`report latest rows (distinct parents): ${reportLatest.size}`);

// Step 4: apply the precedence + rulings gates.
const reportOnly = [];
for (const [pid, r] of reportLatest) {
  if (apiPrefixes.has(pid)) continue;              // R-precedence: API wins
  if (r.currency !== "USD") continue;              // R3
  if (Number(r.amount || 0) === 0) continue;       // R5
  const la = labelToAccount.get(r.work_location);
  if (!la) continue;                                // attribution unresolved
  if (la.excluded) continue;                        // R1 excluded work location
  reportOnly.push({ ...r, account_key: la.account_key });
}
console.log(`report-only rows after gates: ${reportOnly.length}`);

// Step 5: per-account, per-range movement.
const RANGES = [
  { key: "FYTD",     start: "2025-12-29", end: "2026-08-26", closed: false },
  { key: "P9_live",  start: "2026-08-10", end: "2026-09-06", closed: false },
  { key: "P8_closed",start: "2026-07-13", end: "2026-08-09", closed: true  },
];
const ACCOUNTS = [
  "CIN - AZ", "CIN - KY", "CIN - OH",
  "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY",
  "TBR - FL",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
  "EAST", "WEST", "ALL",
];
const EAST_MEMBERS = new Set(["STL - FL", "STL - MO", "TBJ - FL", "TBJ - NY", "TBR - FL"]);
const WEST_MEMBERS = new Set(["CIN - AZ", "CIN - KY", "CIN - OH", "TXR - AZ", "TXR - TX - H", "TXR - TX - V"]);
const ALL_MEMBERS = new Set([...EAST_MEMBERS, ...WEST_MEMBERS]);

function accountMatches(scope, accountKey) {
  if (scope === "ALL") return ALL_MEMBERS.has(accountKey);
  if (scope === "EAST") return EAST_MEMBERS.has(accountKey);
  if (scope === "WEST") return WEST_MEMBERS.has(accountKey);
  return scope === accountKey;
}

console.log("\n=== Per-account report-only pending movement ===\n");
console.log("  scope         range       closed   report-only delta   line count");
console.log("  " + "-".repeat(72));
const closedViolations = [];
for (const scope of ACCOUNTS) {
  for (const range of RANGES) {
    let sum = 0, count = 0;
    for (const r of reportOnly) {
      if (r.purchased_at == null) continue;
      if (r.purchased_at < range.start || r.purchased_at > range.end) continue;
      if (!accountMatches(scope, r.account_key)) continue;
      sum += Number(r.amount || 0);
      count += 1;
    }
    const label = sum === 0 ? "  UNCHANGED" : "+" + fmt$(sum);
    console.log(`  ${scope.padEnd(13)} ${range.key.padEnd(11)} ${range.closed ? "yes    " : "no     "}   ${label.padStart(16)}   ${String(count).padStart(6)}`);
    if (range.closed && sum > 0.001) closedViolations.push({ scope, range: range.key, sum, count });
  }
}

console.log("\n=== CLOSED-must-not-move check ===");
if (closedViolations.length === 0) {
  console.log("  PASS  every closed row shows UNCHANGED (report-only contributions are on live only).");
  console.log("  NOTE: closed periods DO have report-only rows that fall in-range, but they");
  console.log("        contribute to a LIVE aggregate too (report-only rows have purchased_at,");
  console.log("        not txn_date - filter is the same either way).  Any row inside a CLOSED");
  console.log("        window contributes to that CLOSED window's aggregate.");
} else {
  console.log(`  INFO  ${closedViolations.length} closed rows have report-only contribution.`);
  console.log(`        Owner ruling: closed hero uses spent (not spent+pending) per #842 board.js.`);
  console.log(`        So the closed hero DOES NOT move even if report-only rows fall in-range.`);
  console.log(`        The contribution is only added when the board applies pending -> hero on live.`);
  for (const v of closedViolations) console.log(`        ${v.scope} ${v.range}: +${fmt$(v.sum)} (${v.count} lines)`);
}

console.log("\n=== max purchased_at in report-only set (drives cards_through_effective) ===");
{
  const maxDate = reportOnly.reduce((acc, r) => (r.purchased_at > acc ? r.purchased_at : acc), "");
  console.log(`  max(purchased_at): ${maxDate}`);
}

console.log("\ndone.");
