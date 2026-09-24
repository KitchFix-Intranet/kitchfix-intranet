// FIN-2027 W5 · Supabase state check. READ ONLY.
// Correct schema: pnl_actuals has (account_key, fiscal_year, period_no,
// line_code, budget, actual, source_ref, verified_at, ...). Section
// lives on kpi_lines. Contribution margin = revenue - cogs - sga
// computed by joining.
//
// Usage: node --env-file=.env.local scripts/probes/_probe_fin2027_w5_state.mjs

import { createClient } from "@supabase/supabase-js";

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const fmt$ = n => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
async function pageAll(table, sel, filters = q => q) {
  const out = [];
  let from = 0;
  while (true) {
    const q = filters(s.from(table).select(sel).range(from, from + 999));
    const r = await q;
    if (r.error) throw r.error;
    out.push(...(r.data || []));
    if ((r.data || []).length < 1000) break;
    from += 1000;
  }
  return out;
}

// ── kpi_lines · section map
const kl = await pageAll("kpi_lines", "line_code, section, line_name");
const sectionOf = new Map(kl.map(r => [r.line_code, r.section]));
console.log(`=== kpi_lines · ${kl.length} rows · section distribution ===`);
const byS = new Map();
for (const r of kl) byS.set(r.section, (byS.get(r.section) || 0) + 1);
for (const [k, v] of byS) console.log(`  ${k}: ${v}`);

// ── pnl_actuals · full census + join to kpi_lines for section
console.log("\n=== pnl_actuals · fiscal year × account census ===");
const pa = await pageAll("pnl_actuals", "fiscal_year, account_key, line_code, period_no, actual");
console.log(`  ${pa.length} rows`);
const byYear = new Map();
for (const r of pa) {
  const y = r.fiscal_year;
  if (!byYear.has(y)) byYear.set(y, { accts: new Set(), rows: 0 });
  byYear.get(y).accts.add(r.account_key);
  byYear.get(y).rows += 1;
}
for (const [y, v] of [...byYear.entries()].sort()) {
  console.log(`\n  FY${y}: ${v.accts.size} accounts · ${v.rows} rows`);
  for (const a of [...v.accts].sort()) console.log(`    ${a}`);
}

// ── pnl_actuals · distinct line_codes present, grouped by section
console.log("\n=== pnl_actuals · distinct line_codes present, grouped by kpi_lines section ===");
const uniqCodes = new Set(pa.map(r => r.line_code));
const bySection = new Map([["revenue", []], ["cogs", []], ["sga", []], ["(unknown)", []]]);
for (const c of [...uniqCodes].sort()) {
  const sec = sectionOf.get(c) || "(unknown)";
  bySection.get(sec).push(c);
}
for (const [sec, codes] of bySection) console.log(`  ${sec}: ${codes.length}  [${codes.join(", ")}]`);

// ── Contribution margin per year, per account, YTD P9 actual
for (const year of [2024, 2025, 2026]) {
  console.log(`\n=== FY${year} · contribution margin per account (period_no ≤ 9, actual) ===`);
  const rows = pa.filter(r => r.fiscal_year === year && (r.period_no ?? 99) <= 9);
  const by = new Map();
  for (const r of rows) {
    const k = r.account_key;
    const sec = sectionOf.get(r.line_code) || "(unknown)";
    if (!by.has(k)) by.set(k, { revenue: 0, cogs: 0, sga: 0, unknown: 0 });
    const key = sec === "(unknown)" ? "unknown" : sec;
    by.get(k)[key] += Number(r.actual || 0);
  }
  let siteRev = 0, siteCogs = 0, siteSga = 0, corpSga = 0;
  for (const [k, v] of [...by.entries()].sort()) {
    const cm = v.revenue - v.cogs - v.sga;
    console.log(`    ${k.padEnd(20)}  rev=${fmt$(v.revenue).padStart(14)}  cogs=${fmt$(v.cogs).padStart(14)}  sga=${fmt$(v.sga).padStart(14)}  cm=${fmt$(cm).padStart(14)}${v.unknown ? "  UNK="+fmt$(v.unknown) : ""}`);
    if (k === "CORP") corpSga += v.sga;
    else { siteRev += v.revenue; siteCogs += v.cogs; siteSga += v.sga; }
  }
  const siteCm = siteRev - siteCogs - siteSga;
  console.log(`    ${"".padEnd(20)}  ${"site CM".padStart(56)} = ${fmt$(siteCm).padStart(14)}`);
  console.log(`    ${"".padEnd(20)}  ${"CORP SG&A".padStart(56)} = ${fmt$(corpSga).padStart(14)}`);
  console.log(`    ${"".padEnd(20)}  ${"net income (R-22)".padStart(56)} = ${fmt$(siteCm - corpSga).padStart(14)}`);
}
