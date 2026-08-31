// USAGE (path aliases required)
// This probe imports from the `@/…` path alias, which Node cannot resolve
// on its own. Run with the alias hook installed via `--import`:
//
//   node --env-file=.env.local \
//        --import ./scripts/probes/_at_alias_hook.mjs \
//        scripts/probes/<this-file>
//
// Running without --import fails at import time with
//   `Cannot find package '@/…'`
// which reads identically to a probe defect - added 2026-08-31 after
// PR #916 review named this as the sentinel-#4 root cause.
// Part 1 - classify Bug 1 dup excess rows by A1 vs A2 upstream scenario.
//
// A1 (ref was "new" conf >= 60, queued as possible_new): when the cron's
//   batch_match orphan fired, it ALSO created a possible_new review_queue
//   row for the ref item. So we should find a co-occurring queue row with
//   reason="possible_new" for the same description, same account, in the
//   same cron run.
//
// A2 (ref was "match"): no queue row was created for the ref. No co-
//   occurring possible_new row exists.
//
// Heuristic: for each Bug 1 dup excess row (the NEWER row in each group),
// look for a review_queue row with:
//   - account match
//   - reason="possible_new"
//   - lineItemText or suggestedMatchName whose normalize matches the
//     dup row's normalized name
//   - cron created the queue row within the same nightly window (same
//     UTC date or within 12 hours)
import { readSheetSA, SHEET_IDS } from "@/lib/sheets";

function accountMatch(rowAccount, activeAccount) {
  if (!rowAccount || !activeAccount) return false;
  if (rowAccount === activeAccount) return true;
  return rowAccount.startsWith(activeAccount + " -") || activeAccount.startsWith(rowAccount + " -");
}
function normalizeName(name) {
  return (name || "").toLowerCase().replace(/[^a-z0-9]/g, "").trim();
}

const CAT_IDX = {
  itemId: 0, account: 1, name: 2, primaryVendor: 6, active: 11,
  createdBy: 14, createdAt: 15, status: 16,
};
const RQ_IDX = {
  queueId: 0, lineItemText: 1, vendor: 2, invoiceId: 3, invoiceDate: 4,
  account: 5, suggestedMatchId: 6, suggestedMatchName: 7, confidence: 8,
  status: 9, reviewedBy: 10, reviewedAt: 11, resultItemId: 12, reason: 13,
};

// Reuse the classifier logic from coverage-split probe
const catData = await readSheetSA(SHEET_IDS.INVENTORY, "item_catalog");
const active = (catData.rows || []).filter((r) => {
  if (r[CAT_IDX.active] !== "TRUE" && r[CAT_IDX.active] !== true) return false;
  const s = String(r[CAT_IDX.status] || "").trim().toLowerCase();
  if (s === "excluded" || s === "archived" || s === "review_deleted") return false;
  return true;
});

const groupsRaw = new Map();
for (const r of active) {
  const k = (r[CAT_IDX.account] || "") + " :: " + normalizeName(r[CAT_IDX.name]);
  if (!groupsRaw.has(k)) groupsRaw.set(k, []);
  groupsRaw.get(k).push(r);
}
const dupGroups = [...groupsRaw.entries()]
  .filter(([_, rows]) => rows.length > 1)
  .map(([k, rows]) => ({ key: k, rows }));

// Bug 1 = single-vendor groups
const bug1Groups = dupGroups.filter((g) => {
  const v = new Set(g.rows.map((r) => normalizeName(r[CAT_IDX.primaryVendor])));
  v.delete("");
  return v.size === 1;
});
console.log("Bug 1 groups: " + bug1Groups.length);
const bug1ExcessRows = [];
for (const g of bug1Groups) {
  const sorted = [...g.rows].sort((a, b) => String(a[CAT_IDX.createdAt]).localeCompare(String(b[CAT_IDX.createdAt])));
  // every row beyond the first is excess
  for (let i = 1; i < sorted.length; i++) bug1ExcessRows.push(sorted[i]);
}
console.log("Bug 1 excess rows (the dup creates): " + bug1ExcessRows.length);

// Read review_queue
const rqData = await readSheetSA(SHEET_IDS.INVENTORY, "review_queue");
const queueRows = rqData.rows || [];
console.log("Total review_queue rows in Sheets: " + queueRows.length);

const possibleNewRows = queueRows.filter((r) =>
  String(r[RQ_IDX.reason] || "").trim() === "possible_new"
);
console.log("review_queue rows with reason=possible_new: " + possibleNewRows.length);

// Build a lookup keyed by (account, normalizedName) -> list of queue rows
// where normalizedName is the normalize of EITHER lineItemText OR
// suggestedMatchName (we don't know which Claude used at write time, so
// match on either).
const queueByKey = new Map();
function addToIndex(map, key, row) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(row);
}
for (const r of possibleNewRows) {
  const acct = r[RQ_IDX.account] || "";
  const k1 = acct + " :: " + normalizeName(r[RQ_IDX.lineItemText]);
  const k2 = acct + " :: " + normalizeName(r[RQ_IDX.suggestedMatchName]);
  addToIndex(queueByKey, k1, r);
  if (k1 !== k2) addToIndex(queueByKey, k2, r);
}

// Also build a broader index where account matching is fuzzy (accountMatch
// rules) so we catch long-form account labels. queue.account uses long-form
// in some old rows.
const queueByVendorAccountKey = new Map();
for (const r of possibleNewRows) {
  const acct = r[RQ_IDX.account] || "";
  // We will fuzz-match the catalog row's short-form account against this.
  addToIndex(queueByVendorAccountKey, acct, r);
}

