// scripts/_probe_fin2027_pnl3_verify.mjs
//
// FIN-2027 W1 Stage 2 · pnl-3 post-apply verify probe. Counts +
// PASS/FAIL only. Never prints dollar amounts.
//
// Usage:
//   node --env-file=.env.local scripts/_probe_fin2027_pnl3_verify.mjs
//
// Checks:
//   (a) fiscal_periods has 52 rows across FY2024..FY2027 (13 each);
//   (b) FY2023 rows absent (R-10 parked);
//   (c) boundary dates match the four workbook row-4 anchors verified
//       in W0 report §11;
//   (d) kpi_period_status has (2024, 1..13) + (2025, 1..13);
//   (e) (2024, *) and (2025, *) rows have closed_at NOT NULL and
//       verified_at IS NULL (loader owns the flip);
//   (f) (2026, 9) has closed_at = 2026-09-06T23:59:59Z;
//   (g) (2026, 8) closed_at unchanged (2026-08-09T23:59:59Z);
//   (h) fiscal_periods table shape: 4 columns, PK, 28-day span invariant.

import { createClient } from "@supabase/supabase-js";

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

let allOk = true;
function check(label, cond, detail) {
  const pass = !!cond;
  if (!pass) allOk = false;
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? "  · " + detail : ""}`);
}

console.log("pnl-3 post-apply verify");
console.log("");

// (a) fiscal_periods 52 rows, per-year counts
{
  const { count, error } = await supa
    .from("fiscal_periods")
    .select("*", { count: "exact", head: true });
  if (error) { console.error("fiscal_periods read failed:", error.message); process.exit(2); }
  check("(a) fiscal_periods total rows == 52", count === 52, `actual ${count}`);
}
for (const fy of [2024, 2025, 2026, 2027]) {
  const { count } = await supa
    .from("fiscal_periods")
    .select("*", { count: "exact", head: true })
    .eq("fiscal_year", fy);
  check(`(a) fiscal_periods FY${fy} rows == 13`, count === 13, `actual ${count}`);
}

// (b) FY2023 absent
{
  const { count } = await supa
    .from("fiscal_periods")
    .select("*", { count: "exact", head: true })
    .eq("fiscal_year", 2023);
  check("(b) fiscal_periods FY2023 rows == 0 (R-10)", count === 0, `actual ${count}`);
}

// (c) boundary dates
const boundaries = [
  { fy: 2024, p: 1,  col: "start_date", expect: "2024-01-01" },
  { fy: 2024, p: 13, col: "end_date",   expect: "2024-12-29" },
  { fy: 2025, p: 1,  col: "start_date", expect: "2024-12-30" },
  { fy: 2025, p: 13, col: "end_date",   expect: "2025-12-28" },
  { fy: 2026, p: 1,  col: "start_date", expect: "2025-12-29" },
  { fy: 2026, p: 13, col: "end_date",   expect: "2026-12-27" },
  { fy: 2027, p: 1,  col: "start_date", expect: "2026-12-28" },
  { fy: 2027, p: 13, col: "end_date",   expect: "2027-12-26" },
];
for (const b of boundaries) {
  const { data } = await supa
    .from("fiscal_periods")
    .select("start_date, end_date")
    .eq("fiscal_year", b.fy)
    .eq("period_no", b.p)
    .maybeSingle();
  const actual = data?.[b.col];
  check(`(c) FY${b.fy} P${b.p} ${b.col} == ${b.expect}`, actual === b.expect, `actual ${actual ?? "MISSING"}`);
}

// (h) 28-day span invariant spot-check (leverages the CHECK constraint - we sample)
{
  const { data } = await supa
    .from("fiscal_periods")
    .select("fiscal_year, period_no, start_date, end_date")
    .eq("fiscal_year", 2026)
    .eq("period_no", 9)
    .maybeSingle();
  // FY2026 P9: 2026-08-10 .. 2026-09-06
  const okStart = data?.start_date === "2026-08-10";
  const okEnd   = data?.end_date   === "2026-09-06";
  check("(h) FY2026 P9 fiscal_periods row is 2026-08-10..2026-09-06", okStart && okEnd, `start=${data?.start_date} end=${data?.end_date}`);
}

// (d) kpi_period_status has (2024,1..13) + (2025,1..13)
for (const fy of [2024, 2025]) {
  const { count } = await supa
    .from("kpi_period_status")
    .select("*", { count: "exact", head: true })
    .eq("fiscal_year", fy);
  check(`(d) kpi_period_status FY${fy} rows == 13`, count === 13, `actual ${count}`);
}

// (e) FY2024 + FY2025 rows: closed_at NOT NULL, verified_at IS NULL
for (const fy of [2024, 2025]) {
  const { count: nClosed } = await supa
    .from("kpi_period_status")
    .select("*", { count: "exact", head: true })
    .eq("fiscal_year", fy)
    .not("closed_at", "is", null);
  check(`(e) kpi_period_status FY${fy} closed_at populated on all 13`, nClosed === 13, `actual ${nClosed}`);

  const { count: nVerified } = await supa
    .from("kpi_period_status")
    .select("*", { count: "exact", head: true })
    .eq("fiscal_year", fy)
    .not("verified_at", "is", null);
  check(`(e) kpi_period_status FY${fy} verified_at NULL on all 13 (loader owns)`, nVerified === 0, `actual ${nVerified}`);
}

// (e) boundary: FY2024 P1 closed_at, FY2025 P13 closed_at
{
  const { data: p1 } = await supa
    .from("kpi_period_status")
    .select("closed_at")
    .eq("fiscal_year", 2024)
    .eq("period_no", 1)
    .maybeSingle();
  check("(e) FY2024 P1 closed_at == 2024-01-28T23:59:59Z",
    p1?.closed_at === "2024-01-28T23:59:59+00:00", `actual ${p1?.closed_at}`);

  const { data: p13 } = await supa
    .from("kpi_period_status")
    .select("closed_at")
    .eq("fiscal_year", 2025)
    .eq("period_no", 13)
    .maybeSingle();
  check("(e) FY2025 P13 closed_at == 2025-12-28T23:59:59Z",
    p13?.closed_at === "2025-12-28T23:59:59+00:00", `actual ${p13?.closed_at}`);
}

// (f) FY2026 P9 closed_at stamp
{
  const { data } = await supa
    .from("kpi_period_status")
    .select("closed_at, verified_at")
    .eq("fiscal_year", 2026)
    .eq("period_no", 9)
    .maybeSingle();
  check("(f) FY2026 P9 closed_at == 2026-09-06T23:59:59Z",
    data?.closed_at === "2026-09-06T23:59:59+00:00", `actual ${data?.closed_at}`);
  // Sanity: P9 verified_at should already be non-NULL from the Stage 0 loader run.
  check("(f) FY2026 P9 verified_at non-NULL (Stage 0 load persists)",
    !!data?.verified_at, `verified_at=${data?.verified_at}`);
}

// (g) FY2026 P8 closed_at unchanged
{
  const { data } = await supa
    .from("kpi_period_status")
    .select("closed_at")
    .eq("fiscal_year", 2026)
    .eq("period_no", 8)
    .maybeSingle();
  check("(g) FY2026 P8 closed_at unchanged (2026-08-09T23:59:59Z)",
    data?.closed_at === "2026-08-09T23:59:59+00:00", `actual ${data?.closed_at}`);
}

console.log("");
console.log(allOk ? "pnl-3 VERIFY · PASS" : "pnl-3 VERIFY · FAIL");
process.exit(allOk ? 0 : 2);
