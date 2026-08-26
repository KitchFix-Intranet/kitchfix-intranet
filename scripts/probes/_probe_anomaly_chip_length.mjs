// Anomaly-chip label bound guard.
//
// Owner directive 2026-08-26 (homestand-fixes round 2 addendum): the
// anomaly chip's label must state the COUNT ONLY. The reason
// breakdown belongs on the row's title attribute, one hover away,
// not occupying the table cell. Prior chip enumerated its reasons
// ("2 need attention - 1 never clocked out, 1 over 16h" = 267px) and
// grew unbounded past 350px on three anomaly types with larger counts,
// breaking the row.
//
// This probe asserts flagForV42State returns:
//   - label length bounded (no enumerated breakdown)
//   - no enumeration words in the label ("never clocked out", "under
//     1h", "over 16h") - those live in the tooltip
//   - tooltip DOES contain the enumeration (the detail is preserved,
//     just moved to the hover)
//
// Third guard class this week (route SELECT + contrast + chip length).
// The pattern: guards watch one surface, defects live on another.

import { flagForV42State } from "../../src/app/kpi/labor/lib/weekFlag.js";

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra) console.log(extra);
}

// Fixtures: single-anomaly, mixed, high-count. All must produce
// count-only labels.
const scenarios = [
  { name: "1 no-clockout", input: { anomaly_no_clockout: 1, anomaly_under_1h: 0, anomaly_over_16h: 0, unpriced_hrs: 0, draft_entry_count: 0, draft_hours: 0 } },
  { name: "1 under-1h",    input: { anomaly_no_clockout: 0, anomaly_under_1h: 1, anomaly_over_16h: 0, unpriced_hrs: 0, draft_entry_count: 0, draft_hours: 0 } },
  { name: "1 over-16h",    input: { anomaly_no_clockout: 0, anomaly_under_1h: 0, anomaly_over_16h: 1, unpriced_hrs: 0, draft_entry_count: 0, draft_hours: 0 } },
  { name: "2 mixed (Kevin fixture)", input: { anomaly_no_clockout: 1, anomaly_under_1h: 0, anomaly_over_16h: 1, unpriced_hrs: 0, draft_entry_count: 0, draft_hours: 0 } },
  { name: "3 mixed (three types)",   input: { anomaly_no_clockout: 3, anomaly_under_1h: 2, anomaly_over_16h: 1, unpriced_hrs: 0, draft_entry_count: 0, draft_hours: 0 } },
  { name: "12 all no-clockout (stress)", input: { anomaly_no_clockout: 12, anomaly_under_1h: 0, anomaly_over_16h: 0, unpriced_hrs: 0, draft_entry_count: 0, draft_hours: 0 } },
];

const ENUM_WORDS = ["never clocked out", "under 1h", "over 16h"];
// Character-count bound. "12 need attention" is 17 chars. Anything
// beyond 24 chars is over the count-only shape - a plausible extreme
// count (999 need attention = 19 chars) still fits. This mirrors the
// ~140px measured budget Kevin's spec asks for.
const MAX_LABEL_CHARS = 24;

console.log("=== anomaly chip label bound guard ===\n");

for (const sc of scenarios) {
  const flag = flagForV42State(sc.input, false);
  const label = flag?.label ?? "";
  const tooltip = flag?.tooltip ?? "";

  console.log(`  [${sc.name}]`);
  console.log(`    label:   "${label}"  (${label.length} chars)`);
  console.log(`    tooltip: "${tooltip}"`);

  assert(
    `label under ${MAX_LABEL_CHARS} chars`,
    label.length <= MAX_LABEL_CHARS,
    `  got ${label.length} chars: "${label}"`,
  );
  for (const word of ENUM_WORDS) {
    assert(
      `label does NOT contain enumeration word "${word}"`,
      !label.includes(word),
      `  label leaks reason breakdown: "${label}"`,
    );
  }
  // At least one enumeration word MUST be in the tooltip (the detail
  // is preserved, just moved to the hover).
  const anyInTooltip = ENUM_WORDS.some(w => tooltip.includes(w));
  assert(
    `tooltip contains at least one enumeration word (detail preserved, not deleted)`,
    anyInTooltip,
    `  tooltip lost the detail: "${tooltip}"`,
  );
  console.log("");
}

if (failures > 0) {
  console.log(`\n${failures} failure(s) - anomaly chip is either leaking reasons into the label or losing detail from the tooltip.`);
  process.exit(1);
}
console.log(`all assertions pass.`);
