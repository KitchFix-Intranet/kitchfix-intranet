// ════════════════════════════════════════════════════════════════════════════
// One-time backfill: copy vendor data from Sheets into Postgres for PR 5.3.
// 3-table sequential backfill: vendors -> vendor_accounts -> vendor_aliases.
//
// PURPOSE
//   The PG vendor tables (created in PR 5.1 schema) are empty until
//   backfilled. Standard sequence per the cutover plan:
//     1. Enable DUAL_WRITE_TABLES for vendor_master, vendor_accounts,
//        vendor_aliases in Vercel env
//     2. Verify dual-write working via one live edit
//     3. Run this backfill --execute
//     4. Verify PG counts match Sheets
//     5. Enable READ_FROM_POSTGRES_OPS for the vendor tables
//
// USAGE
//   Dry run (default - reads + transforms + prints sample, does NOT write):
//     npm run backfill:vendor
//   Live (3-pass write to PG):
//     npm run backfill:vendor -- --execute
//
//   Subset (run only one table):
//     npm run backfill:vendor -- --table=vendors
//     npm run backfill:vendor -- --table=vendor_accounts
//     npm run backfill:vendor -- --table=vendor_aliases
//
//   Or direct invocation (the npm script wraps this):
//     node --import ./scripts/_setup/register-aliases.mjs \
//          --env-file=.env.local scripts/backfill-vendor.mjs [--execute] [--table=X]
//
// STRATEGY
//   vendors:         upsert ON CONFLICT (id) DO UPDATE
//                    Re-run safe; Sheets values win
//   vendor_accounts: upsert ON CONFLICT (vendor_id, account_key) DO UPDATE
//                    Re-run safe; Sheets values win
//   vendor_aliases:  upsert ON CONFLICT (vendor_id, alias_normalized) DO NOTHING
//                    Existing rows preserved across re-runs (matters when
//                    OCR-learned aliases land via learnVendorAlias during
//                    the dual-write window before the backfill runs)
//
// SOFT-DELETED LEGACY DUPES
//   Per the existing soft-delete pattern, vendor_master rows with
//   notes === 'DELETED' represent legacy merged-away dupes. These are
//   excluded at the Sheets read (filter on notes). PG-side deletions
//   going forward use deleted_at TIMESTAMPTZ instead of the notes
//   sentinel.
//
// VENDOR_ALIASES 1:N EXPANSION
//   vendor_master col I holds aliases as a pipe-separated string
//   (e.g., "Sysco Foods|Sysco Inc|SYSCO"). Each pipe-split alias
//   becomes one vendor_aliases row. ~35 vendor_master rows expand to
//   ~150+ vendor_aliases rows. Empty strings between pipes are
//   filtered. The PG alias_normalized GENERATED column handles
//   case/punctuation dedup automatically via the UNIQUE constraint.
// ════════════════════════════════════════════════════════════════════════════

import { readSheetSA, SHEET_IDS } from "../src/lib/sheets.js";
import { runBackfill } from "./_lib/backfill-runner.mjs";

const args = process.argv.slice(2);
const EXECUTE = args.includes("--execute");
const tableArg = args
  .find((a) => a.startsWith("--table="))
  ?.slice("--table=".length);

const VALID_TABLES = ["vendors", "vendor_accounts", "vendor_aliases"];
if (tableArg && !VALID_TABLES.includes(tableArg)) {
  console.error(`FATAL: --table="${tableArg}" must be one of ${VALID_TABLES.join(", ")}`);
  process.exit(1);
}

// vendor_master col indices (0-indexed; mirrors VM_IDX in vendor.js)
const VM_IDX = {
  vendorId:   0,  // A
  name:       1,  // B
  category:   2,  // C
  website:    3,  // D
  notes:      4,  // E
  createdBy:  5,  // F
  createdAt:  6,  // G
  // H (lastInvoiceDate) dropped per Q4 - DEAD col
  aliases:    8,  // I (pipe-separated)
  clientUuid: 9,  // J (F19b)
};

// vendor_accounts col indices (0-indexed; mirrors VA_IDX in vendor.js)
const VA_IDX = {
  rowId:              0,   // A (synthetic legacy id; not migrated to PG)
  vendorId:           1,   // B
  accountKey:         2,   // C
  customerAccountNum: 3,   // D
  salesRepName:       4,   // E
  salesRepPhone:      5,   // F
  salesRepEmail:      6,   // G
  deliveryDays:       7,   // H
  cutoffTime:         8,   // I
  deliveryMethod:     9,   // J
  portalUrl:          10,  // K
  portalUsername:     11,  // L (Q6 plaintext intentional)
  portalPassword:     12,  // M (Q6 plaintext intentional)
  // N (contactName), O (contactEmail), P (contactPhone) DEAD per audit
  paymentTerms:       16,  // Q
  minOrder:           17,  // R
  active:             18,  // S
  createdBy:          19,  // T
  createdAt:          20,  // U
  // V (reserved/unused) DEAD per audit
  accountNotes:       22,  // W
  clientUuid:         23,  // X (F19b)
};

