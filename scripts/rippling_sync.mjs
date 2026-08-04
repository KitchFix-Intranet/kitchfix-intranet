// scripts/rippling_sync.mjs
//
// KPI PR 8a: sync raw Rippling time_entries + pay_segments into Postgres.
//
// Design:
//   - Two Rippling walks per invocation, sequential (time_entries then
//     pay_segments). One script run = one exit code. A combined total
//     would hide one walk silently failing while the other succeeded,
//     so we report both explicitly.
//   - Full cursor walk per object every time. Rippling's date/worker
//     filters are silently ignored (discovery 2026-08-04); the content-
//     hash unique constraint is what makes re-fetching cheap.
//   - Per-page bulk upsert with onConflict: 'rippling_id,content_hash',
//     ignoreDuplicates: true - unchanged records are dropped by
//     Postgres, only new + changed records write.
//   - Per-object summary line printed at end: pages, examined, inserted,
//     skipped-unchanged, duration.
//
// CLI:
//   node --env-file=.env.local scripts/rippling_sync.mjs --source=nightly
//   node --env-file=.env.local scripts/rippling_sync.mjs --source=manual --dry-run
//
// Required env: RIPPLING_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Exit codes:
//   0  both walks completed
//   1  configuration error (missing env, bad --source, etc.)
//   2  at least one walk failed mid-flight

import { createClient } from "@supabase/supabase-js";
import { fetchPage, extractRows, firstPageUrl, contentHash, BASE } from "../src/lib/rippling.js";

// ─── CLI ─────────────────────────────────────────────────────────────

const VALID_SOURCES = new Set(["backfill", "nightly", "manual"]);
const MAX_PAGES_HARD = 500;    // safety valve; ~50k rows at limit=100
const PAGE_SIZE = 100;

function parseArgs(argv) {
  const args = { source: null, dryRun: false };
  for (const a of argv.slice(2)) {
    if (a.startsWith("--source=")) args.source = a.slice("--source=".length);
    else if (a === "--dry-run") args.dryRun = true;
    else { console.error("unknown arg: " + a); process.exit(1); }
  }
  return args;
}

const args = parseArgs(process.argv);
if (!args.source || !VALID_SOURCES.has(args.source)) {
  console.error("--source is required, one of: " + Array.from(VALID_SOURCES).join(", "));
  process.exit(1);
}

const KEY = process.env.RIPPLING_API_KEY;
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY)    { console.error("RIPPLING_API_KEY not set"); process.exit(1); }
if (!SB_URL) { console.error("SUPABASE_URL not set"); process.exit(1); }
if (!SB_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }

const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const startedAt = new Date();
console.log(`rippling_sync source=${args.source} dryRun=${args.dryRun} started=${startedAt.toISOString()}`);

// ─── Walk one endpoint ──────────────────────────────────────────────

async function walkAndInsert({ endpoint, table, kind }) {
  const t0 = Date.now();
  let url = firstPageUrl(endpoint, PAGE_SIZE);
  let pages = 0;
  let examined = 0;
  let inserted = 0;
  const rowsToInsert = [];

  while (pages < MAX_PAGES_HARD) {
    const res = await fetchPage(url, KEY);
    if (!res.ok) {
      const durationSec = ((Date.now() - t0) / 1000).toFixed(1);
      console.error(`[${kind}] page ${pages + 1} FAILED status=${res.status} error=${res.error} raw=${(res.raw || "").slice(0, 200)}`);
      return { ok: false, pages, examined, inserted, durationSec, error: res.error };
    }
    const rows = extractRows(res.body);
    pages++;
    examined += rows.length;
    for (const raw of rows) {
      const id = raw.id;
      if (!id) continue;
      const hash = contentHash(raw, kind);
      rowsToInsert.push({
        rippling_id:  String(id),
        content_hash: hash,
        payload:      raw,
        fetch_source: args.source,
      });
    }
    process.stderr.write(`[${kind}] page ${pages}  rows=${rows.length}  cumulative=${examined}  elapsed=${Math.round((Date.now() - t0) / 1000)}s\r`);
    if (!rows.length) break;
    const next = res.body?.next_link;
    if (!next) break;
    url = next.startsWith("http") ? next : BASE + next;
  }
  process.stderr.write("\n");

  if (pages >= MAX_PAGES_HARD) {
    console.error(`[${kind}] MAX_PAGES_HARD=${MAX_PAGES_HARD} hit - walk aborted before natural end`);
    return { ok: false, pages, examined, inserted, durationSec: ((Date.now() - t0) / 1000).toFixed(1), error: "max pages" };
  }

  // Batch upsert. supabase-js caps payload size; chunk to be safe.
  if (args.dryRun) {
    console.error(`[${kind}] dry-run: would write ${rowsToInsert.length} rows to ${table}`);
    return { ok: true, pages, examined, inserted: 0, durationSec: ((Date.now() - t0) / 1000).toFixed(1) };
  }

  const CHUNK = 500;
  for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
    const chunk = rowsToInsert.slice(i, i + CHUNK);
    const { data, error } = await supa
      .from(table)
      .upsert(chunk, { onConflict: "rippling_id,content_hash", ignoreDuplicates: true })
      .select("id");
    if (error) {
      const durationSec = ((Date.now() - t0) / 1000).toFixed(1);
      console.error(`[${kind}] upsert chunk ${i / CHUNK + 1} FAILED: ${error.message}`);
      return { ok: false, pages, examined, inserted, durationSec, error: error.message };
    }
    inserted += (data || []).length;
  }

  const durationSec = ((Date.now() - t0) / 1000).toFixed(1);
  return { ok: true, pages, examined, inserted, durationSec };
}

// ─── Run both walks ──────────────────────────────────────────────────

const teResult = await walkAndInsert({
  endpoint: "time-entries",
  table:    "rippling_raw_time_entries",
  kind:     "time_entries",
});

const psResult = await walkAndInsert({
  endpoint: "custom-objects/time_entry_computed_pay_segment/records",
  table:    "rippling_raw_pay_segments",
  kind:     "pay_segments",
});

const finishedAt = new Date();
const totalSec = ((finishedAt - startedAt) / 1000).toFixed(1);

// ─── Summary ─────────────────────────────────────────────────────────

function fmtResult(label, r) {
  const skipped = r.examined - r.inserted;
  const status = r.ok ? "ok" : `FAIL (${r.error})`;
  return `${label.padEnd(14)}  ${status.padEnd(28)}  pages=${String(r.pages).padStart(4)}  examined=${String(r.examined).padStart(6)}  inserted=${String(r.inserted).padStart(6)}  skipped=${String(skipped).padStart(6)}  duration=${r.durationSec}s`;
}

console.log("");
console.log("rippling_sync summary:");
console.log("  " + fmtResult("time_entries", teResult));
console.log("  " + fmtResult("pay_segments", psResult));
console.log(`  total elapsed=${totalSec}s  source=${args.source}  dryRun=${args.dryRun}`);

if (!teResult.ok || !psResult.ok) process.exit(2);
process.exit(0);
