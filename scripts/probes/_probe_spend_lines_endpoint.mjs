#!/usr/bin/env node
/**
 * Diagnose the Rippling spend-lines endpoint. Nightly
 * `purchasing-sync` has been failing with:
 *   [spend_lines] page 1 FAILED status=404 error=client error
 *     raw={"detail":"Custom object not found"}
 * since 2026-10-06, and rippling-sync.yml's own header documents
 * that `pay_segments` and `time_entry_zo` returned the same 404
 * shape on 2026-10-07 before being retired in the labor-te-1
 * cutover. Spend-lines going dark one day before pay_segments is
 * the lead - this probe confirms whether the shape of the response
 * matches that retirement or whether it is a different failure
 * (401 / 403 / 5xx / cursor-shape / rate limit).
 *
 * One page, one row sampled, HTTP status printed, top-level key
 * set of a single row printed. NEVER prints the API key; the key
 * is used only in the Authorization header. The row's own content
 * is not printed because it can carry per-worker PII.
 *
 * CLI:
 *   node --env-file=/path/to/.env.local scripts/probes/_probe_spend_lines_endpoint.mjs
 *
 * Exit codes:
 *   0  endpoint returned 2xx and at least one row (or an explicit
 *      empty page with cursor shape intact)
 *   1  configuration missing or endpoint returned non-2xx
 */
import { BASE, firstPageUrl } from "../../src/lib/rippling.js";

function pres(name) {
  const v = process.env[name];
  console.log(`env ${name.padEnd(32)}: ${v ? "PRESENT" : "ABSENT"}`);
  return !!v;
}

console.log(`spend_lines_endpoint_probe started=${new Date().toISOString()}`);
console.log(`BASE=${BASE}`);
const okKey = pres("RIPPLING_API_KEY");
if (!okKey) {
  console.error("STOP: RIPPLING_API_KEY ABSENT.");
  process.exit(1);
}

// Mirror production exactly: same path, same limit style, same
// Authorization header shape. firstPageUrl wraps the ?limit= so a
// cursor-based 404 vs an unauth 401 is distinguishable by status.
const url = firstPageUrl("custom-objects/spend_transaction_line_item_zo/records", 1);
console.log("");
console.log("step 1: HEAD-shaped GET on the retired-pattern path ...");
console.log(`  url path: /custom-objects/spend_transaction_line_item_zo/records?limit=1`);

let res, raw, parsed;
try {
  res = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${process.env.RIPPLING_API_KEY}`,
      Accept: "application/json",
    },
  });
  raw = await res.text();
  try { parsed = JSON.parse(raw); } catch { parsed = null; }
} catch (e) {
  console.error(`  fetch failed network-side: ${e?.message || e}`);
  process.exit(1);
}

console.log(`  http_status: ${res.status}`);
console.log(`  content-type: ${res.headers.get("content-type") || "n/a"}`);

if (!res.ok) {
  // Non-2xx: print only the detail field and the status - do not
  // dump the whole body in case any error path leaks the request's
  // reflected content.
  const detail = parsed?.detail ?? parsed?.error ?? parsed?.message ?? "(no detail field)";
  console.error(`  FAIL ${res.status}  detail: ${JSON.stringify(detail)}`);
  console.error("");
  if (res.status === 404 && String(detail).toLowerCase().includes("custom object")) {
    console.error("  Shape match: this is the SAME retirement pattern as pay_segments");
    console.error("  (rippling-sync.yml header, 2026-10-07). The custom object was");
    console.error("  removed from the API. Fix is a migration-class move of the");
    console.error("  spend-lines source off this endpoint - design call, not a patch.");
  } else if (res.status === 401 || res.status === 403) {
    console.error("  Auth / scope issue on RIPPLING_API_KEY - check the key is live");
    console.error("  and still carries the spend-lines read scope.");
  } else if (res.status >= 500) {
    console.error("  Rippling-side 5xx - may self-heal; recheck in an hour.");
  }
  process.exit(1);
}

// 2xx: report the row shape without printing row content.
const rows = Array.isArray(parsed?.records) ? parsed.records
           : Array.isArray(parsed) ? parsed
           : [];
const cursor = parsed?.next_cursor ?? parsed?.cursor ?? null;
console.log(`  OK: rows_on_page=${rows.length}  cursor_present=${cursor != null}`);
if (rows.length > 0) {
  const keys = Object.keys(rows[0]).sort();
  console.log(`  row top-level keys: [${keys.join(", ")}]`);
}
console.log("");
console.log("probe PASS: endpoint responded 2xx. If the sync is still failing,");
console.log("  investigate further - 404 was the original cause.");
process.exit(0);