// account_key CHECK regex from the PG schema. Pre-filter at Sheets read
// so malformed rows don't fail mid-backfill. Pattern: 3 uppercase letters
// + optional " - " state + optional " - H/V", OR the literal "CORP".
const ACCOUNT_KEY_RE = /^[A-Z]{3}( - [A-Z]{2,})?( - [HV])?$|^CORP$/;

// ─────────────────────────────────────────────────────────────
// Sheets readers (return canonical record arrays for the runner)
// ─────────────────────────────────────────────────────────────

async function readVendorRecords() {
  const { rows } = await readSheetSA(SHEET_IDS.HUB, "vendor_master");
  return rows
    .filter((r) => {
      const vendorId = String(r[VM_IDX.vendorId] || "").trim();
      const notes    = String(r[VM_IDX.notes] || "").trim();
      // Skip empty rows + soft-deleted legacy dupes (notes === 'DELETED').
      return vendorId && notes !== "DELETED";
    })
    .map((r) => ({
      vendorId:   String(r[VM_IDX.vendorId] || "").trim(),
      name:       String(r[VM_IDX.name] || "").trim(),
      category:   String(r[VM_IDX.category] || "").trim(),
      website:    String(r[VM_IDX.website] || "").trim(),
      notes:      String(r[VM_IDX.notes] || "").trim(),
      createdBy:  String(r[VM_IDX.createdBy] || "").trim(),
      createdAt:  String(r[VM_IDX.createdAt] || "").trim(),
      clientUuid: String(r[VM_IDX.clientUuid] || "").trim(),
    }));
}

async function readVendorAccountRecords() {
  const { rows } = await readSheetSA(SHEET_IDS.HUB, "vendor_accounts");
  return rows
    .filter((r) => {
      const vendorId   = String(r[VA_IDX.vendorId] || "").trim();
      const accountKey = String(r[VA_IDX.accountKey] || "").trim();
      return vendorId && accountKey;
    })
    .map((r) => ({
      vendorId:           String(r[VA_IDX.vendorId] || "").trim(),
      accountKey:         String(r[VA_IDX.accountKey] || "").trim(),
      customerAccountNum: String(r[VA_IDX.customerAccountNum] || "").trim(),
      salesRepName:       String(r[VA_IDX.salesRepName] || "").trim(),
      salesRepPhone:      String(r[VA_IDX.salesRepPhone] || "").trim(),
      salesRepEmail:      String(r[VA_IDX.salesRepEmail] || "").trim(),
      deliveryDays:       String(r[VA_IDX.deliveryDays] || "").trim(),
      cutoffTime:         String(r[VA_IDX.cutoffTime] || "").trim(),
      deliveryMethod:     String(r[VA_IDX.deliveryMethod] || "").trim(),
      portalUrl:          String(r[VA_IDX.portalUrl] || "").trim(),
      portalUsername:     String(r[VA_IDX.portalUsername] || "").trim(),
      portalPassword:     String(r[VA_IDX.portalPassword] || "").trim(),
      paymentTerms:       String(r[VA_IDX.paymentTerms] || "").trim(),
      minOrder:           String(r[VA_IDX.minOrder] || "").trim(),
      active:             String(r[VA_IDX.active] || "TRUE").trim().toUpperCase() !== "FALSE",
      createdBy:          String(r[VA_IDX.createdBy] || "").trim(),
      createdAt:          String(r[VA_IDX.createdAt] || "").trim(),
      accountNotes:       String(r[VA_IDX.accountNotes] || "").trim(),
      clientUuid:         String(r[VA_IDX.clientUuid] || "").trim(),
    }));
}

// 1:N expansion: vendor_master row -> N alias records (one per pipe-split).
async function readVendorAliasRecords() {
  const { rows } = await readSheetSA(SHEET_IDS.HUB, "vendor_master");
  const records = [];
  for (const r of rows) {
    const vendorId = String(r[VM_IDX.vendorId] || "").trim();
    const notes    = String(r[VM_IDX.notes] || "").trim();
    if (!vendorId || notes === "DELETED") continue;
    const aliasPipe = String(r[VM_IDX.aliases] || "").trim();
    if (!aliasPipe) continue;
    const parts = aliasPipe
      .split("|")
      .map((a) => a.trim())
      .filter(Boolean);
    for (const aliasText of parts) {
      records.push({ vendorId, aliasText });
    }
  }
  return records;
}

// ─────────────────────────────────────────────────────────────
// Per-table runs
// ─────────────────────────────────────────────────────────────

