// Bulk-load classifications from item_classifications.json into
// item_classifications table (Postgres) after pr-10-4 migration is applied.
//
// Idempotent via UNIQUE (normalized_description, vendor_id) + upsert semantics.
// Read-only unless --execute is passed.

import dotenv from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/dotenv/lib/main.js";
import { createClient } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/@supabase/supabase-js/dist/index.mjs";
import fs from "node:fs";

dotenv.config({ path: "/Users/kevinfietek/dev/kitchfix-intranet/.env.local", quiet: true });

const CACHE = process.argv.find((a) => a.startsWith("--cache="))?.slice("--cache=".length)
  || "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/item_classifications.json";
const EXECUTE = process.argv.includes("--execute");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("[load-cls] Missing SUPABASE env");
  process.exit(2);
}
const supa = createClient(url, key, { auth: { persistSession: false } });

// Guard: refuse to run write if table missing
const { error: probeErr } = await supa
  .from("item_classifications")
  .select("id", { count: "exact", head: true });
if (probeErr && /does not exist/i.test(String(probeErr.message || ""))) {
  console.error("[load-cls] item_classifications does not exist.");
  console.error("[load-cls] Apply pr-10-4 migration first:");
  console.error("[load-cls]   docs/migrations/pr-10-4-item-classifications-table.sql");
  process.exit(3);
}

const cache = JSON.parse(fs.readFileSync(CACHE, "utf8"));
const items = Object.values(cache.items || {});
console.log("[load-cls] cache items to load:", items.length);
console.log("[load-cls] mode:", EXECUTE ? "EXECUTE (will upsert)" : "DRY (no writes)");

if (!EXECUTE) {
  console.log("[load-cls] first 3 items:");
  for (const it of items.slice(0, 3)) {
    console.log("  -", it.normalized_description, "|", it.vendor_id, "|", it.quality_axis, it.preparation_axis, it.storage_axis);
  }
  console.log("[load-cls] DRY complete. Pass --execute to write.");
  process.exit(0);
}

// Batched upsert
const BATCH = 200;
let attempted = 0, succeeded = 0, failed = 0;
for (let i = 0; i < items.length; i += BATCH) {
  const chunk = items.slice(i, i + BATCH).map((it) => ({
    normalized_description: it.normalized_description,
    vendor_id: it.vendor_id,
    quality_axis: it.quality_axis,
    quality_confidence: it.quality_confidence,
    quality_reason: it.quality_reason,
    preparation_axis: it.preparation_axis,
    preparation_confidence: it.preparation_confidence,
    preparation_reason: it.preparation_reason,
    storage_axis: it.storage_axis,
    storage_confidence: it.storage_confidence,
    storage_reason: it.storage_reason,
    classified_at: it.classified_at,
    model_used: it.model_used,
  }));
  attempted += chunk.length;
  const { error } = await supa
    .from("item_classifications")
    .upsert(chunk, { onConflict: "normalized_description,vendor_id" });
  if (error) {
    failed += chunk.length;
    console.error(`[load-cls] chunk ${i}-${i + chunk.length} FAILED:`, error.message);
  } else {
    succeeded += chunk.length;
    console.log(`[load-cls] chunk ${i}-${i + chunk.length} upserted`);
  }
}

console.log("[load-cls] attempted:", attempted, "succeeded:", succeeded, "failed:", failed);
