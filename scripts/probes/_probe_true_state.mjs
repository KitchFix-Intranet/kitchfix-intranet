#!/usr/bin/env node
/*
 * True-state probe. Answers: what does production actually contain
 * right now, and does it match the "~12,131 records, $4.18M FYTD"
 * mental model Kevin cited?
 *
 * Reports counts + FYTD sums from three tables/views:
 *   - rippling_raw_spend_lines           (append-only observation log)
 *   - rippling_raw_spend_lines_latest    (deduplicated current state)
 *   - purchasing_actuals(source=rippling_spend, excluded=false, FYTD)
 * Read-only. Never prints keys or PII.
 */
import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log("env SUPABASE_URL:              ", SB_URL ? "PRESENT" : "ABSENT");
console.log("env SUPABASE_SERVICE_ROLE_KEY: ", SB_KEY ? "PRESENT" : "ABSENT");
if (!SB_URL || !SB_KEY) { console.error("BLOCKED"); process.exit(2); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const FY_START = "2025-12-29";

async function main() {
  {
    const { count } = await supa.from("rippling_raw_spend_lines").select("rippling_id", { count: "exact", head: true });
    console.log(`rippling_raw_spend_lines (all observations, append-only): ${count}`);
  }
  {
    const { count } = await supa.from("rippling_raw_spend_lines_latest").select("rippling_id", { count: "exact", head: true });
    console.log(`rippling_raw_spend_lines_latest (unique current):          ${count}`);
  }
  {
    const { data } = await supa.from("rippling_raw_spend_lines_latest").select("rippling_id").order("rippling_id", { ascending: false }).limit(1);
    if (data?.[0]?.rippling_id) {
      const hex = data[0].rippling_id.replace(/-/g, "").slice(0, 12);
      const ms = Number(BigInt("0x" + hex));
      console.log(`rippling_raw_spend_lines_latest max mint iso:              ${new Date(ms).toISOString()}`);
    }
  }
  {
    const { count } = await supa.from("purchasing_actuals").select("source", { count: "exact", head: true }).eq("source", "rippling_spend").eq("excluded", false).gte("txn_date", FY_START);
    console.log(`purchasing_actuals rippling_spend FYTD count:              ${count}`);
  }
  {
    const rows = [];
    const PS = 1000;
    for (let from = 0; ; from += PS) {
      const { data, error } = await supa.from("purchasing_actuals").select("amount, txn_date").eq("source", "rippling_spend").eq("excluded", false).gte("txn_date", FY_START).range(from, from + PS - 1);
      if (error) { console.error(error.message); process.exit(1); }
      if (!data || data.length === 0) break;
      rows.push(...data);
      if (data.length < PS) break;
    }
    const sum = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
    const maxD = rows.reduce((m, r) => (r.txn_date > m ? r.txn_date : m), "");
    console.log(`purchasing_actuals rippling_spend FYTD sum:                $${(Math.round(sum * 100) / 100).toLocaleString()}`);
    console.log(`purchasing_actuals rippling_spend FYTD max(txn_date):      ${maxD}`);
  }
}
main().catch(e => { console.error("FAIL:", e); process.exit(1); });
