// R9: Layer-id resolution checks against fresh AUG.
//   - p5 recovered ids (expect 447/447)
//   - catch_weight_reclassified_ids (expect 362/362 after dedupe)
//   - phase4 _recovered_rows ids (x/N)
// Also: catch (deduped) intersection with p4 recovered.
// Read-only.

import fs from "node:fs";

const AUG = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_augmented.json", "utf8"));
const REC5 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_phase5_recovered.json", "utf8"));
const REC4 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_recovered_rows.json", "utf8"));

const freshIds = new Set(AUG.rows.map(r => r.id));

const p5Ids = REC5.recovered.map(r => r.id);
const catchRawIds = REC5.catch_weight_reclassified_ids || [];
const catchDedup = [...new Set(catchRawIds)];
const p4Ids = REC4.recovered.map(r => r.id);
const p4DedupIds = [...new Set(p4Ids)];

const p5Res = p5Ids.filter(id => freshIds.has(id));
const catchRes = catchDedup.filter(id => freshIds.has(id));
const p4Res = p4DedupIds.filter(id => freshIds.has(id));

const p5Miss = p5Ids.filter(id => !freshIds.has(id));
const catchMiss = catchDedup.filter(id => !freshIds.has(id));
const p4Miss = p4DedupIds.filter(id => !freshIds.has(id));

// Impact of dropping non-resolving p4 rows
const rowsById = new Map(AUG.rows.map(r => [r.id, r]));
function impact(ids, layerName) {
  let rows = 0, spend = 0, lbs = 0;
  const droppedFromLayer = layerName === "p4" ? REC4.recovered.filter(r => !freshIds.has(r.id)) : [];
  for (const r of droppedFromLayer) {
    rows += 1;
    spend += Number(r.extended_price ?? r.ep) || 0;
    lbs += Number(r.effective_weight_lb) || 0;
  }
  return { rows, spend: Math.round(spend * 100) / 100, lbs: Math.round(lbs * 10) / 10 };
}

const p5MissImpact = { rows: p5Miss.length };
const catchMissImpact = { rows: catchMiss.length };
const p4MissImpact = impact(p4Miss, "p4");

// catch ∩ p4 overlap  (dedup catch)
const p4Set = new Set(p4DedupIds);
const catchInP4 = catchDedup.filter(id => p4Set.has(id));
const p5Set = new Set(p5Ids);
const catchInP5 = catchDedup.filter(id => p5Set.has(id));

const summary = {
  fresh_row_count: AUG.rows.length,
  p5_recovered: {
    total: p5Ids.length,
    resolved: p5Res.length,
    missing: p5MissImpact,
    missing_ids: p5Miss,
  },
  catch_weight_reclassified: {
    raw_count: catchRawIds.length,
    deduped_count: catchDedup.length,
    resolved: catchRes.length,
    missing: catchMissImpact,
    missing_ids: catchMiss,
  },
  p4_recovered: {
    raw_count: p4Ids.length,
    deduped_count: p4DedupIds.length,
    resolved: p4Res.length,
    missing_ids_count: p4Miss.length,
    missing_impact: p4MissImpact,
  },
  overlaps: {
    "catch ∩ p4": catchInP4.length,
    "catch ∩ p5": catchInP5.length,
  },
};

console.log(JSON.stringify(summary, null, 2));

const OUT = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_layer_id_resolution.json";
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
console.log(`\nwrote ${OUT}`);
