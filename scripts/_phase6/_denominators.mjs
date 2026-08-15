// Canonical window denominators for the 2026-05-01 to 2026-07-31 window.
//
// Source: Kevin supplied the three client Service Calendars (2026); Chat-Claude
// parsed and ruled. These figures REPLACE the v5 per_meal.window_meals_used
// values and the D1-D3 investigation. The sparse-month projection-substitution
// path is disabled for this window - do not let it run and silently override.
//
// Provenance (Addendum §A1):
//
//   TBR-FL  20,300  = MiLB 18,680 (6,000 / 6,240 / 6,440 May/Jun/Jul)
//                    + B&G 1,620 (May only; see A3 disclosure)
//   TBJ-FL  29,541  = all service lines (9,433 / 9,307 / 10,801 May/Jun/Jul)
//   STL-FL  18,860  = FCL 11,060 + PBC 7,800 (7,540 / 6,190 / 5,130)
//                    - unchanged from Kevin's Q6
//
// Consumers:
//   - 10_recompute_v6.mjs: R8 gate, per-cover metrics
//   - workbook + one-pager (B7 blocked pending STOP resolution)
//
// Do NOT reintroduce the sparse-month substitution for this window without
// explicit Kevin sign-off.

export const WINDOW = {
  start: "2026-05-01",
  end: "2026-07-31",
};

// TBR-FL: MiLB 18,680 (6,000 / 6,240 / 6,440) + B&G 1,620 (May only)
// TBR covers include B&G lunches; product purchased on TBR invoices is NOT
// split between clients. See BG_DISCLOSURE below.
export const TBR_FL = {
  total: 20300,
  monthly: {
    "2026-05": 7620,  // MiLB 6,000 + B&G 1,620 (May only)
    "2026-06": 6240,  // MiLB 6,240
    "2026-07": 6440,  // MiLB 6,440
  },
  components: {
    milb: 18680,
    bg: 1620,
  },
  source: "Kevin's 2026 TBR Service Calendar; Chat-Claude ruling (addendum A1)",
};

// TBJ-FL: all service lines (9,433 / 9,307 / 10,801)
export const TBJ_FL = {
  total: 29541,
  monthly: {
    "2026-05": 9433,
    "2026-06": 9307,
    "2026-07": 10801,
  },
  source: "Kevin's 2026 TBJ Service Calendar; Chat-Claude ruling (addendum A1)",
};

// STL-FL: FCL 11,060 + PBC 7,800 (7,540 / 6,190 / 5,130) - unchanged
export const STL_FL = {
  total: 18860,
  monthly: {
    "2026-05": 7540,
    "2026-06": 6190,
    "2026-07": 5130,
  },
  components: {
    fcl: 11060,
    pbc: 7800,
  },
  source: "Kevin's 2027 STL Service Calendar projections; Q6 ruling (unchanged)",
};

export const CANON = {
  "TBR-FL": TBR_FL,
  "TBJ-FL": TBJ_FL,
  "STL-FL": STL_FL,
};

// B&G disclosure boilerplate. Every TBR per-cover figure in _analysis6.json,
// the workbook, and the one-pager must carry this note.
// Phase 6b: Kevin's S6 ruling - "lunches" was wrong; the meal is an after-school
// supper. String updated per verbatim Kevin ruling.
export const BG_DISCLOSURE =
  "TBR covers include 1,620 Boys and Girls Club meals " +
  "(8.0% of window covers, all in May), a separate client billed at a flat " +
  "$6.50 per meal against MiLB blended $20.05. The meal is an after-school " +
  "supper, not a lunch. Invoice product is not split between clients, so " +
  "per-cover figures are a floor for MiLB-only intensity.";

// Phase 6b: bg_contract metadata block. Landed in A6._phase6.bg_contract.
// Sources: REC-108 (Account Record for TBR-FL) + REF-141 (Price Book).
export const BG_CONTRACT = {
  term_start: "2025-08-19",
  term_end: "2026-05-21",
  auto_renewal: false,
  billing_cadence: "prepaid_4_week_periods",
  tax_status: "tax_exempt",
  billed_price_per_meal: 6.50,
  planning_estimate_per_day: 125,
  planning_estimate_note: "125/day is a planning estimate, not a billed floor",
  school_year_value_approx: 79950,
  source: "REC-108 (Account Record TBR-FL) + REF-141 (Price Book)",
};

// Helper to fetch canonical denominator for an account key.
export function windowMeals(acct) {
  const c = CANON[acct];
  if (!c) return null;
  return c.total;
}

// Helper: get monthly meals map (2026-05, 2026-06, 2026-07)
export function monthlyMeals(acct) {
  const c = CANON[acct];
  if (!c) return null;
  return c.monthly;
}
