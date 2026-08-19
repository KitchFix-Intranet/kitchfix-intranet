// scripts/derive_people.mjs
//
// Derive the `people` roster from Rippling raw workers + users +
// the department map. Runs nightly after the workers + users walks.
// Upserts on worker_id with an EXPLICIT column list so the two
// owner-maintained columns (is_site_leader, site_leader_note) are
// preserved every run. See docs/migrations/people-1-table.sql for
// the schema + ownership contract.
//
// Usage
//   node --env-file=.env.local scripts/derive_people.mjs --source=nightly
//   node --env-file=.env.local scripts/derive_people.mjs --source=manual --dry-run
//
// Exit codes
//   0  success (or dry-run success)
//   1  configuration error
//   2  derivation error mid-run
//   3  probe failure (see scripts/_probe_people.mjs; this script
//      itself is derive-only, probes gate the workflow separately)
//
// PII posture
// ────────────
// The roster is PII-dense. This script prints COUNTS only. worker_ids
// (opaque hex) are permitted in error/exception surfaces where the
// operator needs a handle; names, emails, phone numbers, and photos
// are NEVER logged.

import { createClient } from "@supabase/supabase-js";
import { isSalariedWorker } from "../src/lib/labor/salariedPredicate.js";

// ─── CLI ─────────────────────────────────────────────────────────────
const VALID_SOURCES = new Set(["backfill", "nightly", "manual"]);
function parseArgs(argv) {
  const a = { source: null, dryRun: false };
  for (const x of argv.slice(2)) {
    if      (x.startsWith("--source=")) a.source = x.slice(9);
    else if (x === "--dry-run")         a.dryRun = true;
    else { console.error("unknown arg: " + x); process.exit(1); }
  }
  return a;
}
const args = parseArgs(process.argv);
if (!args.source || !VALID_SOURCES.has(args.source)) {
  console.error("--source required, one of: " + [...VALID_SOURCES].join(", "));
  process.exit(1);
}

