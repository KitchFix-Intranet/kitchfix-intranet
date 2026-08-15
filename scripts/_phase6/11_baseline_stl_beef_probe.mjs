// Investigate STL beef in baseline: individual row DPP distribution.
import fs from "node:fs";
import { P } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_common4.mjs";
import { P5, assignProteinType, round2 } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_common5.mjs";

const AUG = JSON.parse(fs.readFileSync(P.AUG, "utf8"));
const REC5 = JSON.parse(fs.readFileSync(P5.RECOVERED, "utf8"));
const REC4 = JSON.parse(fs.readFileSync(P.P4_RECOVERED_ROWS, "utf8"));
const REHAB_3C = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_rehabbed_rows.json", "utf8"));

const p5RecById = new Map(REC5.recovered.map(r => [r.id, r]));
const p4RecById = new Map(REC4.recovered.map(r => [r.id, r]));
const rehab3cById = new Map();
for (const r of REHAB_3C) {
  if (r.id && r._effective_weight_lb != null) rehab3cById.set(r.id, { lb: Number(r._effective_weight_lb) });
}
const catchReclassIdsAll = new Set(REC5.catch_weight_reclassified_ids || []);

function baseEffLb(r) {
  const p5 = p5RecById.get(r.id); if (p5) return p5.effective_weight_lb;
  const p4 = p4RecById.get(r.id); if (p4) return p4.effective_weight_lb;
  const r3c = rehab3cById.get(r.id); if (r3c && r3c.lb > 0) return r3c.lb;
  const pw = Number(r.parsed_weight_lb); if (Number.isFinite(pw) && pw > 0) return pw;
  return null;
}
function baseIn(r) {
  if (r.review_reason === "invoice_over_extracted") return false;
  if (r.review_reason === "ep_qty_up_mismatch" && !catchReclassIdsAll.has(r.id)) return false;
  const eff = baseEffLb(r); return eff && eff > 0;
}

const stlBeef = AUG.rows.filter(r => r.account_label === "STL-FL" && String(r.category).toLowerCase() === "protein" && assignProteinType(r.description) === "beef" && baseIn(r));
console.log(`STL beef baseline weight-set rows: ${stlBeef.length}`);
const rows = stlBeef.map(r => ({
  id: r.id.slice(0, 8),
  desc: r.description.slice(0, 40),
  lb: round2(baseEffLb(r)),
  ep: r.extended_price,
  dpp: round2(r.extended_price / baseEffLb(r)),
  source: (p5RecById.get(r.id) && p5RecById.get(r.id).source) || (p4RecById.get(r.id) && p4RecById.get(r.id).tag) || r.parsed_weight_source,
})).sort((a,b) => a.dpp - b.dpp);

console.log("\nBottom 15 rows (lowest $/lb):");
for (const r of rows.slice(0, 15)) console.log(`  ${r.id}  lb=${String(r.lb).padStart(8)}  ep=${String(r.ep).padStart(8)}  dpp=${String(r.dpp).padStart(6)}  ${r.source}  ${r.desc}`);

console.log("\nTop 10 rows (highest $/lb):");
for (const r of rows.slice(-10)) console.log(`  ${r.id}  lb=${String(r.lb).padStart(8)}  ep=${String(r.ep).padStart(8)}  dpp=${String(r.dpp).padStart(6)}  ${r.source}  ${r.desc}`);

const totalLb = rows.reduce((s,r)=>s+r.lb,0);
const totalEp = rows.reduce((s,r)=>s+r.ep,0);
console.log(`\nAggregate: ${rows.length} rows / ${round2(totalLb)} lbs / $${round2(totalEp)} => $${round2(totalEp/totalLb)}/lb`);

// Try without d48e8152:
const withoutD48 = rows.filter(r => !r.id.startsWith("d48e8152"));
const totalLbW = withoutD48.reduce((s,r)=>s+r.lb,0);
const totalEpW = withoutD48.reduce((s,r)=>s+r.ep,0);
console.log(`Without d48e8152: ${withoutD48.length} rows / ${round2(totalLbW)} lbs / $${round2(totalEpW)} => $${round2(totalEpW/totalLbW)}/lb`);
