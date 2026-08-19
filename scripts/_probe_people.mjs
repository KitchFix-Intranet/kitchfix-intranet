// scripts/_probe_people.mjs
//
// People derive acceptance. Runs after Derive people in
// rippling-sync.yml. FAIL fails the workflow job.
//
// Probes
//   P1  every ACTIVE worker in rippling_raw_workers_latest has a
//       people row
//   P2  display_name is non-null for every ACTIVE person
//   P3  is_site_leader is UNCHANGED across two consecutive derive
//       runs on any currently-seeded rows (static + dynamic checks)
//   P4  at most one is_site_leader per account_key (the index
//       enforces it; probe proves the derive never violates it)
//   P5  is_salaried count matches the salary derive's EXEMPT
//       population exactly
//   P6  idempotency - a second derive run changes zero rows other
//       than last_synced_at
//
// PII posture
// ────────────
// Counts only. worker_ids appear in error lines when a single row
// needs a handle; no names, emails, phones, or photos ever.
//
// Usage
//   node --env-file=.env.local scripts/_probe_people.mjs

import { createClient } from "@supabase/supabase-js";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSalariedWorker } from "../src/lib/labor/salariedPredicate.js";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), "..");

let hardFail = 0;
function ok(line)   { console.log(`  OK    ${line}`); }
function fail(line) { console.log(`  FAIL  ${line}`); hardFail++; }
function skip(line) { console.log(`  SKIP  ${line}`); }

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function fetchAll(table, sel) {
  const PS = 1000;
  const out = [];
  let from = 0;
  while (true) {
    const r = await supa.from(table).select(sel).range(from, from + PS - 1);
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    for (const row of r.data || []) out.push(row);
    if ((r.data || []).length < PS) break;
    from += PS;
  }
  return out;
}

console.log("=".repeat(72));
console.log("people derive acceptance probe");
console.log("=".repeat(72));

// ─── Load ────────────────────────────────────────────────────────────
const [rawWorkers, people] = await Promise.all([
  fetchAll("rippling_raw_workers_latest", "payload"),
  fetchAll("people", "worker_id, status, display_name, account_key, is_manager, is_salaried, is_site_leader, site_leader_note, worker_class, worker_class_source, last_synced_at"),
]);
const activeRaw = rawWorkers.filter(w => (w.payload || {}).status === "ACTIVE");
const peopleById = new Map();
for (const p of people) peopleById.set(p.worker_id, p);

console.log("");
console.log("[P1] every ACTIVE worker resolves to a people row");
const missing = activeRaw.filter(w => !peopleById.has((w.payload || {}).id));
if (missing.length === 0) ok(`active workers=${activeRaw.length} all resolved`);
else fail(`missing people rows: ${missing.length}  (worker_ids: ${missing.slice(0, 5).map(w => (w.payload || {}).id).join(", ")}...)`);

console.log("");
console.log("[P2] display_name non-null for every ACTIVE person");
const activePeople = people.filter(p => p.status === "ACTIVE");
const noName = activePeople.filter(p => !p.display_name);
if (noName.length === 0) ok(`active people=${activePeople.length} all have display_name`);
else fail(`active people without display_name: ${noName.length}  (worker_ids: ${noName.slice(0, 5).map(p => p.worker_id).join(", ")}...)`);

