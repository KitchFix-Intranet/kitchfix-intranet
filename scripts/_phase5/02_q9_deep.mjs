// Q9 deep-dive: look at unit='lb' rows that don't reconcile, and check
// wider populations (uom_raw='LB' etc).
import fs from "node:fs";
import { P } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_common4.mjs";

const AUG = JSON.parse(fs.readFileSync(P.AUG, "utf8"));
const rows = AUG.rows;

// bucket by (unit, uom_raw)
const bucket = {};
for (const r of rows) {
  const u = (r.unit || "").toLowerCase();
  const ur = String(r.uom_raw || "").trim().toUpperCase();
  const key = `unit=${u} uom_raw=${ur}`;
  if (!bucket[key]) bucket[key] = { rows: 0, spend: 0 };
  bucket[key].rows++;
  bucket[key].spend += Number(r.extended_price) || 0;
}
const sorted = Object.entries(bucket).sort((a,b)=> b[1].spend - a[1].spend);
console.log("Top (unit, uom_raw) buckets by spend:");
for (const [k,v] of sorted.slice(0, 20)) console.log(`  ${k} -> ${v.rows} rows / $${v.spend.toFixed(0)}`);

// For unit='lb', look at failed reconciliations
console.log("\nQ9 fail examples (unit='lb', up*shipped != ep):");
let shown = 0;
for (const r of rows) {
  if ((r.unit || "").toLowerCase() !== "lb") continue;
  const up = Number(r.unit_price);
  const sh = Number(r.shipped_count);
  const q  = Number(r.quantity);
  const ep = Number(r.extended_price);
  if (!up || !sh || !ep) continue;
  const calcSh = up * sh;
  const tol = Math.max(1, ep * 0.02);
  if (Math.abs(calcSh - ep) > tol) {
    if (shown < 15) {
      const calcQ = up * q;
      console.log(`  ${r.vendor_name} | ${(r.description||"").slice(0,50)} | up=${up} sh=${sh} q=${q} ep=${ep} calc_sh=${calcSh.toFixed(2)} calc_q=${calcQ.toFixed(2)}`);
      shown++;
    }
  }
}
