"use client";
// SpringTrainingSection (R3-5, 2026-08-01, owner-approved render
// RENDER_STL_FL_SPRING_TRAINING.html).
//
// Synthetic display construct spanning the four " - ST" suffix
// services on STL - FL (Breakfast + Lunch, each in MLB and MiLB
// groups). Membership is a name-suffix match, self-fencing per
// probe A (only account carrying " - ST" services is STL - FL).
//
// Rules (owner R3-5):
//   1. Date inside the spring block -> section renders open at top.
//   2. Outside -> section collapses into the inactive-groups drawer.
//   3. Any ST service with a projection OR entered count on the day
//      -> promoted to top regardless of date (rule 3 override).
//   4. Regular MiLB Breakfast + Lunch always render, in phase or out.
//   5. One Match projections button, covering both tiers, composing
//      with R3-2's meals gate + skip guard - never re-authored here.
//
// Data untouched (Acceptance 3): the four services keep their real
// MLB / MiLB group membership. Tiers here are display-only labels.
// Anything aggregating by group behaves exactly as before.
//
// Match/Clear (Acceptance 4-5): parent constructs one synthetic
// group `{ name: SPRING_TRAINING_GROUP_KEY, services: stServices }`
// and passes it to the existing R3-2 handlers. Snapshot keys by
// the synthetic name; no collision with real groups. Match fills
// only services with a defined projection (R3-2 skip); explicit
// projected 0 fills.

import ServiceRow from "./ServiceRow";

export const SPRING_TRAINING_GROUP_KEY = "__spring_training__";

// Owner-approved subtitles (RENDER_STL_FL_SPRING_TRAINING.html).
// WHY_OFF_PHASE_DRAWER added 2026-08-01: prior label "Off schedule ·
// entered for this day" was the promoted-off-phase copy; when the
// section sat in the inactive drawer without any entries, that copy
// falsely claimed something had been entered. Owner-approved
// alternative from the same render: "Not scheduled today".
const WHY_IN_PHASE_PROJECTED    = "Shared dining room";
const WHY_IN_PHASE_UNPROJECTED  = "Shared dining room · nothing scheduled yet";
const WHY_OFF_PHASE_PROMOTED    = "Off schedule · entered for this day";
const WHY_OFF_PHASE_DRAWER      = "Not scheduled today";

