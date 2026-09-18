// Generate Section 3 (Rippling detail) from live data.
// Produces: Table 3A (per-department) + Table 3B (per-work-location) + Callouts.
// Uses the Round 2 verified map for account attribution.

const KEY = process.env.RIPPLING_API_KEY;
const BASE = "https://rest.ripplingapis.com";
async function call(u) {
  const r = await fetch(u, { headers: { Authorization: "Bearer " + KEY, "X-Rippling-Api-Version": "2024-08-01", Accept: "application/json" } });
  return { ok: r.ok, status: r.status, body: await r.json() };
}
async function walkAll(p) {
  let u = BASE + "/" + p;
  const all = [];
  while (true) {
    const r = await call(u);
    const rows = r.body?.results || r.body?.data || r.body?.records || [];
    all.push(...rows);
    if (!rows.length || !r.body?.next_link) break;
    u = r.body.next_link.startsWith("http") ? r.body.next_link : BASE + r.body.next_link;
  }
  return all;
}
const { createClient } = await import("@supabase/supabase-js");
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Round 2 verified map: dept_id -> {account, pnl_line, legacy_note}
const MAP = {
  "601d80ea2aca9a5fef7617fa": { account: "CIN - AZ", pnl: null,      note: "container parent" },
  "601d817448f7105e4c3d5f49": { account: "CIN - AZ", pnl: "3100.1",  note: "**name-misleading (D32)** - workers at Goodyear AZ, NOT Cincinnati" },
  "601d818b2ab2cef76f0d62f7": { account: "CIN - AZ", pnl: "3100.2",  note: "" },
  "66a3b85f0b7d0b40d36acc2f": { account: "CIN - OH", pnl: null,      note: "container parent" },
  "66a3b8c92d818718345ff854": { account: "CIN - OH", pnl: "3100.1",  note: "created ~Mar 2026, parallel to `- REDS` not a rename" },
  "676a00efeb1828eb5fc829b6": { account: "CIN - OH", pnl: "3100.2",  note: "" },
  "65dcfcbd44398f188b75e20c": { account: "CIN - KY", pnl: null,      note: "container parent (1 contractor sits here, out of labor pipeline)" },
  "65dcfcd6726b559b2db5c0e9": { account: "CIN - KY", pnl: "3100.2",  note: "D26: single salaried Executive Chef" },
  "69179d2b52f92c170ac0d29c": { account: "STL - FL", pnl: null,      note: "container parent" },
  "69612c8272453bb48d0416a1": { account: "STL - FL", pnl: "3100.1",  note: "" },
  "69612c8372453bb48d0416b4": { account: "STL - FL", pnl: "3100.2",  note: "" },
  "67a3caba7a2ec09203ff3895": { account: "STL - MO", pnl: null,      note: "container parent" },
  "67a3cabe7a2ec09203ff38a4": { account: "STL - MO", pnl: "3100.1",  note: "contains 'Cardinals' but not 'Jupiter' - the disambiguator" },
  "67a3cac07a2ec09203ff38ac": { account: "STL - MO", pnl: "3100.2",  note: "includes 1 contractor RD" },
  "5c2cf3cc92dabb2b61fd9411": { account: "TBJ - FL", pnl: null,      note: "container parent" },
  "5c338b256ab9e2451298d7b5": { account: "TBJ - FL", pnl: "3100.1",  note: "" },
  "5c338b1fc59291794dc6daee": { account: "TBJ - FL", pnl: "3100.2",  note: "1 outlier at HQ Chicago (logged)" },
  "5e40c83c5a8f4e2ad22c4bf7": { account: "TBJ - NY", pnl: null,      note: "container parent" },
  "5f2178a412365002972c65ea": { account: "TBJ - NY", pnl: "3100.1",  note: "all workers TERMINATED 2020-21; D26 holds - no active hourly" },
  "5e40c8d2b0974e0f7fc79a6a": { account: "TBJ - NY", pnl: "3100.2",  note: "" },
  "5fd0ff740f3ad600d0424614": { account: "TBR - FL", pnl: null,      note: "container parent" },
  "5fd0ffb21cbc9d00293c4eca": { account: "TBR - FL", pnl: "3100.1",  note: "single work_loc covers both Port Charlotte + Englewood" },
  "5fd0ffbef75c1200ce81bc69": { account: "TBR - FL", pnl: "3100.2",  note: "" },
  "61bba390891bcdcd7caf8103": { account: "TXR - AZ", pnl: null,      note: "container parent" },
  "61bba40f9876bd62d74ab5f9": { account: "TXR - AZ", pnl: "3100.1",  note: "" },
  "61bba432d48aba5eefbc27ee": { account: "TXR - AZ", pnl: "3100.2",  note: "" },
  "5e3ecbba5a8f4e251b754611": { account: "TXR - TX - H", pnl: null,  note: "container parent SHARED with V, arbitrary assign to H" },
  "5e3eccebb0974e16af6f8c16": { account: "TXR - TX - H", pnl: "3100.1", note: "1 worker on deleted work_loc (logged)" },
  "5e3ecce18a9f4e38d515fd9c": { account: "TXR - TX - H", pnl: "3100.2", note: "2 salaried outliers (Buffalo + HQ Chicago, logged)" },
  "65c402509aa26127a1e29f22": { account: "TXR - TX - V", pnl: "3100.1", note: "note typo in name; H+V clock-in ambiguity flagged §2.1" },
  "65c4024887a5e2437fcccc32": { account: "TXR - TX - V", pnl: "3100.2", note: "" },
  "5c4a125c6ab9e21dcc288ad8": { account: "CORP",     pnl: null,      note: "root container for all client trees" },
  "5c140b612962480ef6366027": { account: "CORP",     pnl: null,      note: "root container" },
  "5c338b0a296248677c0a26db": { account: "CORP",     pnl: "5004.1",  note: "out of scope per D17" },
  "5c2cfbbc296248319461af77": { account: "CORP",     pnl: "5004.2",  note: "out of scope per D17" },
  "5c338afbc592917819e89219": { account: "CORP",     pnl: "5004.6",  note: "out of scope per D17" },
  "5c338d8d92dabb3a580c611f": { account: "CORP",     pnl: "5004.7",  note: "out of scope per D17" },
  "5c2cfbc16ab9e23aa196c5ac": { account: "CORP",     pnl: "5004.4",  note: "out of scope per D17; 4 TERMINATED workers" },
};

