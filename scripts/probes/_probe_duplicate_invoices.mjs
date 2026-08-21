// ════════════════════════════════════════════════════════════════════════════
// PROBE: Duplicate invoice submissions audit (Block 3 cleanup)
//
// READ-ONLY. No DB or Sheets writes.
//
// Answers two related cleanup questions:
//   (2) Duplicate ai_line_items - which (vendor, invoice_number) pairs were
//       submitted more than once, creating duplicate rows in ai_line_items?
//   (3) RAW-vs-processed ingestion - did extraction ingest only the submitted
//       version of a re-upload, or did both flow through?
//
// Methodology: groups invoice_submissions_26 rows by (vendor_norm,
// invoice_number) and reports groups with >1 submission. For each such
// group: how many uuids, how many timestamps, what the resubmission pattern
// looks like (FIXED_RESUBMITTED filename hints), and whether multiple uuids
// in the group have ai_line_items rows (= true duplicate ingestion).
// ════════════════════════════════════════════════════════════════════════════

import { safeRead, SHEET_IDS } from "../src/lib/sheets.js";

const SUB_IDX = {
  uuid:           0,
  submittedAt:    1,
  submitterEmail: 2,
  accountKey:     3,
  vendorName:     4,
  vendorId:       5,
  invoiceNumber:  6,
  invoiceDate:    7,
  totalAmount:    8,
  rawDriveUrl:   16,
  status:        13,
  type:          15,
};

