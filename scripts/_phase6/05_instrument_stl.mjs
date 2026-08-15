// Diagnose STL-FL protein lbs by layer + top rows.
// Read-only.

import fs from "node:fs";

const AUG = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_augmented.json", "utf8"));
const REC5 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_phase5_recovered.json", "utf8"));
const REC4 = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_recovered_rows.json", "utf8"));
const REHAB_3C = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3c/_rehabbed_rows.json", "utf8"));

const p5 = new Map(REC5.recovered.map(r => [r.id, r]));
const p4 = new Map(REC4.recovered.map(r => [r.id, r]));
const r3c = new Map();
for (const r of REHAB_3C) if (r.id && r._effective_weight_lb != null) r3c.set(r.id, { lb: Number(r._effective_weight_lb), method: r._weight_method_final });

const catchIds = new Set(REC5.catch_weight_reclassified_ids || []);

function assignProteinType(desc) {
  if (!desc) return "other";
  const d = String(desc).toUpperCase();
  if (/\bEGG\b|\bEGGS\b|\bTOFU\b|\bSEITAN\b|\bTEMPEH\b/.test(d)) return "plant_or_egg";
  if (/\bBEEF\b|\bSTEAK\b|\bRIBEYE\b|\bBRISKET\b|\bFLANK\b|\bSIRLOIN\b|\bTENDERLOIN\b|\bGROUND BEEF\b|\bHAMBURGER\b|MEATBALL|OXTAIL|SHORT RIB|SHORT-RIB|PASTRAMI/.test(d)) return "beef";
  if (/\bCHICKEN\b|\bTURKEY\b|\bDUCK\b|\bPOULTRY\b|\bCHIX\b|\bCVP\b|\bBRST\b|\bTHIGH\b|\bWING\b|\bLEG\b|TUKEY|TURKY/.test(d)) return "poultry";
  if (/\bPORK\b|\bBACON\b|\bSAUSAGE\b|\bHAM\b|PEPPERONI|\bBERKSHIRE\b|PORK BUTT|PORK LOIN|PORK BELLY|PORK CHOP|PROSCIUTTO|SALAMI|CHORIZO/.test(d)) return "pork";
  if (/\bSALMON\b|\bTUNA\b|\bSHRIMP\b|\bCOD\b|\bFISH\b|\bSEAFOOD\b|\bTILAPIA\b|\bMAHI\b|\bSCALLOP\b|\bLOBSTER\b|\bCRAB\b|SUSHI|\bSNAPPER\b|\bBASS\b|\bTROUT\b|GROUPER|CATFISH|FILEFISH|NETUNO|PORTCLS/.test(d)) return "seafood";
  if (/\bLAMB\b|\bGOAT\b|\bVENISON\b|\bBISON\b|VEAL/.test(d)) return "other_meat";
  return "other";
}

const rows = AUG.rows.filter(r => (r.account_label || "").replace(" - ","-") === "STL-FL" && String(r.category||"").toLowerCase() === "protein" && r.review_reason !== "invoice_over_extracted");

const byLayer = { p5: 0, p4: 0, catch_implied: 0, "3c_rehab": 0, base: 0, none: 0 };
const byLayerLbs = { p5: 0, p4: 0, catch_implied: 0, "3c_rehab": 0, base: 0, none: 0 };
const topBase = [];
for (const r of rows) {
  const t = assignProteinType(r.description);
  if (t === "plant_or_egg" || t === "other") continue;
  let layer, lb;
  if (p5.has(r.id)) { layer = "p5"; lb = p5.get(r.id).effective_weight_lb; }
  else if (p4.has(r.id)) { layer = "p4"; lb = p4.get(r.id).effective_weight_lb; }
  else if (r.review_reason === "ep_qty_up_mismatch" && catchIds.has(r.id)) {
    const up = Number(r.unit_price), ep = Number(r.extended_price);
    lb = ep/up; layer = "catch_implied";
  }
  else if (r3c.has(r.id)) { layer = "3c_rehab"; lb = r3c.get(r.id).lb; }
  else {
    const pw = Number(r.parsed_weight_lb);
    if (Number.isFinite(pw) && pw > 0) { layer = "base"; lb = pw; }
    else { layer = "none"; lb = 0; }
  }
  byLayer[layer]++;
  byLayerLbs[layer] += lb || 0;
  if (layer === "base" || layer === "p5" || layer === "3c_rehab") {
    topBase.push({ id: r.id, layer, lb: Math.round(lb*10)/10, ep: r.extended_price, up: r.unit_price, sh: r.shipped_count, pack: r.pack_size, desc: r.description, src: r.parsed_weight_source });
  }
}

console.log("STL-FL protein core-food rows (excl plant_or_egg + other):");
for (const k of Object.keys(byLayer)) {
  console.log(`  ${k.padEnd(14)} rows=${String(byLayer[k]).padStart(4)} lbs=${(Math.round(byLayerLbs[k]*10)/10).toString().padStart(10)}`);
}

topBase.sort((a,b) => b.lb - a.lb);
console.log("\ntop 25 highest-lb rows (base + p5 + 3c) that are NOT p4 or catch:");
for (const t of topBase.slice(0, 25)) {
  console.log(`  ${t.id}  ${t.layer.padEnd(9)} lb=${String(t.lb).padStart(8)}  ep=$${t.ep} up=$${t.up} sh=${t.sh}  pack="${t.pack}"  src=${t.src}  desc="${(t.desc||'').slice(0,50)}"`);
}
