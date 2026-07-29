// M-4b (2026-07-29): empty-scope suppression for MLB accounts.
//
// Owner ruling: months and periods with no service do not render for
// MLB accounts. PDC, MiLB, and STL - FL keep every month - their
// planning surface is calibrated to a full calendar.
//
// This module's whole job is to name that intent in one place. The
// underlying "is this scope empty?" question is answered by two
// existing card-internal predicates (`detectNoService` in MonthCard,
// `detectOffSeason` in PeriodCard) which drive the pre-M-4b
// off-scope rendering that still fires INSIDE the cards for every
// account shape. We call those predicates verbatim; we do NOT fork
// them, so a change to the "empty" definition ships to both the
// card's own rendering and the suppression policy at the same time.
//
// The MLB gate lives here (not at the call sites) so non-MLB
// accounts always get false and the caller can't accidentally
// suppress a PDC card during a refactor.

import { MLB_HOMESTAND_SURFACE_ACCOUNTS } from "../v2/pilots";
import { detectNoService } from "./MonthCard";
import { detectOffSeason } from "./PeriodCard";

// SeasonShell calls this once per month in the calendar loop. Returns
// true iff the account is in the MLB surface set AND the month has
// no service on it (per MonthCard's own predicate). Non-MLB accounts
// always get false - suppression is MLB-only.
export function isEmptyMonthForMlbSuppression({
  accountKey,
  monthSummary,
  hasHomestandSchedule,
  isFeeAccount,
  isMilb,
}) {
  if (!MLB_HOMESTAND_SURFACE_ACCOUNTS.has(accountKey)) return false;
  return detectNoService({ monthSummary, hasHomestandSchedule, isFeeAccount, isMilb });
}

// SeasonShell calls this once per fiscal period in the period loop.
// Same shape as the month variant.
export function isEmptyPeriodForMlbSuppression({ accountKey, days, kind }) {
  if (!MLB_HOMESTAND_SURFACE_ACCOUNTS.has(accountKey)) return false;
  return detectOffSeason(days, kind);
}
