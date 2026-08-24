// Probe: replicate loadPurchasingBudgets EXACTLY and see how many rows return
// for ALL vs single account. Also probe with .range() to see if pagination
// changes the answer.

import { createClient } from "@supabase/supabase-js";

const missing = [];
if (process.env.SUPABASE_URL === undefined) missing.push("SUPABASE_URL");
if (process.env.SUPABASE_SERVICE_ROLE_KEY === undefined) missing.push("SUPABASE_SERVICE_ROLE_KEY");
if (missing.length) {
  console.error("ENV PREFLIGHT FAIL:", missing.join(", "));
  process.exit(2);
}
console.log("ENV PREFLIGHT OK");

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const ALL_MEMBERS = [
  "CIN - AZ", "CIN - KY", "CIN - OH", "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY", "TBR - FL", "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];

async function loadAsRoute(accounts) {
  const q = await supa.from("kpi_budgets")
    .select("account_key, line_code, period_no, amount")
    .eq("fiscal_year", 2026)
    .in("account_key", accounts)
    .neq("line_code", "3100.1")
    .neq("line_code", "3100.2");
  return q;
}

async function loadPaginated(accounts) {
  const out = [];
  let from = 0;
  const PS = 1000;
  while (true) {
    const q = await supa.from("kpi_budgets")
      .select("account_key, line_code, period_no, amount")
      .eq("fiscal_year", 2026)
      .in("account_key", accounts)
      .neq("line_code", "3100.1")
      .neq("line_code", "3100.2")
      .order("account_key", { ascending: true })
      .order("line_code", { ascending: true })
      .order("period_no", { ascending: true })
      .range(from, from + PS - 1);
    if (q.error) return { error: q.error };
    const rows = q.data || [];
    for (const r of rows) out.push(r);
    if (rows.length < PS) break;
    from += PS;
  }
  return { data: out };
}

async function loadCount(accounts) {
  const q = await supa.from("kpi_budgets")
    .select("*", { count: "exact", head: true })
    .eq("fiscal_year", 2026)
    .in("account_key", accounts)
    .neq("line_code", "3100.1")
    .neq("line_code", "3100.2");
  return q;
}

async function main() {
  // Total row count for ALL
  const cAll = await loadCount(ALL_MEMBERS);
  console.log("kpi_budgets count for ALL (FY2026, excl 3100.1/3100.2):", cAll.count);

  // Row count for TBR - FL
  const cTbr = await loadCount(["TBR - FL"]);
  console.log("kpi_budgets count for TBR - FL:", cTbr.count);

  // What route method returns (as-is)
  const routeAll = await loadAsRoute(ALL_MEMBERS);
  console.log("\nroute-method ALL: rows =", routeAll.data?.length);
  const routeTbr = await loadAsRoute(["TBR - FL"]);
  console.log("route-method TBR - FL: rows =", routeTbr.data?.length);

  // Paginated
  const pagAll = await loadPaginated(ALL_MEMBERS);
  console.log("\npaginated ALL: rows =", pagAll.data?.length);

  // Check: does route-method ALL truncate?
  console.log("\nSHORTAGE (paginated - route):", (pagAll.data?.length || 0) - (routeAll.data?.length || 0));

  // Rebuild budgetForRange with paginated data
  const byLine = new Map();
  for (const r of pagAll.data || []) {
    const gl = String(r.line_code);
    const acct = String(r.account_key);
    if (!byLine.has(gl)) byLine.set(gl, new Map());
    if (!byLine.get(gl).has(acct)) byLine.get(gl).set(acct, new Map());
    byLine.get(gl).get(acct).set(Number(r.period_no), Number(r.amount));
  }

  const FY_START_ISO = "2025-12-29";
  const MS_PER_DAY = 86400000;
  const DAYS_PER_PERIOD = 28;
  function parseISO(iso) {
    const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  }
  function periodOf(w) {
    const d = parseISO(w);
    const fy = parseISO(FY_START_ISO);
    if (!d || !fy) return null;
    const days = Math.floor((d.getTime() - fy.getTime()) / MS_PER_DAY);
    if (days < 0) return null;
    const p = Math.floor(days / DAYS_PER_PERIOD) + 1;
    if (p < 1 || p > 13) return null;
    return p;
  }
  function weekStartsInRange(s, e) {
    const rs = parseISO(s), re = parseISO(e), fy = parseISO(FY_START_ISO);
    if (!rs || !re || !fy || rs > re) return [];
    const rsMs = rs.getTime(), reMs = re.getTime(), fyMs = fy.getTime();
    const idxStart = Math.max(0, Math.floor((rsMs - 6 * MS_PER_DAY - fyMs) / (7 * MS_PER_DAY)));
    const out = [];
    for (let i = idxStart; ; i += 1) {
      const wStartMs = fyMs + i * 7 * MS_PER_DAY;
      if (wStartMs > reMs) break;
      const wEndMs = wStartMs + 6 * MS_PER_DAY;
      if (wEndMs >= rsMs) out.push(new Date(wStartMs).toISOString().slice(0, 10));
    }
    return out;
  }
  function budgetForRange({ byLine, glLineCode, members, start, end }) {
    const weeks = weekStartsInRange(start, end);
    if (weeks.length === 0) return 0;
    const perLine = byLine.get(glLineCode);
    if (!perLine) return 0;
    let total = 0;
    for (const w of weeks) {
      const p = periodOf(w);
      if (p == null) continue;
      for (const m of members) {
        const byAcct = perLine.get(m);
        if (!byAcct) continue;
        const amt = byAcct.get(p);
        if (amt == null) continue;
        total += amt / 4;
      }
    }
    return Math.round(total * 100) / 100;
  }

  const KPI_GLS = [...byLine.keys()].filter(gl => gl.startsWith("3200") || gl.startsWith("3400") || gl.startsWith("3500"));
  let kpiAll = 0;
  for (const gl of KPI_GLS) {
    kpiAll += budgetForRange({ byLine, glLineCode: gl, members: ALL_MEMBERS, start: "2025-12-29", end: "2026-08-24" });
  }
  console.log("\nWith paginated data - INDEPENDENT ALL kpi-only budget:", kpiAll.toFixed(2));

  let kpiTbr = 0;
  for (const gl of KPI_GLS) {
    kpiTbr += budgetForRange({ byLine, glLineCode: gl, members: ["TBR - FL"], start: "2025-12-29", end: "2026-08-24" });
  }
  console.log("With paginated data - INDEPENDENT TBR-FL kpi-only budget:", kpiTbr.toFixed(2));

  // Compare route (unpaginated) result if we build byLine from truncated result
  const byLineTrunc = new Map();
  for (const r of routeAll.data || []) {
    const gl = String(r.line_code);
    const acct = String(r.account_key);
    if (!byLineTrunc.has(gl)) byLineTrunc.set(gl, new Map());
    if (!byLineTrunc.get(gl).has(acct)) byLineTrunc.get(gl).set(acct, new Map());
    byLineTrunc.get(gl).get(acct).set(Number(r.period_no), Number(r.amount));
  }
  let kpiAllTrunc = 0;
  for (const gl of [...byLineTrunc.keys()].filter(x => x.startsWith("3200") || x.startsWith("3400") || x.startsWith("3500"))) {
    kpiAllTrunc += budgetForRange({ byLine: byLineTrunc, glLineCode: gl, members: ALL_MEMBERS, start: "2025-12-29", end: "2026-08-24" });
  }
  console.log("\nWith UNPAGINATED (route method) - ALL kpi-only budget:", kpiAllTrunc.toFixed(2));

  // Show account coverage in unpaginated result vs paginated
  const acctCntRoute = new Map();
  for (const r of routeAll.data || []) acctCntRoute.set(r.account_key, (acctCntRoute.get(r.account_key) || 0) + 1);
  console.log("\nRoute-method rows per account_key:");
  for (const [k, v] of [...acctCntRoute.entries()].sort()) console.log(`  ${k}: ${v}`);

  const acctCntPag = new Map();
  for (const r of pagAll.data || []) acctCntPag.set(r.account_key, (acctCntPag.get(r.account_key) || 0) + 1);
  console.log("\nPaginated rows per account_key:");
  for (const [k, v] of [...acctCntPag.entries()].sort()) console.log(`  ${k}: ${v}`);

  // Show breakdown for 3200.1 across all accounts (paginated)
  console.log("\n=== 3200.1 amounts per (acct, period) - paginated ===");
  const perLine3200_1 = byLine.get("3200.1");
  if (perLine3200_1) {
    for (const [acct, byPer] of [...perLine3200_1.entries()].sort()) {
      const total = [...byPer.values()].reduce((s,v) => s+v, 0);
      console.log(`  ${acct}: annual $${total.toFixed(2)}, periods: ${[...byPer.keys()].sort((a,b)=>a-b).join(",")}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
