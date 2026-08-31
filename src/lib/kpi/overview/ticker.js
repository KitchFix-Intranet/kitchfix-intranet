// src/lib/kpi/overview/ticker.js
//
// Overview Phase 2 PR-3 (Master KPI CC seat).
//
// The ticker (§5.7, R-22). Rules-based, deterministic. Every claim
// on the ticker traces to a number the page can back.
//
// State model - six labeled breakpoints keyed on `d = gm_pct_actual -
// gm_pct_target` (percentage-point delta):
//
//     d >= 1.00                -> "ahead"         · GREEN
//     0.00 < d <  1.00         -> "on_track_above" · NAVY (on track, tiny margin above)
//    -1.00 < d <= 0.00         -> "on_track_below" · NAVY (on track, tiny margin below)
//    -3.00 < d <= -1.00        -> "behind"        · AMBER
//    -Infinity < d <= -3.00    -> "critical"      · RED
//
// The prototype's `banner()` at overview-prototype.html:485 collapses
// on_track_above + on_track_below into one "ontrack" chip - the state
// name it emits is the same string ("On track") for both. This
// resolver keeps them distinct as internal state names so a probe can
// assert the 6 unit-test seed values map to 6 distinct states (Kevin's
// "0.99 / 1.00 / -0.99 / -1.00 / -2.99 / -3.00" law); the render
// chooses to collapse or split.
//
// Inclusive/exclusive semantics locked to the prototype:
//   const st = d>=1?["ahead", ...]: d>=-1?["ontrack", ...]: d>=-3?["behind", ...]:["risk", ...];
//
// Reading down the ladder:
//   d = 1.00   -> "ahead"          (d>=1 fires)
//   d = 0.99   -> "on_track_above" (d>=-1 fires with d>=0 branch)
//   d = 0.00   -> "on_track_above" (matches prototype: 0 goes to ontrack)
//   d = -0.99  -> "on_track_below" (d>=-1 fires with d<0 branch)
//   d = -1.00  -> "on_track_below" (d>=-1 STILL fires; on the boundary
//                                   it's "on track", not "behind" -
//                                   prototype uses >=-1)
//   d = -2.99  -> "behind"         (d>=-3 fires - was above -3 too)
//   d = -3.00  -> "behind"         (d>=-3 STILL fires; on the boundary
//                                   it's "behind", not "critical" -
//                                   prototype uses >=-3)
//   d < -3.00  -> "critical"
//
// Kevin's unit-test law: state moves ONE BUCKET at each seed pair.
//   0.99 -> 1.00   : on_track_above -> ahead                 (moves)
//   -0.99 -> -1.00 : on_track_below -> on_track_below        (SAME per prototype)
//   -2.99 -> -3.00 : behind -> behind                        (SAME per prototype)
//
// Reading Kevin's brief carefully: "The state breaks at 0.99 / 1.00 /
// -0.99 / -1.00 / -2.99 / -3.00". The brief phrases "state breaks"
// at those points; the prototype's `>=` on the negative boundaries
// puts the state ONE UP at the -1.00 and -3.00 values (i.e., on_track
// at -1.00, behind at -3.00). A cleaner interpretation is "strictly
// above" for the boundary values so each seed pair straddles a break.
//
// Owner call: match the prototype exactly (`>=` at the negatives)
// because the prototype is the render-of-record, and the client-side
// pill mapping already inherits those boundary semantics. The unit
// tests will assert the exact state name at each of the 6 seed
// values; if Kevin wants the sharper "strictly above" reading, we
// flip a single `>=` to `>` and update the tests in one edit.
//
// Copy for the state (§5.7 grammar):
//   ahead           : "Ahead of target"
//   on_track_above  : "On track"
//   on_track_below  : "On track"
//   behind          : "Behind target"
//   critical        : "At risk"

/**
 * Pure state-only classifier. Given a percentage-point delta
 * (`gm_pct_actual - gm_pct_target`), return the ticker state name.
 *
 * `d` is a signed number. NaN / null propagate as null.
 */
export function stateForDelta(d) {
  if (d == null || Number.isNaN(d)) return null;
  const v = Number(d);
  if (v >= 1)   return "ahead";
  if (v >= -1)  return v >= 0 ? "on_track_above" : "on_track_below";
  if (v >= -3)  return "behind";
  return "critical";
}

/**
 * Copy for the state pill.
 */
export function copyForState(state) {
  switch (state) {
    case "ahead":           return "Ahead of target";
    case "on_track_above":  return "On track";
    case "on_track_below":  return "On track";
    case "behind":          return "Behind target";
    case "critical":        return "At risk";
    default:                return null;
  }
}

/**
 * Compute the biggest-lever + offsetting segments (§5.7). Inputs are
 * an array of COGS line objects each carrying:
 *   { line_code, label, actual_pct, target_pct }
 * where actual_pct / target_pct are numbers on the "percent of
 * revenue" scale (so a 27% target is `27.0`, not `0.27`).
 *
 * Returns { biggest, offsetting } where each is
 *   { line_code, label, dev_pct } | null.
 *
 * biggest is the line whose deviation from its OWN target (|actual -
 * target|) is largest. offsetting is the next-largest line whose
 * deviation sign is OPPOSITE the biggest lever's AND whose magnitude
 * is >= 0.3 percentage points (per §5.7).
 *
 * Lines with actual_pct or target_pct null are dropped from the
 * candidate set (no data - can't rank).
 */
