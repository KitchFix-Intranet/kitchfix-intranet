// scripts/rippling_sync.mjs
//
// KPI PR 8a: sync raw Rippling time_entries + pay_segments into Postgres.
//
// Design:
//   - Serialized by a table-based lock (rippling_sync_locks). Prevents
//     a local backfill from colliding with a scheduled Action; each
//     would otherwise race the compare-then-insert path and produce
//     audit rows for changes that never happened. GitHub Actions'
//     `concurrency:` block handles Action-vs-Action; the lock handles
//     the cross-environment case.
//   - Two Rippling walks per invocation, sequential (time_entries then
//     pay_segments). One script run = one exit code. A combined total
//     would hide one walk silently failing while the other succeeded,
//     so we report both explicitly.
//   - Full cursor walk per object every time. Rippling's date/worker
//     filters are silently ignored (discovery 2026-08-04). Content-
//     hash compare-then-insert makes re-fetching cheap.
//   - Per-page: fetch, hash, batch-lookup <table>_latest for current
//     hashes, INSERT only rows whose hash differs from current. No
//     DB-side UNIQUE (see kpi-8a-rippling-raw.sql header for why).
//   - Per-object summary: pages, examined, unchanged, inserted, duration.
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
//   3  another sync run is in flight (lock held)

import os from "node:os";
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

// ─── Concurrency lock ────────────────────────────────────────────────
//
// Serialize concurrent runs across all environments (local backfill +
// scheduled Action). Row in rippling_sync_locks with a 4-hour TTL;
// on clean exit we DELETE our row, on crash the next run reaps it
// after 4 hours. Manual recovery is a Studio DELETE. Dry-run still
// takes the lock - a walking backfill preview should not overlap
// with a real nightly write.

const LOCK_NAME = "rippling_sync";
const LOCK_TTL_MS = 4 * 60 * 60 * 1000;  // 4h; comfortably over 90-min workflow timeout.
const HOLDER_ID = [
  args.source,
  `host=${os.hostname()}`,
  `pid=${process.pid}`,
  `started=${startedAt.toISOString()}`,
  process.env.GITHUB_RUN_ID ? `gh_run=${process.env.GITHUB_RUN_ID}` : null,
].filter(Boolean).join(" ");

