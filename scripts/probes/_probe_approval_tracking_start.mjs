// Approval-tracking start date - narrow-filter contract.
//
// Owner ruling 2026-08-27. The Approvals card shipped this week and
// three DRAFT stragglers older than 08/01 clutter it. Framing this as
// a start date (approval tracking began on 2026-08-01) rather than a
// suppression list (hardcoded entry IDs) is deliberate - a bare
// exception rots; a start date carries its own reason.
//
// The filter is NARROW: it applies only to what the Approvals card
// reads. Data-quality signals (anomaly chips, entry counts) are NOT
// filtered - a broken punch on any date is still a broken punch.
//
// This probe asserts the contract by driving the DRAFT-block branch
// of estimateDraftBucket (extracted below as a pure copy of the
// deriveActuals block; kept in-probe so the probe does not import
// deriveActuals' heavy dependency tree) with three fixtures:
//
//   A1  07/31 DRAFT     excluded from draft_hours + oldest_draft_start
//   A2  08/01 DRAFT     included (boundary is inclusive)
//   A3  APPROVED 05/19  approved_hours unaffected by the cutoff
//   A4  narrow scope    07/31 DRAFT still counts toward draft_entry_count
//                       and any anomaly flag it carries
//   A5  mixed bucket    a bucket with both pre- and post-cutoff DRAFTs
//                       reports draft_hours from post only, oldest_draft
//                       from the OLDEST POST-cutoff draft (not the
//                       real oldest); draft_entry_count includes both
//
// Under the source-of-truth rule, the branch logic in this probe must
// stay byte-identical with deriveActuals.js:497-521. If deriveActuals
// changes, update this probe.

import { APPROVAL_TRACKING_START } from "../../src/lib/labor/approvalsTracking.js";

// Mirror of the DRAFT/APPROVED accounting block from
// src/lib/labor/deriveActuals.js. Pure - takes a mutable bucket +
// one entry, mutates the bucket. Byte-identical logic per the source
// note above.
function applyEntryToBucket(bucket, p) {
  if (p.status === "DRAFT") {
    const dur = Number(p.time_entry_summary?.duration || 0);
    bucket.draft_entry_count++;
    if (!p.end_time) bucket.anomaly_no_clockout++;
    if (dur > 0 && dur < 1.0) bucket.anomaly_under_1h++;
    if (dur > 16.0) bucket.anomaly_over_16h++;
    const startIso = p.start_time || null;
    const inTrackingWindow = startIso && startIso.slice(0, 10) >= APPROVAL_TRACKING_START;
    if (inTrackingWindow) {
      bucket.draft_hours += dur;
      if (bucket.oldest_draft_start === null || startIso < bucket.oldest_draft_start) {
        bucket.oldest_draft_start = startIso;
      }
    }
  } else if (p.status === "APPROVED") {
    const dur = Number(p.time_entry_summary?.duration || 0);
    bucket.approved_entry_count++;
    bucket.approved_hours += dur;
  }
}

function newBucket() {
  return {
    draft_entry_count: 0,
    draft_hours: 0,
    approved_entry_count: 0,
    approved_hours: 0,
    anomaly_no_clockout: 0,
    anomaly_under_1h: 0,
    anomaly_over_16h: 0,
    oldest_draft_start: null,
  };
}

let failures = 0;
function assert(name, cond, extra) {
  if (cond) { console.log(`  ✓ ${name}`); return; }
  failures += 1;
  console.log(`  ✗ ${name}`);
  if (extra !== undefined) console.log(`      ${JSON.stringify(extra)}`);
}

console.log(`=== approval-tracking start: ${APPROVAL_TRACKING_START} ===\n`);

