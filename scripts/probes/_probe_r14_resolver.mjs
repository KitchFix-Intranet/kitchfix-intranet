#!/usr/bin/env node
/**
 * R14 mgmt-fee resolver unit tests.
 *
 * Inlines the resolver logic (board.js uses the Next `@/` alias which
 * Node can't resolve directly).  Update this file in the same commit
 * as board.js if resolveMgmtFeeCard's contract changes; otherwise
 * this probe drifts from source of truth.
 *
 * Covers:
 *   - real STL - MO (over, no fun money)
 *   - real STL - FL (under, real fun money $20,736.60)
 *   - real CIN - OH (over, no fun money)
 *   - SYNTHETIC fun money on an account that reads $0 today (label swap)
 *   - tail rule N == 1 renders individually
 *   - room-in-goal sentence template
 */

// ─── Inlined resolver copy - keep in sync with board.js ─────────────
function fmt$(n) {
  const v = Number(n || 0);
  const abs = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return v < 0 ? "-$" + abs : "$" + abs;
}
function fmtPct(x) {
  const n = Number(x || 0);
  return (n * 100).toFixed(1) + "%";
}
const TAIL_THRESHOLD_PCT = 0.01;
const NUMBER_WORD = ["zero", "one", "two", "three", "four"];
function numWord(n) { return NUMBER_WORD[n] || String(n); }
function stripAccountPrefix(name, accountKey) {
  if (typeof name !== "string" || !name) return name;
  const pfx = `${accountKey} `;
  return name.startsWith(pfx) ? name.slice(pfx.length) : name;
}
function normaliseCategoryCase(name) { return name; }   // in sync with board.js

function resolveMgmtFeeCard(args) {
  const {
    accountKey, goalRow, mgmtFee, reimbSpentRange, pending,
    yearElapsedFrac, closed, provisional, isFutureRange,
    weekOfPeriod, weeksInPeriod, elapsedFrac, cardTitle,
  } = args;
  const goalAmount = Number(goalRow?.annual || 0);
  const clientLabel = goalRow?.clientLabel || accountKey;
  const taxState = goalRow?.taxCaveatState || null;

  const funMoneyRange = Number(mgmtFee?.fun_money?.spent || 0);
  const hasFunMoney = funMoneyRange > 0.005;
  const leftHeroValue = reimbSpentRange + (hasFunMoney ? funMoneyRange : 0);
  const leftHeroLabel = hasFunMoney
    ? "Reimbursable and fun money"
    : `Billed back to ${clientLabel}`;
  const leftHeroCodeSubtitle = hasFunMoney ? "13xx + 3200.2" : "13xx";

  const catsRaw = Array.isArray(mgmtFee?.reimb_categories) ? mgmtFee.reimb_categories.slice() : [];
  if (hasFunMoney) {
    catsRaw.push({ gl_line_code: "3200.2", name: "Fun Money", spent: Math.round(funMoneyRange * 100) / 100 });
  }
  catsRaw.sort((a, b) => Number(b.spent || 0) - Number(a.spent || 0));

  const categoryRows = [], tailBundle = [];
  for (const c of catsRaw) {
    const spentNum = Number(c.spent || 0);
    const share = leftHeroValue > 0 ? spentNum / leftHeroValue : 0;
    const displayName = c.name
      ? normaliseCategoryCase(stripAccountPrefix(c.name, accountKey))
      : null;
    const row = {
      gl_line_code: c.gl_line_code,
      label: displayName || c.gl_line_code,
      hasName: !!displayName,
      spentNumeric: spentNum,
      valueText: fmt$(spentNum),
      shareText: fmtPct(share),
      share,
    };
    if (share < TAIL_THRESHOLD_PCT) tailBundle.push(row);
    else categoryRows.push(row);
  }
  if (tailBundle.length === 1) categoryRows.push(tailBundle[0]);
  else if (tailBundle.length >= 2) {
    const tailSpent = tailBundle.reduce((s, r) => s + r.spentNumeric, 0);
    categoryRows.push({
      gl_line_code: null,
      label: `${tailBundle.length} smaller lines`,
      hasName: true,
      spentNumeric: tailSpent,
      valueText: fmt$(tailSpent),
      shareText: fmtPct(tailSpent / (leftHeroValue || 1)),
      isTail: true,
    });
  }

  const pendingAmount = Number(pending?.amount || 0);
  const annualSpent = Number(mgmtFee?.goal_fytd_spent || 0);
  const overAmount = annualSpent - goalAmount;
  const isOver = overAmount > 0;
  let rightHeroLabel = "", rightHeroValueText = "", rightHeroClass = "";
  if (goalAmount > 0) {
    if (isOver) {
      rightHeroLabel = "Over the annual goal by";
      rightHeroValueText = fmt$(overAmount);
      rightHeroClass = "r";
    } else {
      rightHeroLabel = "Room in the annual goal";
      rightHeroValueText = fmt$(-overAmount);
      rightHeroClass = "b";
    }
  }
  const rightTaxCaption = taxState
    ? `before ${taxState} sales tax · provisional`
    : "provisional";

  const currentPeriodTrend = Array.isArray(mgmtFee?.periods_trend) ? mgmtFee.periods_trend : [];
  const currentPeriodNo = currentPeriodTrend.length > 0
    ? currentPeriodTrend[currentPeriodTrend.length - 1].period_no
    : null;
  const periodsRemaining = currentPeriodNo != null ? Math.max(0, 13 - currentPeriodNo) : 0;
  const yearLeftPct = Math.max(0, Math.round(100 - (yearElapsedFrac || 0) * 100));
  const crossedPeriod = mgmtFee?.crossed_period_no;
  let sentenceText = "";
  if (crossedPeriod != null && goalAmount > 0) {
    sentenceText = `Crossed the goal in period ${crossedPeriod}, with ${numWord(periodsRemaining)} ${periodsRemaining === 1 ? "period" : "periods"} and ${yearLeftPct}% of the year still to run.`;
  } else if (goalAmount > 0) {
    const remainingText = fmt$(Math.max(0, goalAmount - annualSpent));
    sentenceText = `${remainingText} remains, with ${numWord(periodsRemaining)} ${periodsRemaining === 1 ? "period" : "periods"} and ${yearLeftPct}% of the year still to run.`;
  }
  return {
    leftHeroLabel, leftHeroCodeSubtitle,
    leftHeroValueText: fmt$(leftHeroValue),
    hasFunMoney, categoryRows,
    showPendingRow: pendingAmount > 0.005,
    rightHeroLabel, rightHeroValueText, rightHeroClass,
    rightTaxCaption, sentenceText,
  };
}
// ─── End of inlined resolver ────────────────────────────────────────

