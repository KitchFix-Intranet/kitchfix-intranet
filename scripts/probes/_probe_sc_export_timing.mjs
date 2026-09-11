#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// _probe_sc_export_timing.mjs
// Time the current buildScWorkbook against real Supabase.
// 2026-09-10. Read-only.
// ═══════════════════════════════════════════════════════════════════
//
// Kevin's ask: baseline the current year-scope wall time so the
// rebuild has a number to regress against. In-process import of the
// existing builder + real Supabase reads (read-only). No HTTP, no
// dev server.
//
// Runs against per-meal accounts at scope=year for the season with
// the most data (TBJ - FL, matching the sample fixture).
//
// Run:
//   node --import ./scripts/probes/_at_alias_hook.mjs \
//     --env-file=.env.local \
//     scripts/probes/_probe_sc_export_timing.mjs

const req = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const k of req) {
  console.log(`${k}: ${process.env[k] ? "PRESENT" : "ABSENT"}`);
  if (!process.env[k]) { console.error(`\nABORT: ${k} missing`); process.exit(2); }
}

const { buildScWorkbook } = await import("../../src/lib/export/scWorkbook.js");

const CASES = [
  { accountKey: "TBJ - FL",  scope: "year",  year: 2026 },
  { accountKey: "TBR - FL",  scope: "year",  year: 2026 },
  { accountKey: "TXR - AZ",  scope: "year",  year: 2026 },
  { accountKey: "CIN - AZ",  scope: "year",  year: 2026 },
  // A period scope for one account to see the smaller footprint.
  { accountKey: "TBJ - FL",  scope: "period", year: 2026, period: "P8" },
];

console.log("\n═══ SC export timing baseline (in-process) ═══\n");
console.log("account          scope   year   period  build_ms   serialize_ms   total_ms   kb");
console.log("─".repeat(90));

for (const c of CASES) {
  try {
    const t0 = Date.now();
    const { workbook, filename } = await buildScWorkbook({
      accountKey: c.accountKey,
      scope: c.scope,
      year: c.year,
      period: c.period,
      month: c.month,
      generatedBy: "probe",
    });
    const t1 = Date.now();
    const buf = await workbook.xlsx.writeBuffer();
    const t2 = Date.now();
    const kb = (buf.byteLength / 1024).toFixed(1);
    const buildMs = t1 - t0;
    const serMs   = t2 - t1;
    const totalMs = t2 - t0;
    console.log(
      `${c.accountKey.padEnd(16)} ${c.scope.padEnd(7)} ${String(c.year).padEnd(6)} ${(c.period || "-").padEnd(7)} ${String(buildMs).padStart(8)}   ${String(serMs).padStart(12)}   ${String(totalMs).padStart(8)}   ${kb.padStart(6)}   ${filename}`,
    );
  } catch (e) {
    console.log(
      `${c.accountKey.padEnd(16)} ${c.scope.padEnd(7)} ${String(c.year).padEnd(6)} ${(c.period || "-").padEnd(7)} FAILED: ${e.message}`,
    );
  }
}

console.log("─".repeat(90));
console.log("\nNotes:");
console.log("  build_ms      = supabase reads + workbook composition");
console.log("  serialize_ms  = xlsx.writeBuffer() serialize + compress");
console.log("  total_ms      = end-to-end for the endpoint's inner work (no HTTP overhead)");
console.log("  kb            = final xlsx byte size on disk");
console.log("\nAdd ~50-200ms for HTTP overhead + Vercel cold-start on prod.");
