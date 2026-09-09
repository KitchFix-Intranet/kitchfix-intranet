// recordCopyPdf.test.mjs
//
// Tests for the RECORD COPY PDF generator + approver-phrase helper.
// The PDF is opaque to text-grep once rendered (drawText writes into
// content streams that pdf-lib does not re-expose as searchable text),
// but the returned pretaxCents + filename + lineCount give enough of
// a contract to assert against. The mount-verify probe opens a real
// PDF and asserts visually (watermark, logo, layout).

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRecordCopyPdf,
  buildRecordCopyFilename,
  computeApproverPhrase,
} from "./recordCopyPdf.js";

const SEED_WEEK = {
  accountKey: "TBR - FL",
  accountLabel: "Tampa Bay Rays",
  weekStart: "2026-08-25",
  weekEnd:   "2026-08-31",
  finalizedDateISO: "2026-09-01",
  approvedByLabel: "Joe Coppolino",
  invoiceRecords: [
    {
      invoiceSlot: "TBR-MiLB",
      pretaxTotalCents: 566919,
      lineItems: [
        { serviceName: "TBR MiLB - Breakfast",        serviceDate: "2026-08-25", qty: 120, rateCents: 1783, amountCents: 213960 },
        { serviceName: "TBR MiLB - Lunch/Dinner",     serviceDate: "2026-08-25", qty: 120, rateCents: 2168, amountCents: 260160 },
        { serviceName: "TBR MiLB - Road Sandwiches",  serviceDate: "2026-08-25", qty:  28, rateCents: 1100, amountCents:  30800 },
        { serviceName: "Extra Protein - Chicken/Pork", serviceDate: "2026-08-25", qty:   1, rateCents: 11184, amountCents:  11184 },
        { serviceName: "Labor Fee",                    serviceDate: "2026-08-25", qty:   1, rateCents: 28000, amountCents:  28000 },
        { serviceName: "TBR MiLB - Breakfast",        serviceDate: "2026-08-26", qty: 125, rateCents: 1783, amountCents: 222875 },
      ],
    },
  ],
};

// ─── buildRecordCopyFilename ────────────────────────────────────

test("filename: strips spaces from account key", () => {
  assert.equal(
    buildRecordCopyFilename("TBR - FL", "2026-08-25"),
    "TBR-FL_week-of-Aug-25_record-copy.pdf",
  );
});

test("filename: MLB tri-part account (TXR - TX - H)", () => {
  assert.equal(
    buildRecordCopyFilename("TXR - TX - H", "2026-08-25"),
    "TXR-TX-H_week-of-Aug-25_record-copy.pdf",
  );
});

test("filename: month/day formatted without leading zero", () => {
  assert.equal(
    buildRecordCopyFilename("TBR - FL", "2026-09-01"),
    "TBR-FL_week-of-Sep-1_record-copy.pdf",
  );
});

test("filename: THROWS on em-dash in account key (positive test per Kevin ruling)", () => {
  // Per the CC prompt "confirm that survives an account key with
  // spaces and an em-dash": today no account has an em-dash, and if
  // one is ever introduced it should fail loudly at build time, not
  // silently produce a broken filename.
  assert.throws(
    () => buildRecordCopyFilename("TBR — FL", "2026-08-25"),
    /em-dash/i,
  );
});

test("filename: handles empty account gracefully (empty prefix)", () => {
  assert.equal(
    buildRecordCopyFilename("", "2026-08-25"),
    "_week-of-Aug-25_record-copy.pdf",
  );
});

// ─── buildRecordCopyPdf: contract shape ─────────────────────────

test("buildRecordCopyPdf: returns pdfBuffer + pdfBase64 + filename + pretaxCents + lineCount", async () => {
  const out = await buildRecordCopyPdf(SEED_WEEK);
  assert.ok(Buffer.isBuffer(out.pdfBuffer), "pdfBuffer must be a Buffer");
  assert.ok(out.pdfBuffer.length > 1000, "PDF bytes must be non-trivial");
  assert.equal(typeof out.pdfBase64, "string");
  assert.equal(out.filename, "TBR-FL_week-of-Aug-25_record-copy.pdf");
  assert.equal(out.lineCount, SEED_WEEK.invoiceRecords[0].lineItems.length);
  // 213960 + 260160 + 30800 + 11184 + 28000 + 222875 = 766979
  assert.equal(out.pretaxCents, 766979,
    "pretaxCents must be the exact sum of every line's amountCents");
});

