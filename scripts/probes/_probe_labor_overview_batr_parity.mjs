#!/usr/bin/env node
// Labor PR-A gate (Kevin ruling 2026-09-04): Labor's
// budget_at_this_revenue must equal the Overview's 3100
// budget_at_this_revenue - including null when Overview reports null.
//
// TWO TIERS, per Kevin's ruling after the SC-seeding audit:
//
//   HARD GATE (fails on any disagreement, cent-exact)
//     TBR - FL, TBJ - FL     · both closed ranges
//   These are the two accounts that train next week and the only two
//   with a trustworthy Service Calendar today. Kevin: "They are the
//   gate."
//
//   REPORTED (informational; no build failure)
//     Every other account EXCEPT TXR - TX - V
//   The Service Calendar is not yet seeded on these accounts. If Labor
//   and Overview disagree here it may be because the revenue basis is
//   incomplete, not because either board is wrong. Kevin: "A gate that
//   fails on unseeded data teaches people to ignore it - which is
//   exactly the failure mode we've already seen this session (drift
//   gate not required; sum-to-total that failed by design on hourly;
//   null-GL gate that would have fired on correct behaviour)."
//
//   EXCLUDED
//     TXR - TX - V           · Kevin ruling: out of scope entirely
//   Note the exclusion and its reason here so nobody reads it later
//   as an oversight.
//
// Assertion contract (option 2, never option 1): the gate asserts
// Labor MATCHES Overview's rule for that account, including null. If
// Overview reports null, Labor must report null. If Overview reports
// a figure, Labor must match to the cent. "Skip when it doesn't
// semantically make sense" is refused - a skipped account is an
// unchecked account.
//
// Item 8 assertion (Kevin ruling): running-period exclusion is what
// takes TBJ - FL from $365,398 to $341,586 - the change most likely
// to look like a bug. Asserted here explicitly: on a range spanning
// a running period, labor.board.closed_range_budget MUST be less
// than or equal to labor.board.range_budget (equal only when the
// requested range didn't happen to span the running period).

const BASE = "http://localhost:3399";

const HARD_GATE_ACCOUNTS = ["TBR - FL", "TBJ - FL"];
const REPORTED_ACCOUNTS = [
  "CIN - AZ", "CIN - KY", "CIN - OH", "STL - FL", "STL - MO",
  "TBJ - NY", "TXR - AZ", "TXR - TX - H",
];
const EXCLUDED_ACCOUNTS = {
  "TXR - TX - V": "Kevin ruling 2026-09-04: out of scope entirely",
};

const RANGES = [
  { name: "Last period (P8)", start: "2026-07-13", end: "2026-08-09" },
  { name: "FYTD (P1-P8)",     start: "",           end: ""            },
];

function fmt(n) { return n == null ? "null" : "$" + Number(n).toFixed(2); }

async function readBoards(account, range) {
  const qs = range.start
    ? `account=${encodeURIComponent(account)}&start=${range.start}&end=${range.end}`
    : `account=${encodeURIComponent(account)}`;
  const [laborRes, ovRes] = await Promise.all([
    fetch(`${BASE}/api/kpi/labor?${qs}&include_salary=1`),
    fetch(`${BASE}/api/kpi/overview?${qs}`),
  ]);
  const laborJson = laborRes.ok ? await laborRes.json() : null;
  const ovJson = ovRes.ok ? await ovRes.json() : null;
  const labor = laborJson?.board ?? null;
  const overviewRow = (ovJson?.statement_rows || []).find(r =>
    r.section === "cogs" && !r.parent_line_code && r.line_code === "3100"
  );
  return {
    labor,
    laborBatr: labor?.budget_at_this_revenue ?? null,
    closedRangeBudget: labor?.closed_range_budget ?? null,
    laborRangeBudget: labor?.range_budget ?? null,
    overviewBatr: overviewRow?.budget_at_this_revenue ?? null,
    overviewBilledBack: Array.isArray(overviewRow?.flags) && overviewRow.flags.includes("billed_back"),
    overviewInactive: Array.isArray(overviewRow?.flags) && overviewRow.flags.includes("inactive"),
  };
}

// ─── HARD GATE ─────────────────────────────────────────────────────