// A1 - a DRAFT entry dated 07/31 is excluded from draft_hours and
//      oldest_draft_start (the two card-facing fields).
{
  const b = newBucket();
  applyEntryToBucket(b, {
    status: "DRAFT",
    start_time: "2026-07-31T14:00:00Z",
    end_time:   "2026-07-31T15:00:00Z",
    time_entry_summary: { duration: 1.0 },
  });
  assert("A1  07/31 DRAFT excluded from draft_hours",   b.draft_hours === 0, b);
  assert("A1  07/31 DRAFT excluded from oldest_draft",  b.oldest_draft_start === null, b);
}

// A2 - a DRAFT entry dated 08/01 IS included (boundary inclusive).
{
  const b = newBucket();
  applyEntryToBucket(b, {
    status: "DRAFT",
    start_time: "2026-08-01T14:00:00Z",
    end_time:   "2026-08-01T15:00:00Z",
    time_entry_summary: { duration: 1.0 },
  });
  assert("A2  08/01 DRAFT included in draft_hours",     b.draft_hours === 1.0, b);
  assert("A2  08/01 DRAFT included in oldest_draft",    b.oldest_draft_start === "2026-08-01T14:00:00Z", b);
}

// A3 - approved_hours unaffected by the cutoff. An APPROVED entry
//      dated 05/19 (pre-cutoff) still contributes to approved_hours.
{
  const b = newBucket();
  applyEntryToBucket(b, {
    status: "APPROVED",
    start_time: "2026-05-19T14:00:00Z",
    end_time:   "2026-05-19T15:30:00Z",
    time_entry_summary: { duration: 1.5 },
  });
  assert("A3  approved_hours unaffected by cutoff",     b.approved_hours === 1.5, b);
}

// A4 - narrow scope. A 07/31 DRAFT with a no-clock-out flag still
//      contributes to draft_entry_count + anomaly_no_clockout. Only
//      the card-facing fields are filtered.
{
  const b = newBucket();
  applyEntryToBucket(b, {
    status: "DRAFT",
    start_time: "2026-07-31T14:00:00Z",
    end_time:   null,   // no clock-out
    time_entry_summary: { duration: 8.0 },
  });
  assert("A4a  narrow scope: draft_entry_count counts pre-cutoff",  b.draft_entry_count === 1, b);
  assert("A4b  narrow scope: anomaly_no_clockout counts pre-cutoff", b.anomaly_no_clockout === 1, b);
  assert("A4c  narrow scope: draft_hours does NOT count pre-cutoff", b.draft_hours === 0, b);
}

// A5 - mixed bucket. Three DRAFTs: 05/19 (pre), 08/01 (post), 08/15
//      (post). draft_hours sums post only; oldest_draft is 08/01
//      (the OLDEST POST-cutoff draft, not the real oldest);
//      draft_entry_count includes all three.
{
  const b = newBucket();
  applyEntryToBucket(b, {
    status: "DRAFT",
    start_time: "2026-05-19T14:00:00Z",
    end_time:   "2026-05-19T15:00:00Z",
    time_entry_summary: { duration: 1.0 },
  });
  applyEntryToBucket(b, {
    status: "DRAFT",
    start_time: "2026-08-01T09:00:00Z",
    end_time:   "2026-08-01T17:00:00Z",
    time_entry_summary: { duration: 8.0 },
  });
  applyEntryToBucket(b, {
    status: "DRAFT",
    start_time: "2026-08-15T09:00:00Z",
    end_time:   "2026-08-15T17:00:00Z",
    time_entry_summary: { duration: 8.0 },
  });
  assert("A5a  mixed: draft_hours sums POST only",          b.draft_hours === 16.0, b);
  assert("A5b  mixed: oldest_draft is 08/01 (post-cutoff)", b.oldest_draft_start === "2026-08-01T09:00:00Z", b);
  assert("A5c  mixed: draft_entry_count counts all three",   b.draft_entry_count === 3, b);
}

console.log(`\n---`);
if (failures > 0) {
  console.log(`${failures} assertion(s) failed.`);
  process.exit(1);
}
console.log(`all assertions pass.`);
