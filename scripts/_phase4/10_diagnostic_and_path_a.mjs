// Phase 4 - Path A recovery + full protein weight diagnostic
//
// Path A: Cross-account item_number weight borrowing.
// If vendor V + item_number N has a clean parsed weight at ANY account, borrow
// the median lb-per-qty and apply to matching unresolved rows at every account.
//
// Match key: (vendor_id, item_number). NEVER description-only.
// Donor gate:
//   - parsed_weight_source in CLEAN_METHODS
//   - review_reason not in ('invoice_over_extracted', 'ep_qty_up_mismatch')
//   - qty_used > 0, parsed_weight_lb > 0
//   - donor's implied $/lb in category IQR-ish bounds (CATEGORY_DPLB_BOUNDS)
// Conflict rule: if donor rows disagree by >1.5x on lb-per-qty across donors
//   (max/min > 1.5), do NOT borrow - log conflict.
// Recipient rule: only rows in DOLLAR SET with parsed_weight_source in
//   {'unresolved', 'pack_size_ambiguous_multipack'} AND review_reason NOT
//   'ep_qty_up_mismatch' (those are catch-weight-marked and use Candidate B
//   from Phase 3b).
// Sanity gate on recipient: same as Phase 3b - if implied $/lb of the borrowed
//   weight is outside [bounds_low * 0.5, bounds_high * 2] category-plausibility
//   band, reject the borrow.
// Tag: parsed_weight_source_p4 = 'catalog_lookup:cross_account'.
//
// Read-only. Writes _diagnostic.json + _path_a_borrows.json.

import fs from "node:fs";
import {
  P,
  ACCOUNTS,
  CATEGORY_LB_BOUNDS,
  CATEGORY_DPLB_BOUNDS,
  CLEAN_METHODS,
  assignProteinType,
  inDollar,
  loadAugmented,
  median,
  pct1,
  round1,
  round2,
} from "./_common4.mjs";

const AUG = loadAugmented();

// ----------------------------------------------------------------------------
// Diagnostic first (report BEFORE recovery)
// ----------------------------------------------------------------------------

const PROTEIN_CATEGORIES = new Set(["protein"]);
// We follow Phase 3b protein_mix which filters r.category === 'protein'
// So the diagnostic scope is the same: category === 'protein' AND food basis (from phase3b's assignBasis).

function proteinDiagnostic() {
  const out = {};
  for (const acct of ACCOUNTS) {
    const rows = AUG.rows.filter(
      (r) => r.account_label === acct && inDollar(r) && String(r.category || "").toLowerCase() === "protein"
    );
    const totalSpend = rows.reduce((s, r) => s + (Number(r.extended_price) || 0), 0);
    const buckets = {};
    for (const r of rows) {
      const t = assignProteinType(r.description);
      if (!buckets[t]) buckets[t] = { rows: 0, spend: 0, resolved_rows: 0, resolved_spend: 0, unresolved_rows: 0, unresolved_spend: 0, reasons: {} };
      const b = buckets[t];
      b.rows += 1;
      b.spend += Number(r.extended_price) || 0;
      // Resolved definition = has parsed_weight_lb AND not in exclusion states
      // Match Phase 3b's WEIGHT SET: effective_weight_lb > 0 requires that
      // parsed_weight_source not be unresolved/volume_excluded AND not
      // review_reason ep_qty_up_mismatch (except Candidate B rehab). We'll
      // pull the Phase 3c rehab dump for the effective state.
      const isRehab = REHAB_BY_ID.get(r.id);
      const eff = isRehab ? (isRehab._effective_weight_lb || null) : (r.parsed_weight_lb || null);
      const resolved = eff != null && eff > 0;
      if (resolved) {
        b.resolved_rows += 1;
        b.resolved_spend += Number(r.extended_price) || 0;
      } else {
        b.unresolved_rows += 1;
        b.unresolved_spend += Number(r.extended_price) || 0;
        const rr = r.review_reason || "none";
        const src = r.parsed_weight_source || "none";
        const key = `review=${rr}|src=${src}`;
        b.reasons[key] = b.reasons[key] || { rows: 0, spend: 0, has_item_number: 0, has_wlv: 0 };
        b.reasons[key].rows += 1;
        b.reasons[key].spend += Number(r.extended_price) || 0;
        if (r.item_number) b.reasons[key].has_item_number += 1;
        if (r.weight_line_value && Number(r.weight_line_value) > 0) b.reasons[key].has_wlv += 1;
      }
    }
    const perType = {};
    for (const [t, b] of Object.entries(buckets)) {
      perType[t] = {
        rows: b.rows,
        spend: round2(b.spend),
        resolved_rows: b.resolved_rows,
        resolved_spend: round2(b.resolved_spend),
        unresolved_rows: b.unresolved_rows,
        unresolved_spend: round2(b.unresolved_spend),
        coverage_spend_pct: pct1(b.resolved_spend, b.spend),
        reasons: Object.fromEntries(
          Object.entries(b.reasons)
            .map(([k, v]) => [k, { rows: v.rows, spend: round2(v.spend), has_item_number: v.has_item_number, has_wlv: v.has_wlv }])
            .sort((a, b) => b[1].spend - a[1].spend)
        ),
      };
    }
    out[acct] = {
      total_protein_rows: rows.length,
      total_protein_spend: round2(totalSpend),
      per_type: perType,
    };
  }
  return out;
}

