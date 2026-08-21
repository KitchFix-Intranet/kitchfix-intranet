// ════════════════════════════════════════════════════════════════════════════
// PROBE: review_queue dedup recon - shows the dedup logic + delete preview
// for the one-time cleanup, AND compares Sheets vs PG review_queue.
//
// READ-ONLY. No deletes, no writes. Pure analysis.
// ════════════════════════════════════════════════════════════════════════════

import { safeRead, SHEET_IDS } from "../../src/lib/sheets.js";
import { createClient } from "@supabase/supabase-js";

// review_queue Sheets columns - matches row-shapes.js QUEUE_COLS
const Q = {
  queueId: 0, lineItemText: 1, vendor: 2, invoiceUuid: 3, invoiceDate: 4,
  account: 5, suggestedMatchId: 6, suggestedMatchName: 7, confidence: 8,
  status: 9, reason: 13,
};

// Status priority for canonical selection. Non-pending always beats pending.
// Among non-pending: accepted > rejected. Among pending: first-by-row-position
// (= append order = oldest).
function statusRank(s) {
  const v = String(s || "").trim().toLowerCase();
  if (v === "accepted") return 3;
  if (v === "rejected") return 2;
  if (v === "pending" || v === "") return 1;
  return 0;
}

console.log("=".repeat(100));
console.log("REVIEW_QUEUE DEDUP RECON  (read-only, no deletes)");
console.log("=".repeat(100));

// ── 1. Load both stores ──
const { rows: sheetsRows } = await safeRead(SHEET_IDS.INVENTORY, "review_queue");
console.log(`\nSheets review_queue: ${sheetsRows.length} rows`);

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
// Paginate to get all rows (PostgREST default cap is 1000)
const pgRows = [];
let from = 0;
while (true) {
  const { data, error } = await supa
    .from("review_queue")
    .select("id, line_item_text, vendor, invoice_id, invoice_date, account_key, suggested_match_id, suggested_match_name, confidence, status, reason, created_at")
    .range(from, from + 999);
  if (error) { console.error("PG read error:", error.message); break; }
  if (!data || data.length === 0) break;
  pgRows.push(...data);
  if (data.length < 1000) break;
  from += 1000;
}
console.log(`PG review_queue:     ${pgRows.length} rows`);

// ── 2. Group Sheets rows by (invoiceUuid, lineItemText) and analyze ──
function groupKey(uuid, lineText) {
  return `${String(uuid || "").trim()}::${String(lineText || "").trim()}`;
}

const sheetsGroups = new Map();   // key -> { rows: [{idx, row}], statuses: Set, reasons: Set, matchNames: Set }
for (let i = 0; i < sheetsRows.length; i++) {
  const r = sheetsRows[i];
  const k = groupKey(r[Q.invoiceUuid], r[Q.lineItemText]);
  if (!sheetsGroups.has(k)) {
    sheetsGroups.set(k, { rows: [], statuses: new Set(), reasons: new Set(), matchNames: new Set(), suggestedIds: new Set(), accounts: new Set() });
  }
  const g = sheetsGroups.get(k);
  g.rows.push({ idx: i, row: r });
  g.statuses.add(String(r[Q.status] || "").trim().toLowerCase());
  g.reasons.add(String(r[Q.reason] || "").trim());
  g.matchNames.add(String(r[Q.suggestedMatchName] || "").trim());
  g.suggestedIds.add(String(r[Q.suggestedMatchId] || "").trim());
  g.accounts.add(String(r[Q.account] || "").trim());
}

console.log(`Distinct (invoiceUuid, lineItemText) groups in Sheets: ${sheetsGroups.size}`);
const dupGroups = [...sheetsGroups.values()].filter((g) => g.rows.length > 1);
console.log(`Groups with >1 row (duplicate groups):                 ${dupGroups.length}`);
console.log(`Total rows in duplicate groups:                        ${dupGroups.reduce((s, g) => s + g.rows.length, 0)}`);
console.log(`Excess rows beyond first per group (to delete):        ${dupGroups.reduce((s, g) => s + g.rows.length - 1, 0)}`);

// ── 3. SAFETY CHECK 1: does the (uuid, lineText) key risk collapsing
//    genuinely-different lines? Look for groups where rows have DIFFERENT
//    suggestedMatchName / suggestedMatchId / reason - those are evidence the
//    rows represent distinct lines, not chronic re-fires. ──
console.log("\n" + "-".repeat(100));
console.log("SAFETY CHECK 1: do any duplicate groups have rows that look like distinct lines (not re-fires)?");
console.log("-".repeat(100));
const suspicious = dupGroups.filter((g) =>
  g.matchNames.size > 1 || g.suggestedIds.size > 1 || g.reasons.size > 1
);
console.log(`Suspicious groups (>1 distinct matchName/matchId/reason): ${suspicious.length}`);
if (suspicious.length > 0) {
  console.log("These groups need manual review before dedup; sample of first 5:");
  for (const g of suspicious.slice(0, 5)) {
    const r0 = g.rows[0].row;
    console.log(`\n  uuid=${(r0[Q.invoiceUuid]||"").slice(0,8)} desc="${(r0[Q.lineItemText]||"").slice(0,40)}" — ${g.rows.length} rows`);
    console.log(`    distinct matchNames: ${[...g.matchNames].join(" / ")}`);
    console.log(`    distinct matchIds:   ${[...g.suggestedIds].join(" / ")}`);
    console.log(`    distinct reasons:    ${[...g.reasons].join(" / ")}`);
  }
} else {
  console.log("CLEAN: every duplicate group's rows agree on matchName, matchId, and reason - they are chronic re-fires, not distinct-line collisions.");
}

