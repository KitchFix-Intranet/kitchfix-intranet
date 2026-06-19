// Read-only recon of PG.inventory_items duplicate groups (pre_module_7
// cleanup item #2 / TOP investigation). No writes, no plan - just look
// at the real rows and identify the writer.
import { createClient } from "@supabase/supabase-js";

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 1) Pull the full active set of inventory_items (small enough to fit in memory)
//    Paginate at 1000/page (PostgREST default cap)
const all = [];
let from = 0;
const PAGE = 1000;
for (;;) {
  const { data, error } = await supa.from("inventory_items")
    .select("id, account, name, status, vendor_id, location_id, linked_to_invoice, is_variety_group, created_at, created_by")
    .range(from, from + PAGE - 1);
  if (error) { console.error("PG error:", error.message); break; }
  if (!data || data.length === 0) break;
  all.push(...data);
  if (data.length < PAGE) break;
  from += PAGE;
}
console.log("Total inventory_items rows pulled: " + all.length);

// Filter to ACTIVE only (matches the doc's "active catalog item" framing)
const active = all.filter((r) => r.status === "active");
console.log("Active rows:                       " + active.length);
console.log("Non-active:                         " + (all.length - active.length));

// 2) Group by (account, normalized_name)
//    Normalize name: trim + collapse internal whitespace + lowercase, to
//    match how a "same item" dedup key would normally read.
function norm(s) {
  return String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
}

const groupsRaw = new Map(); // key -> [rows]
for (const r of active) {
  const k = (r.account || "") + " :: " + norm(r.name);
  if (!groupsRaw.has(k)) groupsRaw.set(k, []);
  groupsRaw.get(k).push(r);
}

const dupGroups = [...groupsRaw.entries()]
  .filter(([_, rows]) => rows.length > 1)
  .map(([k, rows]) => ({ key: k, rows, excess: rows.length - 1 }));

const totalDupRows = dupGroups.reduce((a, g) => a + g.rows.length, 0);
const totalExcess  = dupGroups.reduce((a, g) => a + g.excess, 0);

console.log();
console.log("============================================================");
console.log("DUP GROUPS - current count (active items, normalized name)");
console.log("============================================================");
console.log("Distinct duplicate groups:          " + dupGroups.length);
console.log("Rows participating in dup groups:   " + totalDupRows);
console.log("Excess rows over 1-per-group:       " + totalExcess);
console.log();
console.log("Doc says (2026-06-10): 87 groups / ~108 excess rows");
console.log("Now (" + new Date().toISOString().slice(0,10) + "):    " + dupGroups.length + " groups / " + totalExcess + " excess rows");

// 3) Created_by distribution across ALL dup-participating rows
const byCreatedBy = new Map();
const byCreatedDate = new Map();
for (const g of dupGroups) for (const r of g.rows) {
  const cb = r.created_by || "(null)";
  byCreatedBy.set(cb, (byCreatedBy.get(cb) || 0) + 1);
  const cd = (r.created_at || "").slice(0, 10);
  byCreatedDate.set(cd, (byCreatedDate.get(cd) || 0) + 1);
}
console.log();
console.log("============================================================");
console.log("CREATED_BY DISTRIBUTION across all dup rows");
console.log("============================================================");
for (const [v, n] of [...byCreatedBy.entries()].sort((a, b) => b[1] - a[1])) {
  console.log("  " + String(n).padStart(5) + "  " + v);
}

console.log();
console.log("============================================================");
console.log("CREATED_AT date distribution across all dup rows");
console.log("============================================================");
for (const [d, n] of [...byCreatedDate.entries()].sort()) {
  console.log("  " + d + " : " + n);
}

// 4) Variety-group flag check on dup groups
let allVarietyGroups = 0, mixedVarietyFlags = 0, noVarietyFlags = 0;
for (const g of dupGroups) {
  const flags = g.rows.map((r) => r.is_variety_group);
  if (flags.every((f) => f === true)) allVarietyGroups++;
  else if (flags.some((f) => f === true)) mixedVarietyFlags++;
  else noVarietyFlags++;
}
console.log();
console.log("============================================================");
console.log("VARIETY-GROUP flag patterns across dup groups");
console.log("============================================================");
console.log("All rows in group is_variety_group=true:   " + allVarietyGroups + "  (legitimate variety pairs - NOT dups)");
console.log("Mixed (some true, some false):              " + mixedVarietyFlags + "  (worth a look)");
console.log("No variety flag (all false/null):           " + noVarietyFlags + "   (the real dups)");

