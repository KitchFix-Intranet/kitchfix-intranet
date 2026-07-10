// ════════════════════════════════════════════════════════════════════════════
// SEED: sc_homestand_schedule from HUB Sheets homestand_schedule tab
//
// ⚠ DEPRECATED (2026-07-10, sc-13). This script was the original
//   Sheets-HUB → PG bridge for the MLB fee accounts. Post-sc-13, the
//   MLB Stats API is the single source of truth for the schedule
//   (docs/audits/SC_13_MLB_API_FEASIBILITY_2026-07-10.md). Running
//   this script un-modified would:
//     1. Reintroduce PREP/OPEN/CLOSE rows that sc-13 deleted
//        (Sheets HUB still has them for the Ops Labor feature, which
//         reads from Sheets directly - see docs/audits/SC_14_...md).
//     2. Overwrite opponent codes with Sheets HUB values, risking
//        R6-normalization drift (ARI/AZ, ATH/OAK).
//     3. Blank out `game_pk` on GAME rows via UPSERT (the seeder
//        doesn't emit game_pk).
//   Any future refresh of the PG mirror should come from the MLB
//   Stats API path, not this script.
//
//   To force a run despite the deprecation, set the env var
//   `SC_HOMESTAND_SEED_ALLOW=1` at invocation time. The script then
//   proceeds but only mirrors day_type='GAME' rows - PREP/OPEN/CLOSE
//   are filtered out so a forced run can't undo sc-13.
//
// Source:  HUB Google Sheet "homestand_schedule" tab.
//          Columns A-F: AccountKey, Date, DayOfWeek, DayType, Opponent, HomestandID.
// Target:  sc_homestand_schedule (sc-2 migration).
// Scope:   4 MLB fee accounts only: STL - MO, CIN - OH, TXR - TX - H, TXR - TX - V.
// Mode:    UPSERT on (account_key, service_date) - re-runs are safe.
//
// USAGE (deprecated - see banner above):
//   SC_HOMESTAND_SEED_ALLOW=1 node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local scripts/_seed_sc_homestand_schedule.mjs
// ════════════════════════════════════════════════════════════════════════════

if (process.env.SC_HOMESTAND_SEED_ALLOW !== "1") {
  console.error(
    "[_seed_sc_homestand_schedule] DEPRECATED. Post-sc-13 the MLB Stats API is the schedule source of truth.\n" +
    "  This script would reintroduce PREP/OPEN/CLOSE + risk R6 opponent-code drift + blank game_pk.\n" +
    "  Set SC_HOMESTAND_SEED_ALLOW=1 in the environment to bypass this guard (GAME rows only)."
  );
  process.exit(1);
}

import { safeRead, SHEET_IDS } from "@/lib/sheets";
import { getServiceClient } from "@/lib/supabase";

const TARGET_ACCOUNTS = ["STL - MO", "CIN - OH", "TXR - TX - H", "TXR - TX - V"];
// sc-13 (2026-07-10): filter down to GAME only. PREP/OPEN/CLOSE/CLEAN
// were deleted from PG as internal scaffolding; forcing this seeder to
// run must not undo that. HOME game rows are now MLB-API-authoritative
// too, so mirroring from Sheets is a soft downgrade - but the filter
// keeps the seeder available for a one-off maintenance mirror.
const VALID_DAY_TYPES = new Set(["GAME"]);

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

// sc-13 (2026-07-10): breakdown now shows GAME + AWAY + EXHIBITION
// since PREP/OPEN/CLOSE were retired. The seeder itself only writes
// GAME rows (see VALID_DAY_TYPES); AWAY / EXHIBITION are landed by
// the sc-13 migration and are shown here for completeness.
console.error("\nPer-account day_type breakdown:");
console.error("  Account         GAME  AWAY  EXH");
console.error("  --------------  ----  ----  ----");
for (const acct of TARGET_ACCOUNTS) {
  const { data } = await supa
    .from("sc_homestand_schedule")
    .select("day_type")
    .eq("account_key", acct);
  const counts = { GAME: 0, AWAY: 0, EXHIBITION: 0 };
  for (const r of data || []) counts[r.day_type] = (counts[r.day_type] || 0) + 1;
  console.error(`  ${acct.padEnd(14)}  ${String(counts.GAME).padStart(4)}  ${String(counts.AWAY).padStart(4)}  ${String(counts.EXHIBITION).padStart(4)}`);
}

console.error("\nDone.");
