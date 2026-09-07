#!/usr/bin/env node
// Kevin post-1060 sweep · Overview cards variance footer (2026-09-09).
// Render of record: docs/renders/overview-cards-variance-footer.html.
//
// Six combinations: TBJ - FL and TBR - FL × Last period / This year /
// This period. For each, print what each of the three cards renders
// under the new grammar: Actual $/%, Target $/%, pill state, and the
// variance footer (label, arrow, dollars, colour). This period gets
// no footer (no target).
//
// Acceptance:
//   1. Revenue pill drops its dollar prefix - reads state words only
//   2. Margin pill drops its percent - reads "ahead of target"/"behind target"
//   3. Cost pill unchanged - "over budget"/"under budget"
//   4. All three cards carry a variance footer when a target exists
//   5. No footer on This period (pill.tone === "neutral")
//   6. Margin arrow inverts colour vs cost: cost over = bad red ▲,
//      margin over = good green ▲

const BASE = "http://localhost:3000";
const HEADERS = { "x-test-user": "kevin@kitchfix.com" };

async function fetchOv(acct, start, end) {
  const url = `${BASE}/api/kpi/overview?account=${encodeURIComponent(acct)}&start=${start}&end=${end}`;
  const r = await fetch(url, { headers: HEADERS });
  return r.json();
}

function fmt$(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  const n = Number(v);
  return (n < 0 ? "-$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");
}

function derive(card, kind) {
  const tone = card?.pill?.tone;
  // R-92 (2026-09-09): cost + margin pills go "wait" tone on TP
  // single-open. Client HOLD path renders no footer regardless.
  // Revenue on TP renders a confirmed-weeks caption in place of the
  // footer. Both surface no footer.
  if (tone === "neutral" || tone === "wait") return { hasFoot: false };
  if (kind === "revenue" && card?.confirmed_weeks_count != null) return { hasFoot: false };
  let delta;
  if (kind === "revenue") {
    delta = card?.delta_dollars;
  } else {
    const a = card?.hero_actual;
    const t = card?.budget_at_this_revenue;
    if (a == null || t == null) return { hasFoot: false };
    delta = Number(a) - Number(t);
  }
  if (delta == null || !Number.isFinite(Number(delta)) || Math.abs(Number(delta)) < 1) return { hasFoot: false };
  const positive = Number(delta) > 0;
  const arrow = positive ? "▲" : "▼";
  let label, dir;
  if (kind === "cogs") { label = positive ? "Over target" : "Under target"; dir = positive ? "bad" : "good"; }
  else if (kind === "gross_margin") { label = positive ? "Ahead of target" : "Behind target"; dir = positive ? "good" : "bad"; }
  else { label = positive ? "Above projection" : "Below projection"; dir = positive ? "good" : "bad"; }
  return {
    hasFoot: true,
    footLabel: label,
    arrow,
    amount: fmt$(Math.abs(delta)),
    colour: dir === "good" ? "green" : "red",
  };
}

const RANGES = [
  { key: "LP", label: "Last period", start: "2026-08-10", end: "2026-09-06" },
  { key: "TY", label: "This year", start: "2025-12-29", end: "2026-10-04" },
  { key: "TP", label: "This period", start: "2026-09-07", end: "2026-10-04" },
];

let failures = 0;
function assert(cond, msg) {
  const mark = cond ? "  PASS" : "  FAIL";
  console.log(`${mark}  ${msg}`);
  if (!cond) failures += 1;
  return cond;
}

for (const acct of ["TBJ - FL", "TBR - FL"]) {
  console.log(`\n## ${acct}`);
  for (const range of RANGES) {
    console.log(`\n### ${range.label} (${range.start} - ${range.end})`);
    const ov = await fetchOv(acct, range.start, range.end);
    const cards = ov.cards || [];
    const revenue = cards.find(c => c.key === "revenue");
    const cogs = cards.find(c => c.key === "cogs");
    const gm = cards.find(c => c.key === "gross_margin");

    for (const [card, kind, label] of [
      [revenue, "revenue", "Revenue"],
      [cogs, "cogs", "Cost of goods"],
      [gm, "gross_margin", "Gross margin"],
    ]) {
      if (!card) { console.log(`  ${label}: missing`); continue; }
      const foot = derive(card, kind);
      const pill = card.pill;
      console.log(`  ${label}:`);
      console.log(`    Actual  ${fmt$(card.hero_actual)}   ${card.pct_of_revenue_display || "—"}`);
      if (kind !== "revenue") {
        console.log(`    Target  ${fmt$(card.budget_at_this_revenue)}   ${card.target_pct_display || "—"}`);
      } else {
        console.log(`    Projection  ${fmt$(card.budget_to_date)}`);
      }
      console.log(`    Pill:   "${pill?.label || "—"}" (${pill?.tone || "—"})`);
      if (foot.hasFoot) {
        console.log(`    Foot:   ${foot.footLabel}   ${foot.arrow} ${foot.amount}   [${foot.colour}]`);
      } else {
        console.log(`    Foot:   (none)`);
      }
    }

    // Acceptance assertions for this combo.
    // Revenue pill: no leading dollar figure. State words only.
    if (revenue && revenue.pill?.label) {
      const label = revenue.pill.label;
      assert(!/^\$/.test(label), `revenue pill has no leading dollar figure ("${label}")`);
    }
    // Margin pill: no percent figure. State words only.
    if (gm && gm.pill?.label) {
      const label = gm.pill.label;
      assert(!/\d+(\.\d+)?%/.test(label), `margin pill has no percent figure ("${label}")`);
    }
    // Kevin ratification post-#1061 (2026-09-09). Drops the earlier
    // "if cost and margin variances come out equal, one is being
    // derived from the other" diagnostic - it false-alarms on any
    // R-77-consistent implementation because margin_var = -(cost_var)
    // is algebra (t·rev - cost = -(cost - t·rev)), not derivation.
    // Replaces with the invariant that actually matters: the two
    // target percents must sum to 100%. Fails loudly if either
    // target drifts.
    if (cogs?.target_pct_of_revenue != null && gm?.target_pct_of_revenue != null) {
      const sum = Number(cogs.target_pct_of_revenue) + Number(gm.target_pct_of_revenue);
      const delta = Math.abs(sum - 100);
      assert(delta < 0.05, `cost target ${cogs.target_pct_of_revenue.toFixed(2)}% + margin target ${gm.target_pct_of_revenue.toFixed(2)}% = ${sum.toFixed(2)}% (must sum to 100%)`);
    }
    // TP → no footer on any card.
    if (range.key === "TP") {
      for (const [card, kind, label] of [[revenue, "revenue", "Revenue"], [cogs, "cogs", "Cost"], [gm, "gross_margin", "Margin"]]) {
        if (!card) continue;
        const foot = derive(card, kind);
        assert(!foot.hasFoot, `${label} · TP has no footer`);
      }
    }
    // LP + TY: cost footer + margin footer both fire when both have real targets.
    if (range.key === "LP" || range.key === "TY") {
      if (cogs && cogs.delta_dollars != null && cogs.pill?.tone !== "neutral") {
        const foot = derive(cogs, "cogs");
        assert(foot.hasFoot, `Cost · ${range.label} has a footer`);
      }
      if (gm && gm.delta_dollars != null && gm.pill?.tone !== "neutral") {
        const foot = derive(gm, "gross_margin");
        assert(foot.hasFoot, `Margin · ${range.label} has a footer`);
      }
    }
  }
}

console.log(`\n## Summary: ${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
