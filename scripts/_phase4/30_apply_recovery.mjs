// Phase 4 - APPLY recovery. Combines Path A (cross-account borrowing) +
// Path B (bacon invoice reads) + Path C (top-unresolved TBJ-FL invoice reads)
// into a single _recovered_rows.json that maps row-id -> effective weight +
// provenance tag.
//
// Recovery rules per Path:
//
//   Path A (cross-account catalog_lookup):
//     - Direct application from _path_a_borrows.json. Effective weight = the
//       borrowed_effective_weight_lb (already category-plausibility gated).
//     - Tag: parsed_weight_source_p4 = 'catalog_lookup:cross_account'.
//
//   Path B (bacon invoice reads):
//     - For each read with total_lb_per_case > 0 AND confidence >= 70:
//       - if shipped_weight_lb present + > 0: use shipped_weight_lb directly.
//       - else: effective_weight_lb = total_lb_per_case * (qty_used || 1).
//     - Sanity-gate: implied $/lb must be within [category_bounds_low * 0.5, category_bounds_high * 2].
//     - Tag: parsed_weight_source_p4 = 'invoice_image_verified:pack_size'.
//     - If sanity-fail: reject, log to conflict list.
//
//   Path C (top-unresolved invoice reads):
//     - Same rules as Path B.
//     - Additional gate: reject reads where pack_size_verbatim matches Sysco
//       OCR-shorthand patterns that the vision model can't disambiguate:
//         ^\d{3,}\s*LB$ (e.g. "410 LB", "115LB") - Sysco fused-slash pack shape
//       UNLESS shipped_weight_lb is present.
//     - Rationale: "410 LB" could be verbatim "410 LB" (a huge case) OR
//       "4/10 LB" (=40 lb). Without the shipped weight, we cannot disambiguate.
//       Since the invoice showed the pack column with the shape and no shipped
//       total, we lack the doc evidence for a specific number. LEAVE UNRESOLVED.
//     - Tag: parsed_weight_source_p4 = 'invoice_image_verified:shipped_weight'
//       or 'invoice_image_verified:pack_size'.
//
// Output: _recovered_rows.json with array of {id, effective_weight_lb, tag, source_notes}.

import fs from "node:fs";
import { P, CATEGORY_DPLB_BOUNDS, assignProteinType, loadAugmented, round1, round2 } from "./_common4.mjs";

const AUG = loadAugmented();
const AUG_BY_ID = new Map(AUG.rows.map((r) => [r.id, r]));
const PATH_A = JSON.parse(fs.readFileSync(P.P4_PATH_A, "utf8"));
const PATH_B = JSON.parse(fs.readFileSync(P.P4_PATH_B, "utf8"));
const PATH_C = JSON.parse(fs.readFileSync(P.P4_PATH_C, "utf8"));

const recovered = new Map(); // id -> {effective_weight_lb, tag, source_notes, path, ep, dpp, category}
const rejects = { path_a: 0, path_b: [], path_c: [] };

// -----------------------------------------------------------------------
// Path A
// -----------------------------------------------------------------------
for (const b of PATH_A.apply_log) {
  recovered.set(b.id, {
    id: b.id,
    effective_weight_lb: b.borrowed_effective_weight_lb,
    tag: "catalog_lookup:cross_account",
    path: "A",
    source_notes: `donors=${b.donors} across ${b.donor_accounts.join(",")}, med_lb_per_qty=${b.borrowed_lb_per_qty}`,
    implied_dpp: b.implied_dpp,
    category: b.category,
    account: b.account,
    ep: b.extended_price,
  });
}

// -----------------------------------------------------------------------
// Helper: sanity gate a candidate recovery
// -----------------------------------------------------------------------
function sanityCheck(row, effLb) {
  const ep = Number(row.extended_price);
  if (!ep || ep <= 0) return { ok: false, reason: "no_ep" };
  if (!effLb || effLb <= 0) return { ok: false, reason: "no_eff_lb" };
  const dpp = ep / effLb;
  const cat = String(row.category || "").toLowerCase();
  const bounds = CATEGORY_DPLB_BOUNDS[cat];
  if (!bounds) return { ok: true, dpp, reason: "no_bounds_pass" };
  if (dpp < bounds[0] * 0.5 || dpp > bounds[1] * 2) return { ok: false, dpp, reason: `dpp_${round2(dpp)}_out_of_${bounds[0]}_${bounds[1]}` };
  return { ok: true, dpp };
}

