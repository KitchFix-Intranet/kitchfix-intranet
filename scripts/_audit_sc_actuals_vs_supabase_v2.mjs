// V2 corrected: properly paginate the PG read so we see ALL 6398 actuals rows.
// V1 was capped at ~1000 rows and reported thousands of false-positive "missing"
// entries. This version uses chunked .range() calls to walk the full table.
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const TMP_JSON = "/tmp/_sc_audit_xlsx_dump.json";
const HELPER = "/Users/kevinfietek/dev/kitchfix-intranet/scripts/_audit_sc_xlsx_dump.py";
const ACCOUNTS = ["CIN - AZ", "CIN - KY", "STL - FL", "TBJ - FL", "TBJ - NY", "TBR - FL", "TXR - AZ"];

console.log("Step 1: dump xlsx Actuals tabs…");
execFileSync("python3", [HELPER, TMP_JSON], { stdio: "inherit" });
const xlsxData = JSON.parse(readFileSync(TMP_JSON, "utf-8"));

console.log("Step 2: load sc_services + sc_service_groups…");
const { data: groups } = await supa
  .from("sc_service_groups").select("id, account_key, group_name")
  .in("account_key", ACCOUNTS).is("deleted_at", null);
const { data: services } = await supa
  .from("sc_services").select("id, account_key, group_id, service_name")
  .in("account_key", ACCOUNTS).is("deleted_at", null);
const groupNameById = new Map((groups || []).map((g) => [g.id, g.group_name]));
const svcById = new Map();
const svcKeyToId = new Map();
for (const s of services || []) {
  const group = groupNameById.get(s.group_id) || "?";
  svcById.set(s.id, { account: s.account_key, group, service: s.service_name });
  svcKeyToId.set(`${s.account_key}::${group}::${s.service_name}`, s.id);
}

console.log("Step 3: paginate sc_daily_actuals…");
const pgByKey = new Map(); // "account::group::service::date" -> count
const pgDatesByAccount = new Map();
for (const acc of ACCOUNTS) pgDatesByAccount.set(acc, new Set());

let from = 0;
const PAGE = 1000;
let total = 0;
while (true) {
  const { data, error } = await supa
    .from("sc_daily_actuals")
    .select("account_key, service_id, service_date, actual_count, id")
    .in("account_key", ACCOUNTS)
    .range(from, from + PAGE - 1)
    .order("service_date", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) break;
  for (const r of data) {
    const meta = svcById.get(r.service_id);
    if (!meta) continue;
    const k = `${r.account_key}::${meta.group}::${meta.service}::${r.service_date}`;
    pgByKey.set(k, Number(r.actual_count));
    pgDatesByAccount.get(r.account_key).add(r.service_date);
  }
  total += data.length;
  if (data.length < PAGE) break;
  from += PAGE;
}
console.log(`  fetched ${total} rows from PG`);

console.log("Step 4: diff…\n");
console.log("=".repeat(90));
console.log("  Missing-from-Supabase audit per account (CORRECTED)");
console.log("=".repeat(90));

const summary = [];
let totalMissingDates = 0;
let totalMissingEntries = 0;