async function acquireLock() {
  // Reap expired first so a crashed previous run releases automatically.
  const { error: reapErr } = await supa
    .from("rippling_sync_locks")
    .delete()
    .eq("name", LOCK_NAME)
    .lt("expires_at", new Date().toISOString());
  if (reapErr) {
    console.error(`lock: reap-expired failed: ${reapErr.message}`);
    process.exit(1);
  }
  // Try to acquire.
  const expiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  const { error } = await supa
    .from("rippling_sync_locks")
    .insert({ name: LOCK_NAME, expires_at: expiresAt, holder: HOLDER_ID });
  if (error) {
    if (error.code === "23505") {
      // PK conflict - someone holds it. Fetch and report.
      const { data: current } = await supa
        .from("rippling_sync_locks")
        .select("holder, acquired_at, expires_at")
        .eq("name", LOCK_NAME)
        .maybeSingle();
      console.error("rippling_sync: another run is in flight, refusing to start");
      if (current) {
        console.error(`  holder:      ${current.holder}`);
        console.error(`  acquired_at: ${current.acquired_at}`);
        console.error(`  expires_at:  ${current.expires_at}`);
        console.error("");
        console.error("If the holder crashed and never released, wait for TTL expiry or clear manually:");
        console.error("  DELETE FROM rippling_sync_locks WHERE name = 'rippling_sync';");
      }
      process.exit(3);
    }
    console.error(`lock: acquire failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`rippling_sync: acquired lock holder="${HOLDER_ID}" expires_at=${expiresAt}`);
}

async function releaseLock() {
  // Delete only OUR row - if another process reaped ours and took the
  // lock, we must not delete theirs.
  const { error } = await supa
    .from("rippling_sync_locks")
    .delete()
    .eq("name", LOCK_NAME)
    .eq("holder", HOLDER_ID);
  if (error) {
    console.error(`lock: release failed: ${error.message}`);
    return;
  }
  console.log(`rippling_sync: released lock holder="${HOLDER_ID}"`);
}

await acquireLock();
process.on("SIGINT",  async () => { await releaseLock(); process.exit(130); });
process.on("SIGTERM", async () => { await releaseLock(); process.exit(143); });

// ─── Walk one endpoint ──────────────────────────────────────────────
//
// Per-page compare-then-insert. For each page:
//   1. Fetch from Rippling.
//   2. Compute content_hash for each row.
//   3. Batch-query <table>_latest for the current hashes of these ids.
//   4. Filter to rows whose new hash differs from the current latest.
//   5. Bulk INSERT the differing rows (no ON CONFLICT clause - the
//      table has no UNIQUE on (rippling_id, content_hash), see the
//      migration header for why).
//
// Every counted disposition is explicit: examined -> unchanged (matched
// current) + inserted (differed) + failed (walk aborts, never silent).

async function walkAndInsert({ endpoint, table, latestView, kind, project }) {
  const t0 = Date.now();
  let url = firstPageUrl(endpoint, PAGE_SIZE);
  let pages = 0;
  let examined = 0;
  let unchanged = 0;
  let inserted = 0;
  // Accumulate every rippling_id this walk sees, live for the presence
  // projection (kpi-8ba). Kept across pages; kept regardless of whether
  // the row was new or unchanged. On dry-run this is still populated so
  // the caller can see what a real run would have written.
  const seenIds = new Set();

  while (pages < MAX_PAGES_HARD) {
    const res = await fetchPage(url, KEY);
    if (!res.ok) {
      const durationSec = ((Date.now() - t0) / 1000).toFixed(1);
      console.error(`[${kind}] page ${pages + 1} FAILED status=${res.status} error=${res.error} raw=${(res.raw || "").slice(0, 200)}`);
      return { ok: false, pages, examined, unchanged, inserted, durationSec, error: res.error, seenIds };
    }
    const rows = extractRows(res.body);
    pages++;
    examined += rows.length;

    // Build hash-computed rows for this page. The optional `project`
    // hook (salary PR 1: compensations walk) pulls a few fields out of
    // the payload into first-class columns so the derive can filter +
    // join without JSONB unpacking. Projections are read-only convenience;
    // the JSONB payload stays authoritative.
    const hashedRows = [];
    for (const raw of rows) {
      if (!raw.id) continue;
      const row = {
        rippling_id:  String(raw.id),
        content_hash: contentHash(raw, kind),
        payload:      raw,
        fetch_source: args.source,
      };
      if (project) Object.assign(row, project(raw));
      hashedRows.push(row);
    }

    // Record presence for every seen id this page.
    for (const r of hashedRows) seenIds.add(r.rippling_id);

    // Batch-fetch current hashes for these ids. On first backfill this
    // returns nothing; on nightly runs it returns the previous latest
    // for each id we already have.
    let currentByID = new Map();
    if (!args.dryRun && hashedRows.length > 0) {
      const ids = hashedRows.map(r => r.rippling_id);
      const { data, error } = await supa.from(latestView).select("rippling_id, content_hash").in("rippling_id", ids);
      if (error) {
        const durationSec = ((Date.now() - t0) / 1000).toFixed(1);
        console.error(`[${kind}] latest-hash lookup page ${pages} FAILED: ${error.message}`);
        return { ok: false, pages, examined, unchanged, inserted, durationSec, error: error.message, seenIds };
      }
      for (const r of data || []) currentByID.set(r.rippling_id, r.content_hash);
    }

    // Filter to rows whose hash differs from the current latest. A new
    // rippling_id (currentByID.get returns undefined) always differs.
    const toInsert = hashedRows.filter(r => currentByID.get(r.rippling_id) !== r.content_hash);
    unchanged += hashedRows.length - toInsert.length;

    if (toInsert.length > 0) {
      if (args.dryRun) {
        inserted += toInsert.length;   // report what would insert
      } else {
        const { data, error } = await supa.from(table).insert(toInsert).select("id");
        if (error) {
          const durationSec = ((Date.now() - t0) / 1000).toFixed(1);
          console.error(`[${kind}] insert page ${pages} FAILED: ${error.message}`);
          return { ok: false, pages, examined, unchanged, inserted, durationSec, error: error.message, seenIds };
        }
        inserted += (data || []).length;
      }
    }

    process.stderr.write(`[${kind}] page ${pages}  rows=${rows.length}  cumulative=${examined}  unchanged=${unchanged}  inserted=${inserted}  elapsed=${Math.round((Date.now() - t0) / 1000)}s\r`);
    if (!rows.length) break;
    const next = res.body?.next_link;
    if (!next) break;
    url = next.startsWith("http") ? next : BASE + next;
  }
  process.stderr.write("\n");

  if (pages >= MAX_PAGES_HARD) {
    console.error(`[${kind}] MAX_PAGES_HARD=${MAX_PAGES_HARD} hit - walk aborted before natural end`);
    return { ok: false, pages, examined, unchanged, inserted, durationSec: ((Date.now() - t0) / 1000).toFixed(1), error: "max pages", seenIds };
  }

  const durationSec = ((Date.now() - t0) / 1000).toFixed(1);
  return { ok: true, pages, examined, unchanged, inserted, durationSec, seenIds };
}

// ─── Presence + walks (kpi-8ba) ─────────────────────────────────────
//
// Every walk attempt gets a rippling_walks row (status=in_progress at
// insert time). On walk success, commit_walk_success() atomically swaps
// rippling_current_presence for the kind and marks the walk row success
// - or failed_plausibility if the new count fails the plausibility
// check (< 50% of the previous successful walk, or below min_examined).
// On walk failure, mark the walk row failed with the error text; DO NOT
// touch presence. A skipped nightly leaves the previous walk's presence
// intact and is visible by absence of a recent walk row.
//
// Dry-run mode skips the walk-row insert and the presence swap - a
// preview should not write.

async function insertWalkRow(kind) {
  const { data, error } = await supa
    .from("rippling_walks")
    .insert({ kind, source: args.source, status: "in_progress" })
    .select("id")
    .single();
  if (error) {
    console.error(`[${kind}] walk-row insert FAILED: ${error.message}`);
    return null;
  }
  return data.id;
}

async function markWalkFailed(walkId, errorMessage, seenCount, pages, durationSec) {
  const { error } = await supa
    .from("rippling_walks")
    .update({
      status: "failed",
      completed_at: new Date().toISOString(),
      ids_seen: seenCount,
      pages,
      duration_sec: Number(durationSec),
      error_message: String(errorMessage).slice(0, 500),
    })
    .eq("id", walkId);
  if (error) console.error(`[walk ${walkId}] mark-failed FAILED: ${error.message}`);
}

// Returns { status: 'success' | 'failed_plausibility' | 'rpc_error', ids_written: N }.
// Presence swap and walk-status update happen atomically inside the RPC.
async function commitWalkSuccessRPC(walkId, kind, idsArray, pages, durationSec) {
  const { data, error } = await supa.rpc("commit_walk_success", {
    p_walk_id: walkId,
    p_kind: kind,
    p_ids: idsArray,
    p_pages: pages,
    p_duration_sec: Number(durationSec),
    p_min_examined: 1,
  });
  if (error) {
    console.error(`[${kind}] commit_walk_success RPC FAILED: ${error.message}`);
    return { status: "rpc_error", ids_written: 0, error: error.message };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { status: row?.result_status || "unknown", ids_written: row?.ids_written || 0 };
}

// Wrap a single walk with the presence-tracking machinery. Returns the
// walk result augmented with { walkId, presenceStatus, presenceIdsWritten }.
async function runWalkWithPresence(walkArgs) {
  const { kind } = walkArgs;
  let walkId = null;
  if (!args.dryRun) {
    walkId = await insertWalkRow(kind);
    // If we couldn't even insert the walk row, still do the ingest -
    // presence just won't get written. The failure surfaces in the
    // rippling_walks table being missing a row for this run.
  }

  const result = await walkAndInsert(walkArgs);

  if (args.dryRun) {
    return { ...result, walkId: null, presenceStatus: "skipped_dry_run", presenceIdsWritten: 0 };
  }
  if (walkId === null) {
    return { ...result, walkId: null, presenceStatus: "walk_row_insert_failed", presenceIdsWritten: 0 };
  }

  if (result.ok) {
    const commitOutcome = await commitWalkSuccessRPC(
      walkId, kind, [...result.seenIds], result.pages, result.durationSec
    );
    return { ...result, walkId, presenceStatus: commitOutcome.status, presenceIdsWritten: commitOutcome.ids_written };
  } else {
    await markWalkFailed(walkId, result.error, result.seenIds.size, result.pages, result.durationSec);
    return { ...result, walkId, presenceStatus: "walk_failed", presenceIdsWritten: 0 };
  }
}

// ─── Run all six walks ──────────────────────────────────────────────
// Sequential: time_entries, pay_segments (PR 8a), workers and
// time_entry_zo (PR 8a-2), users (C5), compensations (salary PR 1).
// Wrapped in try/finally so the lock releases on both success and
// caught failure paths. SIGINT/SIGTERM handlers registered above cover
// the killed-by-signal path.

let teResult, psResult, wkResult, zoResult, usResult, cpResult;
try {
  // One kind failing must not prevent the others from writing their
  // presence. Each runWalkWithPresence is independent - it returns a
  // result object rather than throwing, so a walk failure surfaces in
  // the summary and exit code without short-circuiting the remaining
  // walks. Gate 2 property, preserved by the fifth walk.
  teResult = await runWalkWithPresence({
    endpoint:    "time-entries",
    table:       "rippling_raw_time_entries",
    latestView:  "rippling_raw_time_entries_latest",
    kind:        "time_entries",
  });

  psResult = await runWalkWithPresence({
    endpoint:    "custom-objects/time_entry_computed_pay_segment/records",
    table:       "rippling_raw_pay_segments",
    latestView:  "rippling_raw_pay_segments_latest",
    kind:        "pay_segments",
  });

  wkResult = await runWalkWithPresence({
    endpoint:    "workers",
    table:       "rippling_raw_workers",
    latestView:  "rippling_raw_workers_latest",
    kind:        "workers",
  });

  zoResult = await runWalkWithPresence({
    endpoint:    "custom-objects/time_entry_zo/records",
    table:       "rippling_raw_time_entry_zo",
    latestView:  "rippling_raw_time_entry_zo_latest",
    kind:        "time_entry_zo",
  });

  // C5: fifth walk. /users carries the name fields that /workers
  // omits by design (C5.1 diagnostic). PII-dense endpoint - the
  // rippling_raw_users table is service_role-only, and no route
  // outside OPS_LEADERSHIP_EMAILS reads it. Names are NEVER logged;
  // this walk reports counts only.
  usResult = await runWalkWithPresence({
    endpoint:    "users",
    table:       "rippling_raw_users",
    latestView:  "rippling_raw_users_latest",
    kind:        "users",
  });

  // Salary PR 1 · sixth walk. /compensations carries the salary
  // record referenced by workers.compensation_id (S0b established
  // the pattern; /workers returns null with a reference, the record
  // lives here). Same cursor-walk contract - filter surface is
  // silently ignored per S0b (?worker_id= returned 5 rows on a
  // single-worker query). No amount / name / id is ever logged; the
  // derive downstream is the only reader that unpacks the payload.
  //
  // `project` writes convenience columns (worker_id, payment_type,
  // annual_value, salary_effective_date, currency) into the raw row
  // alongside the JSONB payload. Payload stays authoritative; the
  // columns exist so the derive can filter on payment_type + join on
  // worker_id + resolve effective dates without JSONB unpacking.
  cpResult = await runWalkWithPresence({
    endpoint:    "compensations",
    table:       "rippling_raw_compensations",
    latestView:  "rippling_raw_compensations_latest",
    kind:        "compensations",
    project: (raw) => ({
      worker_id:             raw.worker_id || null,
      payment_type:          raw.payment_type || null,
      annual_value:          raw.annual_compensation && typeof raw.annual_compensation.value === "number"
                               ? raw.annual_compensation.value
                               : null,
      salary_effective_date: raw.salary_effective_date || null,
      currency:              raw.annual_compensation?.currency_type
                               ?? raw.hourly_wage?.currency_type
                               ?? null,
    }),
  });
} finally {
  await releaseLock();
}

const finishedAt = new Date();
const totalSec = ((finishedAt - startedAt) / 1000).toFixed(1);

// ─── Summary ─────────────────────────────────────────────────────────

function fmtResult(label, r) {
  const status = r.ok ? "ok" : `FAIL (${r.error})`;
  const presence = r.presenceStatus
    ? `  presence=${r.presenceStatus}${r.presenceIdsWritten ? `(${r.presenceIdsWritten})` : ""}`
    : "";
  return `${label.padEnd(14)}  ${status.padEnd(28)}  pages=${String(r.pages).padStart(4)}  examined=${String(r.examined).padStart(6)}  unchanged=${String(r.unchanged).padStart(6)}  inserted=${String(r.inserted).padStart(6)}  duration=${r.durationSec}s${presence}`;
}

console.log("");
console.log("rippling_sync summary:");
console.log("  " + fmtResult("time_entries",  teResult));
console.log("  " + fmtResult("pay_segments",  psResult));
console.log("  " + fmtResult("workers",       wkResult));
console.log("  " + fmtResult("time_entry_zo", zoResult));
console.log("  " + fmtResult("users",         usResult));
console.log("  " + fmtResult("compensations", cpResult));
console.log(`  total elapsed=${totalSec}s  source=${args.source}  dryRun=${args.dryRun}`);

if (!teResult.ok || !psResult.ok || !wkResult.ok || !zoResult.ok || !usResult.ok || !cpResult.ok) process.exit(2);
process.exit(0);
