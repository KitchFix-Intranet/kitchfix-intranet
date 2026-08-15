// S5: identify catch ∩ p4 rows and confirm p4 wins (no double count).
import fs from "node:fs";
import { P } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase4/_common4.mjs";
import { P5, round2 } from "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase5/_common5.mjs";

const AUG = JSON.parse(fs.readFileSync(P.AUG, "utf8"));
const REC5 = JSON.parse(fs.readFileSync(P5.RECOVERED, "utf8"));
const REC4 = JSON.parse(fs.readFileSync(P.P4_RECOVERED_ROWS, "utf8"));
const CHANGE = JSON.parse(fs.readFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_change_log6.json", "utf8"));

const rowsById = new Map(AUG.rows.map(r => [r.id, r]));
const p4Ids = new Set(REC4.recovered.map(r => r.id));
const catchIds = new Set(REC5.catch_weight_reclassified_ids || []);
const inter = [...catchIds].filter(id => p4Ids.has(id));
console.log(`catch ∩ p4 rows: ${inter.length}`);

const p4LbByRow = new Map(REC4.recovered.map(r => [r.id, r.effective_weight_lb]));

const details = [];
for (const id of inter) {
  const r = rowsById.get(id);
  if (!r) continue;
  const up = Number(r.unit_price), ep = Number(r.extended_price);
  const catchLb = up && ep ? ep / up : null;
  const p4Lb = p4LbByRow.get(id);
  details.push({
    id: id.slice(0, 8),
    account: r.account_label,
    category: r.category,
    description: (r.description || "").slice(0, 40),
    ep,
    up,
    catch_candidate_lb: catchLb != null ? round2(catchLb) : null,
    p4_lb: p4Lb != null ? round2(p4Lb) : null,
    dpp_at_catch: catchLb ? round2(ep / catchLb) : null,
    dpp_at_p4: p4Lb ? round2(ep / p4Lb) : null,
  });
}

console.log("\nSide by side:");
console.log("id      | acct   | cat        | desc                                    |     ep |  up |  catch_lb |  p4_lb |  dpp@catch | dpp@p4");
for (const d of details) {
  console.log(`${d.id} | ${(d.account || '').padEnd(6)} | ${(d.category || '').padEnd(10)} | ${(d.description || '').padEnd(40)} | ${String(d.ep).padStart(6)} | ${String(d.up).padStart(4)} | ${String(d.catch_candidate_lb).padStart(9)} | ${String(d.p4_lb).padStart(6)} | ${String(d.dpp_at_catch).padStart(10)} | ${String(d.dpp_at_p4).padStart(6)}`);
}

// Check change_log for evidence any of these got double-counted
console.log("\nChange log entries for these ids (should show p4 wins):");
for (const id of inter) {
  const short = id.slice(0, 8);
  const entries = CHANGE.entries.filter(e => e.id === id);
  if (!entries.length) { console.log(`  ${short}: no change-log entry (unchanged from baseline)`); continue; }
  for (const e of entries) console.log(`  ${short}: rule=${e.rule}  before_lb=${e.before_lb}  after_lb=${e.after_lb}  before_src=${e.before_source}  after_src=${e.after_source}`);
}

fs.writeFileSync("/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts/_phase6/_s5_catch_p4.json", JSON.stringify({ count: inter.length, details }, null, 2));
