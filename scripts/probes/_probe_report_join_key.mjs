#!/usr/bin/env node
/**
 * Join-key discovery.
 *
 * Confirm:
 *   1. rippling_report_txns.parent_txn_id shares an identifier
 *      space with a column on rippling_raw_spend_lines (the API side).
 *      Candidates: id, parent_txn_id, txn_id, object_id.
 *   2. How many rippling_report_txns rows match an API row, how many
 *      do not.
 *   3. Second number should reproduce the 319 measurement from phase 2.
 *
 * Env: --env-file=.env.local (USE, never SEE).
 */
import { createClient } from "@supabase/supabase-js";

function envOrDie(name) {
  const v = process.env[name];
  if (!v) { console.error(`env ${name} ABSENT`); process.exit(1); }
  return v;
}
console.log(`SUPABASE_URL: ${process.env.SUPABASE_URL ? "PRESENT" : "ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${process.env.SUPABASE_SERVICE_ROLE_KEY ? "PRESENT" : "ABSENT"}`);
const supa = createClient(envOrDie("SUPABASE_URL"), envOrDie("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } });

// ─── Section A: table shape probes ─────────────────────────────────
console.log("\n=== A - rippling_raw_spend_lines shape ===");
{
  const r = await supa.from("rippling_raw_spend_lines").select("*").limit(1);
  if (r.error) { console.error(`shape read failed: ${r.error.message}`); process.exit(1); }
  const cols = Object.keys(r.data?.[0] || {});
  console.log(`  columns: ${cols.join(", ")}`);
  const idLike = cols.filter(c => /id|txn/i.test(c));
  console.log(`  id-like columns: ${idLike.join(", ")}`);
}

console.log("\n=== A2 - rippling_report_txns shape (sanity) ===");
{
  const r = await supa.from("rippling_report_txns").select("*").limit(1);
  if (r.error) { console.error(`shape read failed: ${r.error.message}`); process.exit(1); }
  const cols = Object.keys(r.data?.[0] || {});
  const idLike = cols.filter(c => /id|txn/i.test(c));
  console.log(`  id-like columns: ${idLike.join(", ")}`);
}

// ─── Section B: sample values from each side ───────────────────────
console.log("\n=== B - sample id shapes (first 3 each) ===");
{
  // report parent_txn_id samples
  const rr = await supa.from("rippling_report_txns")
    .select("parent_txn_id").order("id", { ascending: true }).limit(3);
  if (rr.error) { console.error(`report sample failed: ${rr.error.message}`); process.exit(1); }
  console.log("  report.parent_txn_id samples:");
  for (const row of rr.data || []) console.log(`    ${String(row.parent_txn_id)}  len=${String(row.parent_txn_id).length}`);
}
{
  // Check every id-like column on rippling_raw_spend_lines for shape
  const cols = ["id", "parent_txn_id", "txn_id", "transaction_id", "object_id", "rippling_txn_id"];
  console.log("  raw_spend candidate columns tried, first non-null value shape:");
  for (const c of cols) {
    try {
      const q = await supa.from("rippling_raw_spend_lines").select(c).not(c, "is", null).limit(1);
      if (q.error) { console.log(`    ${c}: ERROR ${q.error.code} - ${q.error.message}`); continue; }
      const v = q.data?.[0]?.[c];
      console.log(`    ${c}: ${v == null ? "no non-null" : `sample="${String(v)}" len=${String(v).length}`}`);
    } catch (e) {
      console.log(`    ${c}: ERROR ${e.message}`);
    }
  }
}

// ─── Section C: total counts ───────────────────────────────────────
console.log("\n=== C - row counts ===");
{
  const rr = await supa.from("rippling_report_txns").select("*", { count: "exact", head: true });
  console.log(`  rippling_report_txns rows total (all content_hashes): ${rr.count}`);
  const rdp = await supa.rpc?.("count_distinct_parents_report_txns") ?? { data: null };
  if (!rdp?.data) {
    const all = await supa.from("rippling_report_txns").select("parent_txn_id", { count: "exact" });
    if (!all.error) {
      const seen = new Set();
      for (const r of all.data || []) seen.add(r.parent_txn_id);
      console.log(`  rippling_report_txns DISTINCT parent_txn_id: ${seen.size}`);
    }
  }
  const rsc = await supa.from("rippling_report_seen_txns").select("*", { count: "exact", head: true });
  console.log(`  rippling_report_seen_txns rows (phase 1 arbitration set): ${rsc.count}`);
  const rsl = await supa.from("rippling_raw_spend_lines").select("*", { count: "exact", head: true });
  console.log(`  rippling_raw_spend_lines rows (API side, all): ${rsl.count}`);
}

// ─── Section D: try join candidates ────────────────────────────────
console.log("\n=== D - candidate joins (which column overlaps?) ===");
{
  // Get all distinct report parent_txn_id
  const reportIds = new Set();
  {
    let from = 0; const PS = 1000;
    while (true) {
      const q = await supa.from("rippling_report_txns")
        .select("parent_txn_id").order("id", { ascending: true }).range(from, from + PS - 1);
      if (q.error) { console.error(`report id sweep failed: ${q.error.message}`); process.exit(1); }
      const rows = q.data || [];
      for (const r of rows) reportIds.add(String(r.parent_txn_id));
      if (rows.length < PS) break;
      from += PS;
    }
  }
  console.log(`  distinct report parent_txn_ids: ${reportIds.size}`);

  // For each candidate column, count how many report_ids appear in raw_spend
  const candidates = ["id", "parent_txn_id", "rippling_id", "external_id", "embedded_document_id"];
  for (const col of candidates) {
    try {
      const has = await supa.from("rippling_raw_spend_lines").select(col).not(col, "is", null).limit(1);
      if (has.error) { console.log(`  raw_spend.${col}: NO SUCH COLUMN`); continue; }
      // Get all distinct values from raw_spend for this column
      const rawIds = new Set();
      let from = 0; const PS = 1000;
      while (true) {
        const q = await supa.from("rippling_raw_spend_lines")
          .select(col).not(col, "is", null).order(col, { ascending: true }).range(from, from + PS - 1);
        if (q.error) { console.log(`  raw_spend.${col}: read error ${q.error.message}`); break; }
        const rows = q.data || [];
        for (const r of rows) rawIds.add(String(r[col]));
        if (rows.length < PS) break;
        from += PS;
      }
      let overlap = 0;
      for (const rid of reportIds) if (rawIds.has(rid)) overlap += 1;
      console.log(`  raw_spend.${col}: rawIds=${rawIds.size}  overlap-with-report=${overlap} / ${reportIds.size}`);
    } catch (e) {
      console.log(`  raw_spend.${col}: EXCEPTION ${e.message}`);
    }
  }
}

console.log("\ndone.");