const MOCK_GOAL_STL_MO = { annual: 331345.95, salesTaxApplied: false, clientLabel: "St Louis Cardinals", taxCaveatState: "Missouri" };
const MOCK_GOAL_STL_FL = { annual: 1060000.00, salesTaxApplied: true, clientLabel: "St Louis Cardinals", taxCaveatState: "Florida" };
const MOCK_GOAL_CIN_OH = { annual: 227391.02, salesTaxApplied: true, clientLabel: "Cincinnati Reds", taxCaveatState: "Ohio" };

const passed = [], failed = [];
function ok(name, cond, detail = "") {
  (cond ? passed : failed).push({ name, detail });
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
}

console.log("\n=== Layer 1: STL - MO FYTD (over, real data) ===");
{
  const d = resolveMgmtFeeCard({
    accountKey: "STL - MO", goalRow: MOCK_GOAL_STL_MO,
    mgmtFee: {
      goal_fytd_spent: 404394.46, crossed_period_no: 8,
      periods_trend: [
        { period_no: 1, spent: 8000 }, { period_no: 2, spent: 25000 },
        { period_no: 3, spent: 90000 }, { period_no: 4, spent: 55000 },
        { period_no: 5, spent: 42000 }, { period_no: 6, spent: 48000 },
        { period_no: 7, spent: 52000 }, { period_no: 8, spent: 69160 },
        { period_no: 9, spent: 5643 },
      ],
      fun_money: { spent: 0 },
      reimb_categories: [
        { gl_line_code: "1385.1",   name: "STL - MO Food",     spent: 271533.12 },
        { gl_line_code: "1385.1.2", name: "Beverages",         spent: 69943.44 },
        { gl_line_code: "1385.1.1", name: "Packaged Snacks",   spent: 24854.52 },
        { gl_line_code: "1385.2",   name: "STL - MO Other",    spent: 19282.98 },
        { gl_line_code: "1385",     name: "STL Reimbursables", spent: 16398.04 },
        { gl_line_code: "1385.3.1", name: "Packaged Snacks",   spent: 1645.87 },
        { gl_line_code: "1374.3",   name: "CIN - OH Clubhouse Snacks", spent: 388.58 },
        { gl_line_code: "1385.3",   name: "STL - FL Food",     spent: 347.91 },
      ],
    },
    reimbSpentRange: 404394.46,
    pending: { amount: 11364.84 },
    yearElapsedFrac: 0.66,
    closed: false, provisional: true, isFutureRange: false,
    weekOfPeriod: null, weeksInPeriod: null, elapsedFrac: 0.66,
    cardTitle: "Fiscal year to date",
  });
  ok("hero label", d.leftHeroLabel === "Billed back to St Louis Cardinals");
  ok("hero subtitle", d.leftHeroCodeSubtitle === "13xx");
  ok("hero value", d.leftHeroValueText === "$404,394.46");
  ok("hasFunMoney false at $0", d.hasFunMoney === false);
  ok("prefix strip on 1385.1 - 'STL - MO Food' -> 'Food'",
     d.categoryRows.find(r => r.gl_line_code === "1385.1")?.label === "Food");
  const tail = d.categoryRows.find(r => r.isTail);
  ok("tail groups 3 sub-1% rows", tail?.label === "3 smaller lines", `got ${tail?.label}`);
  ok("right hero label - Over", d.rightHeroLabel === "Over the annual goal by");
  ok("right hero colour - red", d.rightHeroClass === "r");
  ok("crossed sentence", d.sentenceText.startsWith("Crossed the goal in period 8"));
  ok("tax caveat", d.rightTaxCaption === "before Missouri sales tax · provisional");
}

