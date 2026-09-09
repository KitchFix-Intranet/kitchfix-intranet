#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// _probe_bg_report_mount_verify.mjs
// Mount-verify for the monthly B&G report.
// 2026-09-09.
// ═══════════════════════════════════════════════════════════════════
//
// Generates a real August 2026 workbook against production Supabase
// (read-only), writes it to ~/Downloads/, cross-checks totals with a
// direct DB probe. Kevin's fence: "read the actual xlsx rather than
// inferring from the payload we built."
//
// Also renders the email HTML for the same run so Kevin can eyeball
// the intranet-shell layout. Writes it alongside the xlsx.
//
// Run with:
//   node --import ./scripts/probes/_at_alias_hook.mjs \
//     --env-file=.env.local \
//     scripts/probes/_probe_bg_report_mount_verify.mjs

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getServiceClient } from "../../src/lib/supabase.js";
import { buildBgReport } from "../../src/lib/bg/bgReport.js";
import { renderBgReportEmail } from "../../src/lib/bg/bgReportEmail.js";

const execFileP = promisify(execFile);

const req = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
for (const k of req) {
  console.log(`${k}: ${process.env[k] ? "PRESENT" : "ABSENT"}`);
  if (!process.env[k]) { console.error(`\nABORT: ${k} missing`); process.exit(2); }
}

const OUT_DIR = path.join(os.homedir(), "Downloads",
  `bg_report_mount_verify_${new Date().toISOString().slice(0,10)}`);
await fs.mkdir(OUT_DIR, { recursive: true });

const supa = getServiceClient();

// ─── Fixture A: August 2026 (real data, has service days) ──────
const A = { accountKey: "TBR - FL", monthISO: "2026-08" };
console.log(`\n═══ Fixture A: ${A.accountKey} / ${A.monthISO} (real month with service) ═══`);

const reportA = await buildBgReport({ ...A, deps: { supa } });
const bufA = Buffer.from(await reportA.workbook.xlsx.writeBuffer());
const pathA = path.join(OUT_DIR, reportA.filename);
await fs.writeFile(pathA, bufA);

const emailA = renderBgReportEmail({
  accountKey: A.accountKey,
  factTable: reportA.factTable,
  reconciliationLine: reportA.reconciliationLine,
  generatedAt: new Date(),
});
const htmlPathA = path.join(OUT_DIR, reportA.filename.replace(".xlsx", ".html"));
await fs.writeFile(htmlPathA, emailA.html);

console.log(`  filename:            ${reportA.filename}`);
console.log(`  workbook byteLength: ${bufA.length.toLocaleString()} bytes (${(bufA.length / 1024).toFixed(1)} KB)`);
console.log(`  monthLabel:          ${reportA.factTable.monthLabel}`);
console.log(`  daysServed:          ${reportA.factTable.daysServed}`);
console.log(`  meals:               ${reportA.factTable.meals}`);
console.log(`  revenue:             $${(reportA.factTable.revenueCents / 100).toFixed(2)}`);
console.log(`  isEmpty:             ${reportA.factTable.isEmpty}`);
console.log(`  bgServiceCount:      ${reportA.meta.bgServiceCount}`);
console.log(`  actualRowCount:      ${reportA.meta.actualRowCount}`);
console.log(`  reconciliation:      ${reportA.reconciliationLine}`);
console.log(`  subject:             ${emailA.subject}`);

// Cross-check totals against a direct DB probe. If the report and
// the direct query disagree, one of them is wrong; the mount-verify
// exists to catch that class of bug before it ships.
console.log(`\n─── Direct DB cross-check ───`);
const { data: bgServices } = await supa
  .from("sc_qbo_service_map")
  .select("service_id, export_excluded")
  .eq("account_key", A.accountKey)
  .eq("export_excluded", true);
const bgServiceIds = (bgServices || []).map((r) => r.service_id);
const { data: actuals } = await supa
  .from("sc_daily_actuals")
  .select("service_date, service_id, actual_count")
  .eq("account_key", A.accountKey)
  .in("service_id", bgServiceIds)
  .gte("service_date", "2026-08-01")
  .lte("service_date", "2026-08-31");
const nonZero = (actuals || []).filter((r) => (r.actual_count || 0) > 0);
const directMeals = nonZero.reduce((s, r) => s + (r.actual_count || 0), 0);
const directDays = new Set(nonZero.map((r) => r.service_date)).size;
console.log(`  Direct query: ${bgServiceIds.length} B&G service(s), ${directDays} day(s) served, ${directMeals} meals total`);

const daysMatch  = directDays  === reportA.factTable.daysServed;
const mealsMatch = directMeals === reportA.factTable.meals;
console.log(`  daysServed match:  ${daysMatch ? "✔" : "✖"} (direct=${directDays}, report=${reportA.factTable.daysServed})`);
console.log(`  meals match:       ${mealsMatch ? "✔" : "✖"} (direct=${directMeals}, report=${reportA.factTable.meals})`);

// ─── Fixture B: September 2026 (whatever's in DB, likely partial) ──
const B = { accountKey: "TBR - FL", monthISO: "2026-09" };
console.log(`\n═══ Fixture B: ${B.accountKey} / ${B.monthISO} ═══`);
const reportB = await buildBgReport({ ...B, deps: { supa } });
const bufB = Buffer.from(await reportB.workbook.xlsx.writeBuffer());
const pathB = path.join(OUT_DIR, reportB.filename);
await fs.writeFile(pathB, bufB);
const emailB = renderBgReportEmail({
  accountKey: B.accountKey,
  factTable: reportB.factTable,
  reconciliationLine: reportB.reconciliationLine,
  generatedAt: new Date(),
});
await fs.writeFile(path.join(OUT_DIR, reportB.filename.replace(".xlsx", ".html")), emailB.html);
console.log(`  filename:  ${reportB.filename}`);
console.log(`  workbook:  ${(bufB.length / 1024).toFixed(1)} KB`);
console.log(`  daysServed: ${reportB.factTable.daysServed}, meals: ${reportB.factTable.meals}, revenue: $${(reportB.factTable.revenueCents / 100).toFixed(2)}`);
console.log(`  isEmpty:   ${reportB.factTable.isEmpty}`);
console.log(`  subject:   ${emailB.subject}`);

console.log(`\n═══ Fixtures written to ${OUT_DIR} ═══`);
console.log(`\nSpot-check checklist:`);
console.log(`  [ ] Open ${reportA.filename} - Daily/Weekly/Monthly sheets present`);
console.log(`  [ ] Daily sheet lists only days with actual_count > 0`);
console.log(`  [ ] Weekly sheet's meal count equals sum of daily counts in that week`);
console.log(`  [ ] Monthly sheet's Meals + Revenue match the fact-table above`);
console.log(`  [ ] Reconciliation line in Monthly sheet reads sensibly`);
console.log(`  [ ] Open ${reportA.filename.replace(".xlsx", ".html")} - intranet-shell email renders`);
console.log(`  [ ] Non-empty month shows green "Ready to bill" flag`);
console.log(`  [ ] If Fixture B is empty, its email shows grey "No B&G service this month" flag`);

try { await execFileP("open", [OUT_DIR]); console.log(`\nOpened ${OUT_DIR}`); }
catch { console.log("\n(auto-open failed - open manually)"); }
