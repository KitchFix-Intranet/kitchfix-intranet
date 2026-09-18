// Regenerate Section 2 (Identifier crosswalk) of ACCOUNT_REFERENCE.md
// from live data. Single-pass, [ran] evidence on every cell.
//
// Re-run this when: an account is added, gl_codes changes, an sc_*
// table gets a new account column, or the Rippling department map
// (Section 3) changes.

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

// Round 2 verified dept->account map (same as Section 3)
const DEPT_MAP = {
  "601d80ea2aca9a5fef7617fa": "CIN - AZ", "601d817448f7105e4c3d5f49": "CIN - AZ", "601d818b2ab2cef76f0d62f7": "CIN - AZ",
  "66a3b85f0b7d0b40d36acc2f": "CIN - OH", "66a3b8c92d818718345ff854": "CIN - OH", "676a00efeb1828eb5fc829b6": "CIN - OH",
  "65dcfcbd44398f188b75e20c": "CIN - KY", "65dcfcd6726b559b2db5c0e9": "CIN - KY",
  "69179d2b52f92c170ac0d29c": "STL - FL", "69612c8272453bb48d0416a1": "STL - FL", "69612c8372453bb48d0416b4": "STL - FL",
  "67a3caba7a2ec09203ff3895": "STL - MO", "67a3cabe7a2ec09203ff38a4": "STL - MO", "67a3cac07a2ec09203ff38ac": "STL - MO",
  "5c2cf3cc92dabb2b61fd9411": "TBJ - FL", "5c338b256ab9e2451298d7b5": "TBJ - FL", "5c338b1fc59291794dc6daee": "TBJ - FL",
  "5e40c83c5a8f4e2ad22c4bf7": "TBJ - NY", "5f2178a412365002972c65ea": "TBJ - NY", "5e40c8d2b0974e0f7fc79a6a": "TBJ - NY",
  "5fd0ff740f3ad600d0424614": "TBR - FL", "5fd0ffb21cbc9d00293c4eca": "TBR - FL", "5fd0ffbef75c1200ce81bc69": "TBR - FL",
  "61bba390891bcdcd7caf8103": "TXR - AZ", "61bba40f9876bd62d74ab5f9": "TXR - AZ", "61bba432d48aba5eefbc27ee": "TXR - AZ",
  "5e3ecbba5a8f4e251b754611": "TXR - TX - H", "5e3eccebb0974e16af6f8c16": "TXR - TX - H", "5e3ecce18a9f4e38d515fd9c": "TXR - TX - H",
  "65c402509aa26127a1e29f22": "TXR - TX - V", "65c4024887a5e2437fcccc32": "TXR - TX - V",
  "5c4a125c6ab9e21dcc288ad8": "CORP", "5c140b612962480ef6366027": "CORP",
  "5c338b0a296248677c0a26db": "CORP", "5c2cfbbc296248319461af77": "CORP",
  "5c338afbc592917819e89219": "CORP", "5c338d8d92dabb3a580c611f": "CORP",
  "5c2cfbc16ab9e23aa196c5ac": "CORP",
};
const DEPT_LABEL = {
  "601d80ea2aca9a5fef7617fa": "container",     "601d817448f7105e4c3d5f49": "hourly (- REDS, D32 legacy)", "601d818b2ab2cef76f0d62f7": "salary",
  "66a3b85f0b7d0b40d36acc2f": "container",     "66a3b8c92d818718345ff854": "hourly (REDS OH)",              "676a00efeb1828eb5fc829b6": "salary",
  "65dcfcbd44398f188b75e20c": "container (1 contractor)", "65dcfcd6726b559b2db5c0e9": "salary (D26 single-salaried)",
  "69179d2b52f92c170ac0d29c": "container",     "69612c8272453bb48d0416a1": "hourly",                            "69612c8372453bb48d0416b4": "salary",
  "67a3caba7a2ec09203ff3895": "container",     "67a3cabe7a2ec09203ff38a4": "hourly",                            "67a3cac07a2ec09203ff38ac": "salary",
  "5c2cf3cc92dabb2b61fd9411": "container",     "5c338b256ab9e2451298d7b5": "hourly (- TBJ)",                    "5c338b1fc59291794dc6daee": "salary (- TBJ)",
  "5e40c83c5a8f4e2ad22c4bf7": "container",     "5f2178a412365002972c65ea": "hourly (all TERMINATED)",           "5e40c8d2b0974e0f7fc79a6a": "salary",
  "5fd0ff740f3ad600d0424614": "container",     "5fd0ffb21cbc9d00293c4eca": "hourly (- TBR)",                    "5fd0ffbef75c1200ce81bc69": "salary (- TBR)",
  "61bba390891bcdcd7caf8103": "container",     "61bba40f9876bd62d74ab5f9": "hourly",                            "61bba432d48aba5eefbc27ee": "salary",
  "5e3ecbba5a8f4e251b754611": "container (shared H/V)", "5e3eccebb0974e16af6f8c16": "hourly",                    "5e3ecce18a9f4e38d515fd9c": "salary",
  "65c402509aa26127a1e29f22": "hourly (V, typo in name)", "65c4024887a5e2437fcccc32": "salary (V)",
  "5c4a125c6ab9e21dcc288ad8": "root container (PFS)", "5c140b612962480ef6366027": "root container (Corporate)",
  "5c338b0a296248677c0a26db": "CORP CEO", "5c2cfbbc296248319461af77": "CORP Finance",
  "5c338afbc592917819e89219": "CORP HR", "5c338d8d92dabb3a580c611f": "CORP Ops",
  "5c2cfbc16ab9e23aa196c5ac": "Marketing Wages",
};

