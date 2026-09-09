#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// _probe_record_copy_mount_verify.mjs
// Mount-verify for the RECORD COPY PDF (Kevin fence 2026-09-09).
// ═══════════════════════════════════════════════════════════════════
//
// Generates real PDFs from seeded invoiceRecords covering:
//   A. Single-slot light week (matches render fixture: TBR - FL, 6 lines)
//   B. Multi-slot heavy week (TBJ - FL, 3 slots, 30+ lines - forces
//      pagination + full-height render + logo/watermark on both pages)
//   C. Multi-approver week (Joe + Desiree) - proves the multi-approver
//      lede lands in the fact-table meta row
//
// Writes each PDF to ~/Downloads/ and opens it so Kevin can eyeball:
//   - watermark renders (NOT AN INVOICE, diagonal, translucent red)
//   - PFS logo resolves (top-right, navy transparent)
//   - line count matches input
//   - pretax total matches the email's fact table
//   - no invoice number appears
//   - approved-by meta reflects the multi-approver case
//
// Reports actual PDF byte size per Kevin's F2 ask - if a busy week
// generates 200KB rather than 40KB, kitchfix.admin@ accumulates fast
// and he wants the real number not an estimate.

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildRecordCopyPdf } from "../../src/lib/billing/recordCopyPdf.js";
import { fireN1 } from "../../src/lib/billing/qboNotifications.js";

const execFileP = promisify(execFile);

const OUT_DIR = path.join(os.homedir(), "Downloads",
  `record_copy_mount_verify_${new Date().toISOString().slice(0,10)}`);
await fs.mkdir(OUT_DIR, { recursive: true });

// ─── Fixture A: single-slot light week (matches render) ─────────
const FIXTURE_A_LINES = [
      { serviceName: "TBR MiLB - Breakfast",         serviceDate: "2026-08-25", qty: 120, rateCents: 1783, amountCents: 213960 },
      { serviceName: "TBR MiLB - Lunch/Dinner",      serviceDate: "2026-08-25", qty: 120, rateCents: 2168, amountCents: 260160 },
      { serviceName: "TBR MiLB - Road Sandwiches",   serviceDate: "2026-08-25", qty:  28, rateCents: 1100, amountCents:  30800 },
      { serviceName: "Extra Protein - Chicken/Pork", serviceDate: "2026-08-25", qty:   1, rateCents: 11184, amountCents:  11184 },
      { serviceName: "Labor Fee",                    serviceDate: "2026-08-25", qty:   1, rateCents: 28000, amountCents:  28000 },
      { serviceName: "TBR MiLB - Breakfast",         serviceDate: "2026-08-26", qty: 125, rateCents: 1783, amountCents: 222875 },
      { serviceName: "TBR MiLB - Lunch/Dinner",      serviceDate: "2026-08-26", qty: 125, rateCents: 2168, amountCents: 271000 },
      { serviceName: "TBR MiLB - Breakfast",         serviceDate: "2026-08-27", qty: 130, rateCents: 1783, amountCents: 231790 },
      { serviceName: "TBR MiLB - Lunch/Dinner",      serviceDate: "2026-08-27", qty: 130, rateCents: 2168, amountCents: 281840 },
      { serviceName: "TBR MiLB - Breakfast",         serviceDate: "2026-08-28", qty: 122, rateCents: 1783, amountCents: 217526 },
      { serviceName: "TBR MiLB - Lunch/Dinner",      serviceDate: "2026-08-28", qty: 122, rateCents: 2168, amountCents: 264496 },
      { serviceName: "Labor Fee",                    serviceDate: "2026-08-28", qty:   1, rateCents: 28000, amountCents:  28000 },
      { serviceName: "TBR MiLB - Breakfast",         serviceDate: "2026-08-29", qty: 128, rateCents: 1783, amountCents: 228224 },
      { serviceName: "TBR MiLB - Lunch/Dinner",      serviceDate: "2026-08-29", qty: 128, rateCents: 2168, amountCents: 277504 },
      { serviceName: "TBR MiLB - Breakfast",         serviceDate: "2026-08-30", qty: 118, rateCents: 1783, amountCents: 210394 },
      { serviceName: "TBR MiLB - Lunch/Dinner",      serviceDate: "2026-08-30", qty: 118, rateCents: 2168, amountCents: 255824 },
      { serviceName: "TBR MiLB - Breakfast",         serviceDate: "2026-08-31", qty: 115, rateCents: 1783, amountCents: 205045 },
      { serviceName: "TBR MiLB - Lunch/Dinner",      serviceDate: "2026-08-31", qty: 115, rateCents: 2168, amountCents: 249320 },
];
const FIXTURE_A_PRETAX = FIXTURE_A_LINES.reduce((s, l) => s + l.amountCents, 0);
const FIXTURE_A = {
  accountKey: "TBR - FL",
  accountLabel: "Tampa Bay Rays",
  weekStart: "2026-08-25",
  weekEnd:   "2026-08-31",
  finalizedDateISO: "2026-09-01",
  approvedByLabel: "Joe Coppolino",
  invoiceRecords: [{
    invoiceSlot: "TBR-MiLB",
    pretaxTotalCents: FIXTURE_A_PRETAX,
    lineItems: FIXTURE_A_LINES,
  }],
};

