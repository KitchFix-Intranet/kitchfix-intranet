// SEED: sc_labor_budgets + accounts.labor_ratio for M-1.
//
// Idempotent + guarded. Re-running is a no-op after the initial seed.
// Values are 2026 P&L truth per owner spec:
//   - TXR-TX-H's hourly line is $150k on the P&L (pre-adjustment /
//     stale). Owner ruling: $110k is authoritative, split evenly
//     across the seven periods that contain homestands (15,714.29 each).
//   - salary_budget and non-TXR-V revenue_forecast are seeded NULL.
//     They render as "not set" in the admin so the missing-vs-zero
//     rule holds. First real edit fills them.
//   - TXR-TX-V labor_ratio = 0.1923. Other MLB accounts NULL.
//
// USAGE:
//   node --env-file=.env.local scripts/_seed_sc_labor_budgets.mjs
//
// Aborts if any target row already exists (safety) unless
// SC_LABOR_BUDGETS_SEED_FORCE=1.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// sc-21 (2026-08-15): period is now BARE NUMERIC ("4"..."10"), matching
// sc_day_metadata's house convention. Display formats add "P" at
// render (admin: "P" + period).
//
// TXR-TX-H P10 is 15714.26 (not 15714.29). Six periods × 15714.29 +
// one at 15714.26 = 110,000.00 exactly. Owner ruling: the season
// total is the constraint; the per-period figure absorbs the 3¢
// drift on the last chronological slot. Do NOT restore the uniform
// value later - the intent is exact.
const HOURLY = {
  "CIN - OH":     { "4": 16709,    "5": 16709,    "6": 15316,    "7": 20886,    "8": 13924,    "9": 16709,    "10": 9747 },
  "STL - MO":     { "4": 17778,    "5": 17778,    "6": 17778,    "7": 25185,    "8": 14815,    "9": 13333,    "10": 13333 },
  "TXR - TX - H": { "4": 15714.29, "5": 15714.29, "6": 15714.29, "7": 15714.29, "8": 15714.29, "9": 15714.29, "10": 15714.26 },
  "TXR - TX - V": { "4": 4154,     "5": 12000,    "6": 6000,     "7": 12000,    "8": 9231,     "9": 9231,     "10": 7385 },
};

const REVENUE = {
  "TXR - TX - V": { "4": 21600, "5": 62400, "6": 31200, "7": 62400, "8": 48000, "9": 48000, "10": 38400 },
};

const RATIO = { "TXR - TX - V": 0.1923 };

const EFFECTIVE_FROM = "2026-01-01";
const CHANGED_BY = "seed@kitchfix.com";
const REASON = "Seed: 2026 P&L labor budgets (M-1 initial load).";

const FORCE = process.env.SC_LABOR_BUDGETS_SEED_FORCE === "1";

console.log(`═══ sc-20 labor budgets seed ═══`);
console.log(`  target: 4 MLB accounts × 7 periods = 28 sc_labor_budgets rows`);
console.log(`  target: TXR - TX - V labor_ratio = 0.1923`);
console.log(`  effective_from: ${EFFECTIVE_FROM}`);
console.log(`  force: ${FORCE ? "YES" : "no"}\n`);

// Guard: any existing rows?
const { count: existingCount, error: countErr } = await supa
  .from("sc_labor_budgets")
  .select("*", { count: "exact", head: true });
if (countErr) { console.error(`FATAL: read guard failed: ${countErr.message}`); process.exit(1); }
if (existingCount > 0 && !FORCE) {
  console.error(`\nsc_labor_budgets already has ${existingCount} rows. Set SC_LABOR_BUDGETS_SEED_FORCE=1 to override (dangerous).`);
  process.exit(1);
}

// ── 1. Insert 28 budget rows ────────────────────────────────────
const rows = [];
for (const [account, periods] of Object.entries(HOURLY)) {
  const revs = REVENUE[account] || {};
  for (const [period, hourly] of Object.entries(periods)) {
    rows.push({
      account_key:      account,
      period,
      hourly_budget:    hourly,
      salary_budget:    null,
      revenue_forecast: revs[period] ?? null,
      effective_from:   EFFECTIVE_FROM,
      superseded_at:    null,
      reason:           REASON,
      requested_by:     null,
      changed_by:       CHANGED_BY,
    });
  }
}

const { data: inserted, error: insErr } = await supa
  .from("sc_labor_budgets")
  .insert(rows)
  .select("account_key, period, hourly_budget, revenue_forecast");
if (insErr) { console.error(`FATAL: insert failed: ${insErr.message}`); process.exit(1); }

console.log(`inserted ${inserted.length} sc_labor_budgets rows.\n`);
for (const acct of Object.keys(HOURLY)) {
  const acctRows = inserted.filter(r => r.account_key === acct).sort((a, b) => a.period.localeCompare(b.period));
  const season = acctRows.reduce((s, r) => s + Number(r.hourly_budget || 0), 0);
  console.log(`  ${acct}  season=${season.toFixed(2)}  ${acctRows.map(r => `${r.period}=${r.hourly_budget}${r.revenue_forecast != null ? "/" + r.revenue_forecast : ""}`).join(", ")}`);
}

// ── 2. Set TXR-TX-V labor_ratio ──────────────────────────────────
console.log(`\nsetting labor_ratio for TXR - TX - V ...`);
const { error: ratioErr } = await supa
  .from("accounts")
  .update({ labor_ratio: RATIO["TXR - TX - V"] })
  .eq("team_key", "TXR - TX - V");
if (ratioErr) { console.error(`FATAL: ratio update failed: ${ratioErr.message}`); process.exit(1); }
console.log(`  TXR - TX - V labor_ratio = ${RATIO["TXR - TX - V"]}`);

console.log(`\n═══ seed complete ═══`);
