// src/lib/labor/salariedPredicate.js
//
// Salaried predicate for the intranet. ONE source of truth for the
// "is this worker salaried" question so the salary derive
// (scripts/derive_salary_actuals.mjs) and the people derive
// (scripts/derive_people.mjs) cannot drift.
//
// Rule per salary PR 1 spec S-1 fallback: worker.overtime_exemption
// === 'EXEMPT'. compensations.payment_type is DEFAULT / VARIED and
// does not partition salaried-vs-hourly; employment_type is null on
// every worker in the current snapshot; the OT-exemption flag on
// the worker record is what admits or refuses.
//
// The full history for that fallback is at
// scripts/derive_salary_actuals.mjs (the SALARIED_OT_EXEMPTION
// const's comment header). Do not re-derive it here.

export const SALARIED_OT_EXEMPTION = "EXEMPT";

export function isSalariedWorker(workerPayload) {
  return workerPayload?.overtime_exemption === SALARIED_OT_EXEMPTION;
}