// Load Phase 3c rehabbed rows to make diagnostic reflect Phase 3b/3c effective state
const REHAB_ARR = JSON.parse(fs.readFileSync(P.REHABBED_3C, "utf8"));
const REHAB_BY_ID = new Map(REHAB_ARR.map((r) => [r.id, r]));

const diagnostic = proteinDiagnostic();

// ----------------------------------------------------------------------------
// Path A: cross-account borrowing
// ----------------------------------------------------------------------------
// Build donor index over ALL rows (all accounts, all categories) where clean.

const donorIndex = new Map(); // key -> [{lb_per_qty, dpp, category, account}]
for (const r of AUG.rows) {
  if (!r.vendor_id || !r.item_number) continue;
  if (!CLEAN_METHODS.has(r.parsed_weight_source)) continue;
  if (r.review_reason === "invoice_over_extracted") continue;
  if (r.review_reason === "ep_qty_up_mismatch") continue;
  const q = Number(r.qty_used);
  const lb = Number(r.parsed_weight_lb);
  const ep = Number(r.extended_price);
  if (!q || !lb || lb <= 0) continue;
  // Donor sanity: implied $/lb in category-plausibility (loose gate for donors)
  const dpp = ep > 0 ? ep / lb : null;
  const bounds = CATEGORY_DPLB_BOUNDS[String(r.category || "").toLowerCase()];
  if (bounds && dpp != null && (dpp < bounds[0] * 0.5 || dpp > bounds[1] * 2)) continue;
  const key = `${r.vendor_id}::${r.item_number}`;
  if (!donorIndex.has(key)) donorIndex.set(key, []);
  donorIndex.get(key).push({
    lb_per_qty: lb / q,
    dpp: dpp,
    category: r.category,
    account: r.account_label,
    parsed_weight_lb: lb,
    qty_used: q,
    id: r.id,
  });
}

// Track exclusion of conflict-heavy donors
let conflictDonors = 0;
const conflictLog = [];

// Attempt borrows on recipient rows
// Recipient predicate: DOLLAR SET AND parsed_weight_source in
//   {unresolved, pack_size_ambiguous_multipack} AND review_reason NOT
//   ep_qty_up_mismatch (those already covered by Phase 3b Candidate B).
// Also: recipient must have vendor_id + item_number.
// If Phase 3b Candidate A already rehabbed the row (pack_size_ambiguous_multipack
// with a same-account sibling), Path A is a superset - it can find donors at
// OTHER accounts too. To not double-count, we only borrow if the row is not
// already carrying an effective weight in the Phase 3c dump.
const applyLog = [];
let attempted = 0;
let applied = 0;
let noItemNumber = 0;
let noDonor = 0;
let conflictSkip = 0;
let boundsReject = 0;
let alreadyResolved = 0;

const perAccountPerType = {};
for (const a of ACCOUNTS) perAccountPerType[a] = {};

