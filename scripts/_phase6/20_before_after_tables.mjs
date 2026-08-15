// B6: Before/after tables (per account per protein type: rows, spend, lbs,
// $/lb, coverage %, publication tier; and per-account food/core-food lbs,
// lbs/meal, coverage) - v5-logic baseline vs v6, plus the published-v5 -> v6
// bridge decomposed per R2. Coverage % printed adjacent to every lbs figure.
// 25% threshold / 25-35% caveat tiers preserved.
//
// Also writes _bridge6.json.

import fs from "node:fs";

const A5 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_analysis5.json", "utf8"));
const A6_BASE = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_analysis6_baseline.json", "utf8"));
const A6 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_analysis6.json", "utf8"));

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;
const pct1 = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : 0);

const ACCOUNTS = ["TBR-FL", "TBJ-FL", "STL-FL"];
const PROTEIN_TYPES = ["beef", "poultry", "pork", "seafood", "plant_or_egg", "other_meat", "other"];

function findBucket(pm, t) { return (pm?.by_type || []).find(x => x.type === t) || null; }

// R2 bridge: pub-v5 -> v6 = restatement (v5-logic-baseline - pub-v5) + fix (v6 - v5-logic-baseline)
function bridge(prev, base, v6) {
  return {
    restatement: {
      delta_lbs: round1((base?.lbs ?? 0) - (prev?.lbs ?? 0)),
      delta_spend: round2((base?.lbs_spend ?? base?.spend ?? 0) - (prev?.lbs_spend ?? prev?.spend ?? 0)),
    },
    fix: {
      delta_lbs: round1((v6?.lbs ?? 0) - (base?.lbs ?? 0)),
      delta_spend: round2((v6?.lbs_spend ?? v6?.spend ?? 0) - (base?.lbs_spend ?? base?.spend ?? 0)),
    },
  };
}

const proteinRows = [];
for (const acct of ACCOUNTS) {
  const pmPrev = A5.protein_mix[acct];
  const pmBase = A6_BASE.protein_mix[acct];
  const pmV6 = A6.protein_mix[acct];
  for (const t of PROTEIN_TYPES) {
    const prev = findBucket(pmPrev, t);
    const base = findBucket(pmBase, t);
    const v6 = findBucket(pmV6, t);
    if (!prev && !base && !v6) continue;
    proteinRows.push({
      account: acct,
      type: t,
      published_v5: prev ? {
        rows: prev.rows, spend: prev.spend, lbs_rows: prev.lbs_rows,
        lbs: prev.lbs, lbs_spend: prev.lbs_spend, dollars_per_lb: prev.dollars_per_lb,
        coverage_spend_pct: prev.coverage_spend_pct, publication: prev._publication,
      } : null,
      v5_logic_baseline: base ? {
        rows: base.rows, spend: base.spend, lbs_rows: base.lbs_rows,
        lbs: base.lbs, lbs_spend: base.lbs_spend, dollars_per_lb: base.dollars_per_lb,
        coverage_spend_pct: base.coverage_spend_pct, publication: base._publication,
      } : null,
      v6: v6 ? {
        rows: v6.rows, spend: v6.spend, lbs_rows: v6.lbs_rows,
        lbs: v6.lbs, lbs_spend: v6.lbs_spend, dollars_per_lb: v6.dollars_per_lb,
        coverage_spend_pct: v6.coverage_spend_pct, publication: v6._publication,
      } : null,
      bridge: bridge(prev, base, v6),
    });
  }
}