console.log("\n=== Layer 2: STL - FL FYTD (under, real fun money) ===");
{
  const d = resolveMgmtFeeCard({
    accountKey: "STL - FL", goalRow: MOCK_GOAL_STL_FL,
    mgmtFee: {
      goal_fytd_spent: 960909.72, crossed_period_no: null,
      periods_trend: [
        { period_no: 1, spent: 100000 }, { period_no: 2, spent: 150000 },
        { period_no: 3, spent: 170000 }, { period_no: 4, spent: 90000 },
        { period_no: 5, spent: 85000 },  { period_no: 6, spent: 80000 },
        { period_no: 7, spent: 65000 },  { period_no: 8, spent: 70000 },
        { period_no: 9, spent: 150000 },
      ],
      fun_money: { spent: 20736.60 },
      reimb_categories: [
        { gl_line_code: "1385.3",   name: "STL - FL Food", spent: 606047.23 },
        { gl_line_code: "1385.3.2", name: "Beverages",     spent: 209793.62 },
        { gl_line_code: "1385.4",   name: "STL - FL Other",spent: 87324.18 },
      ],
    },
    reimbSpentRange: 960909.72, pending: { amount: 4493.19 },
    yearElapsedFrac: 0.66, closed: false, provisional: true, isFutureRange: false,
    weekOfPeriod: null, weeksInPeriod: null, elapsedFrac: 0.66,
    cardTitle: "Fiscal year to date",
  });
  ok("fun money fires hasFunMoney", d.hasFunMoney === true);
  ok("hero label swaps", d.leftHeroLabel === "Reimbursable and fun money");
  ok("hero subtitle swaps", d.leftHeroCodeSubtitle === "13xx + 3200.2");
  ok("hero value includes fun money", d.leftHeroValueText === "$981,646.32");
  ok("Fun Money row present", d.categoryRows.some(r => r.gl_line_code === "3200.2"));
  ok("right hero label - Room", d.rightHeroLabel === "Room in the annual goal");
  ok("right hero colour - navy", d.rightHeroClass === "b");
  ok("under-goal sentence", d.sentenceText.startsWith("$99,090.28 remains"), `got "${d.sentenceText}"`);
}

console.log("\n=== Layer 3: CIN - OH FYTD (over, no fun money) ===");
{
  const d = resolveMgmtFeeCard({
    accountKey: "CIN - OH", goalRow: MOCK_GOAL_CIN_OH,
    mgmtFee: {
      goal_fytd_spent: 278791.20, crossed_period_no: 7,
      periods_trend: [
        { period_no: 1, spent: 5000 }, { period_no: 2, spent: 25000 },
        { period_no: 3, spent: 35000 }, { period_no: 4, spent: 35000 },
        { period_no: 5, spent: 40000 }, { period_no: 6, spent: 42000 },
        { period_no: 7, spent: 55000 }, { period_no: 8, spent: 40000 },
        { period_no: 9, spent: 2000 },
      ],
      fun_money: { spent: 0 },
      reimb_categories: [
        { gl_line_code: "1374.1", name: "CIN - OH Reimbursables", spent: 249797.06 },
        { gl_line_code: "1374.3", name: "CIN - OH Clubhouse Snacks", spent: 20519.51 },
        { gl_line_code: "1374.2", name: "CIN - OH Equipment Reimbursables", spent: 7271.87 },
      ],
    },
    reimbSpentRange: 278791.20, pending: { amount: 200 },
    yearElapsedFrac: 0.66, closed: false, provisional: true, isFutureRange: false,
    weekOfPeriod: null, weeksInPeriod: null, elapsedFrac: 0.66,
    cardTitle: "Fiscal year to date",
  });
  ok("hero label", d.leftHeroLabel === "Billed back to Cincinnati Reds");
  ok("no fun money", d.hasFunMoney === false);
  ok("prefix strip on 1374.1 - 'CIN - OH Reimbursables' -> 'Reimbursables'",
     d.categoryRows.find(r => r.gl_line_code === "1374.1")?.label === "Reimbursables");
  ok("right hero - Over", d.rightHeroLabel === "Over the annual goal by");
  ok("crossed sentence P7", d.sentenceText.startsWith("Crossed the goal in period 7"));
  ok("tax caveat Ohio", d.rightTaxCaption === "before Ohio sales tax · provisional");
}