// ─── Fixture B: multi-slot heavy week (forces pagination) ───────
const FIXTURE_B = {
  accountKey: "TBJ - FL",
  accountLabel: "Tampa Bay Jays",
  weekStart: "2026-08-25",
  weekEnd:   "2026-08-31",
  finalizedDateISO: "2026-09-01",
  approvedByLabel: "Diego Diaz",
  invoiceRecords: (() => {
    // 4 slots x 15 lines each = 60 lines. Will paginate.
    const slots = ["MiLB", "MLB", "SSM", "Media"];
    const out = [];
    for (const slot of slots) {
      const lineItems = [];
      for (let d = 25; d <= 31; d++) {
        for (const svc of ["Breakfast", "Lunch/Dinner"]) {
          lineItems.push({
            serviceName: `${slot} - ${svc}`,
            serviceDate: `2026-08-${String(d).padStart(2, "0")}`,
            qty: 50 + Math.floor(Math.random() * 20),
            rateCents: 1500,
            amountCents: 75000,
          });
        }
      }
      out.push({
        invoiceSlot: `TBJ - ${slot}`,
        pretaxTotalCents: lineItems.reduce((s, l) => s + l.amountCents, 0),
        lineItems,
      });
    }
    return out;
  })(),
};

// ─── Fixture C: multi-approver week (via fireN1 for full HTML) ──
const FIXTURE_C_ARGS = {
  qboMode: "test",
  accountKey: "TBR - FL",
  accountLabel: "Tampa Bay Rays",
  weekStart: "2026-08-25",
  weekEnd:   "2026-08-31",
  submitterEmail: "joe@kitchfix.com",
  submitterName: "Joe Coppolino",
  invoiceRecords: FIXTURE_A.invoiceRecords.map((r) => ({ ...r, isTest: true })),
  scWeekLink: "http://localhost:3000/service-calendar?account=TBR%20-%20FL&day=2026-08-25",
  accountMap: { salariedManagerEmails: [], rdoEmail: null },
  finalizedDateISO: "2026-09-01",
  daysInWeek: 7,
  // 4/6 days Joe, 2/6 days Desiree - the case Kevin surfaced.
  reviewRows: [
    { reviewedBy: "Joe Coppolino",  reviewedAt: "2026-08-31T22:00:00Z" },
    { reviewedBy: "Joe Coppolino",  reviewedAt: "2026-08-31T22:01:00Z" },
    { reviewedBy: "Joe Coppolino",  reviewedAt: "2026-08-31T22:02:00Z" },
    { reviewedBy: "Joe Coppolino",  reviewedAt: "2026-08-31T22:03:00Z" },
    { reviewedBy: "Desiree Colone", reviewedAt: "2026-08-31T22:04:00Z" },
    { reviewedBy: "Desiree Colone", reviewedAt: "2026-08-31T22:05:00Z" },
  ],
  // send=false: compose only, no live send. Kevin does not need
  // the email in his inbox to eyeball the PDF; the render tells us
  // if the HTML lede is correct.
  send: false,
};

const summary = [];

async function runPdfOnly(label, fixture) {
  const out = await buildRecordCopyPdf(fixture);
  const dest = path.join(OUT_DIR, out.filename);
  await fs.writeFile(dest, out.pdfBuffer);
  summary.push({
    label, filename: out.filename, byteLength: out.pdfBuffer.length,
    pretaxCents: out.pretaxCents, lineCount: out.lineCount,
    approvedByLabel: fixture.approvedByLabel,
  });
  return dest;
}