// -----------------------------------------------------------------------
// Path B: bacon invoice reads
// -----------------------------------------------------------------------
for (const inv of PATH_B.results) {
  if (inv.error) continue;
  for (const read of (inv.reads || [])) {
    const line = inv.lines?.[read.line_index - 1];
    if (!line) continue;
    const row = AUG_BY_ID.get(line.id);
    if (!row) continue;
    // Path D: plant_or_egg category will not resolve to pounds (report only)
    if (assignProteinType(row.description) === "plant_or_egg") continue;
    if (recovered.has(row.id)) continue; // Path A already covered
    const conf = Number(read.confidence || 0);
    if (conf < 70) {
      rejects.path_b.push({ id: row.id, why: `conf_${conf}`, pack_verbatim: read.pack_size_verbatim });
      continue;
    }
    let effLb = null;
    let notes = "";
    if (read.shipped_weight_lb != null && Number(read.shipped_weight_lb) > 0) {
      effLb = Number(read.shipped_weight_lb);
      notes = `shipped_weight_lb=${effLb}`;
    } else if (read.total_lb_per_case != null && Number(read.total_lb_per_case) > 0) {
      const qty = Number(row.qty_used) || 1;
      effLb = Number(read.total_lb_per_case) * qty;
      notes = `total_lb_per_case=${read.total_lb_per_case} * qty=${qty}`;
    } else {
      rejects.path_b.push({ id: row.id, why: "no_weight_read", pack_verbatim: read.pack_size_verbatim });
      continue;
    }
    const check = sanityCheck(row, effLb);
    if (!check.ok) {
      rejects.path_b.push({ id: row.id, why: `sanity:${check.reason}`, effLb, pack_verbatim: read.pack_size_verbatim });
      continue;
    }
    recovered.set(row.id, {
      id: row.id,
      effective_weight_lb: round1(effLb),
      tag: read.shipped_weight_lb != null && Number(read.shipped_weight_lb) > 0
        ? "invoice_image_verified:shipped_weight"
        : "invoice_image_verified:pack_size",
      path: "B",
      source_notes: notes + ` conf=${conf} vision_pack="${read.pack_size_verbatim}"`,
      implied_dpp: round2(check.dpp),
      category: row.category,
      account: row.account_label,
      ep: Number(row.extended_price),
    });
  }
}

// -----------------------------------------------------------------------
// Path C: top-unresolved TBJ-FL invoice reads
// -----------------------------------------------------------------------
const SYSCO_AMBIGUOUS_RE = /^\d{3,}\s*LB\s*$/i; // "410 LB", "115LB", "610LB" - Sysco fused-slash shape

for (const inv of PATH_C.results) {
  if (inv.error) continue;
  for (const read of (inv.reads || [])) {
    const line = inv.lines?.[read.line_index - 1];
    if (!line) continue;
    const row = AUG_BY_ID.get(line.id);
    if (!row) continue;
    // Path D: plant_or_egg category will not resolve to pounds (report only)
    if (assignProteinType(row.description) === "plant_or_egg") continue;
    if (recovered.has(row.id)) continue;
    const conf = Number(read.confidence || 0);
    if (conf < 70) {
      rejects.path_c.push({ id: row.id, why: `conf_${conf}`, pack_verbatim: read.pack_size_verbatim });
      continue;
    }
    // Sysco fused-slash pack shape: if shipped_weight_lb is not present, do NOT trust total_lb.
    const vpack = String(read.pack_size_verbatim || "").trim();
    const isSyscoFused = SYSCO_AMBIGUOUS_RE.test(vpack);
    let effLb = null;
    let notes = "";
    if (read.shipped_weight_lb != null && Number(read.shipped_weight_lb) > 0) {
      effLb = Number(read.shipped_weight_lb);
      notes = `shipped_weight_lb=${effLb} (invoice-printed TOT WT)`;
    } else if (isSyscoFused) {
      rejects.path_c.push({ id: row.id, why: `sysco_fused_pack_no_shipped_weight`, pack_verbatim: vpack });
      continue;
    } else if (read.total_lb_per_case != null && Number(read.total_lb_per_case) > 0) {
      const qty = Number(row.qty_used) || 1;
      effLb = Number(read.total_lb_per_case) * qty;
      notes = `total_lb_per_case=${read.total_lb_per_case} * qty=${qty}`;
    } else {
      rejects.path_c.push({ id: row.id, why: "no_weight_read", pack_verbatim: vpack });
      continue;
    }
    const check = sanityCheck(row, effLb);
    if (!check.ok) {
      rejects.path_c.push({ id: row.id, why: `sanity:${check.reason}`, effLb: round1(effLb), pack_verbatim: vpack });
      continue;
    }
    recovered.set(row.id, {
      id: row.id,
      effective_weight_lb: round1(effLb),
      tag: read.shipped_weight_lb != null && Number(read.shipped_weight_lb) > 0
        ? "invoice_image_verified:shipped_weight"
        : "invoice_image_verified:pack_size",
      path: "C",
      source_notes: notes + ` conf=${conf} vision_pack="${vpack}"`,
      implied_dpp: round2(check.dpp),
      category: row.category,
      account: row.account_label,
      ep: Number(row.extended_price),
    });
  }
}

