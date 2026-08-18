// K3 - Undo actually reverses the action. Prove data state before + after
// for BOTH reversible variants:
//   1. Day cleared (sc-reset-day + Undo via sc-submit-day)
//   2. Marked no service (sc-submit-day with zeros + Undo via sc-submit-day)
//
// Uses page.request so the API calls carry the storageState auth cookie
// (dev server runs TEST_MODE for middleware; the route.js auth() still
// checks the session). DB state read via Supabase service-role client.

import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

// Pilot per-meal test account. Both TXR-AZ + CIN-AZ are already
// qbo_mode='test' in sc_qbo_account_map so any writes are already
// non-billing per PR-F.
const ACCOUNT = 'TXR - AZ';
// Pick a historical date that has real actuals. TXR-AZ 2026-08-03
// carries 4 actuals rows with a mix of zero + non-zero counts (probed
// 2026-08-18). Non-zero rows give the "restore" assertion something
// to verify against; the classifier flips between entered / no-service
// based on anyNonZero which we exercise on both sides of Undo.
const TARGET_DATE = '2026-08-03';

function supaClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function readActuals(supa: any) {
  const { data, error } = await supa
    .from('sc_daily_actuals')
    .select('service_id, actual_count')
    .eq('account_key', ACCOUNT)
    .eq('service_date', TARGET_DATE);
  if (error) throw error;
  const map: Record<string, number> = {};
  for (const r of data || []) map[r.service_id] = Number(r.actual_count);
  return map;
}

function snapshotEqual(a: Record<string, number>, b: Record<string, number>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] || 0) !== (b[k] || 0)) return false;
  return true;
}

test.setTimeout(120_000);

test('K3: day-cleared Undo re-POSTs pre-reset actuals and restores state', async ({ page, request }) => {
  const supa = supaClient();

  // Pre-state snapshot from DB.
  const before = await readActuals(supa);
  const beforeCount = Object.keys(before).length;
  console.log('K3/reset before:', { rows: beforeCount, sample: Object.entries(before).slice(0, 3) });
  test.skip(beforeCount === 0, `${ACCOUNT} ${TARGET_DATE} has no actuals to reset - can't prove reversal`);

  // Fire reset via the SC API.
  const resetRes = await request.post('http://localhost:3000/api/service-calendar', {
    data: { action: 'sc-reset-day', accountKey: ACCOUNT, date: TARGET_DATE },
  });
  const resetJson = await resetRes.json();
  console.log('K3/reset API:', { status: resetRes.status(), success: resetJson?.success });
  expect(resetJson?.success).toBe(true);

  // Post-reset snapshot: actuals row count should be zero.
  const afterReset = await readActuals(supa);
  console.log('K3/reset after action:', { rows: Object.keys(afterReset).length });
  expect(Object.keys(afterReset).length).toBe(0);

  // Fire Undo via sc-submit-day with the pre-reset values.
  const undoEntries = Object.entries(before).map(([colIndex, value]) => ({ colIndex, value }));
  const undoRes = await request.post('http://localhost:3000/api/service-calendar', {
    data: {
      action: 'sc-submit-day',
      accountKey: ACCOUNT,
      date: TARGET_DATE,
      entries: undoEntries,
    },
  });
  const undoJson = await undoRes.json();
  console.log('K3/reset Undo API:', { status: undoRes.status(), success: undoJson?.success });
  expect(undoJson?.success).toBe(true);

  // Post-Undo snapshot: should match `before` byte-for-byte.
  const afterUndo = await readActuals(supa);
  console.log('K3/reset after Undo:', { rows: Object.keys(afterUndo).length });
  expect(snapshotEqual(before, afterUndo)).toBe(true);
});

test('K3: mark-no-service Undo re-POSTs pre-mark actuals and restores state', async ({ page, request }) => {
  const supa = supaClient();

  // Pre-state snapshot.
  const before = await readActuals(supa);
  const beforeCount = Object.keys(before).length;
  console.log('K3/no-service before:', { rows: beforeCount, sample: Object.entries(before).slice(0, 3) });
  test.skip(beforeCount === 0, `${ACCOUNT} ${TARGET_DATE} has no actuals to mark - can't prove reversal`);

  // Fire mark-no-service via sc-submit-day with all zeros for every
  // service currently present. Classifier will read them as no-service
  // (dataStore/serviceCalendar.js:326).
  const noSvcEntries = Object.keys(before).map(colIndex => ({ colIndex, value: 0 }));
  const markRes = await request.post('http://localhost:3000/api/service-calendar', {
    data: {
      action: 'sc-submit-day',
      accountKey: ACCOUNT,
      date: TARGET_DATE,
      entries: noSvcEntries,
      auditNote: 'Service cancelled - marked no service',
    },
  });
  const markJson = await markRes.json();
  console.log('K3/no-service mark API:', { status: markRes.status(), success: markJson?.success });
  expect(markJson?.success).toBe(true);

  // Post-mark snapshot: same services present but all zero.
  const afterMark = await readActuals(supa);
  const allZero = Object.values(afterMark).every(v => v === 0);
  console.log('K3/no-service after action:', { rows: Object.keys(afterMark).length, allZero });
  expect(allZero).toBe(true);

  // Fire Undo via sc-submit-day with the pre-mark values.
  const undoEntries = Object.entries(before).map(([colIndex, value]) => ({ colIndex, value }));
  const undoRes = await request.post('http://localhost:3000/api/service-calendar', {
    data: {
      action: 'sc-submit-day',
      accountKey: ACCOUNT,
      date: TARGET_DATE,
      entries: undoEntries,
    },
  });
  const undoJson = await undoRes.json();
  console.log('K3/no-service Undo API:', { status: undoRes.status(), success: undoJson?.success });
  expect(undoJson?.success).toBe(true);

  // Post-Undo snapshot must match `before`.
  const afterUndo = await readActuals(supa);
  console.log('K3/no-service after Undo:', { rows: Object.keys(afterUndo).length });
  expect(snapshotEqual(before, afterUndo)).toBe(true);
});
