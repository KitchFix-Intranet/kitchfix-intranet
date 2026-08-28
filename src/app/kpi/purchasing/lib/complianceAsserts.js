// src/app/kpi/purchasing/lib/complianceAsserts.js
//
// PR 6 - deterministic parity gates on the compliance payload. Extracted
// from CardCompliance.js so a probe (scripts/probes/_probe_compliance_
// check3.mjs) can seed a mismatch and prove the check fires, per the
// CC_PROMPT B ruling.
//
// The gates walk the invariant Kevin's C-clause names as the defect
// class this board has closed on three prior surfaces: two things
// describing one number from different inputs.
//   Check 2 - east + west == total          (region parity)
//   Check 3 - sum(people) == site totals    (site/person parity)
// Both throw on mismatch in dev. In production they still log-and-
// continue so a bad payload never crashes an operator's live board.

const NEAR_ZERO = 0.01;

function nearlyEqual(a, b) {
  return Math.abs(Math.round(a * 100) / 100 - Math.round(b * 100) / 100) <= NEAR_ZERO;
}

// Check 3 - site totals must equal the sum of their people rows on
// BOTH charges and amount. Every site is walked; the first mismatch
// throws with a diagnostic that names the site, the two totals, and
// the delta.
export function assertSitePeopleParity(site_rows) {
  for (const site of site_rows) {
    const cSum = site.people.reduce((s, p) => s + p.charges, 0);
    const aSum = Math.round(site.people.reduce((s, p) => s + p.amount, 0) * 100) / 100;
    const aSite = Math.round(site.amount * 100) / 100;
    if (cSum !== site.charges || !nearlyEqual(aSum, aSite)) {
      throw new Error(
        `CardCompliance Check 3: site ${site.site_code} charges=${site.charges} != sum(people.charges)=${cSum}, amount=$${aSite.toFixed(2)} != sum(people.amount)=$${aSum.toFixed(2)}`,
      );
    }
  }
}

// Check 2 - region_split east + west must equal total_count /
// total_amount when present. Null region_split (single-account scope)
// short-circuits.
export function assertRegionParity(region_split, total_count, total_amount) {
  if (!region_split) return;
  const east = region_split.east ?? { count: 0, amount: 0 };
  const west = region_split.west ?? { count: 0, amount: 0 };
  const c = (east.count ?? 0) + (west.count ?? 0);
  const a = Math.round(((east.amount ?? 0) + (west.amount ?? 0)) * 100) / 100;
  if (c !== total_count || !nearlyEqual(a, total_amount)) {
    throw new Error(
      `CardCompliance Check 2: east+west count=${c} amount=$${a.toFixed(2)} != total count=${total_count} amount=$${Math.round(total_amount * 100) / 100}`,
    );
  }
}
