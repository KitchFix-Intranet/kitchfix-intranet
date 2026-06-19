// ════════════════════════════════════════════════════════════════════════════
// SEED: sc_fee_schedule from the contract bible
//
// Source:  docs/SC_CONTRACT_BILLING_SUMMARY.md "Resolved billing decisions"
//          section. Locked 2026-06-18 from executed contracts. Five flat-fee
//          accounts; service/fee portion only (passthrough excluded per bible).
// Target:  sc_fee_schedule (sc-5 migration, applied 2026-06-19).
// Audit:   Paired sc_config_changelog row per fee insert (entity_type='fee').
//
// EFFECTIVE-DATE CHOICE: 2026-01-01 for all 5. The bible labels each value
// as "2026 revenue (fee)" - the 2026 contract-year annual figure. Per-account
// installment cadences (Mar-Aug, Apr-Sep, Nov/Feb/May/Aug, etc.) are payment
// schedules, not when the annual fee starts applying. Storing 2026-01-01
// gives the future KPI dashboard a clean "what's the fee for 2026?" answer
// via the standard LATERAL pick.
//
// IDEMPOTENCY: skips a row if any row already exists for the same
// (account_key, effective_date). This is deliberately TIGHTER than the
// schema (which has no UNIQUE - same-day corrections need that). Re-running
// the seed should never insert duplicate baselines; corrections happen
// through the admin UI.
//
// USAGE
//   node --import ./scripts/_setup/register-aliases.mjs \
//        --env-file=.env.local scripts/_seed_sc_fee_schedule.mjs
//
// Apply sc-5-fee-schedule.sql in Supabase Studio FIRST. This script requires
// sc_fee_schedule to exist; it will not create it. Verify probe is
// scripts/_probe_sc5_fee_schedule_verify.mjs.
// ════════════════════════════════════════════════════════════════════════════

import { getServiceClient } from "@/lib/supabase";

const EFFECTIVE_DATE = "2026-01-01";
const SEED_BY = "seed-script";
const SEED_REASON =
  "Seed: locked 2026 contract-year annual fee from SC_CONTRACT_BILLING_SUMMARY.md (Bundle 1 Stage 2).";

// Five locked 2026 fees from the contract bible. Service/fee portion only;
// passthrough excluded per bible's "Passthrough is never revenue" rule.
const SEED_ROWS = [
  {
    account_key:            "CIN - OH",
    amount:                 362500,
    payment_cadence:        "monthly-6",
    covered_by_account_key: null,
  },
  {
    account_key:            "STL - MO",
    amount:                 473000,
    payment_cadence:        "monthly-6",
    covered_by_account_key: null,
  },
  {
    account_key:            "TXR - TX - H",
    amount:                 604032,
    payment_cadence:        "monthly-6",
    covered_by_account_key: null,
  },
  {
    account_key:            "TXR - TX - V",
    amount:                 0,
    payment_cadence:        null,
    covered_by_account_key: "TXR - TX - H",
  },
  {
    account_key:            "STL - FL",
    amount:                 1400000,
    payment_cadence:        "quarterly",
    covered_by_account_key: null,
  },
];

const supa = getServiceClient();

console.error("══════ Seed sc_fee_schedule (5 locked 2026 fees) ══════");

let inserted = 0;
let skipped = 0;
let failed = 0;

for (const row of SEED_ROWS) {
  // Idempotency check: any existing row for this (account, eff_date) means
  // we've already seeded this account or an admin write landed first.
  // Either way, do not double-insert.
  const { data: existing, error: checkErr } = await supa
    .from("sc_fee_schedule")
    .select("id, amount, created_at")
    .eq("account_key", row.account_key)
    .eq("effective_date", EFFECTIVE_DATE)
    .limit(1);
  if (checkErr) {
    console.error(`  ✗ ${row.account_key}: check failed (${checkErr.message})`);
    failed++;
    continue;
  }
  if (existing && existing.length > 0) {
    console.error(
      `  - ${row.account_key}: SKIP (already has a row at ${EFFECTIVE_DATE}, ` +
      `id=${existing[0].id.slice(0, 8)}, amount=${existing[0].amount})`
    );
    skipped++;
    continue;
  }

  // Insert fee row.
  const feeRow = {
    account_key:            row.account_key,
    amount:                 row.amount,
    effective_date:         EFFECTIVE_DATE,
    period_type:            "annual",
    payment_cadence:        row.payment_cadence,
    covered_by_account_key: row.covered_by_account_key,
    reason:                 SEED_REASON,
    requested_by:           null,
    changed_by:             SEED_BY,
  };
  const insRes = await supa
    .from("sc_fee_schedule")
    .insert(feeRow)
    .select("id, created_at")
    .single();
  if (insRes.error) {
    console.error(`  ✗ ${row.account_key}: insert failed (${insRes.error.message})`);
    failed++;
    continue;
  }

  // Paired changelog insert. If this fails after the fee insert succeeded,
  // we have an un-audited fee row. The fee-insert GRANT denies UPDATE/DELETE
  // so we can't clean it up programmatically - surface the error so it
  // can be reconciled by hand in Studio.
  const newValue = {
    amount:               row.amount,
    periodType:           "annual",
    paymentCadence:       row.payment_cadence,
    coveredByAccountKey:  row.covered_by_account_key,
  };
  const logRes = await supa.from("sc_config_changelog").insert({
    account_key:    row.account_key,
    entity_type:    "fee",
    entity_id:      null,
    entity_label:   row.account_key,
    change_type:    "create",
    old_value:      null,
    new_value:      newValue,
    effective_date: EFFECTIVE_DATE,
    reason:         SEED_REASON,
    requested_by:   null,
    changed_by:     SEED_BY,
  });
  if (logRes.error) {
    console.error(
      `  ! ${row.account_key}: fee inserted (id=${insRes.data.id.slice(0, 8)}) ` +
      `but changelog FAILED (${logRes.error.message}). Reconcile in Studio.`
    );
    failed++;
    continue;
  }

  const amtStr = row.amount === 0
    ? `$0 (covered by ${row.covered_by_account_key})`
    : `$${row.amount.toLocaleString()}`;
  console.error(`  ✓ ${row.account_key}: ${amtStr} effective ${EFFECTIVE_DATE}`);
  inserted++;
}

console.error("");
console.error(`══════ Done ══════`);
console.error(`  inserted: ${inserted}`);
console.error(`  skipped:  ${skipped}`);
console.error(`  failed:   ${failed}`);

if (failed > 0) {
  process.exit(1);
}