// ── 4. SAFETY CHECK 2: would the dedup key collapse rows across DIFFERENT
//    accounts on the same invoice? (shouldn't happen, but sanity check) ──
console.log("\n" + "-".repeat(100));
console.log("SAFETY CHECK 2: any duplicate group span multiple accounts?");
console.log("-".repeat(100));
const crossAcct = dupGroups.filter((g) => g.accounts.size > 1);
console.log(`Groups spanning >1 account: ${crossAcct.length}`);
if (crossAcct.length > 0) console.log("(would need to extend key with account; investigate before deduping)");
else console.log("CLEAN: every duplicate group is within a single account.");

// ── 5. Canonical selection per group + delete preview ──
console.log("\n" + "-".repeat(100));
console.log("DEDUP LOGIC: pick canonical per group");
console.log("-".repeat(100));
console.log("Per (invoiceUuid, lineItemText) group with N>1 rows:");
console.log("  1. Sort by statusRank DESC:  accepted (3) > rejected (2) > pending (1)");
console.log("  2. Break ties by row index ASC (= append order = oldest first).");
console.log("  3. Keep position [0]; delete the rest.");

let keptRowCount = 0;
let deleteRowIndices = [];
const sampleKeep = [];
const sampleDelete = [];
for (const [_k, g] of sheetsGroups) {
  if (g.rows.length === 1) {
    keptRowCount++;
    continue;
  }
  const sorted = [...g.rows].sort((a, b) => {
    const sr = statusRank(b.row[Q.status]) - statusRank(a.row[Q.status]);
    if (sr !== 0) return sr;
    return a.idx - b.idx;
  });
  const canonical = sorted[0];
  const toDelete = sorted.slice(1);
  keptRowCount++;
  for (const d of toDelete) deleteRowIndices.push(d.idx);
  if (sampleKeep.length < 5) {
    sampleKeep.push({ canonical, toDelete, group: g });
  }
}

console.log(`\nKeep:   ${keptRowCount} rows (one canonical per distinct group)`);
console.log(`Delete: ${deleteRowIndices.length} rows (duplicate re-fires)`);
console.log(`Sheets total: ${sheetsRows.length}  ->  after cleanup: ${keptRowCount}`);

// ── 6. Sample (first 5 dup groups: what gets kept vs deleted) ──
console.log("\n" + "-".repeat(100));
console.log("DELETE PREVIEW: first 5 duplicate groups, showing canonical (KEEP) + duplicates (DELETE)");
console.log("-".repeat(100));
for (const s of sampleKeep) {
  const r0 = s.canonical.row;
  console.log(`\nGROUP: uuid=${(r0[Q.invoiceUuid]||"").slice(0,8)}  desc="${(r0[Q.lineItemText]||"").slice(0,40)}"  (${s.group.rows.length} rows total)`);
  console.log(`   KEEP   row#${s.canonical.idx + 2}  queueId=${(r0[Q.queueId]||"").slice(0,18)}  status=${r0[Q.status]||"(empty)"}  reason=${r0[Q.reason]||""}`);
  for (const d of s.toDelete.slice(0, 3)) {
    const rr = d.row;
    console.log(`   DELETE row#${d.idx + 2}      queueId=${(rr[Q.queueId]||"").slice(0,18)}  status=${rr[Q.status]||"(empty)"}  reason=${rr[Q.reason]||""}`);
  }
  if (s.toDelete.length > 3) console.log(`   DELETE (+${s.toDelete.length - 3} more rows)`);
}

// ── 7. PG side: do PG rows match the Sheets dedup picture? ──
console.log("\n" + "-".repeat(100));
console.log("PG REVIEW_QUEUE: what's already in PG?");
console.log("-".repeat(100));
const pgGroups = new Map();
for (const p of pgRows) {
  const k = groupKey(p.invoice_id, p.line_item_text);
  if (!pgGroups.has(k)) pgGroups.set(k, []);
  pgGroups.get(k).push(p);
}
const pgDupGroups = [...pgGroups.values()].filter((g) => g.length > 1);
const pgDupRows = pgDupGroups.reduce((s, g) => s + g.length - 1, 0);
console.log(`PG total rows:                ${pgRows.length}`);
console.log(`PG distinct groups:           ${pgGroups.size}`);
console.log(`PG duplicate groups:          ${pgDupGroups.length}`);
console.log(`PG excess (dup re-fires):     ${pgDupRows}`);

// Overlap: how many Sheets distinct groups are also in PG?
const sheetsKeys = new Set([...sheetsGroups.keys()]);
const pgKeys = new Set([...pgGroups.keys()]);
const inBoth = [...sheetsKeys].filter((k) => pgKeys.has(k));
const sheetsOnly = [...sheetsKeys].filter((k) => !pgKeys.has(k));
const pgOnly = [...pgKeys].filter((k) => !sheetsKeys.has(k));
console.log(`\nGroups in both Sheets AND PG: ${inBoth.length}`);
console.log(`Groups in Sheets only:        ${sheetsOnly.length}`);
console.log(`Groups in PG only:            ${pgOnly.length}`);
console.log("");
console.log("Interpretation: PG presumably represents some dual-write window or backfill subset.");
console.log("Cleanup must address BOTH stores so Module 7's eventual review_queue backfill (if any) doesn't re-import duplicates.");

console.log("\n" + "=".repeat(100));
console.log("RECON COMPLETE - NO DELETES PERFORMED. Numbers above are the proposed delete preview.");
console.log("=".repeat(100));