function normVendor(v) {
  return String(v || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}
function normInvNum(n) {
  return String(n || "").trim().toUpperCase();
}

console.log("=".repeat(100));
console.log("DUPLICATE INVOICE SUBMISSIONS AUDIT");
console.log("=".repeat(100));

const { rows: subs } = await safeRead(SHEET_IDS.COLLECTION, "invoice_submissions_26");
console.log(`\nTotal invoice_submissions rows: ${subs.length}`);

// Group by (vendorNorm, invoiceNumber). Skip rows missing either.
const groups = new Map();
let skippedNoKey = 0;
for (const r of subs) {
  const v = normVendor(r[SUB_IDX.vendorName]);
  const i = normInvNum(r[SUB_IDX.invoiceNumber]);
  if (!v || !i) { skippedNoKey++; continue; }
  const key = `${v}::${i}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push({
    uuid: r[SUB_IDX.uuid],
    submittedAt: r[SUB_IDX.submittedAt],
    vendor: r[SUB_IDX.vendorName],
    invoiceNumber: r[SUB_IDX.invoiceNumber],
    accountKey: r[SUB_IDX.accountKey],
    type: r[SUB_IDX.type],
    status: r[SUB_IDX.status],
    rawDriveUrl: r[SUB_IDX.rawDriveUrl],
  });
}

console.log(`Rows with vendor+invoice# both set: ${subs.length - skippedNoKey}`);
console.log(`Skipped (missing vendor or invoice#): ${skippedNoKey}`);
console.log(`Distinct (vendor, invoice#) groups: ${groups.size}`);

// Groups with >1 submission
const dupes = [...groups.entries()].filter(([_k, arr]) => arr.length > 1);
console.log(`Groups with MULTIPLE submissions (duplicates): ${dupes.length}`);

// Total extra submissions
const extraSubs = dupes.reduce((s, [_k, arr]) => s + (arr.length - 1), 0);
console.log(`Extra submissions (beyond the first per group): ${extraSubs}`);
console.log("");

// Bucket the duplicates by likely cause
const buckets = { sameDay: 0, fixedResubmittedFilename: 0, otherMultiDay: 0 };
const byAccount = new Map();
for (const [_k, arr] of dupes) {
  arr.sort((a, b) => (a.submittedAt || "").localeCompare(b.submittedAt || ""));
  const firstTs = Date.parse(arr[0].submittedAt) || 0;
  const lastTs  = Date.parse(arr[arr.length - 1].submittedAt) || 0;
  const sameDay = firstTs && lastTs && (lastTs - firstTs) < 24 * 3600 * 1000;
  const filenameHint = arr.some((x) =>
    /fixed|resubmitted/i.test(x.rawDriveUrl || "")
  );
  if (sameDay) buckets.sameDay++;
  else if (filenameHint) buckets.fixedResubmittedFilename++;
  else buckets.otherMultiDay++;
  const acct = arr[0].accountKey || "(no account)";
  byAccount.set(acct, (byAccount.get(acct) || 0) + 1);
}

console.log("Duplicate buckets (heuristic):");
console.log(`   same-day duplicates (RAW + processed uploaded same day):     ${buckets.sameDay}`);
console.log(`   FIXED_RESUBMITTED filename present in group:                 ${buckets.fixedResubmittedFilename}`);
console.log(`   other multi-day duplicates (legit resubmits or operator dup):${buckets.otherMultiDay}`);
console.log("");

console.log("Duplicates by account (top 10):");
const accountRanked = [...byAccount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
for (const [a, n] of accountRanked) console.log(`   ${String(n).padStart(4)}  ${a}`);
console.log("");

// Show first 8 examples of each bucket
function showExamples(label, predicate) {
  console.log(`\n--- ${label} (up to 5 examples) ---`);
  let shown = 0;
  for (const [_k, arr] of dupes) {
    arr.sort((a, b) => (a.submittedAt || "").localeCompare(b.submittedAt || ""));
    const firstTs = Date.parse(arr[0].submittedAt) || 0;
    const lastTs  = Date.parse(arr[arr.length - 1].submittedAt) || 0;
    const sameDay = firstTs && lastTs && (lastTs - firstTs) < 24 * 3600 * 1000;
    const filenameHint = arr.some((x) => /fixed|resubmitted/i.test(x.rawDriveUrl || ""));
    if (!predicate({ sameDay, filenameHint })) continue;
    if (shown >= 5) break;
    shown++;
    const a0 = arr[0];
    console.log(`  ${a0.vendor} #${a0.invoiceNumber} (account=${a0.accountKey}) — ${arr.length} submissions:`);
    for (const x of arr) {
      const hint = /fixed|resubmitted/i.test(x.rawDriveUrl || "") ? " [FIXED/RESUBMITTED]" : "";
      console.log(`     ${x.submittedAt}  uuid8=${(x.uuid||"").slice(0,8)}  type=${x.type}  status=${x.status}${hint}`);
    }
  }
}

showExamples("SAME-DAY duplicates (probable RAW + processed upload pairs)", (b) => b.sameDay);
showExamples("FIXED/RESUBMITTED filename present", (b) => !b.sameDay && b.filenameHint);
showExamples("OTHER multi-day duplicates (legit resubmit OR operator dup)", (b) => !b.sameDay && !b.filenameHint);

// Now: which duplicate uuids actually got their lines ingested into ai_line_items?
// Strategy: read a handful of ai_line_items per-account tabs and check whether the
// duplicate uuids appear. Cheap subset, not exhaustive - want a signal not a census.
console.log("\n" + "=".repeat(100));
console.log("INGESTION CHECK: for a few duplicate groups, do MULTIPLE uuids appear in ai_line_items?");
console.log("=".repeat(100));

// Pick a handful of accounts with the most duplicates
const accountsToCheck = accountRanked.slice(0, 4).map(([a, _n]) => a).filter((a) => a !== "(no account)");
console.log(`Checking ai_line_items for accounts: ${accountsToCheck.join(", ")}\n`);

for (const account of accountsToCheck) {
  console.log(`\n--- account=${account} ---`);
  const { rows: liRows } = await safeRead(SHEET_IDS.AI_LINE_ITEMS, account);
  const uuidsInLi = new Set(liRows.map((r) => r[0]).filter(Boolean));
  console.log(`   ai_line_items rows: ${liRows.length}, distinct uuids: ${uuidsInLi.size}`);

  // For each duplicate group in this account, check uuids in li
  let groupsChecked = 0;
  let bothInLi = 0;
  let oneInLi = 0;
  let noneInLi = 0;
  const samples = { bothInLi: [], oneInLi: [] };
  for (const [_k, arr] of dupes) {
    if ((arr[0].accountKey || "") !== account) continue;
    groupsChecked++;
    const present = arr.filter((x) => uuidsInLi.has(x.uuid));
    if (present.length === arr.length) {
      bothInLi++;
      if (samples.bothInLi.length < 3) samples.bothInLi.push(arr);
    } else if (present.length > 0) {
      oneInLi++;
      if (samples.oneInLi.length < 3) samples.oneInLi.push({ arr, present });
    } else {
      noneInLi++;
    }
  }
  console.log(`   duplicate groups in this account: ${groupsChecked}`);
  console.log(`     ALL submissions in li (true duplicate ingestion): ${bothInLi}`);
  console.log(`     PARTIAL (only some uuids ingested - safe):        ${oneInLi}`);
  console.log(`     NONE in li (duplicate never reached extraction):  ${noneInLi}`);
  if (samples.bothInLi.length > 0) {
    console.log(`   Examples of true duplicate ingestion (all uuids in ai_line_items):`);
    for (const arr of samples.bothInLi) {
      const a0 = arr[0];
      const linesPerUuid = arr.map((x) => liRows.filter((r) => r[0] === x.uuid).length);
      console.log(`     ${a0.vendor} #${a0.invoiceNumber} uuids=${arr.map(x=>x.uuid.slice(0,8)).join("/")} lines-per-uuid=${linesPerUuid.join("/")}`);
    }
  }
}

console.log("\n" + "=".repeat(100));
console.log("INTERPRETATION:");
console.log("  ALL-in-li counts represent TRUE duplicate ai_line_items rows (one set per uuid).");
console.log("  PARTIAL counts are safe (only the first / final submission's lines reached li).");
console.log("  Same-day duplicates likely = RAW + processed both uploaded; FIXED/RESUBMITTED = operator");
console.log("  re-uploaded a corrected version; other multi-day = legit invoice resubmission.");
console.log("=".repeat(100));
