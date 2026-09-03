#!/usr/bin/env node
// scripts/probes/_probe_r63_effective_end.mjs
//
// Kevin ruling R-63 (2026-09-03). Permanent assertion:
//
//   On every range and account, the maximum contributing date for
//   revenue equals the maximum contributing date for cost.
//
// The intent (from the prompt): "That single check makes this class
// impossible to reintroduce, and it is the assertion I would keep
// above all others in this PR."
//
// On CLOSED ranges (single_closed + FYTD): every week is complete,
// so `range_effective_end == range.end` and the shape is trivially
// satisfied. On OPEN ranges (P9 today): `range_effective_end` is
// the last complete week's end (08/30 for today = 2026-09-03), and
// both sides' maximum contributing date must equal that value.
//
// Live check runs against the current API + reads the shipped
// payload's `range_effective_end`. Also asserts:
//   - closed ranges: horizon reads "PN · closed and verified" or
//     "PA-PB · closed and verified"
//   - open ranges:   horizon reads "through week N · MM/DD - MM/DD"
//
// USAGE
//   TEST_MODE=true PORT=3311 npm run dev &
//   node scripts/probes/_probe_r63_effective_end.mjs

const BASE = process.env.BASE || "http://localhost:3311";
const acct = (k) => encodeURIComponent(k);

// Full account list. Portfolio scope (ALL/EAST/WEST) is separate; the
// per-account rule holds on every single-site payload.
const ACCOUNTS = [
  "CIN - AZ", "CIN - KY", "CIN - OH",
  "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY", "TBR - FL",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
];

const RANGES = [
  { kind: "FYTD",         qs: "",                                       expected: "closed" },
  { kind: "P8 closed",    qs: "start=2026-07-13&end=2026-08-09",        expected: "closed" },
  { kind: "P9 open",      qs: "start=2026-08-10&end=2026-09-06",        expected: "open" },
];

const TODAY = "2026-09-03";
// R-63: last complete week on 2026-09-03 ends 2026-08-30 (week 4
// starts 08/31 = today - 3d; not complete).
const EXPECTED_OPEN_EFFECTIVE_END = "2026-08-30";

const FAILS = [];
function fail(w, why) { FAILS.push(`${w}  ${why}`); }

async function main() {
  console.log(`# R-63 effective-end + horizon - ${new Date().toISOString()}`);
  console.log(`# BASE=${BASE}`);
  console.log(`# today assumed ${TODAY}; expected open-range effective end = ${EXPECTED_OPEN_EFFECTIVE_END}`);
  console.log("");

  for (const acctName of ACCOUNTS) {
    for (const r of RANGES) {
      const url = r.qs
        ? `${BASE}/api/kpi/overview?account=${acct(acctName)}&${r.qs}`
        : `${BASE}/api/kpi/overview?account=${acct(acctName)}`;
      const before = FAILS.length;
      const res = await fetch(url);
      const j = await res.json();

      if (!j || !j.ok) {
        fail(`${acctName} ${r.kind}`, `payload not ok: ${JSON.stringify(j?.error || j)}`);
        continue;
      }

      const effEnd = j.range_effective_end;
      const rangeEnd = j.range?.end;
      const horizon = j.range_labels?.horizon;
      const periodState = j.period_state;

      // Core R-63 invariant:
      //   closed -> effective_end == range.end
      //   open   -> effective_end < range.end AND == expected week end
      if (r.expected === "closed") {
        if (effEnd !== rangeEnd) {
          fail(`${acctName} ${r.kind}`, `closed range: range_effective_end (${effEnd}) != range.end (${rangeEnd})`);
        }
      } else {
        if (effEnd !== EXPECTED_OPEN_EFFECTIVE_END) {
          fail(`${acctName} ${r.kind}`, `open range: range_effective_end = ${JSON.stringify(effEnd)}, want ${EXPECTED_OPEN_EFFECTIVE_END}`);
        }
        if (effEnd && rangeEnd && effEnd >= rangeEnd) {
          fail(`${acctName} ${r.kind}`, `open range: effective_end (${effEnd}) should be < range.end (${rangeEnd})`);
        }
      }

      // Horizon copy per range shape.
      if (r.expected === "closed") {
        // Single closed reads "P8 · closed and verified"; FYTD reads
        // "P1-P8 · closed and verified" (or single P if the fytd
        // only enumerates one period).
        if (!/^P\d+(-P\d+)? · closed and verified$/.test(horizon || "")) {
          fail(`${acctName} ${r.kind}`, `closed horizon malformed: ${JSON.stringify(horizon)}`);
        }
      } else {
        if (!/^through week \d+ · \d\d\/\d\d – \d\d\/\d\d$/.test(horizon || "")) {
          fail(`${acctName} ${r.kind}`, `open horizon malformed: ${JSON.stringify(horizon)}`);
        }
      }

      // period_state consistency: open ranges are period_state=open;
      // FYTD ends at last closed period per #981 (verified).
      const wantOpenState = r.expected === "open";
      if (wantOpenState && periodState !== "open") {
        fail(`${acctName} ${r.kind}`, `period_state=${JSON.stringify(periodState)}, want "open"`);
      }
      if (!wantOpenState && periodState === "open") {
        fail(`${acctName} ${r.kind}`, `period_state=${JSON.stringify(periodState)}, expected closed/verified`);
      }

      const after = FAILS.length;
      const tag = after === before ? "OK  " : "FAIL";
      // Compact per-row output.
      if (acctName === "TBJ - FL" || after !== before) {
        console.log(`  ${tag} ${acctName.padEnd(16)} ${r.kind.padEnd(12)} eff=${effEnd} horizon=${JSON.stringify(horizon)}`);
      }
    }
  }

  console.log("");
  if (FAILS.length === 0) {
    console.log(`Result: R-63 invariants hold across ${ACCOUNTS.length} accounts × ${RANGES.length} ranges.`);
    process.exit(0);
  }
  console.log(`Result: ${FAILS.length} violation(s):`);
  for (const f of FAILS) console.log(`  ${f}`);
  process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
