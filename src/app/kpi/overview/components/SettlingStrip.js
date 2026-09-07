"use client";
// src/app/kpi/overview/components/SettlingStrip.js
//
// Kevin R-94 (2026-09-09). "What is still moving" strip above the
// three cards on Last period when the period is closed but not yet
// finance-verified. Names the two sources of movement - purchases
// (invoice lag) + labour (unapproved hours) - with counts so the
// caveat becomes an action for the half the operator controls.
//
// Render of record: docs/renders/last-period-awaiting-verification.html.
//
// Drops a line when it no longer applies:
//   - all hours approved -> purchases only
//   - all invoices landed -> labour only (rare - purchases keep landing
//     for a week regardless of approval state)
// If neither applies the period is verified and the strip is absent
// (settling === null from the resolver).
//
// Payload contract:
//   settling: {
//     period_no, period_end,
//     purchases: { current_lines, prior_lines, prior_period_no },
//     labour: { hours, people },
//   } | null

export default function SettlingStrip({ settling }) {
  if (!settling) return null;
  const { purchases, labour } = settling;
  const hasPurchases = purchases && purchases.current_lines != null;
  const hasLabour = labour && Number(labour.hours || 0) > 0.04 && (labour.people || 0) > 0;
  if (!hasPurchases && !hasLabour) return null;

  return (
    <div className="kpi-ov-settling" data-kpi-ov="settling-strip">
      <span className="kpi-ov-settling-t">What is still moving</span>
      {hasPurchases && (
        <span className="kpi-ov-settling-it" data-kpi-ov="settling-purchases">
          <b>Purchases</b>
          {" · "}
          {purchases.current_lines} invoice line{purchases.current_lines === 1 ? "" : "s"}
          {purchases.prior_lines != null && purchases.prior_period_no != null && (
            <> against {purchases.prior_lines} in P{purchases.prior_period_no}</>
          )}
          {" · more land on the nightly sync"}
        </span>
      )}
      {hasLabour && (
        <span className="kpi-ov-settling-it" data-kpi-ov="settling-labour">
          <b>Labour</b>
          {" · "}
          {Number(labour.hours).toFixed(2)} hrs awaiting approval across{" "}
          {labour.people} {labour.people === 1 ? "person" : "people"}
          {" · lands as they are approved"}
        </span>
      )}
    </div>
  );
}
