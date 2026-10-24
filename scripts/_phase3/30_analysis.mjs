// Compute all the metrics the workbook needs. Reads _augmented.json, _meals.json,
// item_classifications.json. Writes _analysis.json for the workbook builder.
//
// No DB access. Read-only in-memory transforms.

import fs from "node:fs";

const AUG = JSON.parse(
  fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_augmented.json", "utf8")
);
const MEALS = JSON.parse(
  fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_meals.json", "utf8")
);
const CLS = JSON.parse(
  fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/item_classifications.json", "utf8")
);

const ACCOUNTS = AUG.accounts.map((a) => a.label);
const MONTHS = ["2026-05", "2026-06", "2026-07"];
const CONFIDENCE_THRESHOLD = 70;

// Two-tier filters
function inDollar(r) { return r.review_reason !== "invoice_over_extracted"; }
function inWeight(r) {
  if (r.review_reason === "invoice_over_extracted") return false;
  if (r.review_reason === "ep_qty_up_mismatch") return false;
  const src = r.parsed_weight_source;
  if (!src) return false;
  if (src === "unresolved") return false;
  if (src === "volume_excluded") return false;
  if (src === "pack_size_ambiguous_multipack") return false;
  return true;
}

const sumBy = (arr, fn) => arr.reduce((s, x) => s + (Number(fn(x)) || 0), 0);
const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;
const pct1 = (num, den) => (den ? Math.round((num / den) * 1000) / 10 : 0);

// ============================================================================
// SECTION A: SPEND (DOLLAR SET, food-only for most figures)
// ============================================================================

const perAccount = {};
for (const acct of ACCOUNTS) {
  const rows = AUG.rows.filter((r) => r.account_label === acct);
  const dollar = rows.filter(inDollar);
  const dollarFood = dollar.filter((r) => r.is_food === true);
  const dollarNonFood = dollar.filter((r) => r.is_food === false);
  const dollarUnknown = dollar.filter((r) => r.is_food === null || r.is_food === undefined);
  const dollarByMonth = {};
  for (const m of MONTHS) {
    const drows = dollar.filter((r) => r.month === m);
    const frows = drows.filter((r) => r.is_food === true);
    const nfrows = drows.filter((r) => r.is_food === false);
    dollarByMonth[m] = {
      total_rows: drows.length,
      total_spend: round2(sumBy(drows, (r) => r.extended_price)),
      food_rows: frows.length,
      food_spend: round2(sumBy(frows, (r) => r.extended_price)),
      non_food_spend: round2(sumBy(nfrows, (r) => r.extended_price)),
      unknown_spend: round2(sumBy(drows.filter((r) => r.is_food == null), (r) => r.extended_price)),
    };
  }
  perAccount[acct] = {
    account: acct,
    dollar_all_rows: dollar.length,
    dollar_food_rows: dollarFood.length,
    dollar_nonfood_rows: dollarNonFood.length,
    dollar_unknown_rows: dollarUnknown.length,
    dollar_total_spend: round2(sumBy(dollar, (r) => r.extended_price)),
    dollar_food_spend: round2(sumBy(dollarFood, (r) => r.extended_price)),
    dollar_nonfood_spend: round2(sumBy(dollarNonFood, (r) => r.extended_price)),
    dollar_unknown_spend: round2(sumBy(dollarUnknown, (r) => r.extended_price)),
    dollar_food_pct: pct1(sumBy(dollarFood, (r) => r.extended_price), sumBy(dollar, (r) => r.extended_price)),
    dollar_nonfood_pct: pct1(sumBy(dollarNonFood, (r) => r.extended_price), sumBy(dollar, (r) => r.extended_price)),
    dollar_unknown_pct: pct1(sumBy(dollarUnknown, (r) => r.extended_price), sumBy(dollar, (r) => r.extended_price)),
    by_month: dollarByMonth,
    // Category breakdown - within food
    by_category_food: computeCategoryBreakdown(dollarFood),
    by_category_all: computeCategoryBreakdown(dollar),
    // Vendor top-10 by spend
    top_vendors: computeTopVendors(dollar, 10),
    // Top items by spend / by frequency (DOLLAR SET, all rows per spec section B)
    top_items_by_spend: computeTopItems(dollar, "spend", 25),
    top_items_by_frequency: computeTopItems(dollar, "frequency", 25),
    // Recurring items (food only, since price-stability analysis focuses on food)
    recurring_items: computeRecurringItems(dollarFood),
  };
}