test("buildRecordCopyPdf: PDF starts with %PDF- magic", async () => {
  const out = await buildRecordCopyPdf(SEED_WEEK);
  assert.equal(out.pdfBuffer.subarray(0, 5).toString("utf-8"), "%PDF-");
});

test("buildRecordCopyPdf: multi-slot week aggregates lines across slots", async () => {
  const multiSlot = {
    ...SEED_WEEK,
    invoiceRecords: [
      { invoiceSlot: "TBJ - Meals",       pretaxTotalCents: 100000, lineItems: [
        { serviceName: "Meals",  serviceDate: "2026-08-25", qty: 100, rateCents: 1000, amountCents: 100000 },
      ] },
      { invoiceSlot: "TBJ - Snacks",      pretaxTotalCents:  30000, lineItems: [
        { serviceName: "Snacks", serviceDate: "2026-08-25", qty: 30,  rateCents: 1000, amountCents:  30000 },
      ] },
      { invoiceSlot: "TBJ - Beverages",   pretaxTotalCents:  25000, lineItems: [
        { serviceName: "Beverages", serviceDate: "2026-08-25", qty: 25, rateCents: 1000, amountCents: 25000 },
      ] },
    ],
  };
  const out = await buildRecordCopyPdf(multiSlot);
  assert.equal(out.pretaxCents, 155000);
  assert.equal(out.lineCount, 3);
});

test("buildRecordCopyPdf: unknown invoice-number-shaped fields on invoiceRecords are ignored (construction invariant)", async () => {
  // The invariant: this document must never carry a QBO invoice
  // number, even once QBO assigns one. Enforced by construction -
  // buildRecordCopyPdf reads only lineItems out of each invoiceRecord.
  // This test proves the invariant by rendering with vs without a
  // qboInvoiceNumber field on each record + asserting byte-identical
  // output (unknown fields cannot leak into a drawn text).
  //
  // Presence-in-content-stream assertions live in the mount-verify
  // probe (open the PDF, walk text). pdf-lib compresses content
  // streams and inflating them client-side is out of scope here.
  const cleanRecords = SEED_WEEK.invoiceRecords;
  const withInvoiceNumbers = cleanRecords.map((r) => ({
    ...r,
    qboInvoiceNumber: "INV-987654",
    docNumber: "12345",
    invoiceNumber: "INV/2026-987",
  }));
  const [outClean, outWithNumbers] = await Promise.all([
    buildRecordCopyPdf({ ...SEED_WEEK, invoiceRecords: cleanRecords }),
    buildRecordCopyPdf({ ...SEED_WEEK, invoiceRecords: withInvoiceNumbers }),
  ]);
  // Bytes differ only where a Date-based boundary/id lives; strip
  // pdf-lib's timestamp metadata and compare the rest.
  const stripTimestamps = (buf) =>
    buf.toString("latin1")
      .replace(/\/CreationDate \([^)]+\)/g, "")
      .replace(/\/ModDate \([^)]+\)/g, "")
      .replace(/\/ID \[[^\]]+\]/g, "");
  assert.equal(
    stripTimestamps(outClean.pdfBuffer),
    stripTimestamps(outWithNumbers.pdfBuffer),
    "unknown invoice-number fields must not affect PDF output",
  );
});

test("buildRecordCopyPdf: page count matches input volume (single page for a light week, 2+ for a heavy week)", async () => {
  // Watermark presence + text presence are asserted by the mount-
  // verify probe (opens the actual PDF, walks text). Here we assert
  // the pagination invariant: a light week fits one page, a heavy
  // week overflows. Pagination breakage would be visible as
  // wrong page count.
  const { PDFDocument } = await import("pdf-lib");
  const light = await buildRecordCopyPdf(SEED_WEEK);
  const lightDoc = await PDFDocument.load(light.pdfBuffer);
  assert.equal(lightDoc.getPageCount(), 1, "light week (6 lines) fits one page");

  const heavyRecords = [{
    invoiceSlot: "TBJ - Meals",
    pretaxTotalCents: 0,
    lineItems: Array.from({ length: 80 }).map((_, i) => ({
      serviceName: `Line ${i + 1}`,
      serviceDate: "2026-08-25",
      qty: 1, rateCents: 100, amountCents: 100,
    })),
  }];
  const heavy = await buildRecordCopyPdf({ ...SEED_WEEK, invoiceRecords: heavyRecords });
  const heavyDoc = await PDFDocument.load(heavy.pdfBuffer);
  assert.ok(heavyDoc.getPageCount() >= 2, "80-line week must overflow to a second page");
});