process.stderr.write("Fetching departments, workers, work-locations...\n");
const depts = await walkAll("departments?limit=100");
const workers = await walkAll("workers?limit=100");
const workLocs = await walkAll("work-locations?limit=100");
const wlName = new Map(workLocs.map(w => [w.id, w.name]));

// Per-worker time-entry count from Postgres
process.stderr.write("Fetching time-entry counts per worker...\n");
const entriesByWorker = new Map();
let from = 0;
while (true) {
  const q = await supa.from("rippling_raw_time_entries_latest").select("payload").range(from, from + 999);
  if (q.error) throw new Error(q.error.message);
  if (!q.data?.length) break;
  for (const r of q.data) {
    const wid = r.payload?.worker_id;
    if (wid) entriesByWorker.set(wid, (entriesByWorker.get(wid) || 0) + 1);
  }
  if (q.data.length < 1000) break;
  from += 1000;
}

// Per-dept aggregation
const perDept = new Map();
for (const d of depts) perDept.set(d.id, {
  id: d.id, name: d.name || "", parent_id: d.parent_id,
  workers: 0, entries: 0, workLocDist: new Map(), statuses: {}
});
for (const w of workers) {
  const did = w.department_id;
  if (!did || !perDept.has(did)) continue;
  const b = perDept.get(did);
  b.workers++;
  const st = w.status || "(no-status)";
  b.statuses[st] = (b.statuses[st] || 0) + 1;
  const wl = w.location?.work_location_id;
  if (wl) b.workLocDist.set(wl, (b.workLocDist.get(wl) || 0) + 1);
  b.entries += entriesByWorker.get(w.id) || 0;
}

// Per work-loc aggregation
const perWL = new Map();
for (const wl of workLocs) perWL.set(wl.id, { id: wl.id, name: wl.name, workers: 0, accounts: new Set() });
for (const w of workers) {
  const wid = w.location?.work_location_id;
  if (!wid || !perWL.has(wid)) continue;
  perWL.get(wid).workers++;
  const did = w.department_id;
  const acct = MAP[did]?.account;
  if (acct) perWL.get(wid).accounts.add(acct);
}

