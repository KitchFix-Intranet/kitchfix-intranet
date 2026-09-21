// Fix 1 - reclassify beverage items in item_classifications.json cache.
// Any row identifiable as a "consumer beverage" (branded water, sodas, sports
// drinks, energy drinks, bottled coffee, juices, coconut water/milk) gets its
// quality_axis forced to "neutral" with confidence 100 and a reason string
// indicating the Phase 3b rule.
//
// Culinary exceptions (marsala wine, cooking wine, vanilla extract) keep their
// LLM verdict.
//
// The cache is patched in place. Original quality_axis + confidence stored on a
// `_phase3_original_quality_axis` / `_phase3_original_quality_confidence`
// sibling field so we can audit + reverse if needed.

import fs from "node:fs";
import { P, loadAll, isConsumerBeverage, CULINARY_BEV_EXCEPTION_RE } from "./_common3b.mjs";

const { AUG, CLS } = loadAll();

// Build a map: key -> example row (for category / description context)
const rowByKey = new Map();
for (const r of AUG.rows) {
  const key = (r.vendor_id || "NO-VENDOR") + "::" + (r.description || "").trim();
  if (!rowByKey.has(key)) rowByKey.set(key, r);
}

let patched = 0;
let reverted = 0;
let already = 0;
let preserved = 0;
const patchedItems = [];

// Step 1: revert any prior 3b beverage-force so we can re-decide with the
// current (possibly-tightened) isConsumerBeverage predicate. Cache carries
// _phase3_original_quality_axis so revert is deterministic.
for (const [key, cls] of Object.entries(CLS.items)) {
  if (!cls._phase3b_beverage_forced) continue;
  if ("_phase3_original_quality_axis" in cls) {
    cls.quality_axis = cls._phase3_original_quality_axis;
    cls.quality_confidence = cls._phase3_original_quality_confidence;
    cls.quality_reason = cls._phase3_original_quality_reason;
    delete cls._phase3_original_quality_axis;
    delete cls._phase3_original_quality_confidence;
    delete cls._phase3_original_quality_reason;
    delete cls._phase3b_beverage_forced;
    reverted += 1;
  }
}

// Step 2: apply patch with current predicate.
for (const [key, cls] of Object.entries(CLS.items)) {
  const r = rowByKey.get(key);
  if (!r) continue;
  // Only touch beverage items. Culinary exceptions preserved.
  if (!isConsumerBeverage(r)) continue;
  if (CULINARY_BEV_EXCEPTION_RE.test(r.description || "")) {
    preserved += 1;
    continue;
  }
  if (cls.quality_axis === "neutral" && cls.quality_confidence >= 70) {
    already += 1;
    continue;
  }
  cls._phase3_original_quality_axis = cls.quality_axis;
  cls._phase3_original_quality_confidence = cls.quality_confidence;
  cls._phase3_original_quality_reason = cls.quality_reason;
  cls.quality_axis = "neutral";
  cls.quality_confidence = 100;
  cls.quality_reason = "Phase 3b: consumer beverage (branded water/soda/juice/energy/bottled coffee) forced to neutral - not a food-quality signal";
  cls._phase3b_beverage_forced = true;
  patched += 1;
  patchedItems.push({
    key,
    description: r.description,
    account_examples: [...new Set(AUG.rows.filter((x) => (x.vendor_id || "NO-VENDOR") + "::" + (x.description || "").trim() === key).map((x) => x.account_label))].join(","),
    original: cls._phase3_original_quality_axis,
    original_conf: cls._phase3_original_quality_confidence,
  });
}

CLS.classified_at = new Date().toISOString();
CLS.phase3b_beverage_reclassified_at = new Date().toISOString();
CLS.phase3b_beverage_patched_count = patched;

const tmp = P.CLS + ".tmp";
fs.writeFileSync(tmp, JSON.stringify(CLS, null, 2));
fs.renameSync(tmp, P.CLS);

console.log("[3b-fix1] beverage reclassification pass complete");
console.log("  reverted from prior 3b run:", reverted);
console.log("  patched:", patched);
console.log("  already neutral / no-op:", already);
console.log("  culinary exceptions preserved:", preserved);
console.log("  sample patches (top 15 by description length):");
patchedItems.slice(0, 15).forEach((p) => {
  console.log(`    ${p.description} (was ${p.original}/${p.original_conf}, accounts: ${p.account_examples})`);
});
