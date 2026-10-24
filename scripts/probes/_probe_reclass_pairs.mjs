// Sweep the prior audit's variance list for offsetting pairs.
// A reclass leaves two accounts with roughly equal absolute deltas
// in opposite directions, same period, same kind. Report every pair
// where |delta_a + delta_b| < $1 AND both are significant (>$100).

import fs from "node:fs";

const MATRIX = JSON.parse(fs.readFileSync("/tmp/pnl_matrix.json", "utf8"));

// Kevin's specific hypothesis: TXR - TX - H P5 -$925.01 vs
// CIN - AZ P5 +$925.02. Confirm to the cent.
function get(acct, per, kind) {
  const row = MATRIX.find(r => r.account === acct && r.period === per);
  if (!row) return null;
  return kind === "hourly" ? row.delta_hourly : row.delta_salary;
}
console.log("=== Kevin's P5 hypothesis ===");
console.log(`  TXR - TX - H P5 hourly delta: ${get("TXR - TX - H", "P5", "hourly")}`);
console.log(`  CIN - AZ    P5 hourly delta: ${get("CIN - AZ", "P5", "hourly")}`);
const sum = (get("TXR - TX - H", "P5", "hourly") ?? 0) + (get("CIN - AZ", "P5", "hourly") ?? 0);
console.log(`  sum:                          ${Math.round(sum * 100) / 100}  (near-zero = matched reclass)`);

// Full sweep: for every (period, kind), find offsetting pairs where
// |delta_a + delta_b| < $1 AND both |delta| >= $100.
console.log("\n=== Offsetting pair sweep (both |delta| >= $100 AND |sum| < $1) ===");
const byPerKind = new Map();
for (const r of MATRIX) {
  for (const kind of ["hourly", "salary"]) {
    const d = kind === "hourly" ? r.delta_hourly : r.delta_salary;
    if (d == null || Math.abs(d) < 100) continue;
    const key = `${r.period}|${kind}`;
    const arr = byPerKind.get(key) || [];
    arr.push({ acct: r.account, delta: d });
    byPerKind.set(key, arr);
  }
}
for (const [key, arr] of byPerKind) {
  const [period, kind] = key.split("|");
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const s = arr[i].delta + arr[j].delta;
      if (Math.abs(s) < 1) {
        console.log(`  ${period} ${kind}:  ${arr[i].acct} ${arr[i].delta.toFixed(2)}  <->  ${arr[j].acct} ${arr[j].delta.toFixed(2)}  (sum ${s.toFixed(2)})`);
      }
    }
  }
}

// Loosen tolerance: also print pairs with |sum| < $10 (near-match)
console.log("\n=== Near-match pairs ($1 <= |sum| < $10) - not strict reclass but suggestive ===");
for (const [key, arr] of byPerKind) {
  const [period, kind] = key.split("|");
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      const s = arr[i].delta + arr[j].delta;
      const abs = Math.abs(s);
      if (abs >= 1 && abs < 10) {
        console.log(`  ${period} ${kind}:  ${arr[i].acct} ${arr[i].delta.toFixed(2)}  <->  ${arr[j].acct} ${arr[j].delta.toFixed(2)}  (sum ${s.toFixed(2)})`);
      }
    }
  }
}