// Per-account food/core-food/lbs-per-meal
const perAcct = [];
for (const acct of ACCOUNTS) {
  const wPrev = A5.weight[acct];
  const wBase = A6_BASE.weight[acct];
  const wV6 = A6.weight[acct];
  const mPrev = A5.per_meal[acct];
  const mBase = A6_BASE.per_meal[acct];
  const mV6 = A6.per_meal[acct];
  perAcct.push({
    account: acct,
    published_v5: {
      food_lbs: wPrev.food_lbs, coverage_food_spend_pct: wPrev.coverage_food_spend_pct,
      core_food_lbs: wPrev.core_food_lbs, coverage_core_food_spend_pct: wPrev.coverage_core_food_spend_pct,
      window_meals_used: mPrev.window_meals_used,
      window_lbs_per_meal: mPrev.window_lbs_per_meal,
      window_lbs_per_meal_core: mPrev.window_lbs_per_meal_core,
    },
    v5_logic_baseline: {
      food_lbs: wBase.food_lbs, coverage_food_spend_pct: wBase.coverage_food_spend_pct,
      core_food_lbs: wBase.core_food_lbs, coverage_core_food_spend_pct: wBase.coverage_core_food_spend_pct,
      window_meals_used: mBase.window_meals_used,
      window_lbs_per_meal: mBase.window_lbs_per_meal,
      window_lbs_per_meal_core: mBase.window_lbs_per_meal_core,
    },
    v6: {
      food_lbs: wV6.food_lbs, coverage_food_spend_pct: wV6.coverage_food_spend_pct,
      core_food_lbs: wV6.core_food_lbs, coverage_core_food_spend_pct: wV6.coverage_core_food_spend_pct,
      window_meals_used: mV6.window_meals_used,
      window_lbs_per_meal: mV6.window_lbs_per_meal,
      window_lbs_per_meal_core: mV6.window_lbs_per_meal_core,
    },
    bridge_food_lbs: {
      restatement: round1(wBase.food_lbs - wPrev.food_lbs),
      fix: round1(wV6.food_lbs - wBase.food_lbs),
    },
    bridge_core_food_lbs: {
      restatement: round1(wBase.core_food_lbs - wPrev.core_food_lbs),
      fix: round1(wV6.core_food_lbs - wBase.core_food_lbs),
    },
  });
}

const OUT = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_bridge6.json";
fs.writeFileSync(OUT, JSON.stringify({
  built_at: new Date().toISOString(),
  protein_rows: proteinRows,
  per_account: perAcct,
}, null, 2));

console.log("\n===== PROTEIN MIX v5(published) vs v5-logic-baseline vs v6 =====");
for (const r of proteinRows) {
  const pub = r.published_v5;
  const bas = r.v5_logic_baseline;
  const v6 = r.v6;
  const fmt = (b) => b ? `lbs=${(b.lbs||0).toFixed(1).padStart(8)} cov=${(b.coverage_spend_pct||0).toString().padStart(5)}% dpp=${b.dollars_per_lb} [${b.publication?.slice(0,25)||''}]` : "(n/a)";
  console.log(`  ${r.account} ${r.type.padEnd(14)}`);
  console.log(`     pub-v5      ${fmt(pub)}`);
  console.log(`     v5-logic    ${fmt(bas)}`);
  console.log(`     v6          ${fmt(v6)}`);
  console.log(`     bridge      restatement lbs=${r.bridge.restatement.delta_lbs}  fix lbs=${r.bridge.fix.delta_lbs}`);
}

console.log("\n===== PER ACCOUNT (food, core-food, lbs/meal) =====");
for (const r of perAcct) {
  const p = r.published_v5;
  const b = r.v5_logic_baseline;
  const v6 = r.v6;
  console.log(`  ${r.account}`);
  console.log(`     pub-v5      food_lbs=${p.food_lbs} (${p.coverage_food_spend_pct}%)  core=${p.core_food_lbs} (${p.coverage_core_food_spend_pct}%)  lbs/meal=${p.window_lbs_per_meal}  core=${p.window_lbs_per_meal_core}`);
  console.log(`     v5-logic    food_lbs=${b.food_lbs} (${b.coverage_food_spend_pct}%)  core=${b.core_food_lbs} (${b.coverage_core_food_spend_pct}%)  lbs/meal=${b.window_lbs_per_meal}  core=${b.window_lbs_per_meal_core}`);
  console.log(`     v6          food_lbs=${v6.food_lbs} (${v6.coverage_food_spend_pct}%)  core=${v6.core_food_lbs} (${v6.coverage_core_food_spend_pct}%)  lbs/meal=${v6.window_lbs_per_meal}  core=${v6.window_lbs_per_meal_core}`);
  console.log(`     bridge      food_restate=${r.bridge_food_lbs.restatement}  food_fix=${r.bridge_food_lbs.fix}   core_restate=${r.bridge_core_food_lbs.restatement}  core_fix=${r.bridge_core_food_lbs.fix}`);
}
console.log(`\nwrote ${OUT}`);
