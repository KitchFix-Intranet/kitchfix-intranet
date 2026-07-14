// READ-ONLY probe for sc-19 migration planning.
//
// Kevin's ruling (2026-07-14): fix Part 4 DATE_DRIFT + AAA MISSING_IN_DB in
// an sc-19 migration, WITH SPLIT:
//   - DATE_DRIFT: rows whose corrected date is free -> UPDATE now.
//                  rows whose corrected date creates a two-games-one-date
//                  collision -> WAIT for Option A.
//   - AAA missing: rescheduled Louisville dates INSERT now if collision-free.
//                  DH game-2s WAIT for Option A.
//   - GUARD: any drifted date carrying operator actuals -> report + SKIP
//             (do not silently rewrite dates the operator has entered on).
//
// This probe classifies every row from Part 4 into SAFE_NOW vs WAIT vs
// GUARDED so sc-19 can be composed with justification per row.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// DATE_DRIFT rows verbatim from Part 4 (§P4.2).
const DATE_DRIFT = [
  { acct: "CIN - OH", pk: 824518, oldDate: "2026-05-22", newDate: "2026-05-23", ha: "HOME", opp: "STL" },
  { acct: "CIN - OH", pk: 824514, oldDate: "2026-05-24", newDate: "2026-08-17", ha: "HOME", opp: "STL" },
  { acct: "STL - MO", pk: 824518, oldDate: "2026-05-22", newDate: "2026-05-23", ha: "AWAY", opp: "CIN" },
  { acct: "STL - MO", pk: 823062, oldDate: "2026-05-05", newDate: "2026-07-07", ha: "HOME", opp: "MIL" },
  { acct: "STL - MO", pk: 823042, oldDate: "2026-06-25", newDate: "2026-07-23", ha: "HOME", opp: "ARI" },
  { acct: "STL - MO", pk: 824514, oldDate: "2026-05-24", newDate: "2026-08-17", ha: "AWAY", opp: "CIN" },
  { acct: "CIN - KY", pk: 816286, oldDate: "2026-05-05", newDate: "2026-05-07", ha: "HOME", opp: "NAS" },
  { acct: "CIN - KY", pk: 816276, oldDate: "2026-05-16", newDate: "2026-05-17", ha: "HOME", opp: "IND" },
  { acct: "CIN - KY", pk: 816810, oldDate: "2026-05-19", newDate: "2026-05-20", ha: "AWAY", opp: "COL" },
  { acct: "CIN - KY", pk: 816802, oldDate: "2026-05-22", newDate: "2026-05-23", ha: "AWAY", opp: "COL" },
  { acct: "CIN - KY", pk: 816638, oldDate: "2026-06-16", newDate: "2026-06-17", ha: "AWAY", opp: "GWN" },
  { acct: "CIN - KY", pk: 816643, oldDate: "2026-06-18", newDate: "2026-06-19", ha: "AWAY", opp: "GWN" },
  { acct: "TBJ - NY", pk: 816975, oldDate: "2026-03-28", newDate: "2026-03-29", ha: "HOME", opp: "SWB" },
  { acct: "TBJ - NY", pk: 815998, oldDate: "2026-04-03", newDate: "2026-04-04", ha: "AWAY", opp: "OMA" },
  { acct: "TBJ - NY", pk: 816974, oldDate: "2026-04-07", newDate: "2026-04-08", ha: "HOME", opp: "SYR" },
  { acct: "TBJ - NY", pk: 815912, oldDate: "2026-04-16", newDate: "2026-04-17", ha: "AWAY", opp: "ROC" },
  { acct: "TBJ - NY", pk: 816964, oldDate: "2026-04-25", newDate: "2026-04-26", ha: "HOME", opp: "COL" },
  { acct: "TBJ - NY", pk: 815840, oldDate: "2026-04-29", newDate: "2026-05-01", ha: "AWAY", opp: "SWB" },
  { acct: "TBJ - NY", pk: 815675, oldDate: "2026-05-23", newDate: "2026-05-24", ha: "AWAY", opp: "SYR" },
  { acct: "TBJ - NY", pk: 816932, oldDate: "2026-07-09", newDate: "2026-07-11", ha: "HOME", opp: "SWB" },
  { acct: "STL - FL", pk: 820419, oldDate: "2026-05-12", newDate: "2026-05-13", ha: "HOME", opp: "DBT" },
  { acct: "TBJ - FL", pk: 820698, oldDate: "2026-04-02", newDate: "2026-04-04", ha: "HOME", opp: "BRD" },
  { acct: "TBJ - FL", pk: 820676, oldDate: "2026-05-19", newDate: "2026-05-21", ha: "HOME", opp: "FTM" },
  { acct: "TBJ - FL", pk: 820655, oldDate: "2026-07-10", newDate: "2026-07-11", ha: "HOME", opp: "LAK" },
];

