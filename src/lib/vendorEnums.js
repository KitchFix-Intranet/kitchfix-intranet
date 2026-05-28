// ═══════════════════════════════════════════════════════════════
// VENDOR ENUMS
// ═══════════════════════════════════════════════════════════════
//
// Single source of truth for vendor-related enumerations. Extracted
// from 5 component files during PR 5.2 (Project 3 Module 5) as part
// of the S2 consolidation. Previously each component declared its
// own const, with drift across files (PAYMENT_TERMS was the worst
// case: "Net 30" with space in 2 of 3 places, "NET30" no-space in
// the third).
//
// Canonical choices made in PR 5.2:
//   CATEGORIES       - 13 items, order matches VendorEditModal /
//                      VendorAdminView (the more-recent files).
//                      VendorList wraps locally as ["All", ...CATEGORIES]
//                      for its filter UI.
//   CATEGORY_COLORS  - 13 entries matching CATEGORIES exactly.
//                      Same values used in VendorAdminView / VendorCard /
//                      VendorSetup pre-extraction.
//   PAYMENT_TERMS    - 11 items, "Net X" with space (the format used
//                      in VendorEditModal + VendorSetup; the
//                      "NET30" no-space form from VendorAddModal was
//                      a divergence). Legacy data with "NETX" format
//                      stays in vendor_accounts rows untouched; a
//                      data-normalization PR can backfill later.
//   DELIVERY_METHODS - 4 items, identical across all sources.
//
// VendorList's "All" sentinel is NOT included in CATEGORIES because
// it is a filter-UI artifact, not a real category value. Consumers
// that need a filter list prefix locally.

export const CATEGORIES = [
  "Produce", "Protein", "Dairy", "Dry Goods", "Beverage",
  "Packaging", "Cleaning", "Supplies", "Equipment", "Linen",
  "Specialty", "Broadliner", "Other",
];

export const CATEGORY_COLORS = {
  Produce:     "#16a34a",
  Protein:     "#dc2626",
  Dairy:       "#2563eb",
  "Dry Goods": "#d97706",
  Beverage:    "#7c3aed",
  Packaging:   "#0891b2",
  Cleaning:    "#0d9488",
  Supplies:    "#ca8a04",
  Equipment:   "#475569",
  Linen:       "#9d174d",
  Specialty:   "#db2777",
  Broadliner:  "#9333ea",
  Other:       "#64748b",
};

export const PAYMENT_TERMS = [
  "Net 7", "Net 10", "Net 14", "Net 15",
  "Net 30", "Net 45", "Net 60",
  "COD", "Prepaid", "Credit Card", "I don't know",
];

export const DELIVERY_METHODS = [
  "Direct Delivery",
  "Will Call / Pickup",
  "Shipped (Common Carrier)",
  "Drop Ship",
];
