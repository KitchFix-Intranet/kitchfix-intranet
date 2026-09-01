#!/usr/bin/env node
// scripts/probes/_probe_f11_cold_lambda_repro.mjs
//
// F-11 item 1 - cold-lambda reproduction. Read-only from the client's
// perspective (only issues GET requests; the route is READ-only).
//
// PURPOSE
//   The F-11 timeout guard shipped in #933 turns 500s into a fallback
//   surface. That means the failure mode we were catching is no longer
//   visible to the operator - which is correct in the short term but
//   removes the diagnostic signal. This probe puts the signal back.
//
//   Hit the purchasing route N times with spacing. Record client-
//   observed status + total_ms per request. Kevin greps Vercel
//   runtime logs for [F-11-timing] and [F-11] to see:
//     - which loader was slowest per request
//     - whether the F-11 timeout guard fired
//     - whether either of the two view-reading loaders (loadReport
//       OnlyPending, loadCardCharges) was in the near-guard band
//   Cross-reference the client-observed timing with the log line to
//   attribute each slow request to its slowest loader.
//
// USAGE
//   Local (TEST_MODE bypass, warms fast so mainly a smoke test):
//     node scripts/probes/_probe_f11_cold_lambda_repro.mjs \
//       --url=http://localhost:3311/api/kpi/purchasing \
//       --account=ALL --range=fytd \
//       --count=5 --spacing-ms=1000
//
//   Production (needs a session cookie; TEST_MODE has no effect there):
//     COOKIE='next-auth.session-token=...' \
//     node scripts/probes/_probe_f11_cold_lambda_repro.mjs \
//       --url=https://<vercel-url>/api/kpi/purchasing \
//       --account=ALL --range=fytd \
//       --count=10 --spacing-ms=900000
//
//   The default spacing (900,000 ms = 15 min) is chosen to exceed
//   Vercel's typical lambda warm window. For a run of 10 that's 2.5h.
//   Reduce for testing; keep at ~15min for the real cold-lambda repro.
//
// OUTPUT
//   Streaming per-request: status, total_ms, cold_hint (first request
//   only, since we can't distinguish cold vs warm from the client),
//   plus a summary at the end: N requests, X passed, Y 500s, Z >5s.

const args = new Map();
for (const a of process.argv.slice(2)) {
  if (a.startsWith("--")) {
    const [k, v] = a.slice(2).split("=");
    args.set(k, v ?? true);
  }
}
const URL_BASE = args.get("url") || "http://localhost:3311/api/kpi/purchasing";
const ACCOUNT = args.get("account") || "ALL";
const RANGE = args.get("range") || "fytd";
const COUNT = Number(args.get("count") || 5);
const SPACING_MS = Number(args.get("spacing-ms") || 1000);
const COOKIE = process.env.COOKIE || null;

// Range translation. FYTD: 2025-12-29 -> today. P8: 2026-07-13 -> 2026-08-09.
function rangeToParams(range) {
  const today = new Date().toISOString().slice(0, 10);
  if (range === "fytd") return { start: "2025-12-29", end: today };
  if (range === "p8") return { start: "2026-07-13", end: "2026-08-09" };
  if (range === "p9") return { start: "2026-08-10", end: "2026-09-06" };
  throw new Error(`unknown range: ${range}`);
}
const rp = rangeToParams(RANGE);
const url = `${URL_BASE}?account=${encodeURIComponent(ACCOUNT)}&start=${rp.start}&end=${rp.end}`;

function fmtMs(ms) { return `${String(ms).padStart(6)}ms`; }
function fmtTs() { return new Date().toISOString().slice(11, 23); }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function hit(i, urlStr) {
  const t0 = Date.now();
  const headers = { Accept: "application/json" };
  if (COOKIE) headers.Cookie = COOKIE;
  try {
    const r = await fetch(urlStr, { headers });
    const ms = Date.now() - t0;
    const ok = r.ok;
    let bodySnip = "";
    if (!ok) {
      const txt = await r.text().catch(() => "");
      bodySnip = ` body=${txt.slice(0, 160).replace(/\s+/g, " ")}`;
    } else {
      // Successful shape: peek at freshness so we can tell whether the
      // F-11 guard fired without needing Vercel log access.
      try {
        const j = await r.json();
        const uf = j?.freshness?.report_only_unavailable === true;
        if (uf) bodySnip = ` report_only_unavailable=true`;
      } catch {}
    }
    return { i, status: r.status, ok, ms, note: bodySnip };
  } catch (e) {
    const ms = Date.now() - t0;
    return { i, status: 0, ok: false, ms, note: ` THROWN: ${e.message}` };
  }
}

async function main() {
  console.log(`# F-11 cold-lambda repro - ${new Date().toISOString()}`);
  console.log(`# url:      ${url}`);
  console.log(`# count:    ${COUNT}`);
  console.log(`# spacing:  ${SPACING_MS}ms (${(SPACING_MS / 60000).toFixed(1)} min)`);
  console.log(`# cookie:   ${COOKIE ? "PRESENT" : "ABSENT"}`);
  console.log(`# grep Vercel runtime logs for '[F-11-timing]' + '[F-11]' to attribute per-loader elapsed`);
  console.log("");

  const results = [];
  for (let i = 1; i <= COUNT; i += 1) {
    const r = await hit(i, url);
    const marker = !r.ok ? "FAIL" : r.ms >= 8000 ? "TIMEOUT-CANDIDATE" : r.ms >= 5000 ? "SLOW " : "ok   ";
    console.log(`  ${fmtTs()}  req ${String(i).padStart(2)}/${COUNT}  ${marker}  status=${r.status}  ${fmtMs(r.ms)}${r.note}`);
    results.push(r);
    if (i < COUNT) await sleep(SPACING_MS);
  }

  console.log("");
  console.log(`## Summary`);
  const ok = results.filter(r => r.ok).length;
  const fail = results.length - ok;
  const over5 = results.filter(r => r.ms >= 5000).length;
  const over8 = results.filter(r => r.ms >= 8000).length;
  const status500 = results.filter(r => r.status === 500).length;
  const guardFired = results.filter(r => (r.note || "").includes("report_only_unavailable=true")).length;
  console.log(`  ${results.length} requests · ${ok} ok · ${fail} fail (${status500} 500s)`);
  console.log(`  ${over5} slow (>=5s)  ·  ${over8} timeout-candidate (>=8s)`);
  console.log(`  ${guardFired} responses with report_only_unavailable=true (F-11 guard fired)`);
  console.log("");
  console.log(`## Next step`);
  console.log(`  vercel logs --since=<start> | grep -E '\\[F-11(-timing)?\\]' > /tmp/f11_logs.txt`);
  console.log(`  Attribute each request in this run to its slowest loader from the log.`);
}

main().catch(e => { console.error(`THROWN: ${e.message || e}`); process.exit(1); });
