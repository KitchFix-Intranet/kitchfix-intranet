// R-114 PR 2 · expected P9 numbers after items 6 + 7
//
// Dry-run verification: queries the CURRENT prod DB state, applies the
// migrations' deltas arithmetically (without touching the DB), and
// reports what TBJ - FL P9 will read after both migrations run.
//
// Assertions (Kevin ruling 2026-09-17):
//   · vehicle line: $124 → ~$735
//   · cost of goods: $78,926 → ~$80,691
//   · cost of goods variance and gross margin variance are equal
//     magnitude, opposite sign, to the cent (the $1 mirror gap on
//     P9 pre-fix was Kevin's item 3 observation - if it remains
//     post-fix that's a separate defect).

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) { console.error("SUPABASE_URL: ABSENT"); process.exit(2); }
if (!key) { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(2); }
const db = createClient(url, key, { auth: { persistSession: false } });

// FY2026 P9 = 2026-08-10..2026-09-06
const P9_START = "2026-08-10";
const P9_END   = "2026-09-06";
const ACCT     = "TBJ - FL";

async function sumPurchasing(gl_prefix) {
  const { data, error } = await db
    .from("purchasing_actuals")
    .select("amount")
    .eq("account_key", ACCT)
    .gte("txn_date", P9_START)
    .lte("txn_date", P9_END)
    .like("gl_line_code", `${gl_prefix}%`)
    .eq("excluded", false);
  if (error) throw error;
  return data.reduce((s, r) => s + Number(r.amount || 0), 0);
}

// Current-state reads.
const current = {
  vehicle_3500_4: await sumPurchasing("3500.4"),
  vehicle_3500_2: await sumPurchasing("3500.2"),
  food_3200:      await sumPurchasing("3200"),
  packaging_3400: await sumPurchasing("3400"),
};

// Item 6 deltas: TBJ - FL P9 3500.2 goes from 0 to 611.
const delta6_vehicle = 611.00 - current.vehicle_3500_2;

// Item 7 deltas: INVJE synthetic rows contribute -adjusting_je to
// cost (per R-61: adjusted cost = purchases - JE).
// TBJ - FL P9 workbook (per-category, reconciled prior + JE = closing):
//   food      JE -$331.06   prior $8,058.41  closing $7,727.35
//   packaging JE   -$60.29  prior    $60.29  closing     $0.00
//   supplies  JE  -$763.12  prior $2,347.55  closing $1,584.43
// packaging + supplies share the 3400 bucket so the resolver sees
// one combined `3400.INVJE` synthetic row (per R-74).
const invje_food_je      = -331.06;
const invje_packaging_je =  -60.29;
const invje_supplies_je  = -763.12;
const delta7_food_cost      = -invje_food_je;      // 331.06 added to food cost
const delta7_packaging_cost = -invje_packaging_je; // 60.29
const delta7_supplies_cost  = -invje_supplies_je;  // 763.12
const delta7_3400_cost      = delta7_packaging_cost + delta7_supplies_cost; // 823.41 into bucket 3400

// Labor (3100) is not touched by either migration.
// For the cost-of-goods total we need labor + food + packaging + vehicle.
// Read the labor figure from the API rather than reproducing R-105.
async function fetchApi(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return await r.json();
}

const BASE = process.env.BASE || "http://localhost:3000";
const encAcct = encodeURIComponent(ACCT);
const payload = await fetchApi(`${BASE}/api/kpi/overview?account=${encAcct}&range=period:9`);
const cogsCard = payload.cards.find(c => c.key === "cogs");
const gmCard   = payload.cards.find(c => c.key === "gross_margin");
const revCard  = payload.cards.find(c => c.key === "revenue");

const cogs_before          = cogsCard.hero_actual;
const cogs_adjusted        = cogsCard.budget_at_this_revenue;
const gm_before            = gmCard.hero_actual;
const gm_adjusted          = gmCard.budget_at_this_revenue;
const revenue              = revCard.hero_actual;

