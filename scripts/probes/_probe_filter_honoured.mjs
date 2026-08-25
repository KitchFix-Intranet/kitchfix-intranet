#!/usr/bin/env node
/*
 * Probe: does spend_transaction_line_item_zo actually honour updated_at_gte?
 *
 * Sends three targeted requests:
 *   A. no filter                          -> baseline count on page 1 + total-page-shape
 *   B. updated_at_gte=2027-01-01T00:00:00Z (far future) -> should return ~0 if filter honoured
 *   C. updated_at_gte=2026-08-24T00:00:00Z (1 day ago)  -> should return small subset if honoured
 *
 * Reports per request: HTTP status, page-1 row count, has_next_link.
 * Read-only. Never prints keys or PII.
 */
import { fetchPage, firstPageUrl, extractRows } from "../../src/lib/rippling.js";

const KEY = process.env.RIPPLING_API_KEY;
console.log("env RIPPLING_API_KEY:", KEY ? "PRESENT" : "ABSENT");
if (!KEY) { console.error("BLOCKED: RIPPLING_API_KEY absent"); process.exit(2); }

async function probe(label, filterQs) {
  const base = firstPageUrl("custom-objects/spend_transaction_line_item_zo/records", 100);
  const url = filterQs ? `${base}&${filterQs}` : base;
  const shown = url.replace(/https:\/\/rest\.ripplingapis\.com/, "");
  console.log(`\n[${label}] GET ${shown}`);
  const res = await fetchPage(url, KEY);
  if (!res.ok) {
    console.log(`[${label}] FAIL status=${res.status} error=${res.error}`);
    return;
  }
  const rows = extractRows(res.body);
  const hasNext = Boolean(res.body?.next_link);
  console.log(`[${label}] status=${res.status} page1_rows=${rows.length} has_next_link=${hasNext}`);
  if (rows.length > 0) {
    const sample = rows[0];
    const uat = sample?.updated_at || sample?.updatedAt || sample?.mongo_updated_at || null;
    console.log(`[${label}] sample updated_at=${uat}`);
  }
}

await probe("A_baseline", null);
await probe("B_far_future", "updated_at_gte=" + encodeURIComponent("2027-01-01T00:00:00Z"));
await probe("C_yesterday", "updated_at_gte=" + encodeURIComponent("2026-08-24T00:00:00Z"));
await probe("D_year_ago",  "updated_at_gte=" + encodeURIComponent("2025-08-24T00:00:00Z"));
