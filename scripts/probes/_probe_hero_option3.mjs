#!/usr/bin/env node
/**
 * Option 3 verification.
 *
 * Layer 1 - WEST FYTD reproduces with the new hero.
 * Layer 2 - closed periods DO NOT move a cent.
 * Layer 3 - live coherence: Bills + Cards + Pending = Hero.
 * Layer 4 - projected close on live now includes pending.
 * Layer 5 - captions on live are empty (nothing to reconstruct).
 * Layer 6 - #839 sign-gated captions closed still fire on closed.
 * Layer 7 - bucket + ledger unaffected (pending never enters).
 *
 * Inlines the resolver logic (board.js uses the Next `@/` alias which
 * Node can't resolve directly).  Update this file in the same commit
 * as board.js if the resolver's contract changes; otherwise this probe
 * drifts from source of truth.
 */
function fmt$(n) {
  const v = Number(n || 0);
  const abs = Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return v < 0 ? "-$" + abs : "$" + abs;
}
function moneyArrow(n) {
  const v = Number(n || 0);
  const glyph = v < 0 ? "▼" : "▲";
  return `${glyph} ${fmt$(Math.abs(v))}`;
}
function fmtPct(x) { return (Number(x || 0) * 100).toFixed(1) + "%"; }
function stateOf({ spent, budget, elapsedFrac, hasBills, isPassThrough, closed } = {}) {
  if (isPassThrough) return "passthru";
  if (!(budget > 0)) return "nobud";
  if (closed) return spent > budget ? "over" : "under";
  if (!hasBills) return "none";
  if (!(elapsedFrac > 0)) return "none";
  const pace = spent / (budget * elapsedFrac);
  if (pace > 1.03) return "over";
  if (pace < 0.97) return "under";
  return "onpace";
}
const PILL_COPY = {
  over:{tone:"r",label:"Over target"}, under:{tone:"g",label:"On target"},
  onpace:{tone:"b",label:"On pace"}, none:{tone:"n",label:"No spend"},
  nobud:{tone:"n",label:"No budget"}, passthru:{tone:"n",label:"Billed to client"},
};
function heroToneClass(state) {
  if (state === "over") return "r";
  if (state === "under" || state === "onpace") return "g";
  return "";
}
function resolveCardState(args) {
  const state = stateOf(args);
  const pill = PILL_COPY[state] || PILL_COPY.none;
  const spent = Number(args?.spent || 0);
  const budget = Number(args?.budget || 0);
  const variance = Math.round((spent - budget) * 100) / 100;
  let sign = 0; if (variance > 0.005) sign = 1; else if (variance < -0.005) sign = -1;
  let signClass = ""; if (sign > 0) signClass = "r"; else if (sign < 0) signClass = "g";
  return { state, pillTone: pill.tone, pillLabel: pill.label,
    heroClass: heroToneClass(state), variance, sign, signClass,
    spent, budget, closed: !!args?.closed };
}
function resolveCardDisplay(args) {
  const kind = args?.cardKind || "period";
  const spent = Number(args?.spent || 0);
  const budget = Number(args?.budget || 0);
  const pending = Number(args?.pending || 0);
  const closed = !!args?.closed;
  const isFutureRange = !!args?.isFutureRange;
  const isPassThrough = !!args?.isPassThrough;
  const tier = args?.tier || null;
  const adjusted = args?.adjusted;
  const budgetSpent = !!args?.budgetSpent;
  const includePendingInVerdict = kind === "period" && !closed;
  const resolverSpent = spent + (includePendingInVerdict ? pending : 0);
  const cs = resolveCardState({ ...args, spent: resolverSpent, hasBills: resolverSpent > 0 });
  const heroValue = resolverSpent;
  const heroValueText = fmt$(heroValue);
  const subLineOfBudgetText = fmt$(budget);
  const spentUsedFrac = budget > 0 ? (heroValue / budget) : null;
  const subLinePctText = (!isFutureRange && spentUsedFrac != null) ? fmtPct(spentUsedFrac) : "";
  const subLineNoBudgetText = (budget === 0 && !isFutureRange) ? "no budget" : "";
  const remRaw = budget - spent - (includePendingInVerdict ? pending : 0);
  const rem = Math.round(remRaw * 100) / 100;
  const showOverArrow = rem < 0;
  const showRemainingBlock = !isFutureRange && budget !== 0;
  const showFutureBudgetBlock = isFutureRange;
  const heroClassEffective = isFutureRange ? "" : (showOverArrow ? "r" : cs.heroClass);
  let remainingLabel = "", remainingValueText = "", remainingClass = "", remainingCaption = "";
  if (kind === "ledger") {
    remainingLabel = closed ? "Vs budget" : (showOverArrow ? "Over by" : "Remaining");
    remainingValueText = closed ? moneyArrow(cs.variance) : (showOverArrow ? fmt$(-rem) : fmt$(rem));
    remainingClass = closed ? (cs.signClass || (cs.variance > 0 ? "r" : "g")) : (showOverArrow ? "r" : "");
    remainingCaption = closed ? "period closed" : "every purchase below";
  } else if (kind === "bucket") {
    remainingLabel = closed ? "Vs budget" : (showOverArrow ? "Over by" : "Remaining");
    remainingValueText = closed ? moneyArrow(cs.variance) : (showOverArrow ? fmt$(-rem) : fmt$(rem));
    remainingClass = closed ? (cs.signClass || (cs.variance > 0 ? "r" : "g")) : (showOverArrow ? "r" : "");
    if (closed) remainingCaption = "period closed";
    else if (budgetSpent) remainingCaption = "budget spent";
    else if (tier === "C") remainingCaption = "no target this range";
    else if (adjusted != null) remainingCaption = `aim for ${fmt$(adjusted)} / wk`;
    else remainingCaption = "no target this range";
  } else {
    remainingLabel = closed ? "Vs budget" : (showOverArrow ? "Over by" : "Remaining");
    remainingValueText = closed ? moneyArrow(cs.variance) : (showOverArrow ? fmt$(-rem) : fmt$(rem));
    remainingClass = closed ? (cs.signClass || (cs.variance > 0 ? "r" : "g")) : (showOverArrow ? "r" : "");
    remainingCaption = closed ? "period closed" : "";
  }
  const serverProjectedClose = args?.projectedClose;
  const elapsedFrac = Number(args?.elapsedFrac || 0);
  const displayedProjectedClose = (kind === "period" && !closed
      && elapsedFrac > 0 && (spent + pending) > 0)
    ? Math.round(((spent + pending) / elapsedFrac) * 100) / 100
    : (serverProjectedClose != null ? Number(serverProjectedClose) : null);
  const showProjectedClose = kind === "period" && !isFutureRange && !closed && displayedProjectedClose != null;
  const pcOverBudget = showProjectedClose && displayedProjectedClose > budget;
  return {
    pillTone: cs.pillTone, pillLabel: cs.pillLabel,
    heroValueText, heroClass: heroClassEffective,
    subLineOfBudgetText, subLinePctText, subLineNoBudgetText,
    showRemainingBlock, showFutureBudgetBlock,
    remainingLabel, remainingValueText, remainingClass, remainingCaption,
    showProjectedClose,
    projectedCloseValueText: showProjectedClose ? fmt$(displayedProjectedClose) : "",
    projectedCloseValueClass: pcOverBudget ? "r" : "",
    projectedCloseArrow: showProjectedClose ? (pcOverBudget ? "▲ " : "▼ ") : "",
    projectedCloseDeltaText: showProjectedClose ? fmt$(Math.abs(displayedProjectedClose - budget)) : "",
    projectedCloseAnnotationClass: pcOverBudget ? "r" : "g",
    __cs: cs,
  };
}