function computeCategoryBreakdown(rows) {
  const cats = {};
  for (const r of rows) {
    const c = r.category || "(uncategorized)";
    if (!cats[c]) cats[c] = { rows: 0, spend: 0 };
    cats[c].rows += 1;
    cats[c].spend += Number(r.extended_price) || 0;
  }
  const total = Object.values(cats).reduce((s, x) => s + x.spend, 0);
  return Object.entries(cats)
    .map(([category, v]) => ({
      category,
      rows: v.rows,
      spend: round2(v.spend),
      pct_of_scope: pct1(v.spend, total),
    }))
    .sort((a, b) => b.spend - a.spend);
}

function computeTopVendors(rows, n) {
  const v = {};
  for (const r of rows) {
    const key = r.vendor_name || "(no vendor)";
    if (!v[key]) v[key] = { spend: 0, rows: 0, vendor_id: r.vendor_id };
    v[key].spend += Number(r.extended_price) || 0;
    v[key].rows += 1;
  }
  const total = Object.values(v).reduce((s, x) => s + x.spend, 0);
  return Object.entries(v)
    .map(([name, obj]) => ({ vendor: name, vendor_id: obj.vendor_id, spend: round2(obj.spend), rows: obj.rows, pct: pct1(obj.spend, total) }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, n);
}

function computeTopItems(rows, mode, n) {
  const m = {};
  for (const r of rows) {
    const key = `${r.vendor_id || "NO-VENDOR"}::${(r.description || "").trim()}`;
    if (!m[key]) m[key] = { description: r.description, vendor_id: r.vendor_id, vendor_name: r.vendor_name, category: r.category, spend: 0, rows: 0, qty: 0, unit: r.unit };
    m[key].spend += Number(r.extended_price) || 0;
    m[key].rows += 1;
    m[key].qty += Number(r.qty_used) || 0;
  }
  const arr = Object.values(m).map((x) => ({ ...x, spend: round2(x.spend), qty: round2(x.qty) }));
  arr.sort((a, b) => (mode === "spend" ? b.spend - a.spend : b.rows - a.rows));
  return arr.slice(0, n);
}

function computeRecurringItems(rows) {
  // Group by (vendor_id, description); include only items with >= 3 orders.
  const m = {};
  for (const r of rows) {
    const key = `${r.vendor_id || "NO-VENDOR"}::${(r.description || "").trim()}`;
    if (!m[key]) m[key] = { description: r.description, vendor_id: r.vendor_id, vendor_name: r.vendor_name, category: r.category, orders: 0, spend: 0, qty: 0, unit_prices: [] };
    m[key].orders += 1;
    m[key].spend += Number(r.extended_price) || 0;
    m[key].qty += Number(r.qty_used) || 0;
    const up = Number(r.unit_price);
    if (up > 0) m[key].unit_prices.push(up);
  }
  const arr = [];
  for (const v of Object.values(m)) {
    if (v.orders < 3) continue;
    const mean = v.unit_prices.reduce((s, x) => s + x, 0) / (v.unit_prices.length || 1);
    const variance = v.unit_prices.reduce((s, x) => s + (x - mean) ** 2, 0) / (v.unit_prices.length || 1);
    const std = Math.sqrt(variance);
    const cv = mean ? std / mean : 0;
    arr.push({
      description: v.description,
      vendor_id: v.vendor_id,
      vendor_name: v.vendor_name,
      category: v.category,
      orders: v.orders,
      spend: round2(v.spend),
      avg_order_spend: round2(v.spend / v.orders),
      mean_unit_price: round2(mean),
      std_unit_price: round2(std),
      cv_unit_price: Math.round(cv * 1000) / 1000,
    });
  }
  arr.sort((a, b) => b.spend - a.spend);
  return arr;
}

// ============================================================================
// SECTION D: WEIGHT (WEIGHT SET)
// ============================================================================

const weightPerAccount = {};
for (const acct of ACCOUNTS) {
  const all = AUG.rows.filter((r) => r.account_label === acct);
  const dollar = all.filter(inDollar);
  const weight = all.filter(inWeight);
  const foodWeight = weight.filter((r) => r.is_food === true);

  const totalLbs = sumBy(weight, (r) => r.parsed_weight_lb);
  const foodLbs = sumBy(foodWeight, (r) => r.parsed_weight_lb);

  // Coverage: how much of DOLLAR SET food spend has a resolved weight
  const dollarFoodSpend = sumBy(dollar.filter((r) => r.is_food === true), (r) => r.extended_price);
  const weightFoodSpend = sumBy(foodWeight, (r) => r.extended_price);
  const coverageSpendPct = pct1(weightFoodSpend, dollarFoodSpend);
  const dollarFoodRows = dollar.filter((r) => r.is_food === true).length;
  const weightFoodRows = foodWeight.length;
  const coverageRowsPct = pct1(weightFoodRows, dollarFoodRows);

  // By category
  const byCat = {};
  for (const r of foodWeight) {
    const c = r.category || "(uncategorized)";
    if (!byCat[c]) byCat[c] = { lbs: 0, spend: 0, rows: 0 };
    byCat[c].lbs += Number(r.parsed_weight_lb) || 0;
    byCat[c].spend += Number(r.extended_price) || 0;
    byCat[c].rows += 1;
  }
  // Dollar-set food per category for coverage comparison
  const dollarFoodByCat = {};
  for (const r of dollar.filter((r) => r.is_food === true)) {
    const c = r.category || "(uncategorized)";
    if (!dollarFoodByCat[c]) dollarFoodByCat[c] = { spend: 0, rows: 0 };
    dollarFoodByCat[c].spend += Number(r.extended_price) || 0;
    dollarFoodByCat[c].rows += 1;
  }
  const byCategoryArr = Object.entries(byCat)
    .map(([category, v]) => {
      const df = dollarFoodByCat[category] || { spend: 0, rows: 0 };
      return {
        category,
        food_rows_dollar_set: df.rows,
        food_rows_weight_set: v.rows,
        food_spend_dollar_set: round2(df.spend),
        food_spend_weight_set: round2(v.spend),
        coverage_rows_pct: pct1(v.rows, df.rows),
        coverage_spend_pct: pct1(v.spend, df.spend),
        weight_lbs: round1(v.lbs),
        dollars_per_lb: v.lbs ? round2(v.spend / v.lbs) : null,
      };
    })
    .sort((a, b) => b.food_spend_weight_set - a.food_spend_weight_set);

  weightPerAccount[acct] = {
    account: acct,
    total_lbs_all: round1(totalLbs),
    food_lbs: round1(foodLbs),
    coverage_food_spend_pct: coverageSpendPct,
    coverage_food_rows_pct: coverageRowsPct,
    food_spend_dollar_set: round2(dollarFoodSpend),
    food_spend_weight_set: round2(weightFoodSpend),
    dollars_per_lb_overall: foodLbs ? round2(weightFoodSpend / foodLbs) : null,
    by_category: byCategoryArr,
  };
}

// ============================================================================
// SECTION C: CLASSIFICATION
// ============================================================================

const classifiedItems = CLS.items || {};
const classifiedCount = Object.keys(classifiedItems).length;

// Attach classification to every row (for aggregation)
for (const r of AUG.rows) {
  const key = `${r.vendor_id || "NO-VENDOR"}::${(r.description || "").trim()}`;
  r._cls = classifiedItems[key] || null;
}

const clsPerAccount = {};
for (const acct of ACCOUNTS) {
  const rows = AUG.rows
    .filter((r) => r.account_label === acct)
    .filter(inDollar)
    .filter((r) => r.is_food === true); // Classification split reported on FOOD rows in DOLLAR SET

  const totalSpend = sumBy(rows, (r) => r.extended_price);

  const axes = ["quality", "preparation", "storage"];
  const perAxis = {};
  for (const axis of axes) {
    const buckets = {};
    let belowConfSpend = 0, belowConfRows = 0;
    let missingClsSpend = 0, missingClsRows = 0;
    for (const r of rows) {
      if (!r._cls) {
        missingClsSpend += Number(r.extended_price) || 0;
        missingClsRows += 1;
        continue;
      }
      const conf = Number(r._cls[`${axis}_confidence`]);
      const label = r._cls[`${axis}_axis`];
      if (!label || conf < CONFIDENCE_THRESHOLD) {
        belowConfSpend += Number(r.extended_price) || 0;
        belowConfRows += 1;
        continue;
      }
      if (!buckets[label]) buckets[label] = { spend: 0, rows: 0 };
      buckets[label].spend += Number(r.extended_price) || 0;
      buckets[label].rows += 1;
    }
    const rendered = Object.entries(buckets).map(([label, v]) => ({
      label,
      rows: v.rows,
      spend: round2(v.spend),
      pct_of_food_spend: pct1(v.spend, totalSpend),
    }));
    perAxis[axis] = {
      buckets: rendered,
      below_confidence_rows: belowConfRows,
      below_confidence_spend: round2(belowConfSpend),
      below_confidence_pct: pct1(belowConfSpend, totalSpend),
      missing_cls_rows: missingClsRows,
      missing_cls_spend: round2(missingClsSpend),
      missing_cls_pct: pct1(missingClsSpend, totalSpend),
    };
  }
  clsPerAccount[acct] = { food_spend: round2(totalSpend), food_rows: rows.length, axes: perAxis };
}

// Inter-axis sanity check: rows both "prefabricated" AND "premium"
const interAxis = {};
for (const acct of ACCOUNTS) {
  const rows = AUG.rows
    .filter((r) => r.account_label === acct)
    .filter(inDollar)
    .filter((r) => r.is_food === true)
    .filter((r) => r._cls);
  const both = rows.filter(
    (r) =>
      r._cls.quality_axis === "premium" &&
      r._cls.preparation_axis === "prefabricated" &&
      r._cls.quality_confidence >= CONFIDENCE_THRESHOLD &&
      r._cls.preparation_confidence >= CONFIDENCE_THRESHOLD
  );
  interAxis[acct] = {
    count: both.length,
    spend: round2(sumBy(both, (r) => r.extended_price)),
    examples: both.slice(0, 5).map((r) => ({ description: r.description, vendor_name: r.vendor_name, spend: r.extended_price })),
  };
}

// ============================================================================
// SECTION B ext: shared basket
// ============================================================================

const itemMapByAccount = {};
for (const acct of ACCOUNTS) {
  const m = new Map();
  for (const r of AUG.rows.filter((r) => r.account_label === acct).filter(inDollar).filter((r) => r.is_food === true)) {
    const key = (r.description || "").trim().toUpperCase();
    if (!key) continue;
    if (!m.has(key)) m.set(key, { spend: 0, rows: 0, mean_unit_price: 0, unit_prices: [] });
    const obj = m.get(key);
    obj.spend += Number(r.extended_price) || 0;
    obj.rows += 1;
    if (Number(r.unit_price) > 0) obj.unit_prices.push(Number(r.unit_price));
  }
  for (const v of m.values()) {
    v.mean_unit_price = v.unit_prices.length ? round2(v.unit_prices.reduce((s, x) => s + x, 0) / v.unit_prices.length) : 0;
    v.spend = round2(v.spend);
  }
  itemMapByAccount[acct] = m;
}

const commonToAll = [];
const accts = [...ACCOUNTS];
const first = itemMapByAccount[accts[0]];
for (const [k, v0] of first) {
  const all = accts.map((a) => itemMapByAccount[a].get(k)).filter(Boolean);
  if (all.length === accts.length) {
    commonToAll.push({
      description: k,
      per_account: Object.fromEntries(accts.map((a, i) => [a, all[i]])),
      total_spend: round2(all.reduce((s, x) => s + (x.spend || 0), 0)),
    });
  }
}
commonToAll.sort((a, b) => b.total_spend - a.total_spend);

// ============================================================================
// SECTION E: Meals denominator & normalized figures
// ============================================================================

const perAcctMeals = MEALS.per_account;

const perMealTable = {};
for (const acct of ACCOUNTS) {
  const md = perAcctMeals[acct];
  const spend = perAccount[acct];
  const wt = weightPerAccount[acct];
  const monthly = {};
  for (const m of MONTHS) {
    const mSpend = spend.by_month[m];
    const mMeals = md.monthly[m];
    monthly[m] = {
      food_spend: mSpend.food_spend,
      meals_used: mMeals.used,
      meals_source: mMeals.source,
      dollars_per_meal: mMeals.used ? round2(mSpend.food_spend / mMeals.used) : null,
    };
  }
  perMealTable[acct] = {
    account: acct,
    monthly,
    window_food_spend: spend.dollar_food_spend,
    window_meals_used: md.total_used,
    window_meals_used_filled: md.total_used_filled,
    window_meals_source: md.window_source,
    window_dollars_per_meal: md.total_used ? round2(spend.dollar_food_spend / md.total_used) : null,
    window_dollars_per_meal_filled: md.total_used_filled ? round2(spend.dollar_food_spend / md.total_used_filled) : null,
    window_food_lbs: wt.food_lbs,
    window_lbs_per_meal: md.total_used && wt.food_lbs ? round2(wt.food_lbs / md.total_used) : null,
    window_lbs_per_meal_filled: md.total_used_filled && wt.food_lbs ? round2(wt.food_lbs / md.total_used_filled) : null,
    window_lbs_coverage_pct: wt.coverage_food_spend_pct,
  };
}

// ============================================================================
// SECTION F: RECONCILIATION (DOLLAR SET)
// ============================================================================

const reconciliation = {};
const headers = AUG.headers;
const headerMap = new Map(headers.map((h) => [h.id, h]));
for (const acct of ACCOUNTS) {
  const acctKey = AUG.accounts.find((a) => a.label === acct).key;
  const monthly = {};
  for (const m of MONTHS) {
    // Line-item sum (DOLLAR SET, live headers only)
    const rows = AUG.rows.filter((r) => r.account_label === acct && r.month === m).filter(inDollar);
    const liSum = round2(sumBy(rows, (r) => r.extended_price));
    // Header sum (live headers - status not in corrected/deleted)
    const acctHeaders = headers.filter((h) => {
      const monthMatch = h.invoice_date && String(h.invoice_date).slice(0, 7) === m;
      const acctMatch = (h.vendor_name || "") || true; // vendor_name only, cannot easily filter by account
      return monthMatch;
    });
    // Get headers whose ids are referenced by rows in this account/month
    const acctMonthUuids = new Set(
      AUG.rows.filter((r) => r.account_label === acct && r.month === m).map((r) => r.invoice_uuid)
    );
    // Headers via join - only headers whose id appears in this account/month row set
    const hdrInScope = headers.filter((h) => acctMonthUuids.has(h.id) && h.status !== "corrected" && h.status !== "deleted");
    // Also headers whose invoice_date matches m and we can attribute to acct via any row
    const hdrTotal = round2(sumBy(hdrInScope, (h) => h.total_amount));
    // GL food total per month
    let glFood = 0;
    for (const h of hdrInScope) {
      const glb = h.gl_breakdown;
      if (Array.isArray(glb)) {
        for (const g of glb) {
          const t = `${g.name || ""} ${g.code || ""}`;
          if (/FOOD|COGS|RESALE|COST OF (GOODS|SALES)/i.test(t)) {
            glFood += Number(g.amount) || 0;
          }
        }
      }
    }
    monthly[m] = {
      line_item_sum: liSum,
      header_sum: hdrTotal,
      gl_food_sum: round2(glFood),
      variance_dollars: round2(liSum - hdrTotal),
      variance_pct: hdrTotal ? Math.round(((liSum - hdrTotal) / hdrTotal) * 1000) / 10 : null,
      invoice_count: hdrInScope.length,
      line_row_count: rows.length,
    };
  }
  // Window totals
  const liSumW = MONTHS.reduce((s, m) => s + monthly[m].line_item_sum, 0);
  const hdrSumW = MONTHS.reduce((s, m) => s + monthly[m].header_sum, 0);
  const glSumW = MONTHS.reduce((s, m) => s + monthly[m].gl_food_sum, 0);
  reconciliation[acct] = {
    monthly,
    window: {
      line_item_sum: round2(liSumW),
      header_sum: round2(hdrSumW),
      gl_food_sum: round2(glSumW),
      variance_dollars: round2(liSumW - hdrSumW),
      variance_pct: hdrSumW ? Math.round(((liSumW - hdrSumW) / hdrSumW) * 1000) / 10 : null,
    },
  };
}

// ============================================================================
// SECTION G: Item Master + Needs Review
// ============================================================================

const itemMaster = [];
const pairMap = new Map();
for (const r of AUG.rows.filter(inDollar)) {
  const key = `${r.vendor_id || "NO-VENDOR"}::${(r.description || "").trim()}`;
  if (!key.endsWith("::")) {
    if (!pairMap.has(key)) pairMap.set(key, { rows: 0, spend: 0, first: r });
    const obj = pairMap.get(key);
    obj.rows += 1;
    obj.spend += Number(r.extended_price) || 0;
  }
}
for (const [key, obj] of pairMap) {
  const c = classifiedItems[key] || null;
  const r = obj.first;
  itemMaster.push({
    vendor_id: r.vendor_id,
    vendor_name: r.vendor_name,
    description: r.description,
    category: r.category,
    accounts: [...new Set(
      [...AUG.rows.filter((x) => (x.vendor_id || "NO-VENDOR") + "::" + (x.description || "").trim() === key).map((x) => x.account_label)]
    )].join(", "),
    order_count: obj.rows,
    total_spend: round2(obj.spend),
    quality_axis: c?.quality_axis || null,
    quality_confidence: c?.quality_confidence ?? null,
    quality_reason: c?.quality_reason || "",
    preparation_axis: c?.preparation_axis || null,
    preparation_confidence: c?.preparation_confidence ?? null,
    preparation_reason: c?.preparation_reason || "",
    storage_axis: c?.storage_axis || null,
    storage_confidence: c?.storage_confidence ?? null,
    storage_reason: c?.storage_reason || "",
    classified: !!c,
  });
}
itemMaster.sort((a, b) => b.total_spend - a.total_spend);

const needsReviewItems = [];
for (const it of itemMaster) {
  if (!it.classified) {
    needsReviewItems.push({ ...it, reason: "not_classified" });
    continue;
  }
  const low = [];
  if (it.quality_confidence < CONFIDENCE_THRESHOLD) low.push(`quality<${CONFIDENCE_THRESHOLD}`);
  if (it.preparation_confidence < CONFIDENCE_THRESHOLD) low.push(`prep<${CONFIDENCE_THRESHOLD}`);
  if (it.storage_confidence < CONFIDENCE_THRESHOLD) low.push(`storage<${CONFIDENCE_THRESHOLD}`);
  if (low.length) needsReviewItems.push({ ...it, reason: low.join(",") });
}
// Also add excluded-rows summary
const excludedRows = AUG.rows.filter((r) => r.review_reason === "invoice_over_extracted");
const excludedRowsMismatch = AUG.rows.filter((r) => r.review_reason === "ep_qty_up_mismatch");
const ambiguousPackRows = AUG.rows.filter((r) => r.parsed_weight_source === "pack_size_ambiguous_multipack");

// ============================================================================
// Write everything out
// ============================================================================

const out = {
  window_label: AUG.window_label,
  window_start: AUG.window_start,
  window_end: AUG.window_end,
  drift_recovered_rows: AUG.drift_recovered,
  orphan_excluded_rows: AUG.orphan_excluded,
  total_live_rows: AUG.row_count,
  classified_items: classifiedCount,
  distinct_pairs_to_classify: pairMap.size,
  classification_coverage_pct: pct1(classifiedCount, pairMap.size),
  spend: perAccount,
  weight: weightPerAccount,
  classification: clsPerAccount,
  inter_axis_prefab_premium: interAxis,
  shared_basket: commonToAll,
  meals: perAcctMeals,
  per_meal: perMealTable,
  reconciliation,
  item_master: itemMaster,
  needs_review: needsReviewItems,
  excluded_rows: {
    invoice_over_extracted: {
      count: excludedRows.length,
      spend: round2(sumBy(excludedRows, (r) => r.extended_price)),
    },
    ep_qty_up_mismatch: {
      count: excludedRowsMismatch.length,
      spend: round2(sumBy(excludedRowsMismatch, (r) => r.extended_price)),
    },
    pack_size_ambiguous_multipack: {
      count: ambiguousPackRows.length,
      spend: round2(sumBy(ambiguousPackRows, (r) => r.extended_price)),
    },
  },
};

fs.writeFileSync(
  "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_analysis.json",
  JSON.stringify(out, null, 2)
);
console.log("[analysis] wrote _analysis.json");
console.log("  classified items:", classifiedCount, "/", pairMap.size, `(${out.classification_coverage_pct}%)`);
console.log("  shared basket size:", commonToAll.length);
console.log("  item master size  :", itemMaster.length);
console.log("  needs review size :", needsReviewItems.length);
for (const acct of ACCOUNTS) {
  const s = perAccount[acct];
  const pm = perMealTable[acct];
  console.log(`  [${acct}] food $=${s.dollar_food_spend}, non-food=${s.dollar_nonfood_pct}%, $/meal=${pm.window_dollars_per_meal} (${pm.window_meals_source})`);
}
