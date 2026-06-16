// ═══════════════════════════════════════════════════════════════
// DATA STORE - logical data layer for Stage 1 dual-write
// ═══════════════════════════════════════════════════════════════
//
// This layer sits between route handlers and the underlying storage
// (Sheets and/or Postgres). Handlers call logical operations like
// upsertNewsInteraction; this module decides which backend(s) get
// hit based on cutover.js flags.
//
// Per-table logical API:
//   news_interactions:
//     getNewsInteractions({ userEmail })   - read records for a user
//     upsertNewsInteraction({ postId, userEmail }, partial)
//                                            - upsert with partial update
//   directory module (Stage 1 module 2, PR A + PR B - DORMANT):
//     getAccounts({ module })              - read all accounts
//     upsertAccount(teamKey, partial)      - upsert with partial update
//     getContacts({ module })              - read all contacts
//     replaceContactsForAccount(teamKey, contacts)
//                                          - replace-all-for-account with
//                                            col-G preservation (PR B)
//     getWorkLocations({ module })         - read all work_locations
//     upsertWorkLocation(teamKey, partial) - upsert by team_key
//     deleteWorkLocation(teamKey)          - delete by team_key
//     getHeroImages({ module })            - read flat global hero list
//     replaceHeroImages(urls)              - replace the global hero pool
//
//   Per-module read dispatch (PR B): readers can pass { module: "directory" }
//   to opt into per-module READ_FROM_POSTGRES_<MODULE> overrides. The dispatch
//   OR-composes per-module + global READ_FROM_POSTGRES flags. With both flag
//   sets empty (default), behavior is identical to today.
//
// Dispatch rules (per table, via cutover.js):
//   READ:
//     isReadFromPostgres(table) -> read from Postgres
//     else                       -> read from Sheets (default)
//   WRITE:
//     always write to Sheets (Sheets is the rollback target)
//     isDualWrite(table)        -> ALSO write to Postgres
//
// With both flags off (the default on merge), this layer is
// Sheets-only and behaves identically to the pre-Stage-1 helpers.

export {
  getNewsInteractions,
  upsertNewsInteraction,
} from "./newsInteractions.js";

export {
  readAccountsSheets,
  getAccounts,
  upsertAccount,
  readHeroImagesSheets,
  getHeroImages,
  replaceHeroImages,
  readContactsSheets,
  getContacts,
  replaceContactsForAccount,
  readWorkLocationsSheets,
  getWorkLocations,
  upsertWorkLocation,
  deleteWorkLocation,
} from "./directory.js";

export {
  readSubmissionsSheets,
  getSubmissions,
  getSubmissionByToken,
  upsertSubmission,
  updateSubmissionStatus,
} from "./submissions.js";

export {
  getVendorsForList,
  getVendorsForBootstrap,
  searchVendors,
  getVendor,
  getVendorsForMatching,
  upsertVendor,
  upsertVendorAccount,
  deactivateVendorAccount,
  learnVendorAlias,
  mergeVendors,
} from "./vendor.js";

export {
  getInvoiceSubmissions,
  getInvoiceSubmissionByUuid,
  findDuplicateSubmission,
  getInvoiceRejectionsForSubmission,
  getAILineItemsForInvoice,
  getGLCodes,
  upsertInvoiceSubmission,
  updateInvoiceFields,
  insertInvoiceRejection,
  unrejectInvoice,
  insertAILineItems,
} from "./invoice.js";

// Inventory module (Stage 1 module 7 / INV-2 - DORMANT until INV-3 backfill).
// Reads stay on Sheets until Module 8 (cron migration); writes dual to PG once
// inventory tabs are added to DUAL_WRITE_TABLES.
export {
  getInventoryBootstrap,
  getCatalogForAccount,
  getCatalogForMatching,
  getRecentMergeHistory,
  createCountSession,
  appendCountItems,
  submitCountSession,
  createInventoryItem,
  verifyItemPrice,
  moveItemsBulk,
  mergeInventoryItems,
  logKeepSeparate,
  acceptReviewItem,
  deleteReviewItem,
  excludeItem,
  saveStorageLocations,
  saveLocationSortOrder,
  addStorageSubZone,
  updateStorageLocation,
  deactivateStorageLocation,
  updateCatalogItem,
  archiveItem,
  reactivateItem,
  listReviewQueueLines,
  resolveReviewQueueLine,
  skipReviewQueueLine,
  resolveReviewQueueMatch,
  resolveReviewQueueCreate,
  getCatalogItemDetail,
  undoLastAction,
  getCanonicalUnits,
} from "./inventory.js";

// Project OPD · The Playbook (greenfield PG-only domain — no Sheets, no
// cutover flags, no dispatch primitives). Module name: 'playbook'.
// pr-7-9 added document_pins as an overlay for pinned state; setPinned /
// clearPinned write to it directly. Reads source pinned from the overlay
// via decoratePinned (internal to listDocuments / getDocument).
// pr-7-10 added document_content as the rendered-HTML store; getDocumentContent
// reads it (returns null when no row exists - reader falls back to Drive iframe).
export {
  listDocuments,
  getDocument,
  getDocumentContent,
  getRelationships,
  getSurfaces,
  getDocumentsForSurface,
  listIssues,
  createDocument,
  updateDocument,
  createIssue,
  setPinned,
  clearPinned,
} from "./opd.js";