for (const r of AUG.rows) {
  if (!inDollar(r)) continue;
  if (r.review_reason === "ep_qty_up_mismatch") continue;
  const src = r.parsed_weight_source;
  if (src !== "unresolved" && src !== "pack_size_ambiguous_multipack") continue;

  attempted += 1;

  // Skip if Phase 3c rehab already gave this row an effective weight
  const rehab = REHAB_BY_ID.get(r.id);
  if (rehab && rehab._effective_weight_lb != null && rehab._effective_weight_lb > 0) {
    alreadyResolved += 1;
    continue;
  }

  if (!r.vendor_id || !r.item_number) {
    noItemNumber += 1;
    continue;
  }
  const key = `${r.vendor_id}::${r.item_number}`;
  const donors = donorIndex.get(key);
  if (!donors || donors.length === 0) {
    noDonor += 1;
    continue;
  }
  const lbs_per_qty = donors.map((d) => d.lb_per_qty);
  const minL = Math.min(...lbs_per_qty);
  const maxL = Math.max(...lbs_per_qty);
  if (minL > 0 && maxL / minL > 1.5) {
    conflictSkip += 1;
    conflictLog.push({
      id: r.id,
      vendor_id: r.vendor_id,
      item_number: r.item_number,
      description: r.description,
      account: r.account_label,
      donors: donors.map((d) => ({ account: d.account, lb_per_qty: round2(d.lb_per_qty), category: d.category })),
      spread_ratio: round2(maxL / minL),
    });
    continue;
  }
  const medLbPerQty = median(lbs_per_qty);
  const q = Number(r.qty_used) || 1;
  const expectedLb = medLbPerQty * q;
  const ep = Number(r.extended_price) || 0;
  if (ep <= 0) {
    boundsReject += 1;
    continue;
  }
  // Sanity gate: implied $/lb must be in bounds
  const implDpp = ep / expectedLb;
  const bounds = CATEGORY_DPLB_BOUNDS[String(r.category || "").toLowerCase()];
  if (bounds && (implDpp < bounds[0] * 0.5 || implDpp > bounds[1] * 2)) {
    boundsReject += 1;
    continue;
  }
  applied += 1;
  applyLog.push({
    id: r.id,
    account: r.account_label,
    invoice_uuid: r.invoice_uuid,
    invoice_date: r.invoice_date,
    vendor_id: r.vendor_id,
    vendor_name: r.vendor_name,
    item_number: r.item_number,
    description: r.description,
    category: r.category,
    protein_type: assignProteinType(r.description),
    pack_size: r.pack_size,
    quantity: r.quantity,
    qty_used: r.qty_used,
    extended_price: ep,
    original_source: src,
    borrowed_lb_per_qty: round2(medLbPerQty),
    borrowed_effective_weight_lb: round1(expectedLb),
    implied_dpp: round2(implDpp),
    donors: donors.length,
    donor_accounts: [...new Set(donors.map((d) => d.account))],
  });
  const t = assignProteinType(r.description);
  perAccountPerType[r.account_label] = perAccountPerType[r.account_label] || {};
  perAccountPerType[r.account_label][t] = perAccountPerType[r.account_label][t] || { rows: 0, spend: 0, lbs: 0 };
  perAccountPerType[r.account_label][t].rows += 1;
  perAccountPerType[r.account_label][t].spend += ep;
  perAccountPerType[r.account_label][t].lbs += expectedLb;
}

// Round per-account per-type
for (const a of Object.keys(perAccountPerType)) {
  for (const t of Object.keys(perAccountPerType[a])) {
    perAccountPerType[a][t].spend = round2(perAccountPerType[a][t].spend);
    perAccountPerType[a][t].lbs = round1(perAccountPerType[a][t].lbs);
  }
}

const summary = {
  attempted,
  applied,
  no_item_number: noItemNumber,
  no_donor: noDonor,
  conflict_skip: conflictSkip,
  bounds_reject: boundsReject,
  already_resolved_by_phase3b_or_c: alreadyResolved,
  per_account_per_type: perAccountPerType,
  applied_spend_total: round2(applyLog.reduce((s, r) => s + Number(r.extended_price), 0)),
  applied_lbs_total: round1(applyLog.reduce((s, r) => s + Number(r.borrowed_effective_weight_lb), 0)),
};

// Category breakdown of applies (for all-account-food benefit reporting)
const cat_breakdown = {};
for (const l of applyLog) {
  const c = String(l.category || "unknown").toLowerCase();
  cat_breakdown[c] = cat_breakdown[c] || { rows: 0, spend: 0, lbs: 0 };
  cat_breakdown[c].rows += 1;
  cat_breakdown[c].spend += Number(l.extended_price);
  cat_breakdown[c].lbs += Number(l.borrowed_effective_weight_lb);
}
for (const k of Object.keys(cat_breakdown)) {
  cat_breakdown[k].spend = round2(cat_breakdown[k].spend);
  cat_breakdown[k].lbs = round1(cat_breakdown[k].lbs);
}
summary.category_breakdown = cat_breakdown;

fs.writeFileSync(P.P4_DIAGNOSTIC, JSON.stringify(diagnostic, null, 2));
fs.writeFileSync(P.P4_PATH_A, JSON.stringify({ summary, apply_log: applyLog, conflict_log: conflictLog }, null, 2));

console.log(`[4-pathA] attempted=${attempted} applied=${applied} conflict_skip=${conflictSkip} bounds_reject=${boundsReject} no_donor=${noDonor} no_item_number=${noItemNumber} already_resolved=${alreadyResolved}`);
console.log(`[4-pathA] total borrow spend=$${summary.applied_spend_total} lbs=${summary.applied_lbs_total}`);
console.log(`[4-pathA] per-account-per-type protein applies:`);
for (const [a, byType] of Object.entries(perAccountPerType)) {
  const proteinTypes = Object.entries(byType).filter(([t]) => ["beef", "poultry", "pork", "seafood", "other_meat", "plant_or_egg"].includes(t));
  if (proteinTypes.length === 0) continue;
  console.log(`   ${a}:`);
  for (const [t, v] of proteinTypes) console.log(`      ${t}: ${v.rows} rows / $${v.spend} / ${v.lbs} lb`);
}
console.log(`[4-pathA] wrote ${P.P4_PATH_A} + ${P.P4_DIAGNOSTIC}`);