async function runFireN1(label, args) {
  const res = await fireN1(args);
  // Save both the PDF (from res.pdf.filename via buildRecordCopyPdf
  // re-run since fireN1's return doesn't expose the buffer) and the
  // HTML for visual inspection.
  const pdfOut = await buildRecordCopyPdf({
    accountKey: args.accountKey,
    accountLabel: args.accountLabel,
    weekStart: args.weekStart,
    weekEnd: args.weekEnd,
    finalizedDateISO: args.finalizedDateISO,
    approvedByLabel: res.approvers.length === 1
      ? res.approvers[0]
      : res.approvers.length === 2
        ? `${res.approvers[0]} and ${res.approvers[1]}`
        : res.approvers.slice(0, 3).join(", "),
    invoiceRecords: args.invoiceRecords,
  });
  const pdfDest  = path.join(OUT_DIR, pdfOut.filename);
  const htmlDest = path.join(OUT_DIR, pdfOut.filename.replace(".pdf", ".html"));
  await fs.writeFile(pdfDest, pdfOut.pdfBuffer);
  await fs.writeFile(htmlDest, res.html);
  summary.push({
    label, filename: pdfOut.filename, htmlFilename: path.basename(htmlDest),
    byteLength: pdfOut.pdfBuffer.length,
    pretaxCents: pdfOut.pretaxCents, lineCount: pdfOut.lineCount,
    subject: res.subject,
    approvers: res.approvers,
    emailPreheader: res.preheader,
  });
  return { pdfDest, htmlDest };
}

console.log("─── A: single-slot light week (TBR - FL, 18 lines, 1 approver) ───");
const aPath = await runPdfOnly("A_light_single_slot", FIXTURE_A);
console.log(`  ${aPath}`);

console.log("─── B: multi-slot heavy week (TBJ - FL, 4 slots x 14 lines = 56 lines, forces pagination) ───");
const bPath = await runPdfOnly("B_heavy_multi_slot", FIXTURE_B);
console.log(`  ${bPath}`);

console.log("─── C: multi-approver week via fireN1 (send=false) ───");
const { pdfDest: cPdf, htmlDest: cHtml } = await runFireN1("C_multi_approver", FIXTURE_C_ARGS);
console.log(`  ${cPdf}`);
console.log(`  ${cHtml}`);

console.log("\n═══ SUMMARY ═══");
for (const s of summary) {
  console.log(`\n${s.label}:`);
  console.log(`  filename:    ${s.filename}`);
  console.log(`  byteLength:  ${s.byteLength.toLocaleString()} bytes (${(s.byteLength / 1024).toFixed(1)} KB)`);
  console.log(`  pretaxCents: ${s.pretaxCents} ($${(s.pretaxCents / 100).toFixed(2)})`);
  console.log(`  lineCount:   ${s.lineCount}`);
  if (s.approvedByLabel) console.log(`  approvedBy:  ${s.approvedByLabel}`);
  if (s.approvers) console.log(`  approvers:   [${s.approvers.join(", ")}]`);
  if (s.subject) console.log(`  subject:     ${s.subject}`);
  if (s.emailPreheader) console.log(`  preheader:   ${s.emailPreheader}`);
  if (s.htmlFilename) console.log(`  html:        ${s.htmlFilename}`);
}

console.log("\n─── Opening PDFs for visual verification ───");
try {
  await execFileP("open", [OUT_DIR]);
  console.log(`Opened ${OUT_DIR}`);
} catch (_) {
  console.log("(auto-open failed, please open manually)");
}
console.log("\nCheck each PDF:");
console.log("  [ ] Watermark 'NOT AN INVOICE' renders diagonally in translucent red");
console.log("  [ ] PFS logo resolves (top-right, navy transparent)");
console.log("  [ ] Every line has a Service, Date, Qty, Rate, Amount");
console.log("  [ ] Pre-tax total in PDF footer matches the pretaxCents in this summary");
console.log("  [ ] No 'INV-', 'Invoice #', or 'Invoice No.' pattern anywhere");
console.log("  [ ] Fixture B: watermark + logo appear on BOTH pages (pagination)");
console.log("  [ ] Fixture C: HTML lede reads 'Joe Coppolino and Desiree Colone approved the week'");