let hardFailures = 0;
console.log("# LABOR ↔ OVERVIEW batr parity gate  ·  2026-09-04\n");
console.log("## HARD GATE · TBR - FL + TBJ - FL · both closed ranges\n");
console.log("The two accounts that train next week and the only two with a trustworthy Service Calendar today.");
console.log("Cent-exact, no exceptions. Fails the build on any disagreement.\n");
console.log("| account | range | labor | overview | diff |");
console.log("|---|---|---:|---:|---:|");
for (const account of HARD_GATE_ACCOUNTS) {
  for (const range of RANGES) {
    const r = await readBoards(account, range);
    const diff = (r.laborBatr != null && r.overviewBatr != null)
      ? Math.abs(r.laborBatr - r.overviewBatr) : null;
    const bothNull = r.laborBatr == null && r.overviewBatr == null;
    const pass = bothNull || (diff != null && diff < 0.005);
    if (!pass) hardFailures++;
    console.log(`| ${account} | ${range.name} | ${fmt(r.laborBatr)} | ${fmt(r.overviewBatr)} | ${diff != null ? "$" + diff.toFixed(2) : "n/a"} | ${pass ? "PASS" : "**FAIL**"} |`);
  }
}
console.log(`\n**Hard-gate result: ${hardFailures === 0 ? "PASS" : `${hardFailures} FAILURES`}**`);

// ─── Item 8 explicit assertion ─────────────────────────────────────

console.log("\n## Item 8 explicit assertion · running-period exclusion\n");
console.log("Kevin ruling: 'This year is P1 through the last closed period. The running period renders");
console.log("hatched and does not enter the total.' The change most likely to look like a bug - assert");
console.log("it explicitly rather than letting it fall out of the range logic.\n");
console.log("On a range spanning a running period, board.closed_range_budget MUST be less than");
console.log("board.range_budget. Verified below on FYTD for the two hard-gate accounts (FYTD today");
console.log("includes P9 which is running).\n");
console.log("| account | range | labor.range_budget | labor.closed_range_budget | excluded correctly? |");
console.log("|---|---|---:|---:|---|");
let item8Failures = 0;
for (const account of HARD_GATE_ACCOUNTS) {
  const r = await readBoards(account, RANGES[1]);  // FYTD
  const excluded = r.closedRangeBudget != null && r.laborRangeBudget != null
    && r.closedRangeBudget < r.laborRangeBudget;
  if (!excluded) item8Failures++;
  console.log(`| ${account} | FYTD | ${fmt(r.laborRangeBudget)} | ${fmt(r.closedRangeBudget)} | ${excluded ? "YES" : "**NO**"} |`);
}
console.log(`\n**Item 8 assertion: ${item8Failures === 0 ? "PASS" : `${item8Failures} FAILURES`}**`);

// ─── REPORTED TIER ─────────────────────────────────────────────────

console.log("\n## REPORTED · other accounts · Service Calendar not yet seeded\n");
console.log("The Service Calendar is not yet seeded on these accounts. If Labor and Overview disagree,");
console.log("it may be because the revenue basis is incomplete rather than because either board is wrong.");
console.log("**Informational until seeded - not build failures.**\n");
console.log("| account | range | labor | overview | diff | note |");
console.log("|---|---|---:|---:|---:|---|");
for (const account of REPORTED_ACCOUNTS) {
  for (const range of RANGES) {
    const r = await readBoards(account, range);
    const diff = (r.laborBatr != null && r.overviewBatr != null)
      ? Math.abs(r.laborBatr - r.overviewBatr) : null;
    const bothNull = r.laborBatr == null && r.overviewBatr == null;
    const matches = bothNull || (diff != null && diff < 0.005);
    let note = "";
    if (r.overviewBilledBack) note = "overview: billed_back";
    else if (r.overviewInactive) note = "overview: inactive";
    else if (matches) note = "matches";
    else note = "SC not yet seeded";
    console.log(`| ${account} | ${range.name} | ${fmt(r.laborBatr)} | ${fmt(r.overviewBatr)} | ${diff != null ? "$" + diff.toFixed(2) : "n/a"} | ${note} |`);
  }
}

// ─── EXCLUSIONS ────────────────────────────────────────────────────

console.log("\n## EXCLUDED\n");
for (const [account, reason] of Object.entries(EXCLUDED_ACCOUNTS)) {
  console.log(`- **${account}** · ${reason}`);
}

console.log(`\n---\n\n**Overall: hard gate ${hardFailures === 0 ? "PASS" : "FAIL"} · item 8 ${item8Failures === 0 ? "PASS" : "FAIL"}**`);
process.exit((hardFailures + item8Failures) === 0 ? 0 : 1);