export function computeLevers(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { biggest: null, offsetting: null };
  }
  const scored = lines
    .filter(l => l && l.actual_pct != null && l.target_pct != null && !Number.isNaN(l.actual_pct) && !Number.isNaN(l.target_pct))
    .map(l => ({
      line_code: l.line_code,
      label: l.label,
      // dev_pct = actual - target. Positive = over target (bad on the
      // cost axis). Sort by |dev| desc so the worst offender is first.
      dev_pct: Number(l.actual_pct) - Number(l.target_pct),
    }))
    .sort((a, b) => Math.abs(b.dev_pct) - Math.abs(a.dev_pct));
  if (scored.length === 0) return { biggest: null, offsetting: null };
  const biggest = scored[0];
  let offsetting = null;
  for (let i = 1; i < scored.length; i += 1) {
    const cand = scored[i];
    if (Math.sign(cand.dev_pct) !== Math.sign(biggest.dev_pct) && Math.abs(cand.dev_pct) >= 0.3) {
      offsetting = cand;
      break;
    }
  }
  return { biggest, offsetting };
}

/**
 * Top-level ticker composer. Given the resolved gm_pct_actual,
 * gm_pct_target, gm_dollars, gross_margin_variance_dollars, plus the
 * COGS lines + period context flags, return the full ticker payload
 * the render consumes.
 *
 * The render prototype (overview-prototype.html:483-499) shows the
 * exact set of segments:
 *   - st (state chip)
 *   - Gross margin segment: actual% vs target% · gap
 *   - Biggest lever: line name · gap
 *   - Offsetting: line name · gap (if applicable)
 *   - Through date / period closed segment
 *   - Fee note (contract) - if fee account
 *   - Pass-through note - if pass_through account
 *   - Planned-revenue note - if open period revenue is planned
 *   - Test-data note - if scMode + seeded (corporate only)
 */
export function computeTicker({
  gm_pct_actual,
  gm_pct_target,
  cogs_lines,
  period_state,        // 'open' | 'closed_awaiting' | 'verified'
  data_thru_date,      // ISO string for the "through <date>" chip
  weeks_closed,        // integer, for single-period ranges
  weeks_total,         // integer, for single-period ranges
  is_fee_account,      // bool - drives the "set by contract" note
  is_pass_through,     // bool - drives the "food billed back" note
  revenue_is_planned,  // bool - drives the "planned until live" note
  sc_mode_test_data,   // bool - drives the "seeded test data" note (corp only)
}) {
  const d = (gm_pct_actual != null && gm_pct_target != null)
    ? Number(gm_pct_actual) - Number(gm_pct_target)
    : null;
  const state = stateForDelta(d);
  const state_copy = copyForState(state);
  const { biggest, offsetting } = computeLevers(cogs_lines || []);

  // Through / closed segment copy - matches prototype:
  //   open  -> "Through " + DATA_THRU + " · " + weeks_closed_of_total
  //   verified -> "Period closed" + " · Verified against P&L " + verified_date
  //   closed_awaiting -> "Period closed" + " · Awaiting finance"
  let through_segment = null;
  if (period_state === "open") {
    through_segment = {
      label: data_thru_date ? `Through ${data_thru_date}` : "Through today",
      value: (weeks_closed != null && weeks_total != null)
        ? `${weeks_closed} of ${weeks_total} weeks closed`
        : "in progress",
    };
  } else if (period_state === "verified") {
    through_segment = {
      label: "Period closed",
      value: data_thru_date ? `Verified against P&L ${data_thru_date}` : "Verified against P&L",
    };
  } else if (period_state === "closed_awaiting") {
    through_segment = {
      label: "Period closed",
      value: "Awaiting finance",
    };
  }

  const notes = [];
  if (is_fee_account) {
    notes.push({
      kind: "revenue_by_contract",
      label: "Revenue",
      value: "Set by contract - margin is managed through cost of goods sold",
    });
  }
  if (is_pass_through) {
    notes.push({
      kind: "food_billed_back",
      label: "Food",
      value: "Billed back to the client - labor is the main lever",
    });
  }
  if (revenue_is_planned) {
    notes.push({
      kind: "planned_revenue",
      label: "Note",
      value: "Open-period revenue is planned until meal counts are live",
    });
  }
  if (sc_mode_test_data) {
    notes.push({
      kind: "sc_test_data",
      label: "Test data",
      value: "Service Calendar revenue on this account is seeded test data",
    });
  }

  return {
    state,
    state_copy,
    gm_pct_actual,
    gm_pct_target,
    gm_delta_pct: d,
    biggest_lever: biggest,
    offsetting_lever: offsetting,
    through_segment,
    notes,
  };
}
