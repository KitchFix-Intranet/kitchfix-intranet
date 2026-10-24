// src/lib/purchase/foodClassifier.js
// Phase 2 purchase-line-item repair. Food vs non-food determination per line,
// tri-source (vendor, GL code on parent header, category on line). Records
// which sources agreed / disagreed so downstream analysis can be honest about
// low-confidence rows.
//
// The output feeds ai_line_items.is_food (boolean derived column, added via
// docs/migrations/pr-10-2-ai-line-items-derived-columns.sql).

// Vendors whose entire product catalog is non-food. From Phase 1 discovery.
const NON_FOOD_VENDORS = new Set([
  "Alsco Uniforms",
  "Cintas",
  "Vestis",
  "Auto-Chlor",
  "Ecolab",
  "Cozzini",
  "Cozzini Bros",
  "Cozzini Brothers",
  "Ferrell Gas",
]);

// Categories the AI extractor uses. `supplies` and `packaging` are non-food
// even when they appear on a food-vendor's invoice.
const NON_FOOD_CATEGORIES = new Set(["supplies", "packaging", "chemical", "linen", "uniform"]);
const FOOD_CATEGORIES = new Set([
  "produce",
  "protein",
  "dairy",
  "dry_goods",
  "beverage",
  "seafood",
  "meat",
  "grocery",
  "frozen",
]);

// Fee/service descriptions that show up as line items but aren't purchases.
const NON_PURCHASE_DESC_RE = /FUEL SURCHARGE|DELIVERY CHARGE|PAYMENT PROCESSING|MATERIAL CHARGE|CAN OPENER|CUSTOMER INCENTIVE|KNIFE SERVICE|INVOICE FEE|CREDIT ADJUSTMENT|RENTAL FEE|SANITIZ|SERVICE FEE|WEEKLY SERVICE|SHOP MAT|WIPER RENT/i;

// GL codes indicating food/COGS. Positive match = food.
// Sample from live gl_breakdown: "1385.3" (STL-FL Food), "3200.1" (Resale Food
// Costs), similar patterns per account.
const FOOD_GL_RE = /FOOD|COGS|RESALE|COST OF (GOODS|SALES)/i;
// GL codes indicating non-food overhead.
const NON_FOOD_GL_RE = /LINEN|CHEMICAL|UNIFORM|SANITAT|CLEANING|GAS|UTILIT|SUPPLIES|SMALLWARE|EQUIPMENT/i;

export function classifyLine(row, invoiceHeader = null) {
  const vendorSig = classifyByVendor(row);
  const catSig = classifyByCategory(row);
  const descSig = classifyByDescription(row);
  const glSig = classifyByGl(row, invoiceHeader);

  const signals = { vendor: vendorSig, category: catSig, description: descSig, gl: glSig };

  // Aggregate: any strong non-food signal overrides food-food-food. Any
  // strong food signal AND no strong non-food signal = food.
  const anyNonFood = [vendorSig, catSig, descSig, glSig].some((s) => s === "non_food");
  const anyFood = [vendorSig, catSig, descSig, glSig].some((s) => s === "food");
  const disagreement = anyNonFood && anyFood;

  let verdict;
  if (anyNonFood && !anyFood) verdict = "non_food";
  else if (anyFood && !anyNonFood) verdict = "food";
  else if (disagreement) {
    // Prefer explicit non-food description (surcharge/fee) over vendor guess.
    if (descSig === "non_food") verdict = "non_food";
    else if (vendorSig === "non_food") verdict = "non_food";
    else if (catSig === "non_food") verdict = "non_food";
    else verdict = "food";
  } else {
    verdict = "unknown";
  }

  return {
    is_food: verdict === "food",
    verdict,
    disagreement,
    signals,
  };
}

function classifyByVendor(row) {
  const v = String(row.vendor_name || "").trim();
  if (NON_FOOD_VENDORS.has(v)) return "non_food";
  return "unknown";
}

function classifyByCategory(row) {
  const c = String(row.category || "").trim().toLowerCase();
  if (NON_FOOD_CATEGORIES.has(c)) return "non_food";
  if (FOOD_CATEGORIES.has(c)) return "food";
  return "unknown";
}

function classifyByDescription(row) {
  const d = String(row.description || "");
  if (NON_PURCHASE_DESC_RE.test(d)) return "non_food";
  return "unknown";
}

function classifyByGl(row, invoiceHeader) {
  if (!invoiceHeader?.gl_breakdown) return "unknown";
  const glb = invoiceHeader.gl_breakdown;
  if (!Array.isArray(glb) || glb.length === 0) return "unknown";
  // If ALL GL entries are food-shaped, food. If ANY non-food and no food, non-food.
  // Mixed = "unknown" from GL alone, resolved by other signals.
  let foodHit = false;
  let nonFoodHit = false;
  for (const g of glb) {
    const t = `${g.name || ""} ${g.code || ""}`;
    if (FOOD_GL_RE.test(t)) foodHit = true;
    if (NON_FOOD_GL_RE.test(t)) nonFoodHit = true;
  }
  if (foodHit && !nonFoodHit) return "food";
  if (nonFoodHit && !foodHit) return "non_food";
  return "unknown";
}