test("buildRecordCopyPdf: empty invoiceRecords -> pretaxCents=0 + lineCount=0 (no crash)", async () => {
  const out = await buildRecordCopyPdf({ ...SEED_WEEK, invoiceRecords: [] });
  assert.equal(out.pretaxCents, 0);
  assert.equal(out.lineCount, 0);
  assert.ok(Buffer.isBuffer(out.pdfBuffer));
});

// ─── computeApproverPhrase ──────────────────────────────────────

test("computeApproverPhrase: 1 approver == finalizer uses render's exact wording", () => {
  const phrase = computeApproverPhrase({
    reviewRows: [
      { reviewedBy: "Joe Coppolino", reviewedAt: "2026-08-31T22:00:00Z" },
      { reviewedBy: "Joe Coppolino", reviewedAt: "2026-08-31T22:01:00Z" },
    ],
    finalizerName: "Joe Coppolino",
    accountKey: "TBR - FL",
  });
  assert.equal(phrase.lede, "Joe Coppolino approved every day and sent TBR - FL to billing.");
  assert.equal(phrase.meta, "Joe Coppolino");
  assert.deepEqual(phrase.approvers, ["Joe Coppolino"]);
});

test("computeApproverPhrase: 1 approver != finalizer splits the clause", () => {
  const phrase = computeApproverPhrase({
    reviewRows: [{ reviewedBy: "Desiree Colone", reviewedAt: "2026-08-31T22:00:00Z" }],
    finalizerName: "Joe Coppolino",
    accountKey: "TBR - FL",
  });
  assert.equal(phrase.lede, "Desiree Colone approved every day. Joe Coppolino sent TBR - FL to billing.");
  assert.equal(phrase.meta, "Desiree Colone");
});

test("computeApproverPhrase: 2 approvers uses 'and' + names both", () => {
  const phrase = computeApproverPhrase({
    reviewRows: [
      { reviewedBy: "Joe Coppolino", reviewedAt: "2026-08-31T22:00:00Z" },
      { reviewedBy: "Joe Coppolino", reviewedAt: "2026-08-31T22:01:00Z" },
      { reviewedBy: "Joe Coppolino", reviewedAt: "2026-08-31T22:02:00Z" },
      { reviewedBy: "Joe Coppolino", reviewedAt: "2026-08-31T22:03:00Z" },
      { reviewedBy: "Desiree Colone", reviewedAt: "2026-08-31T22:04:00Z" },
      { reviewedBy: "Desiree Colone", reviewedAt: "2026-08-31T22:05:00Z" },
    ],
    finalizerName: "Joe Coppolino",
    accountKey: "TBR - FL",
  });
  assert.equal(phrase.lede,
    "Joe Coppolino and Desiree Colone approved the week. Joe Coppolino sent TBR - FL to billing.");
  assert.equal(phrase.meta, "Joe Coppolino and Desiree Colone");
});

test("computeApproverPhrase: 3 approvers use Oxford comma", () => {
  const phrase = computeApproverPhrase({
    reviewRows: [
      { reviewedBy: "Joe Coppolino",  reviewedAt: "2026-08-31T22:00:00Z" },
      { reviewedBy: "Joe Coppolino",  reviewedAt: "2026-08-31T22:01:00Z" },
      { reviewedBy: "Joe Coppolino",  reviewedAt: "2026-08-31T22:02:00Z" },
      { reviewedBy: "Desiree Colone", reviewedAt: "2026-08-31T22:03:00Z" },
      { reviewedBy: "Desiree Colone", reviewedAt: "2026-08-31T22:04:00Z" },
      { reviewedBy: "Steve Groves",   reviewedAt: "2026-08-31T22:05:00Z" },
    ],
    finalizerName: "Joe Coppolino",
    accountKey: "TBR - FL",
  });
  assert.equal(phrase.lede,
    "Joe Coppolino, Desiree Colone, and Steve Groves approved the week. Joe Coppolino sent TBR - FL to billing.");
});

