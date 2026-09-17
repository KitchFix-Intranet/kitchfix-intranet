// R-114 item 1 · closed-period audit
//
// For each closed period P1-P8 on TBJ - FL and TBR - FL, compute
// whether the OLD GM pill anchor (percent-of-revenue vs plan ratio)
// disagrees with the footer anchor (dollar-actual vs adjusted).
//
// Hits local dev at http://localhost:3000. Requires TEST_MODE=true.
//
// Emits a table: account | P | gmActual | gmAdjusted | dollar-verdict |
// pct-actual | pct-plan | pct-verdict | contradiction

const BASE = "http://localhost:3000";
const ACCOUNTS = ["TBJ - FL", "TBR - FL"];
const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

function fmt(n) {
  if (n == null) return "—";
  return "$" + Math.round(Number(n)).toLocaleString("en-US");
}

async function fetchPayload(account, periodNo) {
  const url = `${BASE}/api/kpi/overview?account=${encodeURIComponent(account)}&range=period:${periodNo}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${account} P${periodNo} ${r.status}`);
  return await r.json();
}

function analyseOne(payload) {
  const gm = (payload.cards || []).find(c => c.key === "gross_margin");
  if (!gm) return null;
  const gmActual = gm.hero_actual;
  const gmAdjusted = gm.budget_at_this_revenue;
  const pctActual = gm.pct_of_revenue;
  const pctPlan = gm.target_pct_of_revenue;
  const dollarSign = (gmActual != null && gmAdjusted != null) ? Math.sign(gmActual - gmAdjusted) : 0;
  const pctSign = (pctActual != null && pctPlan != null) ? Math.sign(pctActual - pctPlan) : 0;
  const contradiction = (dollarSign !== 0 && pctSign !== 0 && dollarSign !== pctSign);
  return { gmActual, gmAdjusted, pctActual, pctPlan, dollarSign, pctSign, contradiction };
}

const rows = [];
for (const account of ACCOUNTS) {
  for (const p of PERIODS) {
    try {
      const payload = await fetchPayload(account, p);
      const a = analyseOne(payload);
      if (!a) continue;
      rows.push({ account, p, ...a });
    } catch (e) {
      console.error(`FAIL ${account} P${p}: ${e.message}`);
    }
  }
}

console.log("acct         P  gmActual   gmAdjusted dollarSays pctActual pctPlan pctSays    contradiction");
for (const r of rows) {
  const dollarSays = r.dollarSign > 0 ? "AHEAD" : r.dollarSign < 0 ? "BEHIND" : "—";
  const pctSays    = r.pctSign    > 0 ? "AHEAD" : r.pctSign    < 0 ? "BEHIND" : "—";
  const flag = r.contradiction ? "  ⚠ YES" : "";
  const pa = r.pctActual != null ? r.pctActual.toFixed(2) + "%" : "—";
  const pp = r.pctPlan   != null ? r.pctPlan.toFixed(2)   + "%" : "—";
  console.log(`${r.account.padEnd(10)} P${r.p}  ${fmt(r.gmActual).padStart(10)} ${fmt(r.gmAdjusted).padStart(10)} ${dollarSays.padEnd(10)} ${pa.padEnd(9)} ${pp.padEnd(7)} ${pctSays.padEnd(10)}${flag}`);
}

console.log("\ncontradictions:", rows.filter(r => r.contradiction).length, "of", rows.length);
