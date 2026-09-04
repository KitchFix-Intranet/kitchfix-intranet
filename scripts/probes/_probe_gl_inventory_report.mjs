#!/usr/bin/env node
// scripts/probes/_probe_gl_inventory_report.mjs
//
// Kevin ruling PR-B item 6 (2026-09-03): report the full gl-code
// inventory per parent bucket:
//   - which codes appear in our purchasing_actuals data
//   - which codes appear in our kpi_budgets (purchasing side)
//   - which codes the P8 finance workbook names (our KNOWN_LABELS)
//   - which appear in one but not the other (findings for Sebastian)
//
// USAGE
//   node --env-file=.env.local scripts/probes/_probe_gl_inventory_report.mjs

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log(`SUPABASE_URL: ${url ? "PRESENT" : "ABSENT"}  SERVICE_KEY: ${key ? "PRESENT" : "ABSENT"}`);
  process.exit(1);
}
const supa = createClient(url, key);

const KNOWN_LABELS = {
  "3200.1": "General Food",
  "3200.2": "Resale Food",
  "3400.1": "Packaging",
  "3400.2": "Supplies",
  "3400.5": "Linen",
  "3500.2": "Vehicle Insurance",
  "3500.3": "Leased Vehicle",
  "3500.4": "Fuel",
  "3500.5": "Vehicle Repair & Maintenance",
};

const PARENTS = ["3200", "3400", "3500"];

async function main() {
  console.log(`# gl-code inventory · ${new Date().toISOString()}`);
  console.log("");

  // pull EVERY distinct gl_line_code from purchasing_actuals (FY range)
  const actualsCodes = new Set();
  const actualsByAcct = new Map(); // gl -> Set(account)
  let from = 0;
  while (true) {
    const q = await supa
      .from("purchasing_actuals")
      .select("gl_line_code, account_key, amount")
      .gte("txn_date", "2025-12-29")
      .lte("txn_date", "2026-12-27")
      .range(from, from + 999);
    if (q.error) { console.log(q.error); return; }
    for (const r of q.data || []) {
      const gl = String(r.gl_line_code || "");
      if (!gl) continue;
      const p = PARENTS.find(x => gl.startsWith(x) && gl !== x);
      if (!p) continue;
      actualsCodes.add(gl);
      if (!actualsByAcct.has(gl)) actualsByAcct.set(gl, new Map());
      const m = actualsByAcct.get(gl);
      m.set(r.account_key, (m.get(r.account_key) || 0) + Number(r.amount || 0));
    }
    if ((q.data || []).length < 1000) break;
    from += 1000;
  }

  // pull every distinct gl in kpi_budgets under the three parents
  const budgetCodes = new Set();
  const budgetTotal = new Map();
  from = 0;
  while (true) {
    const q = await supa
      .from("kpi_budgets")
      .select("line_code, amount")
      .eq("fiscal_year", 2026)
      .range(from, from + 999);
    if (q.error) { console.log(q.error); return; }
    for (const r of q.data || []) {
      const gl = String(r.line_code || "");
      if (!gl) continue;
      const p = PARENTS.find(x => gl.startsWith(x) && gl !== x);
      if (!p) continue;
      budgetCodes.add(gl);
      budgetTotal.set(gl, (budgetTotal.get(gl) || 0) + Number(r.amount || 0));
    }
    if ((q.data || []).length < 1000) break;
    from += 1000;
  }

  console.log("## Coverage by parent\n");
  for (const parent of PARENTS) {
    console.log(`### ${parent}.x\n`);
    const all = new Set([
      ...[...actualsCodes].filter(g => g.startsWith(parent) && g !== parent),
      ...[...budgetCodes].filter(g => g.startsWith(parent) && g !== parent),
      ...Object.keys(KNOWN_LABELS).filter(g => g.startsWith(parent) && g !== parent),
    ]);
    const sorted = [...all].sort();
    console.log("| gl_line_code | Workbook label | In actuals? | In budgets? | Total FY actuals | Total FY budget |");
    console.log("|---|---|---:|---:|---:|---:|");
    for (const gl of sorted) {
      const inAct = actualsCodes.has(gl) ? "yes" : "no";
      const inBud = budgetCodes.has(gl) ? "yes" : "no";
      const label = KNOWN_LABELS[gl] || "**UNMAPPED**";
      let actTot = 0;
      for (const [_, amt] of (actualsByAcct.get(gl) || new Map())) actTot += amt;
      const budTot = budgetTotal.get(gl) || 0;
      console.log(`| ${gl} | ${label} | ${inAct} | ${inBud} | $${actTot.toFixed(2)} | $${budTot.toFixed(2)} |`);
    }
    console.log("");
  }

  console.log("## Findings for Sebastian\n");
  const unmappedInActuals = [...actualsCodes].filter(g => !KNOWN_LABELS[g]).sort();
  const unmappedInBudgets = [...budgetCodes].filter(g => !KNOWN_LABELS[g]).sort();
  const unmapped = new Set([...unmappedInActuals, ...unmappedInBudgets]);
  console.log("### Unmapped gl_line_codes (in our data, not in the P8 workbook labels)\n");
  if (unmapped.size === 0) console.log("_None_");
  else for (const gl of [...unmapped].sort()) {
    console.log(`- \`${gl}\` (actuals: ${actualsCodes.has(gl) ? "yes" : "no"}, budgets: ${budgetCodes.has(gl) ? "yes" : "no"})`);
  }

  console.log("\n### Workbook-listed codes we never see (in KNOWN_LABELS but zero data)\n");
  const missing = Object.keys(KNOWN_LABELS).filter(g => !actualsCodes.has(g) && !budgetCodes.has(g)).sort();
  if (missing.length === 0) console.log("_None_");
  else for (const gl of missing) console.log(`- \`${gl}\` (${KNOWN_LABELS[gl]})`);
}

main().catch(e => { console.error(e); process.exit(1); });
