// Q17 analyst decision: reclassify top items in category='other' into real
// categories. Long tail stays in 'other'. Report bucket size + composition.
import fs from "node:fs";
import { P } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_common4.mjs";
import { P5, round2 } from "./_common5.mjs";

const rows = JSON.parse(fs.readFileSync(P.AUG, "utf8")).rows;
const other = rows.filter(r => (r.category || "").toLowerCase() === "other" && r.review_reason !== "invoice_over_extracted");
console.log(`category='other' rows: ${other.length} / $${other.reduce((s,r)=>s+(Number(r.extended_price)||0),0).toFixed(0)}`);

// Group by description head + vendor
const byDescKey = {};
for (const r of other) {
  const key = `${(r.vendor_name || "").split(/\s+/)[0]}|${String(r.description || "").toUpperCase().slice(0, 40)}`;
  byDescKey[key] = byDescKey[key] || { key, description: r.description, vendor: r.vendor_name, rows: 0, spend: 0 };
  byDescKey[key].rows++;
  byDescKey[key].spend += Number(r.extended_price) || 0;
}
const groups = Object.values(byDescKey).sort((a,b) => b.spend - a.spend);
console.log(`\ndistinct desc-groups: ${groups.length}`);
console.log(`\ntop 30 by spend:`);
groups.slice(0, 30).forEach(g => console.log(`  $${g.spend.toFixed(0).padStart(7)}  x${g.rows} | ${g.vendor} | ${g.description}`));

// Reclassification rules for top items - explicit list based on description patterns.
// Kevin: "Items like SAMBZON SORBET plainly food. Reclassify top items by spend into real categories.
//         Long tail stays in 'other'." Analyst call, distinguishable from Kevin answers.
const rules = [
  // sorbet + frozen desserts -> dessert (which we'll treat as dairy for food-share purposes)
  { pattern: /SAMBZON.*SORBET|SORBET|GELATO|ICE CREAM|FROZEN YOGURT/i, target_category: "dairy", reason: "frozen dessert" },
  // condiments, sauces -> dry_goods (grocery)
  { pattern: /HOT SAUCE|KETCHUP|MUSTARD|MAYO|VINEGAR|SOY SAUCE|WORCESTER|BBQ SAUCE|MARINADE|DRESSING|SALSA/i, target_category: "dry_goods", reason: "condiment / sauce" },
  // seasonings, spices, salt, oils -> dry_goods
  { pattern: /SPICE|SEASONING|SALT|PEPPER|OIL|VANILLA|EXTRACT|BROTH|STOCK|BOUILLON/i, target_category: "dry_goods", reason: "seasoning / oil / broth" },
  // fees stay other/non_food
  { pattern: /FEE|CHARGE|SURCHARGE|CREDIT|MISC|MATERIAL/i, target_category: "non_food", reason: "fee / non-food line" },
  // paper/plastic/service supplies -> non_food
  { pattern: /BAG|CUP|BOWL|LID|GLOVE|APRON|TOWEL|NAPKIN|WIPE|PAN FOIL|WRAP|LINER|PLATE/i, target_category: "non_food", reason: "supply / packaging" },
];

let reclassCount = 0;
const reclass = [];
for (const g of groups) {
  if (g.spend < 50) break;  // long tail stops here
  for (const rule of rules) {
    if (rule.pattern.test(g.description)) {
      reclassCount++;
      reclass.push({
        vendor: g.vendor,
        description: g.description,
        rows: g.rows,
        spend: round2(g.spend),
        from_category: "other",
        to_category: rule.target_category,
        reason: rule.reason,
      });
      break;
    }
  }
}
const reclassSpend = reclass.reduce((s,r)=>s+r.spend,0);
const remaining = other.length;
console.log(`\nAnalyst-reclass: ${reclassCount} desc-groups moved out of 'other' totaling $${reclassSpend.toFixed(0)}`);
console.log(`Remaining 'other' bucket: ${remaining - reclass.reduce((s,r)=>s+r.rows,0)} rows / $${(other.reduce((s,r)=>s+r.spend,0) - reclassSpend).toFixed(0)}`);

fs.writeFileSync(
  "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_q17_other_reclass.json",
  JSON.stringify({
    original_bucket: { rows: other.length, spend: other.reduce((s,r)=>s+(Number(r.extended_price)||0),0) },
    reclass_rules: rules.map(r => ({ pattern: String(r.pattern), target_category: r.target_category, reason: r.reason })),
    reclassified_groups: reclass,
    remaining_after: {
      rows: other.length - reclass.reduce((s,r)=>s+r.rows,0),
      spend: other.reduce((s,r)=>s+(Number(r.extended_price)||0),0) - reclassSpend,
    },
    top_remaining: groups.filter(g => !rules.some(r => r.pattern.test(g.description))).slice(0, 20).map(g => ({
      description: g.description, rows: g.rows, spend: round2(g.spend),
    })),
  }, null, 2)
);
console.log("wrote _q17_other_reclass.json");