console.log("");
console.log("[P3] derive preserves owner-maintained columns (is_site_leader, site_leader_note, worker_class when source='owner')");
// STATIC leg 1: the upsert payload does not include is_site_leader
// or site_leader_note at all. PG cannot update columns not in the
// ON CONFLICT DO UPDATE SET, which the js client derives from the
// row's keys.
const deriveSrc = fs.readFileSync(path.join(REPO_ROOT, "scripts/derive_people.mjs"), "utf8");
const rowShapeMatch = deriveSrc.match(/rows\.push\(\{([\s\S]*?)\}\);/);
if (!rowShapeMatch) fail("could not locate rows.push({...}) payload in derive_people.mjs");
else {
  const payload = rowShapeMatch[1];
  const hasLeader = /\bis_site_leader\b/.test(payload);
  const hasNote   = /\bsite_leader_note\b/.test(payload);
  if (!hasLeader && !hasNote) ok("upsert payload omits is_site_leader + site_leader_note (owner columns preserved by construction)");
  else fail(`upsert payload leaks owner columns: is_site_leader=${hasLeader} site_leader_note=${hasNote}`);
}
// STATIC leg 2: worker_class + worker_class_source ARE in the payload
// (they must round-trip), but the derive carries the existing DB value
// through when worker_class_source='owner'. Assert the branch exists.
const carriesOwner = /ownerClassByWorker\.get\(workerId\)/.test(deriveSrc)
  && /isOwner\s*\?\s*"owner"\s*:\s*"derived"/.test(deriveSrc)
  && /isOwner\)\s*\{\s*workerClass\s*=\s*ownerClass;/.test(deriveSrc);
if (carriesOwner) ok("derive carries owner-marked worker_class through the upsert (no overwrite branch verified)");
else fail("derive does not carry owner-marked worker_class through (check ownerClassByWorker branch in derive_people.mjs)");
// STATIC leg 3: derive NEVER emits 'contract' as a derived value.
const emitsContract = /worker_class\s*=\s*"contract"/.test(deriveSrc);
if (!emitsContract) ok("derive never emits worker_class='contract' (owner-only value)");
else fail("derive emits 'contract' - remove that heuristic; contract is owner-only");
// DYNAMIC leg 1: is_site_leader survives a second derive run.
const seededLeader = people.filter(p => p.is_site_leader);
// DYNAMIC leg 2: worker_class_source='owner' rows survive a second derive run.
const seededOwner = people.filter(p => p.worker_class_source === "owner");
if (seededLeader.length === 0 && seededOwner.length === 0) {
  skip(`no seeded rows yet (0 is_site_leader, 0 worker_class_source='owner'); P3 dynamic checks wait for Kevin's seed pass`);
} else {
  const leaderSnap = new Map();
  for (const p of seededLeader) leaderSnap.set(p.worker_id, { note: p.site_leader_note });
  const ownerSnap = new Map();
  for (const p of seededOwner) ownerSnap.set(p.worker_id, { cls: p.worker_class });
  console.log(`  running a second derive against ${seededLeader.length} leader row(s) + ${seededOwner.length} owner-class row(s)`);
  const r = spawnSync("node", ["scripts/derive_people.mjs", "--source=manual"], { cwd: REPO_ROOT, stdio: "pipe", encoding: "utf8" });
  if (r.status !== 0) fail(`second derive run failed exit=${r.status}: ${(r.stderr || "").slice(0, 200)}`);
  else {
    const after = await fetchAll("people", "worker_id, is_site_leader, site_leader_note, worker_class, worker_class_source");
    let leaderDrift = 0;
    let ownerDrift = 0;
    for (const a of after) {
      const bLead = leaderSnap.get(a.worker_id);
      if (bLead && (!a.is_site_leader || (bLead.note || null) !== (a.site_leader_note || null))) leaderDrift++;
      const bOwn = ownerSnap.get(a.worker_id);
      if (bOwn && (a.worker_class_source !== "owner" || bOwn.cls !== a.worker_class)) ownerDrift++;
    }
    if (leaderDrift === 0 && ownerDrift === 0) ok(`seeded rows survived: leaders=${seededLeader.length}, owner-class=${seededOwner.length}`);
    else fail(`drift after second derive - leaders=${leaderDrift}, owner-class=${ownerDrift}`);
  }
}

console.log("");
console.log("[P4] at most one is_site_leader per account_key");
const leaderByAcct = new Map();
for (const p of people.filter(p => p.is_site_leader)) {
  const key = p.account_key ?? "(null)";
  leaderByAcct.set(key, (leaderByAcct.get(key) || 0) + 1);
}
const doubles = [...leaderByAcct.entries()].filter(([, n]) => n > 1);
if (doubles.length === 0) ok(`${leaderByAcct.size} account(s) with a seeded leader; none doubled`);
else fail(`account(s) with more than one leader: ${doubles.map(([k, n]) => `${k}=${n}`).join(", ")}`);

console.log("");
console.log("[P5] is_salaried count matches worker.overtime_exemption = EXEMPT count exactly");
const exemptFromRaw = rawWorkers.filter(w => isSalariedWorker(w.payload || {})).length;
const salariedInPeople = people.filter(p => p.is_salaried).length;
if (exemptFromRaw === salariedInPeople) ok(`salaried=${salariedInPeople} matches raw EXEMPT=${exemptFromRaw}`);
else fail(`salaried mismatch: people.is_salaried=${salariedInPeople} vs raw EXEMPT=${exemptFromRaw}`);

console.log("");
console.log("[P6] idempotency - a second derive run changes zero rows other than last_synced_at");
// The dynamic leg of P3 above already ran a second derive when seeded
// rows exist. Whether it ran or not, take a snapshot NOW (post any
// derive above), re-run once more, and diff.
const beforeSnap = new Map();
for (const p of people) beforeSnap.set(p.worker_id, JSON.stringify({
  user_id: null, // filled below - keep the shape stable
}));
// Re-select a hash-friendly subset for the diff.
const before6 = await fetchAll("people",
  "worker_id, user_id, display_name, title, status, start_date, end_date, department_id, account_key, is_corp, work_email, personal_email, phone, manager_worker_id, is_manager, is_salaried, worker_class, worker_class_source");
const beforeMap = new Map();
for (const r of before6) beforeMap.set(r.worker_id, JSON.stringify(r));
console.log(`  running a fresh derive to test idempotency (${before6.length} rows will be re-upserted)`);
const r6 = spawnSync("node", ["scripts/derive_people.mjs", "--source=manual"], { cwd: REPO_ROOT, stdio: "pipe", encoding: "utf8" });
if (r6.status !== 0) fail(`idempotency derive run failed exit=${r6.status}: ${(r6.stderr || "").slice(0, 200)}`);
else {
  const after6 = await fetchAll("people",
    "worker_id, user_id, display_name, title, status, start_date, end_date, department_id, account_key, is_corp, work_email, personal_email, phone, manager_worker_id, is_manager, is_salaried, worker_class, worker_class_source");
  let changed = 0;
  for (const a of after6) {
    const b = beforeMap.get(a.worker_id);
    if (!b) { changed++; continue; }
    if (b !== JSON.stringify(a)) changed++;
  }
  if (changed === 0) ok(`${after6.length} rows unchanged (only last_synced_at moved)`);
  else fail(`rows changed across identical inputs: ${changed}`);
}

// ─── Counts report ───────────────────────────────────────────────────
console.log("");
console.log("counts");
const total = people.length;
const active = activePeople.length;
const managers = people.filter(p => p.is_manager).length;
const salaried = salariedInPeople;
const nullAcct = people.filter(p => p.account_key == null).length;
console.log(`  total rows:        ${total}`);
console.log(`  active:            ${active}`);
console.log(`  managers:          ${managers}`);
console.log(`  salaried:          ${salaried}`);
console.log(`  null account_key:  ${nullAcct}`);
const perAcct = new Map();
for (const p of activePeople) {
  const key = p.account_key ?? "(unmapped)";
  perAcct.set(key, (perAcct.get(key) || 0) + 1);
}
console.log("  worker_class:");
const byClass = new Map();
for (const p of people) byClass.set(p.worker_class, (byClass.get(p.worker_class) || 0) + 1);
for (const k of ["hourly", "salaried", "contract", "unknown"]) {
  console.log(`    ${k.padEnd(10)} ${byClass.get(k) || 0}`);
}
console.log("  worker_class_source:");
const bySource = new Map();
for (const p of people) bySource.set(p.worker_class_source, (bySource.get(p.worker_class_source) || 0) + 1);
for (const k of ["derived", "owner"]) {
  console.log(`    ${k.padEnd(10)} ${bySource.get(k) || 0}`);
}
console.log("  active per account:");
for (const [k, v] of [...perAcct.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  console.log(`    ${k.padEnd(14)} ${v}`);
}

console.log("");
console.log("=".repeat(72));
console.log(hardFail === 0 ? "PEOPLE PROBE: ALL PASS" : `PEOPLE PROBE: ${hardFail} FAILURE(S)`);
console.log("=".repeat(72));
process.exit(hardFail === 0 ? 0 : 1);