for (const account of ACCOUNTS) {
  const acctXlsx = xlsxData[account];
  if (!acctXlsx) continue;

  const xlsxDates = new Set();
  const xlsxEntries = [];
  for (const row of acctXlsx.rows) {
    xlsxDates.add(row.date);
    for (const e of row.entries) {
      xlsxEntries.push({ date: row.date, group: e.group, service: e.service, value: e.value });
    }
  }
  const pgDates = pgDatesByAccount.get(account);

  const datesMissingInPG = [...xlsxDates].filter((d) => !pgDates.has(d)).sort();
  const datesOnlyInPG = [...pgDates].filter((d) => !xlsxDates.has(d)).sort();
  const missingEntries = [];
  const valueMismatches = [];
  for (const e of xlsxEntries) {
    const k = `${account}::${e.group}::${e.service}::${e.date}`;
    if (!pgByKey.has(k)) {
      missingEntries.push(e);
    } else if (Number(e.value) !== pgByKey.get(k)) {
      valueMismatches.push({ ...e, pg: pgByKey.get(k) });
    }
  }

  console.log(`\n── ${account} ──`);
  console.log(`  xlsx dates: ${xlsxDates.size}    PG dates: ${pgDates.size}`);
  console.log(`  dates missing from PG: ${datesMissingInPG.length}    dates only in PG: ${datesOnlyInPG.length}`);
  console.log(`  xlsx entries: ${xlsxEntries.length}    PG matched entries: ${[...pgByKey.keys()].filter(k => k.startsWith(account + "::")).length}`);
  console.log(`  missing entries (xlsx has value, PG has no row): ${missingEntries.length}`);
  console.log(`  value mismatches: ${valueMismatches.length}`);

  totalMissingDates += datesMissingInPG.length;
  totalMissingEntries += missingEntries.length;
  summary.push({ account, xlsxDates: xlsxDates.size, pgDates: pgDates.size,
    missingDates: datesMissingInPG.length, missingEntries: missingEntries.length,
    mismatches: valueMismatches.length });

  if (datesMissingInPG.length > 0) {
    console.log(`\n  ⚠ Dates with NO PG rows but xlsx HAS values:`);
    for (const d of datesMissingInPG) {
      const nzEntries = xlsxEntries.filter((e) => e.date === d && Number(e.value) > 0);
      if (nzEntries.length === 0) {
        // All zeros - probably operator entered explicit 0s, won't bother listing
        const allEntries = xlsxEntries.filter((e) => e.date === d);
        console.log(`    ${d}: all-zeros row (${allEntries.length} services at 0)`);
        continue;
      }
      const summary_line = nzEntries.map((e) => `${e.group}/${e.service}=${e.value}`).join(", ");
      console.log(`    ${d}: ${summary_line.slice(0, 200)}${summary_line.length > 200 ? "…" : ""}`);
    }
  }

  // Partial-day gaps
  const partial = missingEntries.filter((e) => pgDates.has(e.date) && Number(e.value) > 0);
  if (partial.length > 0) {
    console.log(`\n  ⚠ Partial gaps (PG has the date but is missing services with non-zero values):`);
    for (const e of partial.slice(0, 20)) {
      console.log(`    ${e.date} ${e.group}/${e.service}=${e.value}`);
    }
    if (partial.length > 20) console.log(`    ... (+${partial.length - 20} more)`);
  }

  if (valueMismatches.length > 0) {
    console.log(`\n  ⚠ Value mismatches (xlsx differs from PG):`);
    for (const m of valueMismatches.slice(0, 15)) {
      console.log(`    ${m.date} ${m.group}/${m.service}: xlsx=${m.value} pg=${m.pg}`);
    }
    if (valueMismatches.length > 15) console.log(`    ... (+${valueMismatches.length - 15} more)`);
  }
}

console.log("\n" + "=".repeat(90));
console.log("  Summary");
console.log("=".repeat(90));
console.log(`  ${"account".padEnd(15)} ${"xlsx_d".padStart(7)} ${"pg_d".padStart(6)} ${"miss_d".padStart(7)} ${"miss_e".padStart(7)} ${"vmm".padStart(5)}`);
console.log(`  ${"-".repeat(15)} ${"-".repeat(7)} ${"-".repeat(6)} ${"-".repeat(7)} ${"-".repeat(7)} ${"-".repeat(5)}`);
for (const s of summary) {
  console.log(`  ${s.account.padEnd(15)} ${String(s.xlsxDates).padStart(7)} ${String(s.pgDates).padStart(6)} ${String(s.missingDates).padStart(7)} ${String(s.missingEntries).padStart(7)} ${String(s.mismatches).padStart(5)}`);
}
console.log(`  ${"TOTAL".padEnd(15)} ${"".padStart(7)} ${"".padStart(6)} ${String(totalMissingDates).padStart(7)} ${String(totalMissingEntries).padStart(7)}`);

try { unlinkSync(TMP_JSON); } catch {}