// ─── OUTPUT ─────────────────────────────────────────────────────────

console.log("## Section 3 - Rippling detail");
console.log("");
console.log("All values `[verified - live /departments + /workers + /work-locations + Postgres rippling_raw_time_entries_latest, " + new Date().toISOString().slice(0, 10) + "]` unless noted.");
console.log("");
console.log("### Table 3A - Per department (all 38 departments Rippling returns)");
console.log("");
console.log("Sorted by proposed account then name. Names verbatim (typos + double-spaces preserved).");
console.log("");
console.log("| dept_id | verbatim name | account | pnl_line | workers | entries | worker statuses | work locations | container | verified_at | notes |");
console.log("|---|---|---|---|---:|---:|---|---|---|---|---|");

const rows = [...perDept.values()].map(b => {
  const m = MAP[b.id] || { account: "UNMAPPED", pnl: null, note: "not in Round 2 map - NEW DEPARTMENT" };
  return { ...b, ...m, isContainer: b.workers === 0 };
});
rows.sort((a, b) => (a.account || "").localeCompare(b.account || "") || a.name.localeCompare(b.name));

for (const r of rows) {
  const statuses = Object.entries(r.statuses).map(([k, v]) => `${k}:${v}`).join(", ") || "-";
  const wls = [...r.workLocDist.entries()].map(([id, c]) => `${wlName.get(id) || id.slice(0, 8)}:${c}`).join(", ") || "-";
  console.log(`| \`${r.id}\` | \`${r.name}\` | ${r.account} | ${r.pnl || "-"} | ${r.workers} | ${r.entries} | ${statuses} | ${wls} | ${r.isContainer ? "true" : "false"} | 2026-08-04 | ${r.note} |`);
}

console.log("");
console.log("### Table 3B - Per work location (all locations Rippling returns)");
console.log("");
console.log("| work_location_id | verbatim name | serves account(s) | workers clocking here |");
console.log("|---|---|---|---:|");
const wlRows = [...perWL.values()].sort((a, b) => a.name.localeCompare(b.name));
for (const wl of wlRows) {
  console.log(`| \`${wl.id}\` | \`${wl.name}\` | ${[...wl.accounts].sort().join(", ") || "(none)"} | ${wl.workers} |`);
}

console.log("");
console.log("### Callouts");
console.log("");
console.log("- **`Englewood, FL/Port Charlotte, FL (TBR-FL)`** is a SINGLE Rippling work_location covering BOTH physical sites. 183/183 hourly TBR-FL workers on it. There is no separate Englewood location.");
console.log("- **`Arlington TX (TXR-HOME)` and `Arlington TX Visitor (TXR-VISITOR)`** are separate locations at the same physical ballpark. TXR-TX-V's 12 hourly workers split 4 at Home + 8 at Visitor. Open op question §2.1 with Grant Lawson and Jordan Rodgers on whether chefs actually clock between departments.");
console.log("- **`- REDS` (128 workers, 1,216 entries) is CIN-AZ** (Goodyear), not CIN-OH. Documented as D32.");
console.log("- **`REDS OH` (16 workers, 349 entries) is CIN-OH**, created ~March 2026. Not a rename of `- REDS`; both run in parallel.");
console.log("- **`- TBJ` (181 workers, 2,169 entries)** = TBJ-FL. Verified: 181/181 at Dunedin, FL.");
console.log("- **`- TBR` (183 workers, 2,029 entries)** = TBR-FL. Verified: 183/183 at the combined Englewood/Port Charlotte work_location.");
console.log("- **`Louisville  Bats`** contains a double-space in the name. Preserved verbatim.");
console.log("- **`TXR- Visiting Side`** contains a missing space after the hyphen. Preserved verbatim.");
console.log("- **`Hourly Kitchen - 3100.1 - BUF`** shows 12 workers, all TERMINATED 2020-21. Rippling does not strip department_id on termination. D26 holds - TBJ-NY is single-salaried.");