test("computeApproverPhrase: 4 approvers -> top 3 + 'and 1 other'", () => {
  const phrase = computeApproverPhrase({
    reviewRows: [
      { reviewedBy: "A", reviewedAt: "2026-08-31T22:00:00Z" },
      { reviewedBy: "A", reviewedAt: "2026-08-31T22:01:00Z" },
      { reviewedBy: "A", reviewedAt: "2026-08-31T22:02:00Z" },
      { reviewedBy: "B", reviewedAt: "2026-08-31T22:03:00Z" },
      { reviewedBy: "B", reviewedAt: "2026-08-31T22:04:00Z" },
      { reviewedBy: "C", reviewedAt: "2026-08-31T22:05:00Z" },
      { reviewedBy: "D", reviewedAt: "2026-08-31T22:06:00Z" },
    ],
    finalizerName: "A",
    accountKey: "TXR - AZ",
  });
  assert.equal(phrase.lede,
    "A, B, C and 1 other approved the week. A sent TXR - AZ to billing.");
});

test("computeApproverPhrase: 5 approvers -> 'and 2 others'", () => {
  const phrase = computeApproverPhrase({
    reviewRows: ["A","B","C","D","E"].map((n, i) =>
      ({ reviewedBy: n, reviewedAt: `2026-08-31T22:0${i}:00Z` })),
    finalizerName: "A",
    accountKey: "TXR - AZ",
  });
  assert.match(phrase.lede, /and 2 others approved the week/);
});

test("computeApproverPhrase: sorts by count DESC then earliest-timestamp ASC (deterministic)", () => {
  const phrase = computeApproverPhrase({
    reviewRows: [
      { reviewedBy: "Steve Groves",   reviewedAt: "2026-08-31T22:00:00Z" },
      { reviewedBy: "Joe Coppolino",  reviewedAt: "2026-08-31T21:00:00Z" },
      { reviewedBy: "Joe Coppolino",  reviewedAt: "2026-08-31T22:00:00Z" },
      { reviewedBy: "Desiree Colone", reviewedAt: "2026-08-31T21:00:00Z" },
      { reviewedBy: "Desiree Colone", reviewedAt: "2026-08-31T22:00:00Z" },
    ],
    finalizerName: "Joe Coppolino",
    accountKey: "TBR - FL",
  });
  // Joe + Desiree both have 2, Steve has 1. Tie-break Joe vs Desiree
  // by earliest ts (both 21:00) then alphabetical -> Desiree first
  // alphabetically. Confirm the ordering is deterministic and correct.
  assert.deepEqual(phrase.approvers, ["Desiree Colone", "Joe Coppolino", "Steve Groves"]);
});

test("computeApproverPhrase: empty rows -> falls back to submitter clause only", () => {
  const phrase = computeApproverPhrase({
    reviewRows: [],
    finalizerName: "Joe Coppolino",
    accountKey: "TBR - FL",
  });
  assert.equal(phrase.lede, "Joe Coppolino sent TBR - FL to billing.");
  assert.equal(phrase.meta, "Joe Coppolino");
  assert.deepEqual(phrase.approvers, []);
});

test("computeApproverPhrase: whitespace + empty names are dropped", () => {
  const phrase = computeApproverPhrase({
    reviewRows: [
      { reviewedBy: "  ", reviewedAt: "2026-08-31T22:00:00Z" },
      { reviewedBy: "",   reviewedAt: "2026-08-31T22:01:00Z" },
      { reviewedBy: null, reviewedAt: "2026-08-31T22:02:00Z" },
      { reviewedBy: "Joe Coppolino", reviewedAt: "2026-08-31T22:03:00Z" },
    ],
    finalizerName: "Joe Coppolino",
    accountKey: "TBR - FL",
  });
  assert.deepEqual(phrase.approvers, ["Joe Coppolino"]);
});
