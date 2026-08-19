// scripts/_probe_derive_pay_segments_s1i.mjs
//
// S1i: permanent probe for the 2026-08-19 rippling_id re-issue class.
//
// RED IS ACCURATE, NOT A FAILURE TO FIX. This probe measures the
// derive's INPUT (raw table). The derive consumes dedup-corrected
// input; its writes are right. The probe stays red for as long as
// Rippling issues multiple rippling_ids for the same external_id and
// goes green on its own the first nightly Rippling stops re-issuing.
// Do not "fix" the red by editing the probe.

//
// Mirrors the DERIVE's actual read path (raw table, all versions,
// then presence-filter) - not the `_latest` view. Two inflation
// paths converge here and the derive sees both before dedup:
//   1. rippling_raw_pay_segments holds ALL raw versions (append-only).
//      A rippling_id whose payload's content-hash changed over time
//      has 2+ raw rows. The presence-filter keeps all of them.
//   2. Rippling re-issues rippling_id for the same logical segment
//      (external_id stable). Each re-issue is a new rippling_id, so
//      new raw rows insert. Presence's swap-to-latest-walk semantics
//      keeps whichever set the latest walk saw.
//
// Under either path, the derive's bucket accumulator sums the same
// logical work twice+. The 2026-08-19 hotfix installs an external_id
// dedup right after presence-filter. This probe asserts, per account
// per fiscal period, that the sum-of-hours by rippling_id equals the
// sum-of-hours by external_id.
//
// Before the hotfix: red on P8 (portfolio-wide ~3.3x).
// After the hotfix: this probe still runs against the SAME read
// path, so drift stays visible if Rippling re-issues again. The
// derive's dedup fixes the write; this probe measures the input.
//
// Read-only. No writes. PASS/FAIL per (window, account).
//
// Usage: node --env-file=.env.local scripts/_probe_derive_pay_segments_s1i.mjs

import { createClient } from "@supabase/supabase-js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let hardFail = 0;
function log(line, ok = true) {
  if (!ok) hardFail++;
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${line}`);
}

const WINDOWS = [
  { name: "P6", start: "2026-05-18", end: "2026-06-14" },
  { name: "P7", start: "2026-06-15", end: "2026-07-12" },
  { name: "P8", start: "2026-07-13", end: "2026-08-09" },
  { name: "P9", start: "2026-08-10", end: "2026-09-06" },
];

async function fetchAll(table, sel, filters = {}) {
  const PS = 500;
  const out = [];
  let from = 0;
  while (true) {
    let q = supa.from(table).select(sel).range(from, from + PS - 1);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const r = await q;
    if (r.error) throw new Error(`${table}: ${r.error.message}`);
    for (const row of r.data || []) out.push(row);
    if ((r.data || []).length < PS) break;
    from += PS;
  }
  return out;
}

async function main() {
  console.log("=".repeat(72));
  console.log("S1i - pay-segments dedup identity per account per window");
  console.log("=".repeat(72));

  // Load presence, workers -> account map, and pay_segments _latest.
  // Every load paginates - Supabase's per-request default of 1000
  // rows silently truncated the first-cut probe and made it green
  // on a partial input. fetchAll uses range() to walk every row.
  // Load the same inputs the derive loads: RAW pay_segments (all
  // versions), presence, workers, dept map. Not _latest - that's the
  // view that hides one of the two inflation paths.
  const [presenceAll, workersAll, dmAll, rawRows] = await Promise.all([
    fetchAll("rippling_current_presence", "rippling_id, kind"),
    fetchAll("rippling_raw_workers_latest", "rippling_id, payload"),
    fetchAll("rippling_department_map", "department_id, account_key"),
    fetchAll("rippling_raw_pay_segments", "rippling_id, payload"),
  ]);
  const presenceIds = new Set(presenceAll.filter(r => r.kind === "pay_segments").map(r => r.rippling_id));
  const deptToAccount = new Map(dmAll.map(d => [d.department_id, d.account_key]));
  const workerToAccount = new Map();
  for (const w of workersAll) {
    const d = w.payload?.department_id;
    if (d) workerToAccount.set(w.rippling_id, deptToAccount.get(d));
  }
  console.log(`  inputs: presence=${presenceIds.size}  workers=${workersAll.length}  raw=${rawRows.length}  dept_map=${dmAll.length}`);

  // Filter to presence-visible + attributable segments. Mirrors the
  // derive: raw rows whose rippling_id is in presence, worker
  // attributes to a non-CORP account, segment_date is set.
  const segs = [];
  for (const x of rawRows) {
    const p = x.payload || {};
    if (!presenceIds.has(x.rippling_id)) continue;
    const wid = p.owner_role?.id;
    const acct = wid ? workerToAccount.get(wid) : null;
    if (!acct || acct === "CORP") continue;
    const d = p.segment_date;
    if (!d) continue;
    segs.push({
      rippling_id: x.rippling_id,
      external_id: p.external_id || null,
      account: acct,
      segment_date: d,
      hrs: Number(p.segment_duration_hours || 0),
    });
  }
  console.log(`  presence-visible + account-attributable + dated segments: ${segs.length}`);

  // For each window, per account:
  //   naive_hrs  = sum by rippling_id (every observation)
  //   dedup_hrs  = sum after picking one row per external_id (first seen)
  for (const win of WINDOWS) {
    console.log(`\n[${win.name} · ${win.start}..${win.end}]`);
    const inWin = segs.filter(s => s.segment_date >= win.start && s.segment_date <= win.end);
    const byAccountNaive = new Map();
    for (const s of inWin) byAccountNaive.set(s.account, (byAccountNaive.get(s.account) || 0) + s.hrs);

    // Dedup by external_id (first-seen wins — order is _latest view order
    // which is fetched_at DESC).
    const bestByExt = new Map();
    const noExt = [];
    for (const s of inWin) {
      if (!s.external_id) { noExt.push(s); continue; }
      if (!bestByExt.has(s.external_id)) bestByExt.set(s.external_id, s);
    }
    const dedupSegs = [...bestByExt.values()].concat(noExt);
    const byAccountDedup = new Map();
    for (const s of dedupSegs) byAccountDedup.set(s.account, (byAccountDedup.get(s.account) || 0) + s.hrs);

    let winFail = 0;
    const accts = new Set([...byAccountNaive.keys(), ...byAccountDedup.keys()]);
    console.log(`  account          naive_hrs   dedup_hrs   drift   inflation`);
    for (const a of [...accts].sort()) {
      const n = byAccountNaive.get(a) || 0;
      const d = byAccountDedup.get(a) || 0;
      const drift = n - d;
      const inflPct = d > 0 ? ((n / d - 1) * 100).toFixed(1) + "%" : "n/a";
      const ok = Math.abs(drift) < 0.01;
      if (!ok) winFail++;
      console.log(`  ${(ok ? "OK  " : "FAIL")}  ${a.padEnd(16)} ${n.toFixed(2).padStart(10)} ${d.toFixed(2).padStart(10)} ${drift.toFixed(2).padStart(10)} ${inflPct.padStart(10)}`);
    }
    log(`${win.name}: 0 accounts show naive != dedup (found ${winFail})`, winFail === 0);
  }

  console.log(`\n${"=".repeat(72)}`);
  console.log(hardFail === 0 ? "S1i PROBE: PASS" : `S1i PROBE: ${hardFail} FAIL`);
  console.log("=".repeat(72));
  process.exit(hardFail === 0 ? 0 : 1);
}

main().catch(e => { console.error("PROBE ERROR:", e); process.exit(2); });
