// PR 1b Part C + D verification. READ-ONLY.
//
// Part C: kpi_budgets coverage for TXR - TX - V. Report per-period
// amounts for 3200.1, 3200.2, 3400.1, 3400.2, 3400.5, 3500.3.
// Confirm that removing the account from the purchasing envelope
// exclusion resolves to the expected FY2026 totals (food $102,211,
// packaging $16,040, vehicle $1,750).
//
// Part D: the verification INV-P9 skipped. For CIN - OH, STL - FL,
// STL - MO, FYTD:
//   - spend by GL prefix: 32xx, 34xx, 35xx, 13xx, split by source
//   - any dollars in 32xx or 34xx at these three accounts, with
//     counts, dates, and vendors
//
// Fun Money exception (per INV-P9 #730): STL - FL Fun Money is
// gl_line_code = '3200.2 Resale Food' and is legitimately KitchFix-
// borne. Report it separately, not as a finding.
//
// NO WRITES. No mutations. Presence-check env, do not echo values.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.error(`env SUPABASE_URL: ${url ? "PRESENT" : "ABSENT"}`);
console.error(`env SUPABASE_SERVICE_ROLE_KEY: ${key ? "PRESENT" : "ABSENT"}`);
if (!url || !key) { console.error("missing env"); process.exit(2); }
const supa = createClient(url, key, { auth: { persistSession: false } });

const FY = 2026;
const FY_START = "2025-12-29";
const TODAY = new Date().toISOString().slice(0, 10);

const PASS_THROUGH_ACCOUNTS = ["CIN - OH", "STL - FL", "STL - MO"];
const TXV = "TXR - TX - V";
const TXV_LINES = ["3200.1", "3200.2", "3400.1", "3400.2", "3400.5", "3500.3"];

