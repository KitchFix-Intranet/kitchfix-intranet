// G3 Phase 2 Step 3: bucket movement (portfolio + TBR-FL).
// Non-excluded purchasing_actuals from source='rippling_spend', split by
// gl_bucket AND grouped into spec's 8-row report shape.
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

function classify(glLine) {
  if (glLine == null) return "pending";
  const s = String(glLine);
  if (s === "5002.5") return "equipment";
  if (s === "5002.1") return "rm";
  const digits = s.match(/^(\d+)/);
  if (!digits) return "sga_other";
  const p = digits[1];
  if (p.startsWith("32")) return "food";
  if (p.startsWith("34")) return "pack";
  if (p.startsWith("35")) return "vehicle";
  if (p.startsWith("13")) return "reimbursable";
  if (p.startsWith("5"))  return "sga_other";
  return "sga_other";
}

const LABELS = {
  food:         "Food (3200.x)",
  pack:         "Packaging & supplies (3400.x)",
  vehicle:      "Vehicle (3500.x)",
  equipment:    "Equipment (5002.5 -> sga)",
  rm:           "R&M (5002.1 -> sga)",
  reimbursable: "Reimbursable (13xx)",
  sga_other:    "SG&A (5xxx other)",
  pending:      "Pending (null gl_line_code)",
};
const ORDER = ["food", "pack", "vehicle", "equipment", "rm", "reimbursable", "sga_other", "pending"];

function usd(n) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function printTable(title, buckets) {
  console.log(`\n--- ${title} ---`);
  console.log(`bucket                                    |         before |          after |          delta`);
  console.log(`------------------------------------------+----------------+----------------+----------------`);
  for (const k of ORDER) {
    const b = buckets[k] || { rows: 0, amt: 0 };
    const before = k === "pending" ? 1082107.32 : 0;
    const after = b.amt;
    const delta = after - before;
    console.log(`${LABELS[k].padEnd(41)} | ${usd(before).padStart(14)} | ${usd(after).padStart(14)} | ${usd(delta).padStart(14)}`);
  }
}

(async () => {
  const rows = await pageAll(
    "purchasing_actuals",
    "id, amount, gl_line_code, gl_bucket, account_key",
    q => q.eq("source", "rippling_spend").eq("excluded", false),
  );
  console.log(`[step3] loaded ${rows.length} non-excluded rippling_spend actuals`);

  const portfolio = {};
  const tbrfl = {};
  for (const r of rows) {
    const k = classify(r.gl_line_code);
    const amt = Number(r.amount) || 0;
    portfolio[k] ??= { rows: 0, amt: 0 };
    portfolio[k].rows++;
    portfolio[k].amt += amt;
    if (r.account_key === "TBR - FL") {
      tbrfl[k] ??= { rows: 0, amt: 0 };
      tbrfl[k].rows++;
      tbrfl[k].amt += amt;
    }
  }

  printTable("Portfolio-wide (non-excluded rippling_spend)", portfolio);
  printTable("TBR - FL only (non-excluded rippling_spend)", tbrfl);

  // Row counts
  console.log(`\n--- Row counts (non-excluded rippling_spend) ---`);
  for (const k of ORDER) {
    const p = portfolio[k] || { rows: 0, amt: 0 };
    const t = tbrfl[k] || { rows: 0, amt: 0 };
    console.log(`${LABELS[k].padEnd(41)} | portfolio=${String(p.rows).padStart(5)} rows | TBR-FL=${String(t.rows).padStart(5)} rows`);
  }
})();
