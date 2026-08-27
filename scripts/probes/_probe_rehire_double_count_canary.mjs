// Rehire double-count canary.
//
// Owner ruling 2026-08-27 (post-user_accounts drift audit). Rippling
// worker_id is per employment SPELL, not per person. Email is the
// person key. Every counting site in labor code that dedupes by
// worker_id (7 sites - see below) will double-count a seasonal
// rehire whenever a range spans TWO of that person's spells.
//
// The seven sites:
//   src/lib/labor/salaryBoard.js:226        distinct_workers
//   src/app/kpi/labor/lib/board.js:39-46    workers (OT card)
//   src/app/kpi/labor/lib/board.js:151      worker_count
//   src/app/kpi/labor/lib/board.js:347      distinct_workers
//   src/app/kpi/labor/page.js:541           worker roster ids
//   src/app/kpi/labor/page.js:547           totalWorkersInRange
//   src/lib/labor/dailyRangeBody.js:174     workerIds (fetched meta)
//
// The fix (deferred - timeout comes first per owner ruling):
//   pass worker_id -> email map into buildBoard, dedupe by resolved
//   email. Refactor is trivial once the counting fn is extracted;
//   the map already exists in the request cycle at
//   dailyRangeBody.js:174.
//
// The failing test (also deferred): once the counting fn is extracted
// to a pure module, a synthetic-fixture probe asserts that
// countDistinctPeople([{wid:"a",email:"x"},{wid:"b",email:"x"}])
// === 1. That is the "failing test to fix against" - it fires today,
// passes when the fix lands.
//
// This canary is what ships now instead. It scans live data for the
// pre-condition: any email with 2+ Rippling spells where more than
// one worker_id carries labor rows. Today the pre-condition is not
// met (labor_actuals starts at the FY2026 fiscal-year floor,
// 2025-12-29 - Gilman/Forkner/Rogers all terminated before that, so
// their old worker_ids have zero rows). The canary asserts this
// stays true. The moment a real mid-fiscal-year rehire happens (or
// backfill extends across a rehire), the canary fires with the
// email + names + worker_ids + row counts.
//
// Owner framing: "fires on the day the problem becomes real rather
// than on a synthetic case".
//
// Pagination note: this probe uses fetchAll() with .range(). The
// user_accounts drift audit that surfaced this rule was itself
// silently truncated by Supabase's default 1000-row cap on people
// (1,126 rows). See MEMORY note on the pagination sweep owed.

import { createClient } from "@supabase/supabase-js";

for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) { console.error(`env ${k}: ABSENT`); process.exit(1); }
}
const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Paginated select. Supabase silently caps single-page selects at
// 1000 rows; every probe or derive that queries a >1000-row table
// without .range() truncates. See MEMORY: pagination-sweep.
async function fetchAll(builder) {
  const out = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const q = await builder().range(from, from + PAGE - 1);
    if (q.error) throw q.error;
    if (!q.data.length) break;
    out.push(...q.data);
    if (q.data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra !== undefined) console.log(`      ${JSON.stringify(extra, null, 2)}`);
}

console.log("=== rehire double-count canary ===\n");

const people = await fetchAll(() =>
  supa.from("people").select("worker_id, display_name, work_email, personal_email, status, start_date, end_date")
);
console.log(`people rows (paginated): ${people.length}`);

// Group worker_ids by lower(work_email). Only rows with a work_email
// are candidates for the counting-double-count defect - internal
// site staff always have a work email; contractors on personal
// email are covered by the same rule but currently absent from the
// user_accounts consumer.
const widsByEmail = new Map();
for (const p of people) {
  const e = (p.work_email || "").trim().toLowerCase();
  if (!e) continue;
  if (!widsByEmail.has(e)) widsByEmail.set(e, []);
  widsByEmail.get(e).push(p);
}
const multiSpell = [...widsByEmail].filter(([_, ps]) => ps.length > 1);
console.log(`emails with 2+ Rippling spells (at-risk set): ${multiSpell.length}`);

// For each at-risk email, check labor_actuals + labor_salary_actuals
// for rows on ANY of their worker_ids. If any pair of worker_ids
// both have rows, the counting sites double-count on any range
// that includes both.
const offenders = [];
for (const [email, ps] of multiSpell) {
  const wids = ps.map(p => p.worker_id);
  const [la, ls] = await Promise.all([
    supa.from("labor_actuals").select("worker_id, week_start").in("worker_id", wids),
    supa.from("labor_salary_actuals").select("worker_id, week_start").in("worker_id", wids),
  ]);
  const widsWithRows = new Map();
  for (const r of [...(la.data || []), ...(ls.data || [])]) {
    if (!widsWithRows.has(r.worker_id)) widsWithRows.set(r.worker_id, { rows: 0, first: r.week_start, last: r.week_start });
    const b = widsWithRows.get(r.worker_id);
    b.rows++;
    if (r.week_start < b.first) b.first = r.week_start;
    if (r.week_start > b.last)  b.last  = r.week_start;
  }
  if (widsWithRows.size >= 2) {
    offenders.push({
      email,
      name: ps[0].display_name,
      spellCount: ps.length,
      widsWithRows: [...widsWithRows].map(([wid, b]) => ({
        wid_prefix: wid.slice(0, 10),
        rows: b.rows,
        first: b.first,
        last: b.last,
      })),
    });
  }
}

assert(
  `no at-risk email has 2+ worker_ids with labor rows`,
  offenders.length === 0,
  offenders,
);

console.log(`\n---`);
if (failures > 0) {
  console.log(`${failures} email(s) trigger the double-count pre-condition. Each of the seven counting sites in board.js / salaryBoard.js / page.js / dailyRangeBody.js WILL over-count these people on any range that spans both spells. Fix per owner ruling: extract counting fn + pass worker_id -> email map + dedupe by email (Option 1).`);
  process.exit(1);
}
console.log(`no rehire double-count today. ${multiSpell.length} at-risk emails checked; each has at most 1 worker_id with labor rows.`);
