// ════════════════════════════════════════════════════════════════════════════
// INV-3 backfill — Sheets-resident inventory data -> PG (INV-1 schema)
//
// DRY-RUN by default. Every phase reads from Sheets, computes the inserts
// + cleanups, and reports counts + samples + decisions-needed. With
// --dry-run=false (must be explicit), writes are committed in
// FK-dependency order.
//
// Reads are direct Sheets (safeRead) + direct PG (service client). Does
// NOT call INV-2 orchestrators (those would re-append to Sheets on every
// "write", which is exactly what backfill must not do).
//
// USAGE
//   Dry-run (default; no writes):
//     node --import ./scripts/_setup/register-aliases.mjs \
//          --env-file=.env.local scripts/backfill-inventory.mjs
//
//   Real run:
//     node --import ./scripts/_setup/register-aliases.mjs \
//          --env-file=.env.local scripts/backfill-inventory.mjs --dry-run=false
//
// Sequence (FK-dependency order):
//   1. storage_locations (parents first, then sub-zones)
//   2. inventory_items   (~3,666 rows; vendor_id resolution + status/account/category cleanups)
//   3. item_aliases      (dedup the ~2,270 redundant; preserve the 408 with distinct learned_by/source)
//   4. count_sessions    (5 drafts) + count_items (147 rows)
//   5. price_history     (vendor + invoice resolution)
//   6. review_queue      (invoice_id mapping + reason enum)
//   7. merge_history + merge_history_items (split JSON arrays into junction)
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import { safeRead, SHEET_IDS } from "../src/lib/sheets.js";

// ── Args ──
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=", 2)[1];
  return fallback;
}
// Dry-run defaults TRUE. Only "--dry-run=false" turns writes on.
const DRY_RUN = getArg("dry-run", "true").toLowerCase() !== "false";

// ── Env / clients ──
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[backfill] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Helpers ──
const asStr = (v) => (v == null ? "" : String(v).trim());
const strToBoolFalse = (v) => String(v ?? "").trim().toUpperCase() === "FALSE";
const strToBool = (v) => String(v ?? "").trim().toUpperCase() === "TRUE";
const parseNum = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const ACCOUNT_REGEX = /^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$/;
function isCanonicalAccount(s) {
  return s === "CORP" || ACCOUNT_REGEX.test(s);
}
// Find the longest canonical prefix of a long-form account label.
// "STL - MO - St Louis Cardinals" -> "STL - MO"
// "CIN - OH - Cincinnati Reds"    -> "CIN - OH"
// "TXR - TX - H"                  -> already canonical, returned as-is
// Anything unfixable comes back unchanged and will trip the CHECK guard later.
function canonicalizeAccount(raw) {
  const v = asStr(raw);
  if (!v) return v;
  if (isCanonicalAccount(v)) return v;
  const tokens = v.split(" - ");
  for (let i = tokens.length - 1; i >= 1; i--) {
    const candidate = tokens.slice(0, i).join(" - ");
    if (isCanonicalAccount(candidate)) return candidate;
  }
  return v;
}
// price_history col 5 holds either a known source label (manual-add /
// manual-verify / invoice-ocr / merge) OR a bare invoice UUID written by
// the cron. Map both shapes to (source enum, source_or_invoice_id).
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function inferPriceSource(rawCol5) {
  const v = asStr(rawCol5);
  if (!v) return { source: null, sourceOrInvoiceId: null };
  const lower = v.toLowerCase();
  if (lower === "manual-add"    || lower === "manual_add")    return { source: "manual_add",    sourceOrInvoiceId: v };
  if (lower === "manual-verify" || lower === "manual_verify") return { source: "manual_verify", sourceOrInvoiceId: v };
  if (lower === "merge")                                      return { source: "merge",         sourceOrInvoiceId: v };
  if (lower === "invoice-ocr"   || lower === "invoice_ocr")   return { source: "invoice_ocr",   sourceOrInvoiceId: v };
  if (UUID_RE.test(v))                                        return { source: "invoice_ocr",   sourceOrInvoiceId: v };
  // Legacy historical re-extraction synthetic IDs from the PR 6.3 invoice
  // backfill (REBUILD-204842-00-N pattern). Cron writes treat these as
  // invoice_ocr; we preserve the dedup key but leave invoice_id NULL.
  if (/^REBUILD-/i.test(v))                                   return { source: "invoice_ocr",   sourceOrInvoiceId: v };
  return { source: null, sourceOrInvoiceId: v };
}
function normalizeAlias(s) {
  return String(s || "").toLowerCase().replace(/[^a-zA-Z0-9 ]/g, "");
}
function sample(arr, n = 3) {
  return arr.slice(0, n);
}
function header(label) {
  console.log("");
  console.log("===============================================================");
  console.log(`  ${label}`);
  console.log("===============================================================");
}

// ── Sheets column indices (mirror dataStore/inventory.js) ──
const CAT_IDX = { itemId: 0, account: 1, name: 2, category: 3, unit: 4, locationId: 5, primaryVendor: 6, lastPrice: 7, lastPriceDate: 8, lastPriceVendor: 9, priceAtLastCount: 10, active: 11, linkedToInvoice: 12, isVarietyGroup: 13, createdBy: 14, createdAt: 15, status: 16, notes: 17, lastVerified: 18 };
const ALIAS_IDX = { aliasId: 0, aliasText: 1, itemId: 2, vendor: 3, confidence: 4, learnedBy: 5, learnedAt: 6, source: 7 };
const LOC_IDX = { locationId: 0, account: 1, name: 2, icon: 3, sortOrder: 4, active: 5, createdBy: 6, createdAt: 7, parentLocationId: 8, color: 9 };
const SESSION_IDX = { sessionId: 0, account: 1, period: 2, startedBy: 3, startedAt: 4, status: 5, submittedBy: 6, submittedAt: 7, totalFood: 8, totalPackaging: 9, totalSupplies: 10, totalSnacks: 11, totalBeverages: 12, grandTotal: 13 };
const CI_IDX = { sessionId: 0, locationSaveId: 1, itemId: 2, quantity: 3, unit: 4, priceAtCount: 5, priceVendor: 6, extendedPrice: 7, locationId: 8, savedBy: 9, savedAt: 10, ts: 11, noneOnHand: 12 };
const PRICE_IDX = { itemId: 0, account: 1, vendor: 2, price: 3, effectiveDate: 4, source: 5, recordedAt: 6 };
const RQ_IDX = { queueId: 0, lineItemText: 1, vendor: 2, invoiceId: 3, invoiceDate: 4, account: 5, suggestedMatchId: 6, suggestedMatchName: 7, confidence: 8, status: 9, reviewedBy: 10, reviewedAt: 11, resultItemId: 12, reason: 13 };
const MH_IDX = { mergeId: 0, account: 1, timestamp: 2, email: 3, keeperItemId: 4, keeperName: 5, mergedItemIds: 6, mergedNames: 7, action: 8, reason: 9 };

