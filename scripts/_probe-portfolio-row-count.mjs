// _probe-portfolio-row-count.mjs (throwaway, feat/sous-portfolio-tool)
// Kevin's spec: "paginationNote with a real probe - [ran] the row count
// for the busiest window across all accounts and state the ceiling."
// Runs the exact row-count sc_portfolio_window would fetch across all
// accounts for a typical busy month + reports numbers so the note in
// registry.js is grounded, not asserted.
import { createClient } from "@supabase/supabase-js";
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(url, key, { auth: { persistSession: false } });

// Probe each of the last 6 months for row counts across all accounts.
for (let back = 0; back < 6; back++) {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - back);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
  const { count, error } = await sb
    .from("sc_daily_revenue")
    .select("*", { count: "exact", head: true })
    .gte("service_date", start)
    .lte("service_date", end);
  if (error) { console.log(`${start.slice(0, 7)}: err ${error.message}`); continue; }
  console.log(`${start.slice(0, 7)} → ${start} to ${end}: ${count} rows across all accounts`);
}

// Also probe the WHOLE season (max realistic single-window range for
// an all-accounts query - period could span months if extreme).
const seasonStart = "2026-01-01";
const seasonEnd = "2026-12-31";
const { count: seasonCount } = await sb
  .from("sc_daily_revenue")
  .select("*", { count: "exact", head: true })
  .gte("service_date", seasonStart)
  .lte("service_date", seasonEnd);
console.log(`\nWHOLE 2026 season all-accounts: ${seasonCount} rows (portfolio would never fetch this; it's the absolute upper bound)`);
