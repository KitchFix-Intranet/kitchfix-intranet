// Q12 + Q16: verify non-food shares are correct as published.
// Kevin: "all these examples are packaging/supplies" (Q12) confirmed non-food.
// Q16: fee lines are NON-FOOD; no expected change.

import fs from "node:fs";
import { P } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_common4.mjs";
import { round2 } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_common5.mjs";

const rows = JSON.parse(fs.readFileSync(P.AUG, "utf8")).rows;
const A5 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_analysis5.json", "utf8"));

// Q12: category disagreement rows (packaging / supplies / cleaning / smallwares on food-vendor invoices)
const disagree = rows.filter(r => {
  const c = String(r.category || "").toLowerCase();
  const isNonFoodCat = ["packaging","supplies","cleaning","chemical","chemicals","smallwares","linen"].includes(c);
  const isFoodVendor = /Sysco|Cheney|GFS|Gordon|Fresh Point|Samuels/i.test(r.vendor_name || "");
  return isNonFoodCat && isFoodVendor;
});
const byAcct = {};
for (const r of disagree) {
  const a = r.account_label;
  byAcct[a] = byAcct[a] || { rows: 0, spend: 0, classifier_non_food: 0 };
  byAcct[a].rows++;
  byAcct[a].spend += Number(r.extended_price) || 0;
  // Classifier verdict is stored in food_verdict (set during Phase 3 by foodClassifier)
  if (r.food_verdict === "non_food") byAcct[a].classifier_non_food++;
}
console.log("Q12 category disagreement rows:");
for (const [a, v] of Object.entries(byAcct)) console.log(`  ${a}: ${v.rows} rows / $${v.spend.toFixed(0)} - classifier non_food=${v.classifier_non_food}`);

// Q16 fee lines (already forced non_food)
const feeLines = rows.filter(r => /FUEL SURCHARGE|DELIVERY CHARGE|CUSTOMER INCENTIVE|FUEL SURCH|PAYMENT PROCESSING|MATERIAL CHARGE/i.test(r.description || ""));
const feeByAcct = {};
for (const r of feeLines) {
  const a = r.account_label;
  feeByAcct[a] = feeByAcct[a] || { rows: 0, spend: 0, classifier_non_food: 0 };
  feeByAcct[a].rows++;
  feeByAcct[a].spend += Number(r.extended_price) || 0;
  if (r.food_verdict === "non_food") feeByAcct[a].classifier_non_food++;
}
console.log("\nQ16 fee lines:");
for (const [a, v] of Object.entries(feeByAcct)) console.log(`  ${a}: ${v.rows} rows / $${v.spend.toFixed(0)} - classifier non_food=${v.classifier_non_food}`);

fs.writeFileSync(
  "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_q12_q16_verify.json",
  JSON.stringify({ q12: byAcct, q16: feeByAcct, verdict: "confirmed non-food; no change" }, null, 2)
);
console.log("wrote _q12_q16_verify.json");