let passed = 0, failed = 0;
function ok(name, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${name}${detail ? "  " + detail : ""}`); }
  else      { failed++; console.log(`  FAIL  ${name}${detail ? "  " + detail : ""}`); }
}

// ─── Layer 1 - WEST FYTD reproduces with the new hero ──────────────
console.log("=== Layer 1 - WEST FYTD reproduces with new hero ===\n");
{
  const west = resolveCardDisplay({
    cardKind: "period",
    spent: 1291869.13, budget: 1311698.97, pending: 25490.10,
    closed: false, elapsedFrac: 0.9837,
    projectedClose: 1313357.86,   // server: spent / elapsed_frac = 1291869.13 / 0.9837
  });
  ok("WEST FYTD hero = $1,317,359.23 (was $1,291,869.13)",
     west.heroValueText === "$1,317,359.23",
     `hero="${west.heroValueText}"`);
  ok("WEST FYTD hero colour red (matches over-by)",
     west.heroClass === "r", `class="${west.heroClass}"`);
  ok("WEST FYTD variance label = Over by",
     west.remainingLabel === "Over by", "");
  ok("WEST FYTD variance value = $5,660.26 (unchanged from #839)",
     west.remainingValueText === "$5,660.26",
     `value="${west.remainingValueText}"`);
  ok("WEST FYTD % used now reads off the new hero",
     west.subLinePctText === fmtPct(1317359.23 / 1311698.97),
     `pct="${west.subLinePctText}"  (100.4%)`);
  ok("WEST FYTD caption removed on live (no redundant text)",
     west.remainingCaption === "",
     `caption="${west.remainingCaption}"`);
  ok("WEST FYTD projected close now includes pending",
     west.projectedCloseValueText === fmt$(Math.round(((1291869.13 + 25490.10) / 0.9837) * 100) / 100),
     `pc="${west.projectedCloseValueText}"`);
}

// ─── Layer 2 - closed period must not move ──────────────────────────
console.log("\n=== Layer 2 - CLOSED period must not move a cent ===\n");
{
  const scenarios = [
    { name: "TBR-FL P8 closed under-budget", spent: 100000, budget: 120000, pending: 500, elapsedFrac: 1.0 },
    { name: "STL-FL P8 closed over-budget",  spent: 50000,  budget: 40000,  pending: 1500, elapsedFrac: 1.0 },
    { name: "TXR-TX-H P8 closed with 0 pending", spent: 90000, budget: 100000, pending: 0, elapsedFrac: 1.0 },
    { name: "ALL P8 closed",                 spent: 950000, budget: 1000000, pending: 2000, elapsedFrac: 1.0 },
    { name: "WEST P8 closed",                spent: 320000, budget: 340000, pending: 800, elapsedFrac: 1.0 },
    { name: "EAST P8 closed",                spent: 620000, budget: 660000, pending: 1200, elapsedFrac: 1.0 },
  ];
  for (const s of scenarios) {
    const d = resolveCardDisplay({
      cardKind: "period", spent: s.spent, budget: s.budget, pending: s.pending,
      closed: true, elapsedFrac: s.elapsedFrac,
    });
    // On a closed period the hero must equal fmt$(spent), NOT fmt$(spent+pending)
    ok(`${s.name}: hero = fmt$(spent) unchanged`,
       d.heroValueText === fmt$(s.spent),
       `hero="${d.heroValueText}" expected="${fmt$(s.spent)}"`);
    // Sub-line % must equal spent/budget, NOT (spent+pending)/budget
    ok(`${s.name}: %used = spent/budget unchanged`,
       d.subLinePctText === fmtPct(s.spent / s.budget), "");
    // Variance uses spent-budget, no pending
    const expectedVar = Math.round((s.spent - s.budget) * 100) / 100;
    const expectedText = fmt$(Math.abs(expectedVar)); // moneyArrow uses abs
    const gotAmount = d.remainingValueText.replace(/[▲▼\s]/g, "");
    ok(`${s.name}: variance = |spent-budget| unchanged`,
       gotAmount === expectedText,
       `got="${d.remainingValueText}" expected="${expectedText}"`);
    // Caption must be "period closed"
    ok(`${s.name}: caption = "period closed"`,
       d.remainingCaption === "period closed", "");
  }
}

// ─── Layer 3 - Bills + Cards + Pending = Hero on live ──────────────
console.log("\n=== Layer 3 - live sub-row coherence ===\n");
{
  // With hero = spent+pending, and spent = bills+cards, then
  // bills + cards + pending = hero.  Verify with a set of scenarios.
  const cases = [
    { bills: 800000, cards: 200000, pending: 25000 },
    { bills: 1500, cards: 30, pending: 0 },
    { bills: 0, cards: 12345.67, pending: 500 },
  ];
  for (const c of cases) {
    const spent = c.bills + c.cards;
    const d = resolveCardDisplay({
      cardKind: "period", spent, budget: spent * 1.2, pending: c.pending,
      closed: false, elapsedFrac: 0.5,
    });
    const heroNum = spent + c.pending;
    ok(`bills(${c.bills}) + cards(${c.cards}) + pending(${c.pending}) = hero(${fmt$(heroNum)})`,
       d.heroValueText === fmt$(heroNum),
       `hero="${d.heroValueText}"`);
  }
}

// ─── Layer 4 - projected close includes pending on live ────────────
console.log("\n=== Layer 4 - projected close includes pending on live ===\n");
{
  const d = resolveCardDisplay({
    cardKind: "period",
    spent: 100000, budget: 200000, pending: 5000,
    closed: false, elapsedFrac: 0.5,
    projectedClose: 200000,  // server: 100000 / 0.5
  });
  // Expected: (100000 + 5000) / 0.5 = 210000
  ok("projected close on live = (spent+pending) / elapsed_frac",
     d.projectedCloseValueText === "$210,000.00",
     `pc="${d.projectedCloseValueText}"`);
}

// ─── Layer 5 - captions on live period are empty ────────────────────
console.log("\n=== Layer 5 - captions on live period ===\n");
{
  const under = resolveCardDisplay({ cardKind: "period", spent: 500, budget: 1200, pending: 100, closed: false, elapsedFrac: 0.5 });
  const over  = resolveCardDisplay({ cardKind: "period", spent: 1200, budget: 1000, pending: 50, closed: false, elapsedFrac: 0.9 });
  ok("live under-budget caption is empty (was 'net of pending')",
     under.remainingCaption === "", `got="${under.remainingCaption}"`);
  ok("live over-budget caption is empty (was 'includes uncoded pending')",
     over.remainingCaption === "", `got="${over.remainingCaption}"`);
}

// ─── Layer 6 - closed captions still fire ──────────────────────────
console.log("\n=== Layer 6 - closed caption = 'period closed' still fires ===\n");
{
  const d = resolveCardDisplay({ cardKind: "period", spent: 800, budget: 1000, pending: 100, closed: true });
  ok("closed period caption = 'period closed'",
     d.remainingCaption === "period closed", "");
}

// ─── Layer 7 - bucket + ledger unaffected ──────────────────────────
console.log("\n=== Layer 7 - bucket + ledger unaffected (pending never enters) ===\n");
{
  const bucket = resolveCardDisplay({
    cardKind: "bucket", spent: 100000, budget: 150000, pending: 999999,
    closed: false, elapsedFrac: 0.5, tier: "A", adjusted: 5000,
  });
  ok("bucket hero = fmt$(spent) - pending prop ignored",
     bucket.heroValueText === fmt$(100000),
     `hero="${bucket.heroValueText}"`);

  const ledger = resolveCardDisplay({
    cardKind: "ledger", spent: 5000, budget: 8000, pending: 999999,
    closed: false, elapsedFrac: 0.5,
  });
  ok("ledger hero = fmt$(spent) - pending prop ignored",
     ledger.heroValueText === fmt$(5000),
     `hero="${ledger.heroValueText}"`);
}

console.log(`\nresult: ${passed} passed / ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
