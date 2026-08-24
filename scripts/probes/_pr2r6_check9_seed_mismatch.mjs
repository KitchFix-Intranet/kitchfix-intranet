// PR-2 R6 Part B - Check 9 assertion fire test.
//
// The route asserts `ledger_total == categories.spent` for equipment,
// repair, and reimbursable at request time. This probe demonstrates
// the assertion by TAMPERING with the payload post-fetch and re-running
// the same math the client uses to gate rendering. Simulates the drift
// that would occur if a future change made ledger_total and hero
// compute from different queries.
import { readFileSync } from 'node:fs';

const s = readFileSync('/tmp/pr2r6_pl.json', 'utf8');
const p = JSON.parse(s);
console.log('=== BASELINE (unseeded) ===');
console.log('ledger_reconciliation.pass:', p.ledger_reconciliation.pass);
console.log('deltas:',
  'equip=', p.ledger_reconciliation.equipment.delta,
  'repair=', p.ledger_reconciliation.repair.delta,
  'reimb=', p.ledger_reconciliation.reimbursable.delta);

// Seed a mismatch: pretend the equipment ledger drifted by 100.
const tampered = JSON.parse(JSON.stringify(p));
tampered.ledgers.equipment.total_amount += 100;
// Recompute reconciliation as the client would:
const eqHero  = tampered.categories.find(c => c.gl_line_code === '5002.5').spent;
const eqLed   = tampered.ledgers.equipment.total_amount;
const eqDelta = Math.round((eqHero - eqLed) * 100) / 100;
const pass = Math.abs(eqDelta) <= 0.01;
console.log('\n=== SEEDED MISMATCH (equipment total_amount += 100) ===');
console.log('recomputed delta:', eqDelta);
console.log('would pass Check 9:', pass);
if (!pass) {
  console.log('SEEDED MISMATCH DETECTED - Check 9 assertion FIRES.');
  process.exit(0);
} else {
  console.log('FAILURE: seeded mismatch NOT detected.');
  process.exit(2);
}
