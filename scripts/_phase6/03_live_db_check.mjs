// Independently verify the live DB TBJ dollar set counts + spend for the window.
// This bypasses the augment pipeline entirely and hits Postgres directly to
// confirm what fresh should look like.
//
// Read-only.

import dotenv from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/dotenv/lib/main.js";
import { createClient } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/@supabase/supabase-js/dist/index.mjs";

dotenv.config({ path: "/Users/kevinfietek/dev/kitchfix-intranet/.env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing env");
const supa = createClient(url, key, { auth: { persistSession: false } });

const round2 = (n) => Math.round(n * 100) / 100;

const WINDOW_START = "2026-05-01";
const WINDOW_END = "2026-07-31";
const ACCTS = ["TBR - FL", "TBJ - FL", "STL - FL"];

function normDate(raw) {
  if (!raw) return null;
  const s = String(raw);
  let fixed = s;
  if (s.startsWith("0026-")) fixed = "2026-" + s.slice(5);
  else if (s.startsWith("0206-")) fixed = "2026-" + s.slice(5);
  else if (s.startsWith("23026-")) fixed = s.slice(1);
  else if (s.startsWith("72026-")) fixed = s.slice(1);
  return fixed;
}

async function fetchAll(acct) {
  const rows = [];
  const pageSize = 1000;
  const seenIds = new Set();
  // In-window
  let from = 0;
  while (true) {
    const { data, error } = await supa
      .from("ai_line_items")
      .select("id, account_key, invoice_uuid, invoice_date, extended_price, review_reason, created_at")
      .eq("account_key", acct)
      .gte("invoice_date", WINDOW_START)
      .lte("invoice_date", WINDOW_END)
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) { if (seenIds.has(r.id)) continue; seenIds.add(r.id); rows.push(r); }
    if (data.length < pageSize) break;
    from += pageSize;
  }
  // Drift low/high
  const { data: dLow, error: dErr1 } = await supa
    .from("ai_line_items")
    .select("id, account_key, invoice_uuid, invoice_date, extended_price, review_reason, created_at")
    .eq("account_key", acct)
    .lt("invoice_date", "2015-01-01");
  if (dErr1) throw dErr1;
  const { data: dHigh, error: dErr2 } = await supa
    .from("ai_line_items")
    .select("id, account_key, invoice_uuid, invoice_date, extended_price, review_reason, created_at")
    .eq("account_key", acct)
    .gt("invoice_date", "2027-12-31");
  if (dErr2) throw dErr2;
  for (const r of [...(dLow || []), ...(dHigh || [])]) {
    const norm = normDate(r.invoice_date);
    if (!norm) continue;
    if (norm >= WINDOW_START && norm <= WINDOW_END) rows.push(r);
  }
  return rows;
}

async function fetchHeaders(uuids) {
  const map = new Map();
  const CHUNK = 100;
  for (let i = 0; i < uuids.length; i += CHUNK) {
    const batch = uuids.slice(i, i + CHUNK);
    const { data, error } = await supa
      .from("invoice_submissions")
      .select("id, status")
      .in("id", batch);
    if (error) throw error;
    for (const r of data) map.set(r.id, r);
  }
  return map;
}

const results = {};

for (const acct of ACCTS) {
  const raw = await fetchAll(acct);
  const uuids = [...new Set(raw.map(r => r.invoice_uuid).filter(Boolean))];
  const hdrs = await fetchHeaders(uuids);
  const live = raw.filter(r => {
    const h = hdrs.get(r.invoice_uuid);
    return !(h && (h.status === "corrected" || h.status === "deleted"));
  });
  const dollarSet = live.filter(r => r.review_reason !== "invoice_over_extracted");

  // per month tallies
  const per = {};
  for (const r of dollarSet) {
    const nd = normDate(r.invoice_date);
    if (!nd) continue;
    const m = nd.slice(0, 7);
    per[m] = per[m] || { rows: 0, spend: 0 };
    per[m].rows += 1;
    per[m].spend += Number(r.extended_price) || 0;
  }
  let total_rows = 0, total_spend = 0;
  for (const m of Object.keys(per)) {
    per[m].spend = round2(per[m].spend);
    total_rows += per[m].rows;
    total_spend += per[m].spend;
  }
  total_spend = round2(total_spend);
  results[acct] = {
    raw_row_count: raw.length,
    live_row_count: live.length,
    dollar_set_row_count: dollarSet.length,
    dollar_set_by_month: per,
    dollar_set_total: { rows: total_rows, spend: total_spend },
    latest_row_created_at: dollarSet.map(r => r.created_at).sort().slice(-1)[0] || null,
  };
  console.log(`\n${acct}:`);
  console.log(`  raw=${raw.length}  live=${live.length}  dollarSet=${dollarSet.length} / $${total_spend}`);
  for (const [m, v] of Object.entries(per).sort()) {
    console.log(`    ${m}  ${v.rows} / $${v.spend}`);
  }
  console.log(`  latest_created_at: ${results[acct].latest_row_created_at}`);
}

const OUT = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_live_db_check.json";
(await import("node:fs")).writeFileSync(OUT, JSON.stringify({ ran_at: new Date().toISOString(), results }, null, 2));
console.log(`\nwrote ${OUT}`);
