// scripts/probes/_probe_overview_phase3_accounts.mjs
//
// Overview Phase 3 - Phase K "accounts touched at least once". For
// every account key + the three pseudo keys, hit /api/kpi/overview
// and record status + ok + load-time. Prints a table.
//
// Expects `next start -p 3299` with TEST_MODE=true already running
// (mirrors the screenshot probe's env).

const BASE = process.env.OVERVIEW_BASE || "http://localhost:3299";

const ACCOUNTS = [
  "CIN - AZ", "CIN - OH", "CIN - KY",
  "STL - FL", "STL - MO",
  "TBJ - FL", "TBJ - NY",
  "TBR - FL",
  "TXR - AZ", "TXR - TX - H", "TXR - TX - V",
  "ALL", "EAST", "WEST",
];

async function fetchOne(account) {
  const t = Date.now();
  const url = `${BASE}/api/kpi/overview?account=${encodeURIComponent(account)}&start=2026-08-10&end=2026-09-06`;
  try {
    const r = await fetch(url);
    const dur = Date.now() - t;
    const status = r.status;
    let body = null;
    try { body = await r.json(); } catch {}
    return {
      account,
      status,
      ok: !!(body?.ok),
      posture: body?.posture || null,
      periods_in_range: body?.range?.periods_in_range || null,
      revenue_actual: body?.cards?.find(c => c.key === "revenue")?.hero_actual ?? null,
      cogs_actual: body?.cards?.find(c => c.key === "cogs")?.hero_actual ?? null,
      dur_ms: dur,
    };
  } catch (e) {
    return { account, status: 0, ok: false, err: e?.message || String(e), dur_ms: Date.now() - t };
  }
}

const results = [];
for (const a of ACCOUNTS) {
  const r = await fetchOne(a);
  results.push(r);
}

console.log("\naccounts touched (14 total)");
console.log("=".repeat(90));
console.log("account".padEnd(17), "status".padEnd(7), "ok".padEnd(4), "posture".padEnd(11), "rev".padEnd(11), "cogs".padEnd(11), "ms");
console.log("-".repeat(90));
for (const r of results) {
  console.log(
    r.account.padEnd(17),
    String(r.status).padEnd(7),
    (r.ok ? "yes" : "no").padEnd(4),
    (r.posture || "-").padEnd(11),
    (r.revenue_actual != null ? "$" + Math.round(r.revenue_actual).toLocaleString() : "-").padEnd(11),
    (r.cogs_actual != null ? "$" + Math.round(r.cogs_actual).toLocaleString() : "-").padEnd(11),
    String(r.dur_ms),
  );
}
console.log("=".repeat(90));
const passCount = results.filter(r => r.ok).length;
console.log(`\nPass: ${passCount}/${results.length}`);
process.exit(passCount === results.length ? 0 : 1);
