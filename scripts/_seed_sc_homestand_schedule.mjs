// ════════════════════════════════════════════════════════════════════════════
// SEED: sc_homestand_schedule from HUB Sheets homestand_schedule tab
//
// Source:  HUB Google Sheet "homestand_schedule" tab (same source the
//          Season Tracker reads at src/app/api/ops/route.js:785).
//          Columns A-F: AccountKey, Date, DayOfWeek, DayType, Opponent, HomestandID.
// Target:  sc_homestand_schedule (sc-2 migration).
// Scope:   4 MLB fee accounts only: STL - MO, CIN - OH, TXR - TX - H, TXR - TX - V.
// Mode:    UPSERT on (account_key, service_date) - re-runs are safe.
//
// USAGE
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local scripts/_seed_sc_homestand_schedule.mjs
//
// Apply sc-2-homestand-schedule.sql in Supabase Studio FIRST. This script
// requires sc_homestand_schedule to exist; it will not create it.
//
// Does NOT touch the Season Tracker code path. Does NOT wire this data
// into the Service Calendar. Both of those land in separate work.
// ════════════════════════════════════════════════════════════════════════════

import { safeRead, SHEET_IDS } from "@/lib/sheets";
import { getServiceClient } from "@/lib/supabase";

const TARGET_ACCOUNTS = ["STL - MO", "CIN - OH", "TXR - TX - H", "TXR - TX - V"];
const VALID_DAY_TYPES = new Set(["GAME", "PREP", "OPEN", "CLOSE", "CLEAN"]);

// Sheet date values arrive either as JS Date (typed cells) or as a string.
// Normalize to ISO YYYY-MM-DD; return null if unparseable so the row is
// surfaced as an error rather than silently dropped.
function normDate(v) {
  if (v instanceof Date && !isNaN(v.getTime())) {
    return v.toISOString().split("T")[0];
  }
  const s = String(v || "").trim();
  if (!s) return null;
  // Try MM/DD/YYYY or YYYY-MM-DD parse via Date
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return null;
}

console.error("══════ Read HUB homestand_schedule tab ══════");
const { rows } = await safeRead(SHEET_IDS.HUB, "homestand_schedule");
console.error(`  fetched ${rows.length} rows from HUB sheet`);

// Filter + shape
const toInsert = [];
const skipped = { wrong_account: 0, bad_date: 0, bad_day_type: 0, missing_homestand: 0 };
for (const r of rows) {
  const accountKey  = String(r[0] || "").trim();
  if (!TARGET_ACCOUNTS.includes(accountKey)) { skipped.wrong_account++; continue; }

  const serviceDate = normDate(r[1]);
  if (!serviceDate) { skipped.bad_date++; continue; }

  const dayOfWeek   = String(r[2] || "").trim();
  const dayType     = String(r[3] || "").trim().toUpperCase();
  if (!VALID_DAY_TYPES.has(dayType)) { skipped.bad_day_type++; continue; }

  const opponent    = String(r[4] || "").trim() || null;
  const homestandId = String(r[5] || "").trim();
  if (!homestandId) { skipped.missing_homestand++; continue; }

  toInsert.push({
    account_key:  accountKey,
    service_date: serviceDate,
    day_of_week:  dayOfWeek,
    day_type:     dayType,
    opponent,
    homestand_id: homestandId,
  });
}

console.error(`  rows for target accounts: ${toInsert.length}`);
if (skipped.wrong_account)    console.error(`  skipped (other account):     ${skipped.wrong_account}`);
if (skipped.bad_date)         console.error(`  skipped (bad date):          ${skipped.bad_date}`);
if (skipped.bad_day_type)     console.error(`  skipped (invalid day_type):  ${skipped.bad_day_type}`);
if (skipped.missing_homestand)console.error(`  skipped (no homestand_id):   ${skipped.missing_homestand}`);

if (toInsert.length === 0) {
  console.error("\nNothing to seed. Exiting.");
  process.exit(0);
}

console.error("\n══════ UPSERT to sc_homestand_schedule ══════");
const supa = getServiceClient();

// Batch upsert in chunks of 500 to stay well under any payload limit.
const CHUNK = 500;
let written = 0;
for (let i = 0; i < toInsert.length; i += CHUNK) {
  const chunk = toInsert.slice(i, i + CHUNK);
  const { error } = await supa
    .from("sc_homestand_schedule")
    .upsert(chunk, { onConflict: "account_key,service_date" });
  if (error) {
    console.error(`  ERROR at chunk ${i / CHUNK}: ${error.message}`);
    process.exit(2);
  }
  written += chunk.length;
}
console.error(`  upserted ${written} rows`);

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICATION
// ═══════════════════════════════════════════════════════════════════════════
console.error("\n══════ VERIFICATION ══════\n");

console.error("Per-account row + homestand counts (expected: STL-MO 13, CIN-OH 13, TXR-TX-H 12, TXR-TX-V 12):");
console.error("  Account         rows  homestands  date_range");
console.error("  --------------  ----  ----------  ----------------------");
for (const acct of TARGET_ACCOUNTS) {
  const { data } = await supa
    .from("sc_homestand_schedule")
    .select("service_date, homestand_id, day_type")
    .eq("account_key", acct)
    .order("service_date", { ascending: true });
  const rows = data || [];
  const distinctHS = new Set(rows.map((r) => r.homestand_id));
  const first = rows[0]?.service_date || "-";
  const last  = rows[rows.length - 1]?.service_date || "-";
  console.error(`  ${acct.padEnd(14)}  ${String(rows.length).padStart(4)}  ${String(distinctHS.size).padStart(10)}  ${first}..${last}`);
}

console.error("\nPer-account day_type breakdown (GAME vs PREP/OPEN/CLOSE/CLEAN):");
console.error("  Account         GAME  PREP  OPEN  CLOSE  CLEAN");
console.error("  --------------  ----  ----  ----  -----  -----");
for (const acct of TARGET_ACCOUNTS) {
  const { data } = await supa
    .from("sc_homestand_schedule")
    .select("day_type")
    .eq("account_key", acct);
  const counts = { GAME: 0, PREP: 0, OPEN: 0, CLOSE: 0, CLEAN: 0 };
  for (const r of data || []) counts[r.day_type] = (counts[r.day_type] || 0) + 1;
  console.error(`  ${acct.padEnd(14)}  ${String(counts.GAME).padStart(4)}  ${String(counts.PREP).padStart(4)}  ${String(counts.OPEN).padStart(4)}  ${String(counts.CLOSE).padStart(5)}  ${String(counts.CLEAN).padStart(5)}`);
}

console.error("\nDone.");