// ─── Env + Supabase ──────────────────────────────────────────────────
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL) { console.error("SUPABASE_URL not set"); process.exit(1); }
if (!SB_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const runStartISO = new Date().toISOString();
console.log(`derive_people source=${args.source} dryRun=${args.dryRun} started=${runStartISO}`);

// ─── Helpers ─────────────────────────────────────────────────────────
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

// ─── 1. Load raw + existing owner-marked worker_class ───────────────
// Pre-fetch (worker_id, worker_class, worker_class_source) from
// people so the upsert can carry owner-marked worker_class values
// through unchanged. An owner row is any row Kevin has set to
// worker_class_source='owner' in Studio; the derive treats it the
// same way it treats is_site_leader - never overwritten. On first
// run the table is empty and every row derives normally. If the
// people table does not exist yet (pre-migration dry-run), the
// derive proceeds with an empty owner-class map instead of crashing.
console.log("loading workers, users, department map, existing owner-class rows");
async function fetchAllTolerant(table, sel) {
  try { return await fetchAll(table, sel); }
  catch (e) {
    if (/Could not find the table/i.test(e.message)) {
      console.log(`  ${table} does not exist yet - proceeding with empty set (pre-migration dry-run posture)`);
      return [];
    }
    throw e;
  }
}
const [workers, users, deptMap, existingClass] = await Promise.all([
  fetchAll("rippling_raw_workers_latest", "payload"),
  fetchAll("rippling_raw_users_latest",   "rippling_id, payload"),
  fetchAll("rippling_department_map",     "department_id, account_key, is_container"),
  fetchAllTolerant("people",              "worker_id, worker_class, worker_class_source"),
]);
console.log(`  workers=${workers.length}  users=${users.length}  dept_map=${deptMap.length}  existing_people=${existingClass.length}`);
const ownerClassByWorker = new Map();
for (const r of existingClass) {
  if (r.worker_class_source === "owner") ownerClassByWorker.set(r.worker_id, r.worker_class);
}
console.log(`  owner-marked worker_class rows: ${ownerClassByWorker.size}`);

// Index users by rippling_id for the join.
const userById = new Map();
for (const u of users) userById.set(u.rippling_id, u.payload || {});

// Index department map by department_id.
const deptById = new Map();
for (const d of deptMap) deptById.set(d.department_id, d);

// ─── 2. Shape people rows ────────────────────────────────────────────
// Explicit column list. is_site_leader + site_leader_note are OMITTED
// so the upsert's ON CONFLICT DO UPDATE SET only touches non-owner
// columns; first_seen_at is omitted so the default fires on first
// INSERT and the value is preserved on updates.
const nowISO = new Date().toISOString();
const rows = [];
const exceptionsByReason = new Map();          // reason_code -> count
function bumpException(reason) {
  exceptionsByReason.set(reason, (exceptionsByReason.get(reason) || 0) + 1);
}

for (const w of workers) {
  const p = w.payload || {};
  const workerId = p.id;
  if (!workerId) { bumpException("unknown_worker"); continue; }

  const user = p.user_id ? (userById.get(p.user_id) || null) : null;

  // Name: user.display_name -> user.name (may be an object like
  // { given_name, family_name, formatted }) -> null.
  let displayName = null;
  if (user) {
    if (typeof user.display_name === "string" && user.display_name.trim().length > 0) {
      displayName = user.display_name.trim();
    } else if (typeof user.name === "string" && user.name.trim().length > 0) {
      displayName = user.name.trim();
    } else if (user.name && typeof user.name === "object") {
      const g = user.name.given_name;
      const f = user.name.family_name;
      if (g && f) displayName = `${String(g).trim()} ${String(f).trim()}`;
      else if (typeof user.name.formatted === "string" && user.name.formatted.trim().length > 0) {
        displayName = user.name.formatted.trim();
      }
    }
  }

  // Phone: first entry in user.phone_numbers if present.
  let phone = null;
  const phones = Array.isArray(user?.phone_numbers) ? user.phone_numbers : null;
  if (phones && phones.length > 0) {
    const first = phones[0];
    if (typeof first === "string") phone = first;
    else if (first && typeof first === "object") phone = first.value || first.number || null;
  }

  // Department -> account_key + is_corp. Unknown department leaves
  // account_key null; missing department_id is a separate reason code
  // matching the labor derive taxonomy.
  const deptId = p.department_id || null;
  let accountKey = null;
  let isCorp = false;
  if (!deptId) {
    bumpException("no_worker_department");
  } else {
    const d = deptById.get(deptId);
    if (!d) {
      bumpException("unknown_department");
    } else {
      accountKey = d.account_key || null;
      isCorp = accountKey === "CORP";
    }
  }

  // worker_class default derivation from overtime_exemption. The
  // derive NEVER emits 'contract' - there is no signal in Rippling
  // that distinguishes a contractor from a salaried employee, which
  // is the entire reason worker_class exists as an owner-editable
  // column. For any worker Kevin has marked source='owner' in Studio,
  // carry the existing DB value back through the upsert so the
  // ON CONFLICT DO UPDATE SET is a no-op on those two columns.
  const ownerClass = ownerClassByWorker.get(workerId);
  const isOwner = ownerClass !== undefined;
  let workerClass;
  if (isOwner) {
    workerClass = ownerClass;
  } else {
    const ot = p.overtime_exemption;
    workerClass = ot === "EXEMPT" ? "salaried"
                : ot === "NON_EXEMPT" ? "hourly"
                : "unknown";
  }

  rows.push({
    worker_id:           workerId,
    user_id:             p.user_id ?? null,
    display_name:        displayName,
    title:               typeof p.title === "string" ? p.title.trim() : null,
    status:              p.status || null,
    start_date:          p.start_date || null,
    end_date:            p.end_date || null,
    department_id:       deptId,
    account_key:         accountKey,
    is_corp:             isCorp,
    // V-role-gates spec §8c - normalise emails on ingest, not at
    // query time. Rippling has shipped values with trailing
    // whitespace + mixed case; fixing it here means every consumer
    // (resolver, probes, admin queries) reads a clean column.
    work_email:          p.work_email ? String(p.work_email).trim().toLowerCase() || null : null,
    personal_email:      p.personal_email ? String(p.personal_email).trim().toLowerCase() || null : null,
    phone,
    manager_worker_id:   p.manager_id || null,
    is_manager:          p.is_manager ?? null,
    is_salaried:         isSalariedWorker(p),
    worker_class:        workerClass,
    worker_class_source: isOwner ? "owner" : "derived",
    last_synced_at:      nowISO,
  });
}

console.log(`shaped rows: ${rows.length}`);
if (exceptionsByReason.size > 0) {
  const parts = [...exceptionsByReason.entries()].map(([r, c]) => `${r}=${c}`).join(" ");
  console.log(`  exceptions: ${parts}`);
} else {
  console.log(`  exceptions: none`);
}

// ─── 3. Upsert ───────────────────────────────────────────────────────
// Batch to keep individual requests small. The upsert list DOES NOT
// contain is_site_leader / site_leader_note so ON CONFLICT DO UPDATE
// SET leaves those owner-maintained columns alone. Probe P3 asserts
// this contract survives two consecutive runs against a seeded row.
const BATCH = 500;
let writtenTotal = 0;
if (args.dryRun) {
  console.log(`DRY RUN: would upsert ${rows.length} rows in batches of ${BATCH}`);
} else {
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const r = await supa.from("people").upsert(chunk, { onConflict: "worker_id" });
    if (r.error) { console.error(`upsert failed at offset ${i}: ${r.error.message}`); process.exit(2); }
    writtenTotal += chunk.length;
  }
  console.log(`upserted rows: ${writtenTotal}`);
}

