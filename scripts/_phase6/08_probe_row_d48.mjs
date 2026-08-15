// Probe row d48e8152 for R5b test.
import fs from "node:fs";

const AUG = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_augmented.json", "utf8"));
const target = AUG.rows.find(r => r.id?.startsWith("d48e8152"));
if (!target) {
  console.log("d48e8152 not found - searching for BEEF BOTTOM SIRLOIN FLAP in Cheney");
  const cands = AUG.rows.filter(r =>
    /BEEF.*BOTTOM.*SIRLOIN.*FLAP/i.test(r.description || "") &&
    /CHENEY/i.test(r.vendor_name || "")
  );
  console.log(`  found ${cands.length} candidates`);
  for (const r of cands.slice(0, 5)) console.log("  ", r.id, r.description, r.pack_size, r.unit, r.quantity, r.unit_price, r.extended_price);
} else {
  console.log("id:", target.id);
  console.log("account:", target.account_label);
  console.log("description:", target.description);
  console.log("pack_size:", target.pack_size);
  console.log("unit:", target.unit);
  console.log("quantity:", target.quantity);
  console.log("unit_price:", target.unit_price);
  console.log("extended_price:", target.extended_price);
  console.log("parsed_weight_lb:", target.parsed_weight_lb);
  console.log("parsed_weight_source:", target.parsed_weight_source);
  console.log("review_reason:", target.review_reason);
  console.log("category:", target.category);
  console.log("");
  const qty = Number(target.quantity), up = Number(target.unit_price), ep = Number(target.extended_price);
  const calc = qty * up;
  const tol = Math.max(1, 0.02 * ep);
  console.log(`arith: qty*up = ${qty} * ${up} = ${calc}, ep = ${ep}, |calc-ep| = ${Math.abs(calc-ep)}, tol = ${tol}`);
  console.log(`unit lower: ${String(target.unit).toLowerCase()}, is 'lb': ${String(target.unit).toLowerCase() === 'lb'}`);
  console.log(`R5b would apply: ${String(target.unit).toLowerCase() === 'lb' && Math.abs(calc-ep) <= tol}`);
}

// General R5b population survey
let r5bCount = 0;
const perAcctCat = {};
let r5bLbs = 0;
let r5bSpend = 0;
for (const r of AUG.rows) {
  if (r.review_reason === "invoice_over_extracted") continue;
  const unit = String(r.unit || "").toLowerCase();
  if (unit !== "lb") continue;
  const qty = Number(r.quantity), up = Number(r.unit_price), ep = Number(r.extended_price);
  if (!qty || !up || !ep) continue;
  const calc = qty * up;
  const tol = Math.max(1, 0.02 * ep);
  if (Math.abs(calc - ep) > tol) continue;
  r5bCount += 1;
  r5bLbs += qty;
  r5bSpend += ep;
  const cat = r.category || "other";
  const acct = r.account_label;
  const key = `${acct}::${cat}`;
  if (!perAcctCat[key]) perAcctCat[key] = { rows: 0, lbs: 0, spend: 0 };
  perAcctCat[key].rows += 1;
  perAcctCat[key].lbs += qty;
  perAcctCat[key].spend += ep;
}
console.log(`\nR5b population overall: ${r5bCount} rows / ${r5bLbs.toFixed(1)} lbs / $${r5bSpend.toFixed(2)}`);
console.log("Per acct::category:");
const round2 = n => Math.round(n*100)/100;
const round1 = n => Math.round(n*10)/10;
for (const [k, v] of Object.entries(perAcctCat).sort((a,b)=>b[1].rows-a[1].rows)) {
  console.log(`  ${k.padEnd(28)}  rows=${String(v.rows).padStart(4)}  lbs=${round1(v.lbs).toString().padStart(8)}  $${round2(v.spend).toString().padStart(10)}  $/lb=${v.lbs>0?round2(v.spend/v.lbs):null}`);
}