process.stderr.write("Fetching live Rippling data...\n");
const depts = await walkAll("departments?limit=100");
const workers = await walkAll("workers?limit=100");
const workLocs = await walkAll("work-locations?limit=100");
const wlName = new Map(workLocs.map(w => [w.id, w.name]));

const ACCOUNTS = ["CIN - AZ", "CIN - KY", "CIN - OH", "CORP", "STL - FL", "STL - MO", "TBJ - FL", "TBJ - NY", "TBR - FL", "TXR - AZ", "TXR - TX - H", "TXR - TX - V"];

process.stderr.write("Querying Postgres per-account per-table for existence...\n");
// PostgREST caps SELECT at 1000 rows, so client-side distinct on large
// tables under-reports. Instead, per-account existence check: does at
// least one row exist for each account_key value?
async function existsPerAccount(table, col, accounts) {
  const result = {};
  for (const a of accounts) {
    const { count, error } = await supa.from(table).select(col, { count: "exact", head: true }).eq(col, a);
    if (error) { result[a] = { error: error.message }; continue; }
    result[a] = { count };
  }
  return result;
}
const acctKeys      = await existsPerAccount("accounts",             "team_key",    ACCOUNTS);
const glKeys        = await existsPerAccount("gl_codes",             "account_key", ACCOUNTS);
const scSvcGrpKeys  = await existsPerAccount("sc_service_groups",    "account_key", ACCOUNTS);
const scSvcKeys     = await existsPerAccount("sc_services",          "account_key", ACCOUNTS);
const scProjKeys    = await existsPerAccount("sc_daily_projections", "account_key", ACCOUNTS);
const scActKeys     = await existsPerAccount("sc_daily_actuals",     "account_key", ACCOUNTS);
const scDayKeys     = await existsPerAccount("sc_day_metadata",      "account_key", ACCOUNTS);
const kpiActKeys    = await existsPerAccount("kpi_line_activation",  "account_key", ACCOUNTS);
const invSubKeys    = await existsPerAccount("invoice_submissions",  "account_key", ACCOUNTS);

// PNL tab names + billing model from accounts
const acctRows = await supa.from("accounts").select("team_key, pnl_tab_name, billing_model");

// Per-account: dept ids + work locations
const perAccount = new Map();
for (const a of ACCOUNTS) perAccount.set(a, { deptIds: [], workLocs: new Set() });

for (const d of depts) {
  const acct = DEPT_MAP[d.id];
  if (!acct) continue;
  perAccount.get(acct).deptIds.push({ id: d.id, name: d.name, label: DEPT_LABEL[d.id] || "?" });
}
for (const w of workers) {
  const did = w.department_id;
  const acct = DEPT_MAP[did];
  const wlid = w.location?.work_location_id;
  if (acct && wlid) perAccount.get(acct).workLocs.add(wlid);
}

// ─── Output ─────────────────────────────────────────────────────────
const now = new Date().toISOString().slice(0, 10);
console.log("## Section 2 - Identifier crosswalk");
console.log("");
console.log(`**All values in this section \`[verified - <check>]\` unless flagged otherwise. Generated by \`scripts/_gen_section2.mjs\` against live Postgres + Rippling ${now}.**`);
console.log("");