console.log("\n=== Layer 4: SYNTHETIC fun money at CIN - OH ===");
{
  const d = resolveMgmtFeeCard({
    accountKey: "CIN - OH", goalRow: MOCK_GOAL_CIN_OH,
    mgmtFee: {
      goal_fytd_spent: 278791.20, crossed_period_no: 7,
      periods_trend: [{ period_no: 9, spent: 2000 }],
      fun_money: { spent: 5000.00 },
      reimb_categories: [{ gl_line_code: "1374.1", name: "CIN - OH Reimbursables", spent: 100000 }],
    },
    reimbSpentRange: 100000, pending: { amount: 0 },
    yearElapsedFrac: 0.66, closed: false, provisional: true, isFutureRange: false,
    weekOfPeriod: null, weeksInPeriod: null, elapsedFrac: 0.66,
    cardTitle: "Fiscal year to date",
  });
  ok("hasFunMoney fires on synthetic $5,000", d.hasFunMoney === true);
  ok("label swaps", d.leftHeroLabel === "Reimbursable and fun money");
  ok("subtitle swaps", d.leftHeroCodeSubtitle === "13xx + 3200.2");
  ok("hero value 100k + 5k = 105k", d.leftHeroValueText === "$105,000.00");
  ok("Fun Money row exists",
     d.categoryRows.find(r => r.gl_line_code === "3200.2")?.label === "Fun Money");
  const catTotal = d.categoryRows.reduce((s, r) => s + r.spentNumeric, 0);
  ok("category rows sum to hero", Math.abs(catTotal - 105000) < 0.01, `sum=$${catTotal.toFixed(2)}`);
}

console.log("\n=== Layer 5: tail rule N == 1 renders individually ===");
{
  const d = resolveMgmtFeeCard({
    accountKey: "STL - MO", goalRow: MOCK_GOAL_STL_MO,
    mgmtFee: {
      goal_fytd_spent: 0, crossed_period_no: null,
      periods_trend: [{ period_no: 1, spent: 100000 }],
      fun_money: { spent: 0 },
      reimb_categories: [
        { gl_line_code: "1385.1", name: "STL - MO Food", spent: 99000 },
        { gl_line_code: "1385.2", name: "STL - MO Other", spent: 500 },
      ],
    },
    reimbSpentRange: 99500, pending: { amount: 0 },
    yearElapsedFrac: 0.66, closed: false, provisional: false, isFutureRange: false,
    weekOfPeriod: null, weeksInPeriod: null, elapsedFrac: 0.66,
    cardTitle: "Test",
  });
  const tailRow = d.categoryRows.find(r => r.isTail);
  ok("N == 1 sub-1% renders individually", tailRow == null,
     tailRow ? `unexpected tail: ${tailRow.label}` : "");
  ok("single small row shows with its own name",
     d.categoryRows.some(r => r.gl_line_code === "1385.2" && r.label === "Other"));
}

console.log("\n=== Layer 6: goal-not-crossed sentence template ===");
{
  const d = resolveMgmtFeeCard({
    accountKey: "STL - FL", goalRow: MOCK_GOAL_STL_FL,
    mgmtFee: {
      goal_fytd_spent: 960909.72, crossed_period_no: null,
      periods_trend: [
        { period_no: 1, spent: 0 }, { period_no: 2, spent: 0 },
        { period_no: 3, spent: 0 }, { period_no: 4, spent: 0 },
        { period_no: 5, spent: 0 }, { period_no: 6, spent: 0 },
        { period_no: 7, spent: 0 }, { period_no: 8, spent: 0 },
        { period_no: 9, spent: 960909.72 },
      ],
      fun_money: { spent: 0 },
      reimb_categories: [{ gl_line_code: "1385.3", name: "STL - FL Food", spent: 960909.72 }],
    },
    reimbSpentRange: 960909.72, pending: { amount: 0 },
    yearElapsedFrac: 0.66, closed: false, provisional: true, isFutureRange: false,
    weekOfPeriod: null, weeksInPeriod: null, elapsedFrac: 0.66,
    cardTitle: "Fiscal year to date",
  });
  ok("sentence includes '$99,090.28 remains'",
     d.sentenceText.includes("$99,090.28 remains"), `got "${d.sentenceText}"`);
  ok("sentence includes 'four periods'", d.sentenceText.includes("four periods"));
  ok("sentence includes '34% of the year'", d.sentenceText.includes("34% of the year"));
}

console.log(`\nresult: ${passed.length} passed / ${failed.length} failed`);
if (failed.length > 0) process.exit(1);