async function runVendorsBackfill() {
  await runBackfill({
    moduleLabel:         "vendors",
    sheetId:             SHEET_IDS.HUB,
    sheetTabName:        "vendor_master",
    expectedFirstHeader: "Vendor ID",
    readSheets:          readVendorRecords,
    pgTable:             "vendors",
    strategy:            "upsert",
    onConflict:          "id",
    ignoreDuplicates:    false,
    countScope:          null,
    npmCommand:          "npm run backfill:vendor -- --table=vendors",
    execute:             EXECUTE,
    validators: [
      {
        name:    "vendorId non-empty",
        check:   (r) => Boolean(r.vendorId),
        message: () => "vendorId is empty (PG column is NOT NULL PK)",
      },
      {
        name:    "name non-empty",
        check:   (r) => Boolean(r.name),
        message: (r) => `name is empty for vendorId=${r.vendorId} (PG column is NOT NULL)`,
      },
    ],
    transformToPg: (r) => ({
      id:          r.vendorId,
      name:        r.name,
      category:    r.category || null,
      website:     r.website  || null,
      notes:       r.notes    || null,
      created_by:  r.createdBy || "backfill",
      created_at:  r.createdAt || new Date().toISOString(),
      client_uuid: r.clientUuid || null,
      // deleted_at intentionally absent - all surviving rows are LIVE.
    }),
  });
}

async function runVendorAccountsBackfill() {
  await runBackfill({
    moduleLabel:         "vendor_accounts",
    sheetId:             SHEET_IDS.HUB,
    sheetTabName:        "vendor_accounts",
    expectedFirstHeader: "Row ID",
    readSheets:          readVendorAccountRecords,
    pgTable:             "vendor_accounts",
    strategy:            "upsert",
    onConflict:          "vendor_id,account_key",
    ignoreDuplicates:    false,
    countScope:          null,
    npmCommand:          "npm run backfill:vendor -- --table=vendor_accounts",
    execute:             EXECUTE,
    validators: [
      {
        name:    "vendorId non-empty",
        check:   (r) => Boolean(r.vendorId),
        message: () => "vendorId is empty (PG column is NOT NULL FK)",
      },
      {
        name:    "accountKey matches CHECK constraint",
        check:   (r) => ACCOUNT_KEY_RE.test(r.accountKey),
        message: (r) => `accountKey "${r.accountKey}" fails CHECK regex (vendorId=${r.vendorId})`,
      },
    ],
    transformToPg: (r) => ({
      vendor_id:            r.vendorId,
      account_key:          r.accountKey,
      customer_account_num: r.customerAccountNum || null,
      sales_rep_name:       r.salesRepName       || null,
      sales_rep_phone:      r.salesRepPhone      || null,
      sales_rep_email:      r.salesRepEmail      || null,
      delivery_days:        r.deliveryDays       || null,
      cutoff_time:          r.cutoffTime         || null,
      delivery_method:      r.deliveryMethod     || null,
      portal_url:           r.portalUrl          || null,
      portal_username:      r.portalUsername     || null,  // Q6 plaintext intentional
      portal_password:      r.portalPassword     || null,  // Q6 plaintext intentional
      payment_terms:        r.paymentTerms       || null,
      min_order:            r.minOrder           || null,
      active:               r.active,
      created_by:           r.createdBy || "backfill",
      created_at:           r.createdAt || new Date().toISOString(),
      account_notes:        r.accountNotes       || null,
      client_uuid:          r.clientUuid         || null,
    }),
  });
}

async function runVendorAliasesBackfill() {
  await runBackfill({
    moduleLabel:         "vendor_aliases",
    sheetId:             SHEET_IDS.HUB,
    sheetTabName:        "vendor_master",
    expectedFirstHeader: "Vendor ID",
    readSheets:          readVendorAliasRecords,
    pgTable:             "vendor_aliases",
    strategy:            "upsert",
    // alias_normalized is a GENERATED column server-side; the UNIQUE
    // constraint targets (vendor_id, alias_normalized) and we let PG
    // compute it on insert.
    onConflict:          "vendor_id,alias_normalized",
    ignoreDuplicates:    true,
    countScope:          null,
    npmCommand:          "npm run backfill:vendor -- --table=vendor_aliases",
    execute:             EXECUTE,
    validators: [
      {
        name:    "aliasText non-empty after trim",
        check:   (r) => Boolean(r.aliasText),
        message: (r) => `aliasText empty after trim for vendorId=${r.vendorId}`,
      },
    ],
    transformToPg: (r) => ({
      vendor_id:  r.vendorId,
      alias_text: r.aliasText,
      source:     "manual",
      learned_by: "backfill",
      // alias_normalized + learned_at are server-computed/defaulted.
    }),
  });
}

// ─────────────────────────────────────────────────────────────
// Orchestration: respect --table= subset or run all 3 in order
// ─────────────────────────────────────────────────────────────

try {
  if (!tableArg || tableArg === "vendors") {
    await runVendorsBackfill();
    console.log();
  }
  if (!tableArg || tableArg === "vendor_accounts") {
    await runVendorAccountsBackfill();
    console.log();
  }
  if (!tableArg || tableArg === "vendor_aliases") {
    await runVendorAliasesBackfill();
    console.log();
  }
  console.log("=".repeat(70));
  console.log(`Vendor backfill complete - ${EXECUTE ? "LIVE" : "DRY-RUN"}`);
  console.log("=".repeat(70));
} catch (e) {
  console.error("FATAL backfill error:", e.message);
  process.exit(1);
}
