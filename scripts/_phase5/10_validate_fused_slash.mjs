// Validate the fused-slash resolver against Kevin's 30-SKU verified pack weights.
// Rule of the brief: "If it cannot reproduce all 30, the rule is wrong."
// We check ONLY the per-case weight; disregard quantity multiplication.
// We interpret Kevin's free-text weight column into a canonical lb-per-case
// float where possible.

import fs from "node:fs";
import { resolveFusedSlash, P5 } from "./_common5.mjs";

const OQ = JSON.parse(fs.readFileSync(P5.OPEN_QUESTIONS_JSON, "utf8"));

// -------------------------------------------------------------------
// Parse Kevin's textual weight cell into canonical lb-per-case.
// Handles: "1/15lb=15lbs" -> 15
//          "4/10lb=40lb"  -> 40
//          "2/20lb=40lb"  -> 40
//          "14/12oz=10.5lb" -> 10.5
//          "12ea/12oz bottles" -> 12*12=144 oz -> 9 lb
//          "24ea/20oz bottles" -> 24*20=480 oz -> 30 lb
//          "10/ 1lb packs" -> 10
//          "15ea / 2lb cartons" -> 30
//          "1 ea 50lb bag" -> 50
//          "12/ 32oz bottles" -> 12*32=384 oz -> 24 lb
// -------------------------------------------------------------------
function parseKevinWeight(text) {
  if (text == null) return null;
  const s = String(text).toLowerCase().replace(/\s+/g, " ");
  // First: look for explicit "=NUMBER lb(s)" suffix -> use that
  let m = s.match(/=\s*([\d.]+)\s*lbs?\b/);
  if (m) return Number(m[1]);
  // "N/M lb=Xlbs" or bare "1/15lb=15lbs"
  m = s.match(/(\d+)\/(\d+)\s*lb/);
  if (m) return Number(m[1]) * Number(m[2]);
  // "1 ea Xlb" or "1ea Xlb bag/cs/case"
  m = s.match(/\d+\s*ea\s+(\d+(?:\.\d+)?)\s*lb/);
  if (m) return Number(m[1]);
  // "N ea Mlb"
  m = s.match(/(\d+)\s*(?:ea|packs|cartons|bags|cs|case)?\s*[\/x]?\s*(\d+(?:\.\d+)?)\s*lb/);
  if (m) return Number(m[1]) * Number(m[2]);
  // "NeaMlb"
  m = s.match(/(\d+)ea\/?(\d+(?:\.\d+)?)\s*oz/);
  if (m) return (Number(m[1]) * Number(m[2])) / 16;
  m = s.match(/(\d+)\s*(?:ea|\/)\s*(\d+(?:\.\d+)?)\s*oz/);
  if (m) return (Number(m[1]) * Number(m[2])) / 16;
  m = s.match(/(\d+)\/(\d+(?:\.\d+)?)\s*oz/);
  if (m) return (Number(m[1]) * Number(m[2])) / 16;
  return null;
}

const results = [];
let pass = 0;
let fail = 0;
let ambigMatch = 0;  // ambiguous is a valid outcome if it's genuinely ambiguous
let unresolved = 0;

for (const row of OQ.pack_weights) {
  const pack = String(row.pack_as_printed || "").trim();
  const guess = row.guess || "";
  // Category: infer from description (this is our production behavior)
  // For validation, we approximate:
  let cat = "protein";
  const d = String(row.description || "").toUpperCase();
  if (/EGG/i.test(d)) cat = "protein"; // liquid egg treated as protein in our pipeline
  if (/JUICE|BEV|WATER|MILK/i.test(d)) cat = "beverage";
  if (/BACON|SAUSAG/i.test(d)) cat = "protein";
  if (/CHICKEN|BRST|THIGH/i.test(d)) cat = "protein";
  if (/STEAK|BEEF|RIBEYE|SKIRT|BRISKET|FLANK|GROUND/i.test(d)) cat = "protein";
  if (/BANANA|ASPARAG|APPLE|LIME|ORANGE|PROPACK/i.test(d)) cat = "produce";
  if (/RICE|OAT/i.test(d)) cat = "dry_goods";

  const kevinLb = parseKevinWeight(row.case_weight_lb);
  const res = resolveFusedSlash(pack, cat, 1);

  let status;
  let match;
  if (res.unhandled) {
    unresolved++;
    status = "unhandled_pack_shape";
    match = false;
  } else if (res.ambiguous) {
    // Ambiguous is a valid outcome for our rule; if Kevin's answer matches one
    // of the two candidates we still count it as "rule allows a correct read"
    // but we mark ambig so we know we can't uniquely resolve.
    status = "ambiguous";
    if (kevinLb != null) {
      const a = res.both_candidates.one_two.per_case_lb;
      const b = res.both_candidates.two_one.per_case_lb;
      if (Math.abs(a - kevinLb) < 0.05 || Math.abs(b - kevinLb) < 0.05) {
        ambigMatch++;
        match = "ambiguous_but_option_matches";
      } else {
        match = false;
        fail++;
      }
    } else {
      match = "no_kevin_number_to_compare";
    }
  } else {
    status = "resolved";
    if (kevinLb != null) {
      if (Math.abs(res.effective_weight_lb_per_case - kevinLb) < 0.05) {
        match = true;
        pass++;
      } else {
        match = false;
        fail++;
      }
    } else {
      match = "no_kevin_number_to_compare";
    }
  }

  results.push({
    vendor: row.vendor,
    item: row.item_number,
    description: String(row.description || "").slice(0, 60),
    pack: pack,
    kevin_raw: row.case_weight_lb,
    kevin_lb: kevinLb,
    resolver_status: status,
    resolver_per_case_lb: res.effective_weight_lb_per_case ?? null,
    resolver_split: res.split ?? null,
    resolver_source: res.source ?? null,
    resolver_reason: res.reason ?? null,
    resolver_ambig_options: res.both_candidates ?? null,
    match,
  });
}

const total = OQ.pack_weights.length;
console.log(`\n===== FUSED-SLASH RESOLVER VALIDATION vs 30 KEVIN SKUs =====`);
console.log(`Total SKUs: ${total}`);
console.log(`Pass (uniquely resolved AND matches Kevin): ${pass}`);
console.log(`Ambiguous but Kevin's answer matches one candidate: ${ambigMatch}`);
console.log(`Fail (resolved wrong OR ambiguous with no matching option): ${fail}`);
console.log(`Unhandled pack shape: ${unresolved}`);
console.log(`Pass rate (unique + ambig-with-match): ${((pass + ambigMatch) / total * 100).toFixed(1)}%`);
console.log(`Unique-resolution rate: ${(pass / total * 100).toFixed(1)}%`);

console.log(`\n===== per-SKU detail =====`);
for (const r of results) {
  const short = `${r.pack.padEnd(10)} | kevin=${String(r.kevin_lb).padEnd(6)} | resolver=${String(r.resolver_per_case_lb).padEnd(6)} | ${r.resolver_status.padEnd(10)} | ${r.resolver_source ?? r.resolver_reason ?? ""} | match=${r.match}`;
  console.log(`  ${short}   [${r.description}]`);
}

fs.writeFileSync(P5.FUSED_VALIDATION, JSON.stringify({
  summary: {
    total, pass, ambig_match: ambigMatch, fail, unresolved,
    pass_rate_pct: Math.round((pass + ambigMatch) / total * 1000) / 10,
    unique_resolution_pct: Math.round(pass / total * 1000) / 10,
  },
  detail: results,
}, null, 2));
console.log(`\nwrote ${P5.FUSED_VALIDATION}`);
