"use client";
// src/app/kpi/overview/components/DashOrValue.js
//
// The one rendering primitive for the six non-value states per Phase D
// of the Phase 3 brief:
//
//   state       | render                            | payload signal
//   -----------|-----------------------------------|-----------------------
//   missing    | "-" glyph, muted                   | reported: false + value nullish
//   failed     | "failed" (red)                     | flag "failed" on the row
//   zero       | "$0"                               | reported: true + value === 0
//   not-active | "not active" italic                | flag "not_active" or budget && actual both zero
//   no-budget  | "no budget" muted                  | budget nullish + actual reported
//   not-started| "not started" italic muted         | flag "not_started" (e.g. future week)
//
// The picker function `resolveDashState` inspects the payload signals
// and returns the render shape. Callers can either pass raw payload
// via `value` + `reported` + `flags` (self-picking) OR pass an
// explicit `state` override.

const HYPHEN = "-";

export function resolveDashState({ value, reported, flags = [], budget }) {
  if (Array.isArray(flags) && flags.includes("failed")) return "failed";
  if (Array.isArray(flags) && flags.includes("not_started")) return "not_started";
  if (Array.isArray(flags) && flags.includes("not_active")) return "not_active";
  if (reported === false) return "missing";
  // A payload row that carries value=0 with reported=true is a true
  // zero (customer had no spend / no revenue) - distinct from missing.
  if (value === 0) return "zero";
  if (value == null) return "missing";
  return "value";
}

export default function DashOrValue({
  value,           // preformatted display string (e.g. "$1,234")
  reported = true, // false = missing
  flags = [],
  state,           // explicit override
  showBudgetHint = false,
  budget,
}) {
  const s = state || resolveDashState({ value, reported, flags, budget });

  if (s === "value") {
    return <span data-kpi-ov-cell="value">{value}</span>;
  }
  if (s === "zero") {
    return (
      <span className="kpi-ov-zero kpi-ov-num" data-kpi-ov-cell="zero">
        $0
      </span>
    );
  }
  if (s === "failed") {
    return (
      <span className="kpi-ov-failed" data-kpi-ov-cell="failed">
        failed
      </span>
    );
  }
  if (s === "not_active") {
    return (
      <span className="kpi-ov-notactive" data-kpi-ov-cell="not-active">
        not active
      </span>
    );
  }
  if (s === "no_budget") {
    return (
      <span className="kpi-ov-nobudget" data-kpi-ov-cell="no-budget">
        no budget
      </span>
    );
  }
  if (s === "not_started") {
    return (
      <span className="kpi-ov-notstarted" data-kpi-ov-cell="not-started">
        not started
      </span>
    );
  }
  // missing
  return (
    <span className="kpi-ov-dash" data-kpi-ov-cell="missing" aria-label="not reported">
      {HYPHEN}
    </span>
  );
}