// Post-migration cost delta.
const cogs_delta = delta6_vehicle + delta7_food_cost + delta7_3400_cost;
const cogs_after   = cogs_before + cogs_delta;
const gm_after     = gm_before - cogs_delta;    // revenue unchanged

// Adjusted figures are unchanged (they depend on revenue + target %,
// not on actuals).
const cogs_var_before = cogs_before - cogs_adjusted;
const cogs_var_after  = cogs_after  - cogs_adjusted;
const gm_var_before   = gm_before   - gm_adjusted;
const gm_var_after    = gm_after    - gm_adjusted;

const fmt = (n) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

console.log("R-114 PR 2 · TBJ - FL P9 expected numbers after items 6 + 7\n");
console.log("current-state purchasing sums (before either migration):");
console.log(`  3500.4 fuel         ${fmt(current.vehicle_3500_4)}`);
console.log(`  3500.2 insurance    ${fmt(current.vehicle_3500_2)}`);
console.log(`  3200 food           ${fmt(current.food_3200)}`);
console.log(`  3400 packaging      ${fmt(current.packaging_3400)}\n`);

console.log("item 6 delta (vehicle insurance):");
console.log(`  3500.2 target       ${fmt(611.00)}`);
console.log(`  delta               ${fmt(delta6_vehicle)}`);
console.log(`  vehicle line after  3500.4 ${fmt(current.vehicle_3500_4)} + 3500.2 ${fmt(611.00)} = ${fmt(current.vehicle_3500_4 + 611.00)}`);
console.log(`  Kevin target:       $735 · ${Math.abs((current.vehicle_3500_4 + 611.00) - 735) < 1 ? "MATCH" : "MISS"}\n`);

console.log("item 7 delta (inventory adjustments):");
console.log(`  food INVJE          ${fmt(delta7_food_cost)}     (JE ${fmt(invje_food_je)})`);
console.log(`  packaging INVJE     ${fmt(delta7_packaging_cost)}      (JE ${fmt(invje_packaging_je)})`);
console.log(`  supplies INVJE      ${fmt(delta7_supplies_cost)}     (JE ${fmt(invje_supplies_je)})`);
console.log(`  bucket 3400 total   ${fmt(delta7_3400_cost)}     (packaging + supplies share 3400)\n`);

console.log("cost of goods (COGS):");
console.log(`  before              ${fmt(cogs_before)}`);
console.log(`  total delta         ${fmt(cogs_delta)}  (vehicle ${fmt(delta6_vehicle)} + food ${fmt(delta7_food_cost)} + 3400 ${fmt(delta7_3400_cost)})`);
console.log(`  after               ${fmt(cogs_after)}`);
console.log(`  Kevin target:       ~$80,691 · ${Math.abs(cogs_after - 80691) < 5 ? "MATCH" : "MISS"}\n`);

console.log("variance mirror (cogs.variance == -gm.variance, to the cent):");
console.log(`  cogs.variance before ${fmt(cogs_var_before)}`);
console.log(`  gm.variance   before ${fmt(gm_var_before)}`);
console.log(`  mirror-gap before    ${fmt(cogs_var_before + gm_var_before)}  (Kevin flagged $1 pre-fix)`);
console.log(`  cogs.variance after  ${fmt(cogs_var_after)}`);
console.log(`  gm.variance   after  ${fmt(gm_var_after)}`);
console.log(`  mirror-gap after     ${fmt(cogs_var_after + gm_var_after)}  ${Math.abs(cogs_var_after + gm_var_after) < 0.02 ? "· to the cent ✓" : "· MISMATCH"}\n`);

console.log("full card readouts (expected after both migrations):");
console.log(`  Revenue actual      ${fmt(revenue)}   (unchanged)`);
console.log(`  COGS actual         ${fmt(cogs_after)}   was ${fmt(cogs_before)}`);
console.log(`  COGS adjusted       ${fmt(cogs_adjusted)}   (unchanged)`);
console.log(`  GM actual           ${fmt(gm_after)}   was ${fmt(gm_before)}`);
console.log(`  GM adjusted         ${fmt(gm_adjusted)}   (unchanged)`);