export default function SpringTrainingSection({
  stServices,             // [{ ...svc, tier }] flat, in-service on day
  day,
  editValues,
  touched,
  flashMap,
  isSpringDate,           // date is inside phaseCalendar.js spring block
  hasSTValue,             // any ST service has projection > 0 or actual > 0
  expanded,               // true = at top of ledger, false = inside drawer
  onChange,
  onFillProjections,      // takes synthetic group
  onClearToPreMatch,      // takes synthetic group
  hasMatchSnapshot,       // for the synthetic group
  feeGroupSummary,        // shared aggregator (fee-shape returns {meals, revenue:0})
  feeProjectedGroupSummary,
  readOnly = false,
  // sc-bulk-ui PR 2 item 2 (2026-08-03): forwarded from parent.
  // ST services follow the same predicate as any other service on
  // the day.
  getNotScheduled = null,
}) {
  // Synthetic group for Match/Clear. Snapshot stores keyed by this
  // name; parent's matchSnapshots[SPRING_TRAINING_GROUP_KEY] flows.
  const syntheticGroup = { name: SPRING_TRAINING_GROUP_KEY, services: stServices };
  const gsEntered = feeGroupSummary(syntheticGroup);
  const gsProjected = feeProjectedGroupSummary(syntheticGroup);
  const hasProjectedMeals = gsProjected.meals > 0;

  // Rule 2 acceptance: missing does not look like zero. In-phase and
  // name-match returned nothing = explicit state, not silent absence.
  if (isSpringDate && stServices.length === 0) {
    return (
      <section
        className="sc-v2-entry-st-section sc-v2-entry-st-section--missing"
        data-active={expanded ? "true" : "false"}
      >
        <header className="sc-v2-entry-st-header">
          <div className="sc-v2-entry-st-title">
            <span className="sc-v2-entry-st-name">Spring Training</span>
            <span className="sc-v2-entry-st-why">No matching services on this account</span>
          </div>
        </header>
        <div className="sc-v2-entry-st-missing-body">
          Expected services with a " - ST" name suffix; none found. If services were renamed,
          check the catalog. This day is inside the spring block per phaseCalendar.js.
        </div>
      </section>
    );
  }

  // Subtitle per state. Drawer state (expanded=false) takes precedence:
  // off-phase without any ST value, section sits in the inactive-
  // groups drawer and reads "Not scheduled today". Promoted state
  // (expanded=true) then splits by phase + projection presence.
  let why;
  if (!expanded)                                why = WHY_OFF_PHASE_DRAWER;
  else if (isSpringDate && hasProjectedMeals)   why = WHY_IN_PHASE_PROJECTED;
  else if (isSpringDate && !hasProjectedMeals)  why = WHY_IN_PHASE_UNPROJECTED;
  else                                           why = WHY_OFF_PHASE_PROMOTED;

  // Group services by real group name (their tier). Preserve encounter
  // order so MLB renders before MiLB as the render spec shows.
  const byTier = new Map();
  for (const s of stServices) {
    if (!byTier.has(s.tier)) byTier.set(s.tier, []);
    byTier.get(s.tier).push(s);
  }

  // Show entered totals if the operator has touched any ST service,
  // else the projected. Mirrors GroupBlock's subtotal rule.
  const anyTouched = stServices.some((s) => touched.has(s.colIndex));
  const subtotalMeals = anyTouched ? gsEntered.meals : gsProjected.meals;

  return (
    <section
      className="sc-v2-entry-st-section"
      data-active={expanded ? "true" : "false"}
    >
      <header className="sc-v2-entry-st-header">
        <div className="sc-v2-entry-st-title">
          <span className="sc-v2-entry-st-name">Spring Training</span>
          <span className="sc-v2-entry-st-why">{why}</span>
        </div>
        {/* Match/Clear header - same shape as GroupBlock's, one
            button pair per section. R3-2 meals gate: hide Match
            when nothing is projected (rule 4 acceptance - button
            is absent, not disabled or forced visible). Clear shows
            only when a snapshot exists for this synthetic group. */}
        <div
          className="sc-v2-entry-group-actions"
          data-cleared={hasProjectedMeals && hasMatchSnapshot ? "true" : "false"}
        >
          {hasProjectedMeals && !readOnly && (
            <>
              <button
                type="button"
                className="sc-v2-entry-group-clear"
                onClick={() => onClearToPreMatch?.(syntheticGroup)}
                aria-hidden={hasMatchSnapshot ? undefined : "true"}
                tabIndex={hasMatchSnapshot ? 0 : -1}
              >
                Clear
              </button>
              <button
                type="button"
                className={`sc-v2-entry-group-match${hasMatchSnapshot ? " sc-v2-entry-group-match--held" : ""}`}
                onClick={() => onFillProjections(syntheticGroup)}
              >
                Match projections
              </button>
            </>
          )}
        </div>
      </header>
      <div className="sc-v2-entry-st-body">
        {[...byTier.entries()].map(([tier, svcs]) => (
          <div key={tier} className="sc-v2-entry-st-tier">
            <div className="sc-v2-entry-st-tier-head">{tier}</div>
            <div className="sc-day-ledger sc-day-ledger--fee sc-v2-entry-st-tier-ledger">
              {svcs.map((s) => (
                <ServiceRow
                  key={s.colIndex}
                  svc={s}
                  day={day}
                  editValues={editValues}
                  touched={touched}
                  flashDelay={flashMap?.get(s.colIndex)}
                  onChange={onChange}
                  hideAmount={true}
                  hideRate={true}
                  readOnly={readOnly}
                  notScheduled={getNotScheduled ? getNotScheduled(s) : null}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <footer className="sc-v2-entry-st-subtotal">
        {subtotalMeals.toLocaleString()} meals
      </footer>
    </section>
  );
}