// -----------------------------------------------------------------------
// Summary
// -----------------------------------------------------------------------
const byPath = { A: [], B: [], C: [] };
for (const r of recovered.values()) byPath[r.path].push(r);

const byAccount = {};
const perAccountPerType = {};
for (const r of recovered.values()) {
  byAccount[r.account] = byAccount[r.account] || { rows: 0, spend: 0, lbs: 0 };
  byAccount[r.account].rows += 1;
  byAccount[r.account].spend += r.ep;
  byAccount[r.account].lbs += r.effective_weight_lb;
  const row = AUG_BY_ID.get(r.id);
  const t = assignProteinType(row?.description);
  const cat = String(row?.category || "").toLowerCase();
  if (cat === "protein") {
    perAccountPerType[r.account] = perAccountPerType[r.account] || {};
    perAccountPerType[r.account][t] = perAccountPerType[r.account][t] || { rows: 0, spend: 0, lbs: 0 };
    perAccountPerType[r.account][t].rows += 1;
    perAccountPerType[r.account][t].spend += r.ep;
    perAccountPerType[r.account][t].lbs += r.effective_weight_lb;
  }
}
for (const a of Object.keys(byAccount)) {
  byAccount[a].spend = round2(byAccount[a].spend);
  byAccount[a].lbs = round1(byAccount[a].lbs);
}
for (const a of Object.keys(perAccountPerType)) {
  for (const t of Object.keys(perAccountPerType[a])) {
    perAccountPerType[a][t].spend = round2(perAccountPerType[a][t].spend);
    perAccountPerType[a][t].lbs = round1(perAccountPerType[a][t].lbs);
  }
}

const out = {
  summary: {
    total_recovered: recovered.size,
    by_path: {
      A: { rows: byPath.A.length, spend: round2(byPath.A.reduce((s, r) => s + r.ep, 0)), lbs: round1(byPath.A.reduce((s, r) => s + r.effective_weight_lb, 0)) },
      B: { rows: byPath.B.length, spend: round2(byPath.B.reduce((s, r) => s + r.ep, 0)), lbs: round1(byPath.B.reduce((s, r) => s + r.effective_weight_lb, 0)) },
      C: { rows: byPath.C.length, spend: round2(byPath.C.reduce((s, r) => s + r.ep, 0)), lbs: round1(byPath.C.reduce((s, r) => s + r.effective_weight_lb, 0)) },
    },
    by_account: byAccount,
    per_account_per_protein_type: perAccountPerType,
    rejects: {
      path_b: rejects.path_b.length,
      path_c: rejects.path_c.length,
    },
  },
  recovered: [...recovered.values()],
  rejects,
};

fs.writeFileSync(P.P4_RECOVERED_ROWS, JSON.stringify(out, null, 2));
console.log(`[4-apply] recovered ${recovered.size} rows total (A=${byPath.A.length} B=${byPath.B.length} C=${byPath.C.length})`);
console.log(`[4-apply] spend=$${out.summary.by_path.A.spend + out.summary.by_path.B.spend + out.summary.by_path.C.spend}`);
console.log(`[4-apply] by account:`);
for (const [a, v] of Object.entries(byAccount)) console.log(`   ${a}: ${v.rows} rows / $${v.spend} / ${v.lbs} lb`);
console.log(`[4-apply] per account per PROTEIN type:`);
for (const [a, byType] of Object.entries(perAccountPerType)) {
  console.log(`   ${a}:`);
  for (const [t, v] of Object.entries(byType)) console.log(`      ${t}: ${v.rows} rows / $${v.spend} / ${v.lbs} lb`);
}
console.log(`[4-apply] rejects: path_b=${rejects.path_b.length} path_c=${rejects.path_c.length}`);
console.log(`[4-apply] wrote ${P.P4_RECOVERED_ROWS}`);
