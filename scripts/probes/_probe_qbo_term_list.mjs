#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// _probe_qbo_term_list.mjs
// Query the QBO Term list in the live tenant.
// 2026-09-09.
// ═══════════════════════════════════════════════════════════════════
//
// Report-before-build per Kevin's ask. Fixture invoices consistently
// show SalesTermRef.value="7" name="Net 30" but those are ~2 months
// old and I want to confirm the ID is still current before hardcoding.
//
// Uses the same QBO proxy the invoice POSTs use (QBO_PROXY_BASE +
// QBO_PROXY_KEY + QBO_REALM_ID). Hits /query?query=select+*+from+Term
// which is QBO's SQL-like read endpoint.
//
// Run with:
//   node --env-file=.env.local scripts/probes/_probe_qbo_term_list.mjs

const req = ["QBO_PROXY_BASE", "QBO_PROXY_KEY", "QBO_REALM_ID"];
for (const k of req) {
  console.log(`${k}: ${process.env[k] ? "PRESENT" : "ABSENT"}`);
  if (!process.env[k]) {
    console.error(`\nABORT: ${k} missing. Run with --env-file=.env.local`);
    process.exit(2);
  }
}

const base = process.env.QBO_PROXY_BASE.replace(/\/+$/, "");
const realm = encodeURIComponent(process.env.QBO_REALM_ID);
const query = encodeURIComponent("select * from Term");
const url = `${base}/v3/company/${realm}/query?query=${query}&minorversion=75`;

console.log(`\nGET ${url.replace(process.env.QBO_PROXY_KEY || "___", "***")}`);

const res = await fetch(url, {
  method: "GET",
  headers: {
    "X-API-Key": process.env.QBO_PROXY_KEY,
    "Accept": "application/json",
  },
});

console.log(`Status: ${res.status} ${res.statusText}`);
const body = await res.text();

if (!res.ok) {
  console.error("\nBody:", body.slice(0, 2000));
  process.exit(3);
}

let json;
try { json = JSON.parse(body); }
catch { console.error("Response not JSON:", body.slice(0, 500)); process.exit(4); }

const terms = json?.QueryResponse?.Term || [];
console.log(`\nFound ${terms.length} term(s):`);
console.log("─".repeat(70));
for (const t of terms) {
  const parts = [];
  parts.push(`Id=${t.Id}`);
  parts.push(`Name="${t.Name}"`);
  if (typeof t.DueDays === "number") parts.push(`DueDays=${t.DueDays}`);
  if (typeof t.DayOfMonthDue === "number") parts.push(`DayOfMonthDue=${t.DayOfMonthDue}`);
  if (t.Active === false) parts.push("INACTIVE");
  if (t.DiscountPercent) parts.push(`Disc=${t.DiscountPercent}%/${t.DiscountDays}d`);
  console.log(`  ${parts.join("  ")}`);
}
console.log("─".repeat(70));

const net30 = terms.find((t) => /^net\s*30$/i.test(t.Name || "") && t.Active !== false);
if (net30) {
  console.log(`\nNet 30 -> Id=${net30.Id}  DueDays=${net30.DueDays ?? "(unset)"}`);
} else {
  console.log("\nNet 30 -> NOT FOUND. Kevin needs to know before we hardcode anything.");
}
