// src/lib/labor/approvalsTracking.js
//
// Approval-tracking start date. Owner ruling 2026-08-27.
//
// The Approvals card shipped this week and started reading DRAFT
// entries as "someone needs to approve this". Rippling has a small
// tail of DRAFT entries older than the card - Kevin verified:
//
//   before 2026-08-01   3 entries   1.96 hrs   oldest 2026-05-19
//   08/24 onward       71 entries 464.12 hrs
//
// Nothing falls between 07/28 and 08/24, so a start date of 08/01
// drops exactly those three and keeps everything current.
//
// This is framed as a start date, NOT a suppression list. A hardcoded
// set of ignored entry IDs is a permanent exception nobody remembers
// later. A start date is a declaration: approval tracking began on
// this date, which is true - the card shipped this week.
//
// Scope: NARROW. Applies only to the fields the Approvals card reads:
//   draft_hours          per-bucket sum        skipped pre-cutoff
//   oldest_draft_start   per-bucket min-fold   skipped pre-cutoff
//   approval_people      client-side aggregate (follows draft_hours>0)
//
// NOT to:
//   approved_hours       past approvals are real history
//   draft_entry_count    a pre-cutoff broken punch is still a broken punch
//   anomaly_no_clockout  same - data-quality signal, orthogonal to
//   anomaly_under_1h     "someone needs to approve this"
//   anomaly_over_16h
//
// This means a pre-cutoff week can show an anomaly chip while the
// Approvals card reads clean. That is CORRECT - "this punch is
// broken" and "go approve it" are different asks. Do not "fix" this
// inconsistency; it is intentional per the owner ruling.
//
// The date lives in exactly one place. If someone wants to change it,
// they change this file and nowhere else. Card copy imports the
// display string; derive imports the ISO string; probe imports both.

export const APPROVAL_TRACKING_START = "2026-08-01";
export const APPROVAL_TRACKING_START_DISPLAY = "08/01/26";
