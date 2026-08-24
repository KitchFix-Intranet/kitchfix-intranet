// PR-2 R4 Part A - prove the hero-equals-sources assertion fires on
// a seeded mismatch. The assertion lives in
// src/app/kpi/purchasing/components/BucketCard.js (dev-only) and
// src/app/kpi/purchasing/components/PeriodCard.js (dev-only). We
// simulate the pre-assertion arithmetic in isolation and check the
// throw path.

// Simulated BucketCard assertion (lifted from the file - keep in sync).
function bucketAssert({ bucketKey, spent, bills, cardsCoded }) {
  const heroSpent = Number(spent || 0);
  const billsN = Number(bills || 0);
  const cardsN = Number(cardsCoded || 0);
  const sourcesSum = Math.round((billsN + cardsN) * 100) / 100;
  const heroR = Math.round(heroSpent * 100) / 100;
  if (Math.abs(heroR - sourcesSum) > 0.01) {
    throw new Error(
      `BucketCard Part A: hero $${heroR.toFixed(2)} != bills $${billsN.toFixed(2)} + cards $${cardsN.toFixed(2)} (delta $${(heroR - sourcesSum).toFixed(2)})`
    );
  }
}

function periodAssert({ spent, bills, cards }) {
  const heroR = Math.round(Number(spent || 0) * 100) / 100;
  const billsN = Number(bills || 0);
  const cardsN = Number(cards || 0);
  const sourcesSum = Math.round((billsN + cardsN) * 100) / 100;
  if ((billsN > 0 || cardsN > 0) && Math.abs(heroR - sourcesSum) > 0.01) {
    throw new Error(
      `PeriodCard Part A: hero $${heroR.toFixed(2)} != bills + cards $${sourcesSum.toFixed(2)} (delta $${(heroR - sourcesSum).toFixed(2)})`
    );
  }
}

let passed = 0;
let failed = 0;

function expect(label, fn, wantThrow) {
  try {
    fn();
    if (wantThrow) {
      console.log('  FAIL:', label, '(expected throw, got none)');
      failed++;
    } else {
      console.log('  ok:  ', label);
      passed++;
    }
  } catch (e) {
    if (wantThrow) {
      console.log('  ok:  ', label, '- thrown:', e.message);
      passed++;
    } else {
      console.log('  FAIL:', label, '- unexpected throw:', e.message);
      failed++;
    }
  }
}

console.log('=== BucketCard Part A assertion ===');

// Case 1: healthy - hero = bills + cards. Should not throw.
expect(
  'healthy food bucket ($29019.42 = 28465.86 + 553.56)',
  () => bucketAssert({ bucketKey: 'food', spent: 29019.42, bills: 28465.86, cardsCoded: 553.56 }),
  false,
);

// Case 2: the R3 pre-fix state - hero from weekly view (partial), bills
// from actuals (full window). $18,171.25 hero, $26,614.47 bills, $0
// cards. Delta $-8,443.22. Should throw.
expect(
  'seeded mismatch: TBR-FL pre-fix (hero=18171.25, bills=26614.47, cards=0)',
  () => bucketAssert({ bucketKey: 'food', spent: 18171.25, bills: 26614.47, cardsCoded: 0 }),
  true,
);

// Case 3: hero too high - cards over-counted. Should throw.
expect(
  'seeded mismatch: hero=1000, bills=100, cards=100 (should be 200)',
  () => bucketAssert({ bucketKey: 'test', spent: 1000, bills: 100, cardsCoded: 100 }),
  true,
);

// Case 4: within tolerance. delta 0.001 stays quiet.
expect(
  'within 1c tolerance (hero=100.001 vs 100.00)',
  () => bucketAssert({ bucketKey: 'test', spent: 100.001, bills: 100.00, cardsCoded: 0 }),
  false,
);

// Case 5: 2c drift. Should throw.
expect(
  '2c drift trips assertion',
  () => bucketAssert({ bucketKey: 'test', spent: 100.02, bills: 100.00, cardsCoded: 0 }),
  true,
);

console.log();
console.log('=== PeriodCard Part A assertion ===');

// Case 1: healthy period card ($33527.60 = 32372.37 + 1155.23)
expect(
  'healthy period card ($33527.60 = 32372.37 + 1155.23)',
  () => periodAssert({ spent: 33527.60, bills: 32372.37, cards: 1155.23 }),
  false,
);

// Case 2: seeded mismatch - hero missing $2253.15 (the old billsApprox bug)
expect(
  'seeded mismatch: pre-fix billsApprox understated by $2253.15',
  () => periodAssert({ spent: 33527.60, bills: 30119.22, cards: 1155.23 }),
  true,
);

// Case 3: zero-values (loading / partial payload)
expect(
  'zero values do not trip (loading state)',
  () => periodAssert({ spent: 0, bills: 0, cards: 0 }),
  false,
);

console.log();
console.log(`Result: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