// AAA MISSING_IN_DB from Part 4. Note pk 816263 appears at 4 dates in the
// API (postponement trail: 6/25 -> 6/26 -> 6/27 -> 7/18). Take the LATEST
// as the currently-active date; drop the historical postponement entries.
const AAA_MISSING = [
  // CIN - KY pk 816263: current active per API = 2026-07-18 as DH game #2.
  // Historical trail dates (6/25/6/26/6/27) are Postponed entries - not to
  // be inserted. Only the currently-scheduled 7/18 matters.
  { acct: "CIN - KY", pk: 816263, newDate: "2026-07-18", ha: "HOME", opp: "STP", gameNumber: 2, dhCode: "Y", note: "collapsed from 4 API entries via postponement trail" },
  // TBJ - NY pk 816824: 9/12 CLT DH game #2.
  { acct: "TBJ - NY", pk: 816824, newDate: "2026-09-12", ha: "AWAY", opp: "CLT", gameNumber: 2, dhCode: "S", note: "" },
];

async function hasHsRowOn(acct, date, excludePk = null) {
  const q = supa
    .from("sc_homestand_schedule")
    .select("game_pk, day_type, opponent")
    .eq("account_key", acct)
    .eq("service_date", date);
  const { data, error } = await q;
  if (error) throw new Error(`hs check ${error.message}`);
  if (excludePk != null) return data.filter(r => r.game_pk !== excludePk);
  return data;
}

async function hasActualsOn(acct, date) {
  const { data, error } = await supa
    .from("sc_daily_actuals")
    .select("service_id, actual_count")
    .eq("account_key", acct)
    .eq("service_date", date);
  if (error) throw new Error(`actuals check ${error.message}`);
  return data || [];
}

async function classifyDrift(r) {
  const [tgtRows, oldActuals, newActuals] = await Promise.all([
    hasHsRowOn(r.acct, r.newDate, r.pk),  // any OTHER row on target date
    hasActualsOn(r.acct, r.oldDate),
    hasActualsOn(r.acct, r.newDate),
  ]);
  const hasCollision = tgtRows.length > 0;
  const oldActualsCount = oldActuals.length;
  const newActualsCount = newActuals.length;
  const guardTripped = oldActualsCount > 0 || newActualsCount > 0;

  // Per Kevin's 2026-07-14 "actuals stay" ruling, actuals on either date
  // are NOT a blocker - the schedule row moves, actuals stay put on the
  // dates operators served. Collisions still block (need Option A). So
  // the verdict ladder is: collision first (blocks now), then guard
  // (reportable but not blocking), then SAFE_NOW.
  let verdict, reason;
  if (hasCollision) {
    verdict = "WAIT_OPTION_A";
    reason = `target ${r.newDate} already has ${tgtRows.length} hs row(s): ${tgtRows.map(x => `pk=${x.game_pk} ${x.day_type}/${x.opponent}`).join(", ")}`;
  } else if (guardTripped) {
    // Actuals present on old and/or new date. Under Kevin's ruling this
    // is MOVABLE via sc-19b (actuals stay, only the hs row's
    // service_date changes) but reported for transparency.
    verdict = "GUARDED_MOVABLE";
    const parts = [];
    if (oldActualsCount > 0) parts.push(`old date has ${oldActualsCount} actuals row(s) (stay)`);
    if (newActualsCount > 0) parts.push(`new date has ${newActualsCount} actuals row(s) (stay)`);
    reason = parts.join("; ");
  } else {
    verdict = "SAFE_NOW";
    reason = "target date free; no actuals on either side";
  }
  return { ...r, verdict, reason, collisionRows: tgtRows, oldActualsCount, newActualsCount };
}

