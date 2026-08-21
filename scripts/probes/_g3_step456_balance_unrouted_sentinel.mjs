// G3 Phase 2 Steps 4, 5, 6:
//   4) balance assertion: routed + unrouted + excluded = total rippling_spend
//   5) unrouted (non-excluded) split by category_id top 5
//   6) sentinel unchanged + P8 sentinel gap check (billcom + rippling_spend)
import { createClient } from "@supabase/supabase-js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function pageAll(table, cols, filters = q => q) {
  const rows = [];
  const pageSize = 1000;
  let from = 0;
  while (true) {
    let q = supa.from(table).select(cols).order("id", { ascending: true }).range(from, from + pageSize - 1);
    q = filters(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

function usd(n) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

(async () => {
  // ── Step 4: balance assertion ────────────────────────────────────────
  const allRipp = await pageAll(
    "purchasing_actuals",
    "id, amount, gl_line_code, excluded, account_key",
    q => q.eq("source", "rippling_spend"),
  );
  console.log(`[step4] total rippling_spend actuals rows: ${allRipp.length}`);

  let routed = 0, unrouted = 0, excludedAmt = 0;
  let routedRows = 0, unroutedRows = 0, excludedRows = 0;
  for (const r of allRipp) {
    const amt = Number(r.amount) || 0;
    if (r.excluded) {
      excludedAmt += amt;
      excludedRows++;
    } else if (r.gl_line_code == null) {
      unrouted += amt;
      unroutedRows++;
    } else {
      routed += amt;
      routedRows++;
    }
  }
  const sum = routed + unrouted + excludedAmt;
  const TOTAL_SPEC = 2482310.31;

  console.log(`\n--- Step 4 balance assertion (rippling_spend) ---`);
  console.log(`routed (non-excluded, non-null gl):  ${usd(routed).padStart(16)}  (${routedRows} rows)`);
  console.log(`unrouted (non-excluded, null gl):    ${usd(unrouted).padStart(16)}  (${unroutedRows} rows)`);
  console.log(`excluded:                            ${usd(excludedAmt).padStart(16)}  (${excludedRows} rows)`);
  console.log(`--------------------------------------------------`);
  console.log(`SUM:                                 ${usd(sum).padStart(16)}`);
  console.log(`spec projection (rippling_spend $):  ${usd(TOTAL_SPEC).padStart(16)}`);
  console.log(`delta from spec:                     ${usd(sum - TOTAL_SPEC).padStart(16)}`);

  // ── Step 5: unrouted split by category_id ────────────────────────────
  // spend_category_map link: purchasing_actuals has no direct category_id
  // per line, but the derive uses rippling_raw_spend_lines_latest.
  // Join via source_line_id → external_id → rippling_raw_spend_lines_latest.category_id
  console.log(`\n--- Step 5 unrouted (non-excluded, null gl) split ---`);
  console.log(`Total: ${usd(unrouted)} across ${unroutedRows} rows`);

  const unroutedLineIds = allRipp
    .filter(r => !r.excluded && r.gl_line_code == null)
    .map(r => r.id);
  // Need source_line_id off actuals to join to raw lines
  const actualsFull = await pageAll(
    "purchasing_actuals",
    "id, amount, source_line_id",
    q => q.eq("source", "rippling_spend").eq("excluded", false).is("gl_line_code", null),
  );
  console.log(`[step5] unrouted actuals with source_line_id: ${actualsFull.length}`);

  // source_line_id format is `rippling_spend:{rippling_id}`; strip prefix
  const ripplingIds = actualsFull
    .map(r => (r.source_line_id?.startsWith("rippling_spend:") ? r.source_line_id.slice("rippling_spend:".length) : null))
    .filter(Boolean);
  const uniqueRipIds = [...new Set(ripplingIds)];
  console.log(`[step5] unique rippling_ids: ${uniqueRipIds.length}`);

  // Load raw lines in chunks by rippling_id
  const rawByRipId = new Map();
  const chunkSize = 200;
  for (let i = 0; i < uniqueRipIds.length; i += chunkSize) {
    const chunk = uniqueRipIds.slice(i, i + chunkSize);
    const { data, error } = await supa
      .from("rippling_raw_spend_lines_latest")
      .select("rippling_id, category_id")
      .in("rippling_id", chunk);
    if (error) throw new Error(error.message);
    for (const row of data || []) rawByRipId.set(row.rippling_id, row.category_id);
  }
  console.log(`[step5] raw lines matched: ${rawByRipId.size} of ${uniqueRipIds.length}`);

  // Aggregate by category_id
  const byCat = new Map();
  for (const r of actualsFull) {
    const ripId = r.source_line_id?.startsWith("rippling_spend:") ? r.source_line_id.slice("rippling_spend:".length) : null;
    const catId = rawByRipId.get(ripId) || "(no-match)";
    const cur = byCat.get(catId) || { rows: 0, amt: 0 };
    cur.rows++;
    cur.amt += Number(r.amount) || 0;
    byCat.set(catId, cur);
  }
  const sorted = [...byCat.entries()].sort((a, b) => b[1].amt - a[1].amt);

  // Load category names via spend_category_map + name resolution
  const catIds = sorted.map(([id]) => id).filter(id => id !== "(no-match)");
  // No name column on scm; use label which was noted "null" text. Try both.
  const { data: scmRows } = await supa
    .from("spend_category_map")
    .select("category_id, label, gl_line_code")
    .in("category_id", catIds);
  const scmByCat = new Map((scmRows || []).map(r => [r.category_id, r]));

  // No category_name column on the raw view; try to resolve names via
  // the CSV majority-join file if it exists on disk (best-effort).
  const nameByCat = new Map();
  try {
    const fs = await import("node:fs");
    const csvPath = "/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv";
    if (fs.existsSync(csvPath)) {
      const raw = fs.readFileSync(csvPath, "utf8");
      // We'll only pull the name if it's easy - defer to caller if not.
      // (parse deferred - the applier already prints all 54 names.)
    }
  } catch { /* noop */ }

  console.log(`\nTop 5 unrouted category_ids by dollars:`);
  console.log(`# | category_id                                | rows |          amount | name`);
  for (let i = 0; i < Math.min(5, sorted.length); i++) {
    const [catId, agg] = sorted[i];
    const nm = nameByCat.get(catId) || "(no-name-or-not-in-sample)";
    const scm = scmByCat.get(catId);
    const prov = scm ? `prov=${scm.gl_line_code == null ? "(null gl)" : scm.gl_line_code}` : "(no scm row)";
    console.log(`${i + 1} | ${catId.padEnd(43)} | ${String(agg.rows).padStart(4)} | ${usd(agg.amt).padStart(15)} | ${nm}  ${prov}`);
  }

  // ── Step 6a: sentinel unchanged ──────────────────────────────────────
  // TBR - FL P8 gl 3200.1 billcom only = $39,373.74
  // P8 = FY_START (2025-12-29) + 7 periods of 28d each; P8 covers days
  // 196..223 -> 2026-07-13 to 2026-08-09 inclusive.
  const P8_START = "2026-07-13";
  const P8_END   = "2026-08-09";
  const { data: sentRows, error: sentErr } = await supa
    .from("purchasing_actuals")
    .select("amount")
    .eq("account_key", "TBR - FL")
    .gte("txn_date", P8_START)
    .lte("txn_date", P8_END)
    .eq("gl_line_code", "3200.1")
    .eq("source", "billcom")
    .eq("excluded", false);
  if (sentErr) throw new Error(sentErr.message);
  const sentinelBillcom = (sentRows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  console.log(`\n--- Step 6 sentinel + P8 gap (P8 = ${P8_START} .. ${P8_END}, txn_date) ---`);
  console.log(`Sentinel (TBR-FL P8 3200.1 billcom, non-excluded): ${usd(sentinelBillcom)} (spec=$39,373.74)`);
  console.log(`  delta vs spec: ${usd(sentinelBillcom - 39373.74)}`);

  // ── Step 6b: P8 gap after mapping (all sources) ──────────────────────
  const { data: p8Rows, error: p8Err } = await supa
    .from("purchasing_actuals")
    .select("amount, source")
    .eq("account_key", "TBR - FL")
    .gte("txn_date", P8_START)
    .lte("txn_date", P8_END)
    .eq("gl_line_code", "3200.1")
    .eq("excluded", false);
  if (p8Err) throw new Error(p8Err.message);
  const p8AllSources = (p8Rows || []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const bySource = {};
  for (const r of p8Rows || []) {
    bySource[r.source] ??= 0;
    bySource[r.source] += Number(r.amount) || 0;
  }
  const PL_ACTUAL = 40884.06;
  console.log(`\nEngine P8 3200.1 all-source (non-excluded): ${usd(p8AllSources)}`);
  for (const [src, amt] of Object.entries(bySource)) {
    console.log(`  ${src}: ${usd(amt)}`);
  }
  console.log(`P&L actual: ${usd(PL_ACTUAL)}`);
  console.log(`gap (engine - P&L): ${usd(p8AllSources - PL_ACTUAL)}  (spec expected engine trails P&L by $1,510.32)`);
})();