// ─── 4. Summary counts (no PII) ──────────────────────────────────────
if (!args.dryRun) {
  const q = await supa
    .from("people")
    .select("account_key, status, is_manager, is_salaried, worker_class, worker_class_source, last_synced_at");
  if (q.error) { console.error(`summary select failed: ${q.error.message}`); process.exit(2); }
  const all = q.data || [];
  const total = all.length;
  const active = all.filter(r => r.status === "ACTIVE").length;
  const managerCount = all.filter(r => r.is_manager).length;
  const salariedCount = all.filter(r => r.is_salaried).length;
  const nullAcct = all.filter(r => r.account_key == null).length;
  const staleCount = all.filter(r => r.last_synced_at && r.last_synced_at < runStartISO).length;

  const activeByAccount = new Map();
  for (const r of all) {
    if (r.status !== "ACTIVE") continue;
    const key = r.account_key ?? "(unmapped)";
    activeByAccount.set(key, (activeByAccount.get(key) || 0) + 1);
  }
  const perAcct = [...activeByAccount.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const byClass = new Map();
  const bySource = new Map();
  for (const r of all) {
    byClass.set(r.worker_class,        (byClass.get(r.worker_class)        || 0) + 1);
    bySource.set(r.worker_class_source,(bySource.get(r.worker_class_source)|| 0) + 1);
  }

  console.log("");
  console.log("summary:");
  console.log(`  total rows:            ${total}`);
  console.log(`  active:                ${active}`);
  console.log(`  managers:              ${managerCount}`);
  console.log(`  salaried:              ${salariedCount}`);
  console.log(`  null account_key:      ${nullAcct}`);
  console.log(`  rows not touched this run (stale last_synced_at): ${staleCount}`);
  console.log("  worker_class:");
  for (const k of ["hourly", "salaried", "contract", "unknown"]) {
    console.log(`    ${k.padEnd(10)} ${byClass.get(k) || 0}`);
  }
  console.log("  worker_class_source:");
  for (const k of ["derived", "owner"]) {
    console.log(`    ${k.padEnd(10)} ${bySource.get(k) || 0}`);
  }
  console.log("  active per account:");
  for (const [k, v] of perAcct) console.log(`    ${k.padEnd(14)} ${v}`);
}

console.log(`derive_people done source=${args.source} finished=${new Date().toISOString()}`);