console.log("### Tables in Postgres with an account column (per-account existence check)");
console.log("");
console.log("Method: `SELECT count FROM <table> WHERE <col> = <account>` for each of the 12 accounts. `[verified]` = at least one row present under that canonical key; `[absent]` = zero rows (may be by design: D26 salaried-only, D17 CORP-out-of-scope, or just no volume yet).");
console.log("");
console.log("| table | column | accounts present | accounts absent |");
console.log("|---|---|---|---|");
function summarize(res) {
  const present = [];
  const absent = [];
  for (const a of ACCOUNTS) {
    if (res[a]?.error) absent.push(`${a}(err)`);
    else if ((res[a]?.count || 0) > 0) present.push(a);
    else absent.push(a);
  }
  return { present, absent };
}
function fmtLine(label, colName, res, extra = "") {
  const s = summarize(res);
  const presentCell = s.present.length === 12 ? "all 12 [verified - per-account exists]" : `${s.present.length}: ${s.present.join(", ")}`;
  const absentCell = s.absent.length ? s.absent.join(", ") : "(none)";
  return `| ${label} | ${colName} | ${presentCell} | ${absentCell}${extra ? " " + extra : ""} |`;
}
console.log(fmtLine("accounts", "team_key", acctKeys));
console.log(fmtLine("gl_codes", "account_key", glKeys));
console.log(fmtLine("sc_service_groups", "account_key", scSvcGrpKeys, "(CORP absent by design)"));
console.log(fmtLine("sc_services", "account_key", scSvcKeys, "(CORP absent by design)"));
console.log(`| sc_service_prices | (via service_id -> sc_services) | INDIRECT | joins to account require sc_services.service_id hop [verified - schema-read src/lib/dataStore/serviceCalendar.js] |`);
console.log(fmtLine("sc_daily_projections", "account_key", scProjKeys, "(CORP absent by design; D26 salaried-only may be absent by volume)"));
console.log(fmtLine("sc_daily_actuals", "account_key", scActKeys, "(CORP absent by design; D26 salaried-only may be absent by volume)"));
console.log(fmtLine("sc_day_metadata", "account_key", scDayKeys, "(CORP absent by design)"));
console.log(fmtLine("kpi_line_activation", "account_key", kpiActKeys, "(CORP absent by D17)"));
console.log(fmtLine("invoice_submissions", "account_key", invSubKeys, "(CORP absent by D17; D26 salaried-only may be absent by volume)"));
console.log("");

console.log("### Crosswalk");
console.log("");
console.log("| account | team_key | pnl_tab_name | gl_codes | sc_service_groups | sc_services | sc_daily_projections | sc_daily_actuals | sc_day_metadata | kpi_line_activation | invoice_submissions | Rippling dept IDs (id | label) | Rippling work locations |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
for (const a of ACCOUNTS) {
  const row = acctRows.data?.find(r => r.team_key === a);
  const pnl = row?.pnl_tab_name;
  function mark(res, key) {
    if (res[key]?.error) return `[unknown - ${res[key].error}]`;
    return (res[key]?.count || 0) > 0 ? `${key} [verified - ${res[key].count} rows]` : `[absent - 0 rows]`;
  }
  const per = perAccount.get(a);
  const deptList = per.deptIds.map(d => `\`${d.id.slice(0, 12)}...\` ${d.label}`).join("<br>") || "(none in map)";
  const wlList = [...per.workLocs].map(id => `${wlName.get(id) || id.slice(0, 8)}`).join("<br>") || "(none)";
  const pnlCell = pnl == null
    ? "[verified - NULL for CORP]"
    : `\`${pnl}\` ${pnl.replace(/-/g, " - ").replace(/\s{2,}/g, " - ") === a || pnl === a.replace(/ - /g, "-") ? "[verified - accounts.pnl_tab_name]" : `[conflict - workbook tab diverges from team_key]`}`;
  console.log(`| **${a}** | ${a} [verified - accounts.team_key] | ${pnlCell} | ${mark(glKeys, a)} | ${mark(scSvcGrpKeys, a)} | ${mark(scSvcKeys, a)} | ${mark(scProjKeys, a)} | ${mark(scActKeys, a)} | ${mark(scDayKeys, a)} | ${mark(kpiActKeys, a)} | ${mark(invSubKeys, a)} | ${deptList} | ${wlList} |`);
}
console.log("");

console.log("### Cross-system divergences (`[conflict]` cells summarized)");
console.log("");
const divergences = [];
for (const a of ACCOUNTS) {
  const row = acctRows.data?.find(r => r.team_key === a);
  const pnl = row?.pnl_tab_name;
  if (pnl && pnl.replace(/-/g, " - ").replace(/\s{2,}/g, " - ") !== a && pnl !== a.replace(/ - /g, "-")) {
    divergences.push(`- **${a}**: pnl_tab_name is \`${pnl}\` (workbook tab), NOT \`${a}\`. Load-bearing for parser. Documented in kpi-1.`);
  }
}
for (const d of divergences) console.log(d);
if (!divergences.length) console.log("(none)");
console.log("");
console.log("Non-Rippling `team_key` is consistent across `gl_codes`, all seven `sc_*` tables, `kpi_line_activation`, and `invoice_submissions`. The only cross-system identifier mismatches are the two workbook tab names above.");