// 5) Linked_to_invoice flag patterns
let allLinked = 0, allUnlinked = 0, mixedLinked = 0;
for (const g of dupGroups) {
  const flags = g.rows.map((r) => r.linked_to_invoice);
  if (flags.every((f) => f === true)) allLinked++;
  else if (flags.every((f) => f === false)) allUnlinked++;
  else mixedLinked++;
}
console.log();
console.log("============================================================");
console.log("LINKED_TO_INVOICE patterns across dup groups");
console.log("============================================================");
console.log("All rows linked_to_invoice=true:    " + allLinked + "  (cron-created)");
console.log("All rows linked_to_invoice=false:   " + allUnlinked + " (manual-created)");
console.log("Mixed:                              " + mixedLinked);

// 6) Sample 8 groups for detailed look. Show variety + name byte-check.
console.log();
console.log("============================================================");
console.log("SAMPLE GROUPS (8) - side by side");
console.log("============================================================");
const sample = dupGroups.slice(0, 8);
let idx = 0;
for (const g of sample) {
  idx++;
  console.log();
  console.log("Group " + idx + " (" + g.rows.length + " rows): " + g.key);
  console.log("  Raw name strings byte-by-byte:");
  for (const r of g.rows) {
    const raw = r.name || "";
    console.log('    "' + raw + '"  len=' + raw.length + '  bytes=[' + [...raw].slice(0, 30).map((c) => c.charCodeAt(0)).join(",") + (raw.length > 30 ? ",..." : "") + "]");
  }
  console.log("  Side-by-side:");
  console.log("    " + ["created_at".padEnd(28), "created_by".padEnd(18), "vendor_id".padEnd(12), "location_id".padEnd(16), "linked".padEnd(7), "variety".padEnd(7)].join(" | "));
  for (const r of g.rows) {
    console.log("    " + [
      String(r.created_at || "").padEnd(28),
      String(r.created_by || "").slice(0, 17).padEnd(18),
      String(r.vendor_id || "").padEnd(12),
      String(r.location_id || "").slice(0, 15).padEnd(16),
      String(r.linked_to_invoice).padEnd(7),
      String(r.is_variety_group).padEnd(7),
    ].join(" | "));
  }
}

// 7) Specifically check: any rows created_at AFTER 2026-06-05 (post INV-3 backfill, the cutoff
//    when ongoing production writes would appear)? And any with created_by that matches a real
//    user email (not "ai_cron" or "batch_rebuild")?
console.log();
console.log("============================================================");
console.log("ONGOING vs FROZEN - is production still producing dups?");
console.log("============================================================");
const INV3_BACKFILL_DATE = "2026-06-04";
const postBackfill = [];
const userEmails = new Set();
for (const g of dupGroups) for (const r of g.rows) {
  if ((r.created_at || "") > INV3_BACKFILL_DATE + "T17:54:46") {
    postBackfill.push(r);
  }
  const cb = String(r.created_by || "");
  if (cb.includes("@") && !cb.includes("cron")) userEmails.add(cb);
}
console.log("Dup rows created AFTER INV-3 backfill (2026-06-04 17:54:46): " + postBackfill.length);
if (postBackfill.length > 0) {
  console.log("Sample (up to 10):");
  for (const r of postBackfill.slice(0, 10)) {
    console.log("  " + r.created_at + "  " + (r.created_by || "(null)").padEnd(20) + "  account=" + r.account + "  name=\"" + (r.name || "").slice(0, 50) + "\"");
  }
}

console.log();
console.log("Distinct human-email created_by values among dup rows: " + userEmails.size);
for (const e of userEmails) console.log("  - " + e);

// 8) Specifically check the Review Queue Create-new path:
//    That path writes via createInventoryItem with email = the operator's signed-in email
//    AND linked_to_invoice = false (per dataStore/inventory.js:1516). Look for any rows
//    matching that fingerprint.
console.log();
console.log("============================================================");
console.log("REVIEW QUEUE CREATE-NEW fingerprint check");
console.log("============================================================");
console.log("Path: resolveReviewQueueCreate -> createInventoryItem");
console.log("Fingerprint: created_by = operator email, linked_to_invoice = false,");
console.log("             created_at falls within Review Queue commit window");
console.log("             (2026-06-09 onward when commits 1-7 of the branch landed locally)");

const reviewQueueCommitWindowStart = "2026-06-09";
const candidates = [];
for (const g of dupGroups) for (const r of g.rows) {
  const cb = String(r.created_by || "");
  if (cb.includes("@") && !cb.includes("cron") && r.linked_to_invoice === false && (r.created_at || "") >= reviewQueueCommitWindowStart) {
    candidates.push(r);
  }
}
console.log();
console.log("Candidate rows matching Review Queue Create-new fingerprint: " + candidates.length);
if (candidates.length > 0) {
  console.log("Sample (up to 10):");
  for (const r of candidates.slice(0, 10)) {
    console.log("  " + r.created_at + "  " + r.created_by + "  account=" + r.account + "  name=\"" + (r.name || "").slice(0, 50) + "\"");
  }
} else {
  console.log("  (none - the dups are NOT from the Review Queue Create-new path)");
}

process.exit(0);