// Classify each Bug 1 excess row
const a1Rows = [];
const a2Rows = [];
const ambiguousRows = [];

function findCoOccurringPossibleNew(catalogRow) {
  const acct = catalogRow[CAT_IDX.account] || "";
  const nameKey = normalizeName(catalogRow[CAT_IDX.name]);

  // Exact account match first
  const exactKey = acct + " :: " + nameKey;
  const exact = queueByKey.get(exactKey) || [];

  // Fuzzy account match (accountMatch with all possible_new account values)
  const fuzzyMatches = [];
  for (const r of possibleNewRows) {
    if (accountMatch(r[RQ_IDX.account], acct) || accountMatch(acct, r[RQ_IDX.account])) {
      const lit = normalizeName(r[RQ_IDX.lineItemText]);
      const smn = normalizeName(r[RQ_IDX.suggestedMatchName]);
      if (lit === nameKey || smn === nameKey) fuzzyMatches.push(r);
    }
  }
  // Combine + dedup by queueId
  const all = [];
  const seen = new Set();
  for (const r of [...exact, ...fuzzyMatches]) {
    const qid = r[RQ_IDX.queueId];
    if (!seen.has(qid)) { all.push(r); seen.add(qid); }
  }
  return all;
}

for (const catalogRow of bug1ExcessRows) {
  const matches = findCoOccurringPossibleNew(catalogRow);

  if (matches.length === 0) {
    a2Rows.push({ catalogRow, matches });
    continue;
  }

  // Has matches - check timing. The queue row's status (pending/accepted/rejected)
  // doesn't matter for our diagnosis - the key is: was a possible_new queue row
  // EVER created for this item co-temporally with the catalog row?
  const catalogCreated = catalogRow[CAT_IDX.createdAt] || "";
  const catalogDate = catalogCreated.slice(0, 10);

  // Best signal: queue row's reviewedAt is null (means it was created and never reviewed)
  // AND status is "pending" or empty - this is the chronic-fail-loop residue. The cron
  // typically writes the queue row at the same nightly run as the orphan catalog row.
  // We can't get the queue row's createdAt directly (no column for it), but
  // co-occurrence by reason+account+name is strong enough.
  a1Rows.push({ catalogRow, matches });
}

console.log();
console.log("=============================================================");
console.log("A1 vs A2 SPLIT (Bug 1 excess rows, n=" + bug1ExcessRows.length + ")");
console.log("=============================================================");
console.log("A1 (co-occurring possible_new queue row found): " + a1Rows.length + " (" + ((a1Rows.length / bug1ExcessRows.length) * 100).toFixed(0) + "%)");
console.log("A2 (no co-occurring queue row found):           " + a2Rows.length + " (" + ((a2Rows.length / bug1ExcessRows.length) * 100).toFixed(0) + "%)");
console.log("Ambiguous:                                       " + ambiguousRows.length);

console.log();
console.log("=============================================================");
console.log("SAMPLES");
console.log("=============================================================");
console.log();
console.log("A1 candidates (first 5) - the dup catalog row AND its possible_new queue row:");
for (const { catalogRow, matches } of a1Rows.slice(0, 5)) {
  console.log();
  console.log("  Dup catalog: \"" + catalogRow[CAT_IDX.name] + "\"  acct=" + catalogRow[CAT_IDX.account] + "  created=" + catalogRow[CAT_IDX.createdAt]);
  console.log("  Co-occurring queue rows (n=" + matches.length + "):");
  for (const q of matches.slice(0, 2)) {
    console.log("    queueId=" + q[RQ_IDX.queueId] + "  acct=" + q[RQ_IDX.account] + "  reason=" + q[RQ_IDX.reason] + "  status=\"" + q[RQ_IDX.status] + "\"");
    console.log("      lineItemText=\"" + q[RQ_IDX.lineItemText] + "\"  suggestedMatchName=\"" + q[RQ_IDX.suggestedMatchName] + "\"");
  }
}

console.log();
console.log("A2 candidates (first 5) - the dup catalog row with NO matching queue row:");
for (const { catalogRow } of a2Rows.slice(0, 5)) {
  console.log("  \"" + catalogRow[CAT_IDX.name] + "\"  acct=" + catalogRow[CAT_IDX.account] + "  created=" + catalogRow[CAT_IDX.createdAt]);
}

console.log();
console.log("=============================================================");
console.log("CAVEATS");
console.log("=============================================================");
console.log("This signal has known limitations:");
console.log("- review_queue ONLY contains rows that have not been deleted in cleanup.");
console.log("  The 2026-06-10 review_queue cleanup deleted 677 dup queue rows; some");
console.log("  of the A1 fingerprints may have been swept up in that cleanup.");
console.log("- review_queue's lineItemText may differ from the catalog name (catalog has");
console.log("  the canonical-name normalization applied; queue row carries raw description).");
console.log("- A single ref item produces ONE possible_new queue row, but the orphan path");
console.log("  may have fired multiple times (creating N dup catalog rows from N batch_match");
console.log("  siblings). The N:1 catalog:queue ratio means some A1 dup-catalog rows have");
console.log("  the SAME queue row as their fingerprint, but only one of them shows up matched.");
console.log("- We cannot disambiguate \"A1 with queue row swept up by cleanup\" from \"true A2\".");
console.log("  The number above is a lower-bound on A1 / upper-bound on A2.");
process.exit(0);