function fmt(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function paginate(builder, pageSize = 1000) {
  const out = [];
  let from = 0;
  while (true) {
    const q = await builder.range(from, from + pageSize - 1);
    if (q.error) throw q.error;
    const rows = q.data || [];
    for (const r of rows) out.push(r);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// ─── Part C: TXR - TX - V kpi_budgets coverage ───────────────────────

async function partC() {
  console.log("\n═════════════════════════════════════════════════════════");
  console.log("PART C  TXR - TX - V purchasing budget resolution");
  console.log("═════════════════════════════════════════════════════════\n");

  // Full FY2026 budget rows for TXR - TX - V.
  const q = await supa.from("kpi_budgets")
    .select("account_key, line_code, period_no, amount")
    .eq("fiscal_year", FY)
    .eq("account_key", TXV)
    .order("line_code")
    .order("period_no");
  if (q.error) { console.error("budgets read error:", q.error); process.exit(2); }
  const rows = q.data || [];

  console.log(`TXR - TX - V kpi_budgets rows (FY2026): ${rows.length}`);
  console.log("");

  // Group by line_code.
  const byLine = new Map();
  for (const r of rows) {
    if (!byLine.has(r.line_code)) byLine.set(r.line_code, new Map());
    byLine.get(r.line_code).set(Number(r.period_no), Number(r.amount));
  }

  // Report the six specific lines Kevin named + any other lines that appear.
  const linesToReport = new Set([...TXV_LINES, ...byLine.keys()]);
  const sortedLines = [...linesToReport].sort();

  console.log("Per-line, per-period amounts (FY2026):");
  console.log("");
  for (const line of sortedLines) {
    const perPeriod = byLine.get(line) || new Map();
    const total = [...perPeriod.values()].reduce((s, v) => s + v, 0);
    const flag = TXV_LINES.includes(line) ? "" : " (unexpected line)";
    console.log(`  ${line}: FY total $${fmt(total)}${flag}`);
    if (perPeriod.size > 0) {
      const rowsStr = [...perPeriod.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([p, a]) => `P${p}=$${fmt(a)}`)
        .join(", ");
      console.log(`    ${rowsStr}`);
    } else {
      console.log(`    (NO ROWS - seed gap for this line)`);
    }
  }

  // Expected FY2026 totals per Kevin's spec:
  //   food (3200.x) = $102,211
  //   packaging (3400.x) = $16,040
  //   vehicle (3500.x) = $1,750
  const foodTotal = [...byLine.entries()]
    .filter(([gl]) => gl.startsWith("3200"))
    .reduce((s, [, pm]) => s + [...pm.values()].reduce((a, b) => a + b, 0), 0);
  const packTotal = [...byLine.entries()]
    .filter(([gl]) => gl.startsWith("3400"))
    .reduce((s, [, pm]) => s + [...pm.values()].reduce((a, b) => a + b, 0), 0);
  const vehTotal = [...byLine.entries()]
    .filter(([gl]) => gl.startsWith("3500"))
    .reduce((s, [, pm]) => s + [...pm.values()].reduce((a, b) => a + b, 0), 0);

  console.log("");
  console.log("Bucket totals (FY2026 sum across periods):");
  console.log(`  food (3200.x):       $${fmt(foodTotal)}  (Kevin expected: $102,211)`);
  console.log(`  packaging (3400.x):  $${fmt(packTotal)}  (Kevin expected: $16,040)`);
  console.log(`  vehicle (3500.x):    $${fmt(vehTotal)}   (Kevin expected: $1,750)`);
  const foodOK = Math.round(foodTotal) === 102211;
  const packOK = Math.round(packTotal) === 16040;
  const vehOK = Math.round(vehTotal) === 1750;
  console.log("");
  console.log(`Match: food=${foodOK ? "YES" : "NO"} packaging=${packOK ? "YES" : "NO"} vehicle=${vehOK ? "YES" : "NO"}`);

  // Portfolio-total delta: what would ALL FYTD purchasing budget be
  // with vs without TXR - TX - V included?
  //
  // Compute the "with" total: sum of all budget rows across all site
  // accounts for the six specific lines Kevin named (approximating
  // the food+packaging+vehicle bucket), full FY.
  // Paginate past 1000. Hard rule: .order() before .range(), always.
  const allRows = await paginate(
    supa.from("kpi_budgets")
      .select("account_key, line_code, period_no, amount")
      .eq("fiscal_year", FY)
      .neq("account_key", "CORP")
      .neq("line_code", "3100.1")
      .neq("line_code", "3100.2")
      .order("account_key", { ascending: true })
      .order("line_code", { ascending: true })
      .order("period_no", { ascending: true })
  );

  let withTotal = 0;
  let withoutTotal = 0;
  const foodPackVehLines = allRows.filter(r => {
    const s = String(r.line_code || "");
    return s.startsWith("3200") || s.startsWith("3400") || s.startsWith("3500");
  });
  for (const r of foodPackVehLines) {
    const amt = Number(r.amount || 0);
    withTotal += amt;
    if (r.account_key !== TXV) withoutTotal += amt;
  }
  const delta = withTotal - withoutTotal;
  console.log("");
  console.log("Portfolio-total delta (food + packaging + vehicle, FY2026, all site accounts):");
  console.log(`  WITH  TXR - TX - V: $${fmt(withTotal)}`);
  console.log(`  WITHOUT TXR - TX - V: $${fmt(withoutTotal)}`);
  console.log(`  delta added by unblocking TXR - TX - V: $${fmt(delta)}`);
  console.log(`  expected delta (Kevin): $${fmt(102211 + 16040 + 1750)} = $120,001`);
}

// ─── Part D: pass-through GL split ───────────────────────────────────

async function partD() {
  console.log("\n═════════════════════════════════════════════════════════");
  console.log("PART D  pass-through GL split - INV-P9 skipped verification");
  console.log("═════════════════════════════════════════════════════════\n");

  for (const acct of PASS_THROUGH_ACCOUNTS) {
    console.log(`\n─── ${acct} FYTD (${FY_START} to ${TODAY}) ───\n`);

    // Read all non-excluded actuals FYTD for this account.
    // paginate manually since we want ordered rows. Read
    // vendor_or_merchant off the row directly (already denormalised
    // during the derive step).
    const rows = await paginate(
      supa.from("purchasing_actuals")
        .select("id, source, source_bill_id, source_line_id, account_key, gl_line_code, gl_bucket, txn_date, amount, vendor_or_merchant, excluded")
        .eq("account_key", acct)
        .eq("excluded", false)
        .gte("txn_date", FY_START)
        .lte("txn_date", TODAY)
        .order("txn_date", { ascending: true })
        .order("id", { ascending: true })
    );

    // Split by GL prefix + by source.
    const byPrefix = new Map();          // '32'/'34'/'35'/'13'/'other'/'uncoded' -> {source -> {sum, count}}
    for (const r of rows) {
      let prefix;
      if (!r.gl_line_code) prefix = "uncoded";
      else {
        const s = String(r.gl_line_code);
        if (s.startsWith("32")) prefix = "32xx";
        else if (s.startsWith("34")) prefix = "34xx";
        else if (s.startsWith("35")) prefix = "35xx";
        else if (s.startsWith("13")) prefix = "13xx";
        else prefix = `other (${s})`;
      }
      if (!byPrefix.has(prefix)) byPrefix.set(prefix, new Map());
      const bySrc = byPrefix.get(prefix);
      const src = r.source || "unknown";
      if (!bySrc.has(src)) bySrc.set(src, { sum: 0, count: 0 });
      const bucket = bySrc.get(src);
      bucket.sum += Number(r.amount || 0);
      bucket.count += 1;
    }

    console.log("Spend by GL prefix, split by source:");
    for (const prefix of ["32xx", "34xx", "35xx", "13xx", "uncoded"]) {
      const bySrc = byPrefix.get(prefix);
      if (!bySrc) {
        console.log(`  ${prefix}: (no rows)`);
        continue;
      }
      let totalSum = 0;
      let totalCnt = 0;
      for (const b of bySrc.values()) { totalSum += b.sum; totalCnt += b.count; }
      console.log(`  ${prefix}: $${fmt(totalSum)}  (${totalCnt} rows)`);
      for (const [src, b] of bySrc.entries()) {
        console.log(`    ${src.padEnd(18)} $${fmt(b.sum).padStart(12)}  (${b.count} rows)`);
      }
    }
    // Any other-prefix rows?
    for (const [prefix, bySrc] of byPrefix.entries()) {
      if (["32xx", "34xx", "35xx", "13xx", "uncoded"].includes(prefix)) continue;
      let totalSum = 0;
      let totalCnt = 0;
      for (const b of bySrc.values()) { totalSum += b.sum; totalCnt += b.count; }
      console.log(`  ${prefix}: $${fmt(totalSum)}  (${totalCnt} rows)`);
    }

    // Any dollars in 32xx OR 34xx? Detail: counts, dates, vendors.
    const cogsRows = rows.filter(r => {
      if (!r.gl_line_code) return false;
      const s = String(r.gl_line_code);
      return s.startsWith("32") || s.startsWith("34");
    });

    if (cogsRows.length === 0) {
      console.log(`\n  ${acct}: NO COGS (32xx/34xx) dollars sitting here FYTD - clean.`);
      continue;
    }

    // Separate STL - FL Fun Money (gl_line_code = '3200.2', per INV-P9 note).
    // Fun Money is KitchFix-borne per #730 - report separately, not as a finding.
    const funMoneyRows = (acct === "STL - FL")
      ? cogsRows.filter(r => r.gl_line_code === "3200.2")
      : [];
    const findingRows = (acct === "STL - FL")
      ? cogsRows.filter(r => r.gl_line_code !== "3200.2")
      : cogsRows;

    if (funMoneyRows.length > 0) {
      const fmSum = funMoneyRows.reduce((s, r) => s + Number(r.amount || 0), 0);
      console.log(`\n  ${acct} Fun Money (3200.2, legitimately KitchFix-borne per #730):`);
      console.log(`    ${funMoneyRows.length} rows  $${fmt(fmSum)}`);
    }

    if (findingRows.length === 0) {
      console.log(`\n  ${acct}: after separating Fun Money, NO COGS findings - clean.`);
      continue;
    }

    const findingSum = findingRows.reduce((s, r) => s + Number(r.amount || 0), 0);
    console.log(`\n  ${acct} FINDINGS - billable cost sitting in COGS:`);
    console.log(`    ${findingRows.length} rows  $${fmt(findingSum)}`);

    // Per-line summary + top-5 details. vendor_or_merchant lives on
    // the row directly.
    const byLine = new Map();
    for (const r of findingRows) {
      const gl = r.gl_line_code || "?";
      if (!byLine.has(gl)) byLine.set(gl, []);
      byLine.get(gl).push(r);
    }
    for (const [gl, glRows] of [...byLine.entries()].sort()) {
      const glSum = glRows.reduce((s, r) => s + Number(r.amount || 0), 0);
      console.log(`    ${gl}: ${glRows.length} rows  $${fmt(glSum)}`);
      // Top 5 largest for this GL.
      const top5 = [...glRows].sort((a, b) => Number(b.amount) - Number(a.amount)).slice(0, 5);
      for (const r of top5) {
        const vendor = r.vendor_or_merchant || (r.source === "rippling_spend" ? "(card)" : "(unknown)");
        console.log(`      ${r.txn_date}  $${fmt(r.amount).padStart(10)}  ${r.source.padEnd(15)}  ${vendor}`);
      }
      if (glRows.length > 5) console.log(`      ... and ${glRows.length - 5} more`);
    }
  }
}

// ─── main ────────────────────────────────────────────────────────────

(async () => {
  await partC();
  await partD();
  console.log("\n(done)\n");
  process.exit(0);
})().catch(e => {
  console.error("FATAL:", e?.message || e);
  process.exit(1);
});
