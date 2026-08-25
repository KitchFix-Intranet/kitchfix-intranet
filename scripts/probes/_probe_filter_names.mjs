#!/usr/bin/env node
/*
 * Alternate parameter-name probe. If Rippling honours a date filter on
 * this endpoint at all, it might use a different key.  Try each shape;
 * see if any of them collapse page-1 rows to 0 for a far-future value.
 *
 * A row-count of 100 on page 1 with has_next_link=true is the tell that
 * the filter did NOT constrain the walk. A count of 0 or a small number
 * (<100) with no next_link is the tell that it did.
 */
import { fetchPage, firstPageUrl, extractRows, BASE } from "../../src/lib/rippling.js";

const KEY = process.env.RIPPLING_API_KEY;
if (!KEY) { console.error("BLOCKED"); process.exit(2); }

const FAR_FUTURE = "2027-01-01T00:00:00Z";
const shapes = [
  ["updated_at_gte", `updated_at_gte=${encodeURIComponent(FAR_FUTURE)}`],
  ["updated_at__gte", `updated_at__gte=${encodeURIComponent(FAR_FUTURE)}`],
  ["updated_at.gte", `updated_at.gte=${encodeURIComponent(FAR_FUTURE)}`],
  ["updated_at%5Bgte%5D", `updated_at%5Bgte%5D=${encodeURIComponent(FAR_FUTURE)}`],
  ["updated_at>=", `updated_at%3E%3D=${encodeURIComponent(FAR_FUTURE)}`],
  ["filter[updated_at][gte]", `filter%5Bupdated_at%5D%5Bgte%5D=${encodeURIComponent(FAR_FUTURE)}`],
  ["mongo_updated_at_gte", `mongo_updated_at_gte=${encodeURIComponent(FAR_FUTURE)}`],
  ["system_updated_at_gte", `system_updated_at_gte=${encodeURIComponent(FAR_FUTURE)}`],
];

async function one(name, qs) {
  const base = firstPageUrl("custom-objects/spend_transaction_line_item_zo/records", 100);
  const url = `${base}&${qs}`;
  const res = await fetchPage(url, KEY);
  if (!res.ok) { console.log(`[${name.padEnd(28)}] FAIL status=${res.status}`); return; }
  const rows = extractRows(res.body);
  const nx = Boolean(res.body?.next_link);
  const sample = rows[0]?.updated_at || rows[0]?.updatedAt || "n/a";
  console.log(`[${name.padEnd(28)}] page1_rows=${rows.length}  has_next=${nx}  sample_updated_at=${sample}`);
}
for (const [n, q] of shapes) await one(n, q);