const VALID_CATEGORIES = new Set(["Food", "Packaging", "Supplies", "Snacks", "Beverages"]);
const VALID_ACTIONS = new Set(["merge", "keep_separate", "link", "exclude", "archive", "reactivate", "review_delete"]);
const VALID_PRICE_SOURCES = new Set(["manual_add", "manual_verify", "invoice_ocr", "merge"]);
const VALID_REVIEW_REASONS = new Set(["arithmetic_fail", "low_match_confidence", "possible_new", "overcount_suspect_reextract"]);

// Decisions-needed accumulator surfaced at the end.
const decisions = {
  vendorUnresolved: [],
  accountFailsCheck: [],
  categoryStrays: [],
  countItemsItemUnresolved: [],
  priceVendorUnresolved: [],
  reviewQueueInvoiceUnresolved: [],
  mergeJunctionItemUnresolved: [],
  mergeActionStrays: [],
  priceSourceStrays: [],
  reviewReasonStrays: [],
};

// ── Per-phase summary accumulator ──
const summary = [];

// ════════════════════════════════════════════════════════════════════════════
// Phase 1: storage_locations
// ════════════════════════════════════════════════════════════════════════════

async function phaseStorageLocations() {
  header("PHASE 1 — storage_locations");
  const { rows } = await safeRead(SHEET_IDS.INVENTORY, "storage_locations");
  // Insert ALL locations (active AND inactive) so inventory_items + count_items
  // FKs to deactivated zones resolve. Schema's active boolean preserves the flag.
  const allLocs = rows.filter((r) => asStr(r[LOC_IDX.locationId]));
  const activeCount = allLocs.filter((r) => !strToBoolFalse(r[LOC_IDX.active])).length;
  const inactiveCount = allLocs.length - activeCount;

  const parents = allLocs.filter((r) => !asStr(r[LOC_IDX.parentLocationId]));
  const subs    = allLocs.filter((r) =>  asStr(r[LOC_IDX.parentLocationId]));

  console.log(`Sheets rows (all):     ${allLocs.length}  (active=${activeCount}, inactive=${inactiveCount})`);
  console.log(`  parents (top-level): ${parents.length}`);
  console.log(`  sub-zones:           ${subs.length}`);

  // After canonicalization, check what still fails the CHECK regex.
  const stillFailing = allLocs
    .map((r) => canonicalizeAccount(r[LOC_IDX.account]))
    .filter((a) => a && !isCanonicalAccount(a));
  if (stillFailing.length) {
    console.log(`  WARN account values STILL failing CHECK after canonicalization: ${stillFailing.length}`);
    for (const a of stillFailing) {
      if (!decisions.accountFailsCheck.includes(`storage_locations: "${a}"`)) {
        decisions.accountFailsCheck.push(`storage_locations: "${a}"`);
      }
    }
  } else {
    // Report what we fixed.
    const fixed = allLocs
      .map((r) => ({ raw: asStr(r[LOC_IDX.account]), canon: canonicalizeAccount(r[LOC_IDX.account]) }))
      .filter((x) => x.raw !== x.canon);
    if (fixed.length) {
      const dist = {};
      fixed.forEach((x) => { dist[`${x.raw} -> ${x.canon}`] = (dist[`${x.raw} -> ${x.canon}`] || 0) + 1; });
      console.log(`  Account canonicalization fix:`);
      for (const [k, n] of Object.entries(dist)) console.log(`    ${k} (${n} rows)`);
    }
  }

  function buildRow(r) {
    return {
      id:                  asStr(r[LOC_IDX.locationId]),
      account:             canonicalizeAccount(r[LOC_IDX.account]),
      name:                asStr(r[LOC_IDX.name]),
      icon:                asStr(r[LOC_IDX.icon]) || "box",
      sort_order:          parseInt(r[LOC_IDX.sortOrder]) || 0,
      active:              !strToBoolFalse(r[LOC_IDX.active]),
      parent_location_id:  asStr(r[LOC_IDX.parentLocationId]) || null,
      color:               asStr(r[LOC_IDX.color]) || null,
      created_by:          asStr(r[LOC_IDX.createdBy]) || "system",
      created_at:          asStr(r[LOC_IDX.createdAt]) || undefined,
    };
  }

  const parentRows = parents.map(buildRow);
  const subRows    = subs.map(buildRow);

  console.log(`Would insert: ${parentRows.length} parents, then ${subRows.length} sub-zones (parent FK resolves after parent insert).`);
  console.log(`Parent sample:`);
  for (const r of sample(parentRows)) console.log(`  ${JSON.stringify(r)}`);
  console.log(`Sub-zone sample:`);
  for (const r of sample(subRows)) console.log(`  ${JSON.stringify(r)}`);

  if (!DRY_RUN) {
    // Insert parents first.
    if (parentRows.length) {
      const { error } = await supa.from("storage_locations").insert(parentRows);
      if (error) throw new Error(`storage_locations parents: ${error.message}`);
    }
    if (subRows.length) {
      const { error } = await supa.from("storage_locations").insert(subRows);
      if (error) throw new Error(`storage_locations subs: ${error.message}`);
    }
  }
  summary.push({ table: "storage_locations", wouldInsert: parentRows.length + subRows.length });
  return new Set([...parentRows, ...subRows].map((r) => r.id));
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 2: inventory_items
// Vendor resolution + status mapping + account fix + category validation.
// ════════════════════════════════════════════════════════════════════════════

async function phaseInventoryItems({ insertedLocationIds }) {
  header("PHASE 2 — inventory_items (~3,666 rows)");
  const { rows } = await safeRead(SHEET_IDS.INVENTORY, "item_catalog");

  // Load vendor resolution data from PG (Module 5 LIVE).
  const { data: vendors } = await supa.from("vendors").select("id, name").is("deleted_at", null);
  const { data: vendorAliases } = await supa.from("vendor_aliases").select("vendor_id, alias_text, alias_normalized");
  const nameToVendorId = new Map();
  for (const v of vendors || []) nameToVendorId.set((v.name || "").toLowerCase(), v.id);
  const aliasNormToVendorId = new Map();
  for (const a of vendorAliases || []) aliasNormToVendorId.set((a.alias_normalized || "").toLowerCase(), a.vendor_id);

  // Resolve "Samuels Seafoos" via the existing alias if any; else point at "Samuels Seafood"
  // and flag for a new alias insert.
  const samuelsSeafoodId = nameToVendorId.get("samuels seafood") || null;
  const samuelsAliasNeeded = !aliasNormToVendorId.has(normalizeAlias("Samuels Seafoos"));

  // Resolution helper.
  function resolveVendor(rawName) {
    const trimmed = asStr(rawName);
    if (!trimmed) return { vendorId: null, via: "empty" };
    const lower = trimmed.toLowerCase();
    if (nameToVendorId.has(lower)) return { vendorId: nameToVendorId.get(lower), via: "exact" };
    const norm = normalizeAlias(trimmed);
    if (aliasNormToVendorId.has(norm)) return { vendorId: aliasNormToVendorId.get(norm), via: "alias" };
    if (lower === "samuels seafoos") {
      return samuelsSeafoodId
        ? { vendorId: samuelsSeafoodId, via: "fixed (Samuels Seafoos -> Samuels Seafood)", aliasInsertNeeded: true }
        : { vendorId: null, via: "unresolved (Samuels Seafood missing in PG)" };
    }
    if (lower === "test vendor") return { vendorId: null, via: "skipped (dev artifact)" };
    return { vendorId: null, via: "unresolved" };
  }

  // First pass: collect all primaryVendor strings + resolutions for reporting.
  const allItemRows = rows.filter((r) => asStr(r[CAT_IDX.itemId]) && asStr(r[CAT_IDX.name]));
  const vendorResolutionBuckets = { exact: 0, alias: 0, fixed: 0, skipped: 0, unresolved: 0 };
  const vendorResolutionByString = new Map();    // primaryVendor string -> { vendorId, via, count }
  for (const r of allItemRows) {
    const rawName = asStr(r[CAT_IDX.primaryVendor]);
    if (!vendorResolutionByString.has(rawName)) {
      const res = resolveVendor(rawName);
      vendorResolutionByString.set(rawName, { ...res, count: 0 });
    }
    vendorResolutionByString.get(rawName).count++;
  }
  for (const { via } of vendorResolutionByString.values()) {
    if (via.startsWith("exact"))     vendorResolutionBuckets.exact++;
    else if (via.startsWith("alias"))     vendorResolutionBuckets.alias++;
    else if (via.startsWith("fixed"))     vendorResolutionBuckets.fixed++;
    else if (via.startsWith("skipped"))   vendorResolutionBuckets.skipped++;
    else                                  vendorResolutionBuckets.unresolved++;
  }

  console.log(`Sheets data rows: ${rows.length}; with id+name: ${allItemRows.length}`);
  console.log(`Vendor resolution (distinct strings = ${vendorResolutionByString.size}):`);
  console.log(`  exact match (vendors.name):       ${vendorResolutionBuckets.exact}`);
  console.log(`  via vendor_aliases:               ${vendorResolutionBuckets.alias}`);
  console.log(`  fixed-and-aliased (Samuels):      ${vendorResolutionBuckets.fixed}`);
  console.log(`  skipped (Test Vendor):            ${vendorResolutionBuckets.skipped}`);
  console.log(`  UNRESOLVED (blocks the row):      ${vendorResolutionBuckets.unresolved}`);
  for (const [vendorName, info] of vendorResolutionByString.entries()) {
    if (info.via.startsWith("unresolved")) {
      const flag = `inventory_items.primaryVendor "${vendorName}" - ${info.count} rows - ${info.via}`;
      decisions.vendorUnresolved.push(flag);
      console.log(`    "${vendorName}" (${info.count} rows): ${info.via}`);
    }
  }
  if (samuelsAliasNeeded && samuelsSeafoodId) {
    console.log(`  NOTE: backfill will also INSERT vendor_aliases row ("Samuels Seafoos" -> ${samuelsSeafoodId}) so future loads resolve via alias.`);
  }

  // Status / account / category cleanups + row build.
  const statusCounts = { active: 0, archived: 0, excluded: 0 };
  const accountFixes = []; // {original -> 'STL - MO'}
  let catStrays = 0;
  let droppedByVendor = 0;
  let droppedByAccountFail = 0;
  let droppedByMissingId = 0;

  function isoFromMaybe(s) {
    const v = asStr(s);
    if (!v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  const pgItemRows = [];
  for (const r of allItemRows) {
    const itemId   = asStr(r[CAT_IDX.itemId]);
    const accountRaw = asStr(r[CAT_IDX.account]);
    const account = canonicalizeAccount(accountRaw);
    if (account !== accountRaw) accountFixes.push({ from: accountRaw, to: account });

    if (!isCanonicalAccount(account)) {
      decisions.accountFailsCheck.push(`inventory_items: "${account}" (itemId ${itemId})`);
      droppedByAccountFail++;
      continue;
    }

    const rawVendor = asStr(r[CAT_IDX.primaryVendor]);
    const vendorRes = vendorResolutionByString.get(rawVendor);
    if (!vendorRes.vendorId) {
      droppedByVendor++;
      continue;
    }

    const category = asStr(r[CAT_IDX.category]);
    let normalizedCategory = null;
    if (!category) normalizedCategory = null;
    else if (VALID_CATEGORIES.has(category)) normalizedCategory = category;
    else {
      catStrays++;
      decisions.categoryStrays.push(`inventory_items: "${category}" (itemId ${itemId})`);
    }

    // Status mapping
    const sheetActiveFalse = strToBoolFalse(r[CAT_IDX.active]);
    const sheetStatus = asStr(r[CAT_IDX.status]);
    let pgStatus;
    let updatedAt = null;
    if (!sheetActiveFalse) {
      pgStatus = "active";
    } else if (sheetStatus === "archived") {
      pgStatus = "archived";
    } else if (sheetStatus === "excluded") {
      pgStatus = "excluded";
    } else {
      // The "other" 30 — col Q holds a cron timestamp. Map to archived
      // and move timestamp to updated_at.
      pgStatus = "archived";
      const ts = isoFromMaybe(sheetStatus);
      if (ts) updatedAt = ts;
    }
    statusCounts[pgStatus]++;

    // location_id - keep what's there if Phase 1 will insert it; else NULL
    // to satisfy FK. The legacy Sheets sometimes hold keyword strings
    // ("cooler", "freezer") which we treat as orphan -> NULL.
    const rawLoc = asStr(r[CAT_IDX.locationId]);
    const location_id = (rawLoc && rawLoc.startsWith("loc_") && insertedLocationIds.has(rawLoc)) ? rawLoc : null;

    if (!itemId) {
      droppedByMissingId++;
      continue;
    }

    pgItemRows.push({
      id:                itemId,
      account,
      name:              asStr(r[CAT_IDX.name]),
      category:          normalizedCategory,
      unit:              asStr(r[CAT_IDX.unit]) || null,
      location_id,
      vendor_id:         vendorRes.vendorId,
      status:            pgStatus,
      updated_at:        updatedAt || new Date().toISOString(),
      linked_to_invoice: strToBool(r[CAT_IDX.linkedToInvoice]),
      is_variety_group:  strToBool(r[CAT_IDX.isVarietyGroup]),
      created_by:        asStr(r[CAT_IDX.createdBy]) || "system",
      created_at:        isoFromMaybe(r[CAT_IDX.createdAt]) || undefined,
      notes:             asStr(r[CAT_IDX.notes]) || null,
      last_verified:     isoFromMaybe(r[CAT_IDX.lastVerified]) || null,
      // last_price / last_price_date / last_price_vendor are view-derived; not stored.
      // priceAtLastCount dropped.
    });
  }

  console.log(``);
  console.log(`Status mapping (what the backfill would write):`);
  console.log(`  status='active':   ${statusCounts.active}`);
  console.log(`  status='archived': ${statusCounts.archived}`);
  console.log(`  status='excluded': ${statusCounts.excluded}`);
  if (accountFixes.length) {
    const dist = {};
    accountFixes.forEach((x) => { dist[`${x.from} -> ${x.to}`] = (dist[`${x.from} -> ${x.to}`] || 0) + 1; });
    console.log(`Account canonicalization fixes:`);
    for (const [k, n] of Object.entries(dist)) console.log(`  ${k} (${n} rows)`);
  } else {
    console.log(`Account canonicalization fixes: none`);
  }
  console.log(`Category strays:  ${catStrays} (should be 0 per verification)`);
  console.log(`Dropped rows:     vendor_unresolved=${droppedByVendor}, account_check_fail=${droppedByAccountFail}, missing_id=${droppedByMissingId}`);
  console.log(`Would insert:     ${pgItemRows.length} inventory_items rows`);
  console.log(`Sample:`);
  for (const r of sample(pgItemRows)) console.log(`  ${JSON.stringify(r)}`);

  if (!DRY_RUN) {
    if (samuelsAliasNeeded && samuelsSeafoodId) {
      const { error } = await supa.from("vendor_aliases").insert({
        vendor_id: samuelsSeafoodId,
        alias_text: "Samuels Seafoos",
        source: "manual",
        learned_by: "inv-3-backfill",
      });
      if (error) throw new Error(`vendor_aliases (Samuels Seafoos): ${error.message}`);
    }
    // Insert in chunks.
    const CHUNK = 500;
    for (let i = 0; i < pgItemRows.length; i += CHUNK) {
      const { error } = await supa.from("inventory_items").insert(pgItemRows.slice(i, i + CHUNK));
      if (error) throw new Error(`inventory_items insert chunk: ${error.message}`);
    }
  }
  summary.push({ table: "inventory_items", wouldInsert: pgItemRows.length });

  // Expose the resolution map for downstream phases (count_items, price_history).
  return { vendorResolutionByString, insertedItemIds: new Set(pgItemRows.map((r) => r.id)) };
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 3: item_aliases
// Dedup (item_id, alias_normalized) preserving the 408 distinct learned_by/source.
// ════════════════════════════════════════════════════════════════════════════

async function phaseItemAliases({ insertedItemIds }) {
  header("PHASE 3 — item_aliases (dedup with preservation)");
  const { rows } = await safeRead(SHEET_IDS.INVENTORY, "item_aliases");

  const totalInSheets = rows.length;
  const orphanRows = rows.filter((r) => !insertedItemIds.has(asStr(r[ALIAS_IDX.itemId])));
  const candidateRows = rows.filter((r) => insertedItemIds.has(asStr(r[ALIAS_IDX.itemId])));

  console.log(`Sheets alias rows: ${totalInSheets}`);
  console.log(`Pointing at inserted inventory_items: ${candidateRows.length}`);
  console.log(`Pointing at SKIPPED items (orphaned by Phase 2 drops): ${orphanRows.length}`);

  // Group by (item_id, alias_normalized).
  const groups = new Map();
  for (const r of candidateRows) {
    const itemId = asStr(r[ALIAS_IDX.itemId]);
    const aliasText = asStr(r[ALIAS_IDX.aliasText]);
    if (!aliasText) continue;
    const norm = normalizeAlias(aliasText);
    const key = `${itemId}::${norm}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  // Within each group, prefer the row where learned_by != source (the 408).
  // Tiebreaker: most recent learned_at (col F idx 6).
  let preserved408 = 0;
  const winners = [];
  for (const [key, groupRows] of groups.entries()) {
    if (groupRows.length === 1) {
      winners.push(groupRows[0]);
      continue;
    }
    // Find any with learned_by != source.
    const distinct = groupRows.filter((r) =>
      asStr(r[ALIAS_IDX.learnedBy]) !== asStr(r[ALIAS_IDX.source])
    );
    if (distinct.length > 0) {
      // Keep the most recent of the distinct ones.
      distinct.sort((a, b) => (asStr(b[ALIAS_IDX.learnedAt]).localeCompare(asStr(a[ALIAS_IDX.learnedAt]))));
      winners.push(distinct[0]);
      preserved408++;
    } else {
      // No distinct row - keep the most recent.
      const sorted = [...groupRows].sort((a, b) => (asStr(b[ALIAS_IDX.learnedAt]).localeCompare(asStr(a[ALIAS_IDX.learnedAt]))));
      winners.push(sorted[0]);
    }
  }

  console.log(`After dedup: ${winners.length} unique (item_id, alias_normalized) keys`);
  console.log(`  of which ${preserved408} were preserved BECAUSE the kept row had learned_by != source`);
  console.log(`  (the 408 audit-flagged rows; UNIQUE invariant satisfied)`);

  // Build PG row shape.
  function vendorIdForAlias(rawName) {
    // Cheap lookup: we already loaded vendors in Phase 2 - but the resolution
    // map is per-string in inventory_items. For aliases we use the same exact
    // pass, but it's optional (vendor_id NULLable on item_aliases).
    // Return null for non-trivial lookup; INV-3 can be tightened later.
    return null;
  }
  const pgAliasRows = winners.map((r) => ({
    item_id:        asStr(r[ALIAS_IDX.itemId]),
    alias_text:     asStr(r[ALIAS_IDX.aliasText]),
    vendor_id:      vendorIdForAlias(asStr(r[ALIAS_IDX.vendor])),
    confidence:     parseNum(r[ALIAS_IDX.confidence]) || null,
    learned_by:     asStr(r[ALIAS_IDX.learnedBy]) || null,
    source:         normalizeAliasSource(asStr(r[ALIAS_IDX.source])),
    learned_at:     asStr(r[ALIAS_IDX.learnedAt]) || undefined,
  }));

  // UNIQUE invariant check (in JS - should always hold by construction).
  const seen = new Set();
  let violations = 0;
  for (const r of pgAliasRows) {
    const k = `${r.item_id}::${normalizeAlias(r.alias_text)}`;
    if (seen.has(k)) violations++;
    seen.add(k);
  }
  console.log(`UNIQUE (item_id, alias_normalized) violations in computed set: ${violations} (must be 0)`);

  console.log(`Would insert: ${pgAliasRows.length} item_aliases rows`);
  console.log(`Sample:`);
  for (const r of sample(pgAliasRows)) console.log(`  ${JSON.stringify(r)}`);

  if (!DRY_RUN) {
    const CHUNK = 500;
    for (let i = 0; i < pgAliasRows.length; i += CHUNK) {
      const { error } = await supa.from("item_aliases").insert(pgAliasRows.slice(i, i + CHUNK));
      if (error) throw new Error(`item_aliases insert chunk: ${error.message}`);
    }
  }
  summary.push({ table: "item_aliases", wouldInsert: pgAliasRows.length });
}

function normalizeAliasSource(s) {
  const v = (s || "").toLowerCase().replace(/-/g, "_");
  const known = new Set(["manual", "ocr_learned", "merge", "item_review", "ai_cron"]);
  return known.has(v) ? v : "manual";
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 4: count_sessions + count_items
// ════════════════════════════════════════════════════════════════════════════

async function phaseCountSessions({ insertedItemIds, insertedLocationIds }) {
  header("PHASE 4 — count_sessions + count_items");
  const csRes = await safeRead(SHEET_IDS.INVENTORY, "count_sessions");
  const ciRes = await safeRead(SHEET_IDS.INVENTORY, "count_items");
  const sessions = csRes.rows;
  const items = ciRes.rows;
  console.log(`Sheets count_sessions: ${sessions.length}`);
  console.log(`Sheets count_items:    ${items.length}`);

  const fixAccount = canonicalizeAccount;

  const pgSessionRows = [];
  const sessionStatusOverrides = new Map();
  for (const r of sessions) {
    const id = asStr(r[SESSION_IDX.sessionId]);
    if (!id) continue;
    const accountRaw = asStr(r[SESSION_IDX.account]);
    const account = fixAccount(accountRaw);
    if (!isCanonicalAccount(account)) {
      decisions.accountFailsCheck.push(`count_sessions: "${accountRaw}" -> "${account}"`);
      continue;
    }
    const statusRaw = asStr(r[SESSION_IDX.status]) || "draft";
    const status = ["draft", "submitted", "corrected"].includes(statusRaw) ? statusRaw : "draft";
    const submittedBy = asStr(r[SESSION_IDX.submittedBy]);
    const submittedAt = asStr(r[SESSION_IDX.submittedAt]);
    pgSessionRows.push({
      id,
      account,
      period:       asStr(r[SESSION_IDX.period]) || "P3-2026",
      started_by:   asStr(r[SESSION_IDX.startedBy]) || "system",
      started_at:   asStr(r[SESSION_IDX.startedAt]) || undefined,
      status,
      submitted_by: status === "draft" ? null : (submittedBy || "system"),
      submitted_at: status === "draft" ? null : (submittedAt || new Date().toISOString()),
    });
  }
  console.log(`Would insert: ${pgSessionRows.length} count_sessions rows`);
  console.log(`Status dist (all-drafts expected): ${Object.entries(pgSessionRows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {})).map(([s, n]) => `${s}=${n}`).join(", ")}`);
  console.log(`Sample:`);
  for (const r of sample(pgSessionRows)) console.log(`  ${JSON.stringify(r)}`);

  // count_items - need item_id FK + session_id FK.
  const validSessionIds = new Set(pgSessionRows.map((r) => r.id));
  let droppedByMissingSession = 0;
  let droppedByMissingItem = 0;
  const pgCiRows = [];
  for (const r of items) {
    const sessionId = asStr(r[CI_IDX.sessionId]);
    const itemId = asStr(r[CI_IDX.itemId]);
    if (!sessionId || !validSessionIds.has(sessionId)) {
      droppedByMissingSession++;
      continue;
    }
    if (!itemId || !insertedItemIds.has(itemId)) {
      droppedByMissingItem++;
      decisions.countItemsItemUnresolved.push(`count_items.itemId "${itemId}" (sessionId ${sessionId})`);
      continue;
    }
    const rawLoc = asStr(r[CI_IDX.locationId]);
    const locId = rawLoc && insertedLocationIds.has(rawLoc) ? rawLoc : null;
    pgCiRows.push({
      session_id:       sessionId,
      location_save_id: asStr(r[CI_IDX.locationSaveId]) || "ls_legacy",
      item_id:          itemId,
      location_id:      locId,
      quantity:         parseNum(r[CI_IDX.quantity]) || 0,
      unit:             asStr(r[CI_IDX.unit]) || null,
      price_at_count:   parseNum(r[CI_IDX.priceAtCount]) || null,
      none_on_hand:     strToBool(r[CI_IDX.noneOnHand]),
      saved_by:         asStr(r[CI_IDX.savedBy]) || "system",
      saved_at:         asStr(r[CI_IDX.savedAt]) || undefined,
    });
  }
  console.log(``);
  console.log(`count_items:`);
  console.log(`  Would insert: ${pgCiRows.length} rows`);
  console.log(`  Dropped: missing_session=${droppedByMissingSession}, missing_item=${droppedByMissingItem}`);
  console.log(`  Sample:`);
  for (const r of sample(pgCiRows)) console.log(`  ${JSON.stringify(r)}`);

  if (!DRY_RUN) {
    if (pgSessionRows.length) {
      const { error } = await supa.from("count_sessions").insert(pgSessionRows);
      if (error) throw new Error(`count_sessions: ${error.message}`);
    }
    if (pgCiRows.length) {
      const { error } = await supa.from("count_items").insert(pgCiRows);
      if (error) throw new Error(`count_items: ${error.message}`);
    }
  }
  summary.push({ table: "count_sessions", wouldInsert: pgSessionRows.length });
  summary.push({ table: "count_items",    wouldInsert: pgCiRows.length });
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 5: price_history
// Vendor + invoice resolution.
// ════════════════════════════════════════════════════════════════════════════

async function phasePriceHistory({ vendorResolutionByString, insertedItemIds }) {
  header("PHASE 5 — price_history");
  const { rows } = await safeRead(SHEET_IDS.INVENTORY, "price_history");

  // Load invoice client_uuid -> id map for the linkage step.
  const { data: invoices } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid")
    .not("client_uuid", "is", null);
  const clientUuidToInvoiceId = new Map();
  for (const inv of invoices || []) {
    if (inv.client_uuid) clientUuidToInvoiceId.set(inv.client_uuid, inv.id);
  }
  console.log(`PG invoice_submissions client_uuids loaded: ${clientUuidToInvoiceId.size}`);

  function normalizeSource(raw) {
    const v = (raw || "").toLowerCase().replace(/-/g, "_");
    if (v === "manual_add")     return "manual_add";
    if (v === "manual_verify")  return "manual_verify";
    if (v === "invoice_ocr")    return "invoice_ocr";
    if (v === "merge")          return "merge";
    return null;
  }

  let droppedByItem = 0, droppedByVendor = 0, droppedByAccount = 0, sourceStrays = 0;
  let invoiceResolved = 0, invoiceNull = 0;
  const pgPriceRows = [];
  for (const r of rows) {
    const itemId = asStr(r[PRICE_IDX.itemId]);
    if (!itemId || !insertedItemIds.has(itemId)) { droppedByItem++; continue; }

    const accountRaw = asStr(r[PRICE_IDX.account]);
    const account = canonicalizeAccount(accountRaw);
    if (!isCanonicalAccount(account)) {
      decisions.accountFailsCheck.push(`price_history: "${accountRaw}"`);
      droppedByAccount++; continue;
    }

    const rawVendor = asStr(r[PRICE_IDX.vendor]);
    // Reuse the inventory_items resolution map; new strings get resolved fresh.
    let vendorRes = vendorResolutionByString.get(rawVendor);
    if (!vendorRes) {
      // String didn't appear in inventory_items; do a tiny lookup.
      vendorRes = { vendorId: null, via: "not-in-catalog-map" };
    }
    if (!vendorRes.vendorId) {
      decisions.priceVendorUnresolved.push(`price_history.vendor "${rawVendor}" - ${vendorRes.via}`);
      droppedByVendor++; continue;
    }

    // Col 5 holds EITHER a known source label OR a bare invoice UUID
    // (the cron writes the UUID into source_or_invoice_id). inferPriceSource
    // handles both shapes.
    const sourceRaw = asStr(r[PRICE_IDX.source]);
    const { source, sourceOrInvoiceId } = inferPriceSource(sourceRaw);
    if (!source) {
      sourceStrays++;
      decisions.priceSourceStrays.push(`price_history col5 "${sourceRaw}" (unrecognized format)`);
      continue;
    }

    let invoiceId = null;
    if (source === "invoice_ocr" && clientUuidToInvoiceId.has(sourceOrInvoiceId)) {
      invoiceId = clientUuidToInvoiceId.get(sourceOrInvoiceId);
      invoiceResolved++;
    } else {
      invoiceNull++;
    }

    pgPriceRows.push({
      item_id:               itemId,
      account,
      vendor_id:             vendorRes.vendorId,
      price:                 parseNum(r[PRICE_IDX.price]) || 0,
      effective_date:        asStr(r[PRICE_IDX.effectiveDate]) || asStr(r[PRICE_IDX.recordedAt])?.slice(0, 10) || null,
      invoice_id:            invoiceId,
      source_or_invoice_id:  sourceOrInvoiceId || `${source}:${itemId}:${rows.indexOf(r)}`,
      source,
      recorded_at:           asStr(r[PRICE_IDX.recordedAt]) || undefined,
    });
  }

  console.log(`Sheets rows:          ${rows.length}`);
  console.log(`Would insert:         ${pgPriceRows.length}`);
  console.log(`Dropped:              item_missing=${droppedByItem}, vendor_unresolved=${droppedByVendor}, account_fail=${droppedByAccount}, source_stray=${sourceStrays}`);
  console.log(`invoice_id resolved:  ${invoiceResolved} (via invoice_submissions.client_uuid match)`);
  console.log(`invoice_id NULL:      ${invoiceNull} (manual sources + unresolvable invoice refs)`);
  console.log(`Sample:`);
  for (const r of sample(pgPriceRows)) console.log(`  ${JSON.stringify(r)}`);

  if (!DRY_RUN) {
    const CHUNK = 500;
    for (let i = 0; i < pgPriceRows.length; i += CHUNK) {
      const { error } = await supa.from("price_history").insert(pgPriceRows.slice(i, i + CHUNK));
      if (error) throw new Error(`price_history chunk: ${error.message}`);
    }
  }
  summary.push({ table: "price_history", wouldInsert: pgPriceRows.length });
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 6: review_queue
// ════════════════════════════════════════════════════════════════════════════

async function phaseReviewQueue({ insertedItemIds }) {
  header("PHASE 6 — review_queue (~213 rows)");
  const { rows } = await safeRead(SHEET_IDS.INVENTORY, "review_queue");

  const { data: invoices } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid")
    .not("client_uuid", "is", null);
  const clientUuidToInvoiceId = new Map();
  for (const inv of invoices || []) {
    if (inv.client_uuid) clientUuidToInvoiceId.set(inv.client_uuid, inv.id);
  }

  let droppedByReason = 0;
  let droppedByAccount = 0;
  let invoiceResolved = 0;
  let invoiceNull = 0;
  const reasonCounts = {};
  const pgRqRows = [];
  for (const r of rows) {
    const reasonRaw = asStr(r[RQ_IDX.reason]);
    if (!reasonRaw) {
      // Legacy pre-arithmetic-gate empty rows. Drop them: schema requires NOT NULL reason
      // and we have no way to retro-classify.
      reasonCounts["(empty - dropped)"] = (reasonCounts["(empty - dropped)"] || 0) + 1;
      droppedByReason++;
      continue;
    }
    if (!VALID_REVIEW_REASONS.has(reasonRaw)) {
      decisions.reviewReasonStrays.push(`review_queue.reason "${reasonRaw}"`);
      reasonCounts[`STRAY: ${reasonRaw}`] = (reasonCounts[`STRAY: ${reasonRaw}`] || 0) + 1;
      droppedByReason++;
      continue;
    }
    reasonCounts[reasonRaw] = (reasonCounts[reasonRaw] || 0) + 1;

    const accountRaw = asStr(r[RQ_IDX.account]);
    const account = canonicalizeAccount(accountRaw);
    if (!isCanonicalAccount(account)) {
      decisions.accountFailsCheck.push(`review_queue: "${accountRaw}"`);
      droppedByAccount++;
      continue;
    }

    // invoice_id mapping
    const invoiceUuidRaw = asStr(r[RQ_IDX.invoiceId]);
    let invoiceId = null;
    if (invoiceUuidRaw && clientUuidToInvoiceId.has(invoiceUuidRaw)) {
      invoiceId = clientUuidToInvoiceId.get(invoiceUuidRaw);
      invoiceResolved++;
    } else {
      invoiceNull++;
      if (invoiceUuidRaw) {
        decisions.reviewQueueInvoiceUnresolved.push(`review_queue.invoiceId "${invoiceUuidRaw}" not in invoice_submissions.client_uuid`);
      }
    }

    const status = asStr(r[RQ_IDX.status]) || "pending";
    const safeStatus = ["pending", "accepted", "rejected"].includes(status) ? status : "pending";

    // item_id (resolved match) - nullable.
    const resolvedItemId = asStr(r[RQ_IDX.resultItemId]) || null;
    if (resolvedItemId && !insertedItemIds.has(resolvedItemId)) {
      // Skip the FK; resolver UI deferred. Leave it NULL.
    }
    const suggestedItemId = asStr(r[RQ_IDX.suggestedMatchId]) || null;
    const suggestedItemIdSafe = suggestedItemId && insertedItemIds.has(suggestedItemId) ? suggestedItemId : null;

    pgRqRows.push({
      account,
      item_id:             null,
      line_item_text:      asStr(r[RQ_IDX.lineItemText]),
      vendor:              asStr(r[RQ_IDX.vendor]) || null,
      invoice_id:          invoiceId,
      invoice_date:        asStr(r[RQ_IDX.invoiceDate]) || null,
      suggested_match_id:  suggestedItemIdSafe,
      suggested_match_name: asStr(r[RQ_IDX.suggestedMatchName]) || null,
      confidence:          parseNum(r[RQ_IDX.confidence]) || null,
      status:              safeStatus,
      reviewed_by:         asStr(r[RQ_IDX.reviewedBy]) || null,
      reviewed_at:         asStr(r[RQ_IDX.reviewedAt]) || null,
      result_item_id:      resolvedItemId && insertedItemIds.has(resolvedItemId) ? resolvedItemId : null,
      reason:              reasonRaw,
    });
  }
  console.log(`Sheets rows:           ${rows.length}`);
  console.log(`Reason distribution:`);
  for (const [k, n] of Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${n}`);
  }
  console.log(`Dropped:               by_reason_invalid_or_empty=${droppedByReason}, by_account_fail=${droppedByAccount}`);
  console.log(`invoice_id resolved:   ${invoiceResolved}`);
  console.log(`invoice_id NULL:       ${invoiceNull}`);
  console.log(`Would insert:          ${pgRqRows.length}`);
  console.log(`Sample:`);
  for (const r of sample(pgRqRows)) console.log(`  ${JSON.stringify(r)}`);

  if (!DRY_RUN) {
    const CHUNK = 500;
    for (let i = 0; i < pgRqRows.length; i += CHUNK) {
      const { error } = await supa.from("review_queue").insert(pgRqRows.slice(i, i + CHUNK));
      if (error) throw new Error(`review_queue: ${error.message}`);
    }
  }
  summary.push({ table: "review_queue", wouldInsert: pgRqRows.length });
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 7: merge_history + merge_history_items
// ════════════════════════════════════════════════════════════════════════════

async function phaseMergeHistory({ insertedItemIds }) {
  header("PHASE 7 — merge_history + merge_history_items");
  const { rows } = await safeRead(SHEET_IDS.INVENTORY, "merge_history");

  const actionCounts = {};
  let droppedByAction = 0;
  let droppedByAccount = 0;
  let junctionItemUnresolved = 0;
  const pgHeaders = []; // {sheetIdx, header, junction}

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const actionRaw = asStr(r[MH_IDX.action]);
    if (!actionRaw) continue;
    if (!VALID_ACTIONS.has(actionRaw)) {
      decisions.mergeActionStrays.push(`merge_history.action "${actionRaw}" (row ${idx + 2})`);
      droppedByAction++;
      continue;
    }
    actionCounts[actionRaw] = (actionCounts[actionRaw] || 0) + 1;

    const accountRaw = asStr(r[MH_IDX.account]);
    const account = canonicalizeAccount(accountRaw);
    if (!isCanonicalAccount(account)) {
      decisions.accountFailsCheck.push(`merge_history: "${accountRaw}"`);
      droppedByAccount++;
      continue;
    }

    const keeperItemId = asStr(r[MH_IDX.keeperItemId]) || null;
    const keeperItemIdSafe = keeperItemId && insertedItemIds.has(keeperItemId) ? keeperItemId : null;

    let mergedIds = [], mergedNames = [];
    try { mergedIds = JSON.parse(asStr(r[MH_IDX.mergedItemIds]) || "[]"); } catch { /* skip malformed */ }
    try { mergedNames = JSON.parse(asStr(r[MH_IDX.mergedNames]) || "[]"); } catch { /* skip malformed */ }
    if (!Array.isArray(mergedIds)) mergedIds = [];
    if (!Array.isArray(mergedNames)) mergedNames = [];

    const header = {
      account,
      keeper_item_id: keeperItemIdSafe,
      canonical_name: asStr(r[MH_IDX.keeperName]) || null,
      action: actionRaw,
      reason: asStr(r[MH_IDX.reason]) || null,
      email:  asStr(r[MH_IDX.email]) || "system",
      created_at: asStr(r[MH_IDX.timestamp]) || undefined,
    };

    // Junction rows: keeper (1) + merged (N).
    const junction = [];
    if (keeperItemId) {
      junction.push({
        item_id:   keeperItemIdSafe,
        item_name: asStr(r[MH_IDX.keeperName]) || keeperItemId,
        role:      "keeper",
      });
    }
    for (let i = 0; i < mergedIds.length; i++) {
      const id = String(mergedIds[i] || "");
      const name = String(mergedNames[i] || id);
      const safeId = id && insertedItemIds.has(id) ? id : null;
      if (id && !safeId) {
        junctionItemUnresolved++;
        decisions.mergeJunctionItemUnresolved.push(`merge_history junction itemId "${id}" not in inventory_items (row ${idx + 2}); will insert with item_id NULL + name snapshot "${name}"`);
      }
      junction.push({
        item_id:   safeId,
        item_name: name,
        role:      "merged",
      });
    }
    pgHeaders.push({ header, junction });
  }

  console.log(`Sheets rows:                 ${rows.length}`);
  console.log(`Action distribution (target enum has 7 values: merge / keep_separate / link / exclude / archive / reactivate / review_delete):`);
  for (const [k, n] of Object.entries(actionCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k}: ${n}`);
  }
  console.log(`Dropped:                     by_action_invalid=${droppedByAction}, by_account_fail=${droppedByAccount}`);
  console.log(`Would insert headers:        ${pgHeaders.length}`);
  console.log(`Would insert junction rows:  ${pgHeaders.reduce((s, h) => s + h.junction.length, 0)}`);
  console.log(`Junction item_id NULL (item not in inventory_items, name snapshot preserved): ${junctionItemUnresolved}`);
  console.log(`Sample (header + junction):`);
  for (const { header, junction } of sample(pgHeaders, 2)) {
    console.log(`  header:   ${JSON.stringify(header)}`);
    for (const j of junction) console.log(`  junction: ${JSON.stringify(j)}`);
  }

  if (!DRY_RUN) {
    for (const { header, junction } of pgHeaders) {
      const { data: mh, error } = await supa
        .from("merge_history")
        .insert(header)
        .select("id")
        .single();
      if (error) throw new Error(`merge_history header: ${error.message}`);
      if (junction.length > 0) {
        const withMergeId = junction.map((j) => ({ ...j, merge_id: mh.id }));
        const { error: jErr } = await supa.from("merge_history_items").insert(withMergeId);
        if (jErr) throw new Error(`merge_history_items: ${jErr.message}`);
      }
    }
  }
  summary.push({ table: "merge_history",       wouldInsert: pgHeaders.length });
  summary.push({ table: "merge_history_items", wouldInsert: pgHeaders.reduce((s, h) => s + h.junction.length, 0) });
}

// ════════════════════════════════════════════════════════════════════════════
// Main
// ════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(``);
  console.log(`========================================================================`);
  console.log(`  INV-3 BACKFILL  ${DRY_RUN ? "(DRY-RUN — NO WRITES)" : "(REAL RUN — WRITES ENABLED)"}`);
  console.log(`========================================================================`);

  // Pre-check: assert PG inventory tables are empty (else the apply was already partial).
  const inv1Tables = ["storage_locations", "inventory_items", "item_aliases", "count_sessions", "count_items", "price_history", "review_queue", "merge_history", "merge_history_items"];
  for (const t of inv1Tables) {
    const { count } = await supa.from(t).select("*", { count: "exact", head: true });
    if ((count || 0) > 0) {
      console.error(`PG inventory table ${t} has ${count} rows. Backfill expects empty. Aborting.`);
      process.exit(2);
    }
  }
  console.log(`Pre-check: all 9 PG inventory tables EMPTY.`);

  const insertedLocationIds = await phaseStorageLocations();
  const { vendorResolutionByString, insertedItemIds } = await phaseInventoryItems({ insertedLocationIds });
  await phaseItemAliases({ insertedItemIds });
  await phaseCountSessions({ insertedItemIds, insertedLocationIds });
  await phasePriceHistory({ vendorResolutionByString, insertedItemIds });
  await phaseReviewQueue({ insertedItemIds });
  await phaseMergeHistory({ insertedItemIds });

  // Final summary table.
  header("SUMMARY (per table)");
  for (const s of summary) {
    console.log(`  ${s.table.padEnd(22)} would insert  ${s.wouldInsert}`);
  }

  // Decisions-needed.
  header("DECISIONS NEEDED BEFORE REAL RUN");
  let anyDecision = false;
  function dump(label, list) {
    if (!list.length) return;
    anyDecision = true;
    console.log(``);
    console.log(`${label} (${list.length}):`);
    const dedup = [...new Set(list)];
    for (const item of dedup.slice(0, 20)) console.log(`  ${item}`);
    if (dedup.length > 20) console.log(`  ... +${dedup.length - 20} more`);
  }
  dump("Vendor strings that resolve to nothing", decisions.vendorUnresolved);
  dump("Account values that fail the CHECK regex", decisions.accountFailsCheck);
  dump("Category strays", decisions.categoryStrays);
  dump("count_items.itemId references that won't resolve", decisions.countItemsItemUnresolved);
  dump("price_history vendor strings that won't resolve", decisions.priceVendorUnresolved);
  dump("review_queue invoice references that won't resolve", decisions.reviewQueueInvoiceUnresolved);
  dump("merge_history junction itemIds that won't resolve", decisions.mergeJunctionItemUnresolved);
  dump("merge_history action values outside enum", decisions.mergeActionStrays);
  dump("price_history source values outside enum", decisions.priceSourceStrays);
  dump("review_queue reason values outside enum", decisions.reviewReasonStrays);

  if (!anyDecision) {
    console.log(`  (none - everything resolves cleanly)`);
  }

  console.log(``);
  console.log(DRY_RUN
    ? `DRY-RUN complete. NO writes performed. To execute: re-run with --dry-run=false.`
    : `REAL RUN complete. Inserts above are now committed in PG.`);
}

main().catch((e) => {
  console.error(`[backfill] FATAL: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