async function classifyMissing(r) {
  const [tgtRows, actuals] = await Promise.all([
    hasHsRowOn(r.acct, r.newDate),  // any row on target date
    hasActualsOn(r.acct, r.newDate),
  ]);
  const hasCollision = tgtRows.length > 0;
  const actualsCount = actuals.length;
  const guardTripped = actualsCount > 0;

  let verdict, reason;
  if (guardTripped) {
    verdict = "GUARDED";
    reason = `target date has ${actualsCount} actuals row(s)`;
  } else if (hasCollision) {
    verdict = "WAIT_OPTION_A";
    reason = `target ${r.newDate} already has ${tgtRows.length} hs row(s): ${tgtRows.map(x => `pk=${x.game_pk} ${x.day_type}/${x.opponent}`).join(", ")}`;
  } else {
    verdict = "SAFE_NOW";
    reason = "target date free; no actuals";
  }
  return { ...r, verdict, reason, collisionRows: tgtRows, actualsCount };
}

async function main() {
  console.log("READ-ONLY :: sc-19 collision + actuals guard probe");
  console.log("Classifies Part 4 DATE_DRIFT + AAA MISSING_IN_DB into SAFE_NOW / WAIT_OPTION_A / GUARDED.");

  console.log(`\n============================================================`);
  console.log(`DATE_DRIFT (${DATE_DRIFT.length} rows)`);
  console.log(`============================================================`);
  const driftResults = [];
  for (const r of DATE_DRIFT) {
    const c = await classifyDrift(r);
    driftResults.push(c);
    console.log(`  ${c.acct.padEnd(14)} pk=${String(c.pk).padEnd(7)} ${c.oldDate} -> ${c.newDate}  ${c.ha}/${c.opp}  [${c.verdict}]`);
    console.log(`    reason: ${c.reason}`);
  }

  console.log(`\n============================================================`);
  console.log(`AAA MISSING_IN_DB (${AAA_MISSING.length} unique pks, ${AAA_MISSING.length} rows)`);
  console.log(`============================================================`);
  const missingResults = [];
  for (const r of AAA_MISSING) {
    const c = await classifyMissing(r);
    missingResults.push(c);
    console.log(`  ${c.acct.padEnd(14)} pk=${String(c.pk).padEnd(7)} INSERT on ${c.newDate}  ${c.ha}/${c.opp} game#${c.gameNumber}  [${c.verdict}]`);
    console.log(`    reason: ${c.reason}`);
    if (c.note) console.log(`    note: ${c.note}`);
  }

  console.log(`\n============================================================`);
  console.log(`ROLLUP`);
  console.log(`============================================================`);
  const counts = { SAFE_NOW: 0, GUARDED_MOVABLE: 0, WAIT_OPTION_A: 0 };
  for (const c of [...driftResults, ...missingResults]) counts[c.verdict] = (counts[c.verdict] || 0) + 1;
  console.log(`  SAFE_NOW         : ${counts.SAFE_NOW || 0} row(s)  (sc-19 already shipped)`);
  console.log(`  GUARDED_MOVABLE  : ${counts.GUARDED_MOVABLE || 0} row(s)  (sc-19b, actuals-stay ruling)`);
  console.log(`  WAIT_OPTION_A    : ${counts.WAIT_OPTION_A || 0} row(s)  (Option A follow-up)`);

  console.log(`\n=== GUARDED_MOVABLE subset (for sc-19b migration body) ===`);
  for (const c of [...driftResults, ...missingResults].filter(x => x.verdict === "GUARDED_MOVABLE")) {
    const op = c.oldDate ? `UPDATE (${c.oldDate} -> ${c.newDate})` : `INSERT (${c.newDate})`;
    console.log(`  ${c.acct} pk=${c.pk} ${op} ${c.ha}/${c.opp}  actuals: old=${c.oldActualsCount || 0} new=${c.newActualsCount || 0}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
