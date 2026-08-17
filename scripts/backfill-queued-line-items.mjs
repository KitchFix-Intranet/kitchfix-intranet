// ════════════════════════════════════════════════════════════════════════════
// BACKFILL: existing invoice_submissions with no terminal extraction outcome
//           get flipped to ai_scan_status='queued' with a STAGGERED
//           ai_scan_next_attempt_at, so the /api/cron/extract-line-items
//           worker drains the backlog without thundering-herd against
//           Anthropic.
//
// Part of feat/li-a1-durable-extraction. Assumes docs/migrations/li-2-
// extraction-worker.sql has already been applied in Studio (Kevin
// confirms). This script is safe to run repeatedly; it re-derives its
// target set every time and never touches a row that already has a
// terminal state.
//
// ─── Target set (verified against live PG on 2026-08-17) ────────────────
//   ai_scan_status IS NULL           : 552
//   ai_scan_status = 'failed'        :  65
//   ai_scan_status = 'pending'       :   7  (legacy pre-migration status)
//   ai_scan_status = 'pg_failed'     :   9  (special handling - see below)
//                                    ---
//                                       633
//
// ─── pg_failed handling ─────────────────────────────────────────────────
//
// Per Kevin's 2026-08-12 standing ruling: pg_failed invoices need
// DELETE-then-INSERT per invoice for re-extraction (Sheets already has
// the line items; PG side threw during dual-write). NEVER a global
// truncate.
//
// This backfill script does NOT process pg_failed rows in its default
// mode. They land in a distinct bucket and are reported at the end
// with the exact command Kevin needs to run for each. Rationale:
// automating the DELETE would push us past "fast-as-safe" back into
// "clever" territory, and there are only 9 of them - hand-processing
// them keeps the ruling honest.
//
// If you want to force this script to process one pg_failed row (e.g.,
// after you have manually confirmed the Sheets side and want to re-
// extract), pass --include-pg-failed=<uuid>. The script will DELETE
// the ai_line_items rows for that submission FIRST (per the ruling),
// then flip it to 'queued' with the standard stagger.
//
// ─── Staggering schedule ────────────────────────────────────────────────
//
// The worker runs every 5 minutes and processes 3 rows per tick
// (CLAIM_LIMIT = 3, LEASE_SECS = 300). Absolute drain rate is
// bounded at 3 rows / 5 min = 36 rows / hour when the tick is 100%
// utilized, but the average tail will be lower. The stagger targets
// a per-hour delivery rate that keeps the queue reasonably full
// without giving the worker a fixed spike:
//
//   PACE_PER_HOUR = 20  (worker's realistic sustained throughput
//                        under the observed median 22s extraction)
//
// For 633 rows this is ~32 hours to drain the whole backlog, which
// is fine - the acceptance bar is "backlog drains to zero," not
// "drains inside one tick."
//
// The stagger is computed as: assign each row a next_attempt_at at
// (now + rank/PACE_PER_HOUR hours), where rank is the row's index in
// submitted_at DESC order (newest first). Newest rows are the ones
// where users are most likely to care about seeing line items, so
// they run first.
//
// ─── Usage ──────────────────────────────────────────────────────────────
//
// Dry run (no writes; prints the plan):
//   node --env-file=.env.local scripts/backfill-queued-line-items.mjs
//
// Real writes (adds the necessary --execute flag; belt-and-suspenders):
//   node --env-file=.env.local scripts/backfill-queued-line-items.mjs \
//     --execute
//
// Real writes, restricted subset (useful for the acceptance dry-run):
//   node --env-file=.env.local scripts/backfill-queued-line-items.mjs \
//     --execute --limit=10
//
// Include one pg_failed row (rare):
//   node --env-file=.env.local scripts/backfill-queued-line-items.mjs \
//     --execute --include-pg-failed=7f622f4f-c986-4913-a889-c6fdb4301760
//
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";

// ── Args ──
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=", 2)[1];
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}
const EXECUTE = args.includes("--execute");
const LIMIT = parseInt(getArg("limit", "0"), 10);
const INCLUDE_PG_FAILED = getArg("include-pg-failed", null);
const PACE_PER_HOUR = parseInt(getArg("pace-per-hour", "20"), 10);

if (PACE_PER_HOUR <= 0 || PACE_PER_HOUR > 200) {
  console.error(`[backfill] --pace-per-hour out of range: ${PACE_PER_HOUR}. Use 1-200.`);
  process.exit(2);
}

// ── Env ──
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("[backfill] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run under Vercel or with --env-file=.env.local.");
  process.exit(2);
}
const supa = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Preflight: verify the migration is applied ──
async function preflight() {
  // The get_extraction_claims function is the durable marker for
  // "li-2 has been applied." A missing function = the migration
  // hasn't run; abort so we don't queue rows the worker can't claim.
  const { data, error } = await supa.rpc("get_extraction_claims", {
    p_limit: 0,
    p_lease_seconds: 60,
    p_worker_id: "backfill-preflight",
  });
  if (error) {
    console.error(`[backfill] preflight failed: ${error.message}`);
    console.error(`[backfill] this usually means docs/migrations/li-2-extraction-worker.sql has not been applied in Studio yet.`);
    console.error(`[backfill] apply the migration first, then re-run.`);
    process.exit(3);
  }
  // data is an empty array; that's expected because we asked for p_limit=0.
  console.log(`[backfill] preflight OK: get_extraction_claims is callable.`);
}

// ── Load target set ──
async function loadTargets() {
  // NULL bucket
  const nulls = await pageThrough({ isNull: true });
  const failed = await pageThrough({ eq: "failed" });
  const pending = await pageThrough({ eq: "pending" });
  const pgFailed = await pageThrough({ eq: "pg_failed" });
  return { nulls, failed, pending, pgFailed };
}

async function pageThrough({ isNull, eq }) {
  const out = [];
  let from = 0;
  const step = 1000;
  while (true) {
    let q = supa
      .from("invoice_submissions")
      .select("id, client_uuid, submitted_at, account_key, vendor_name, invoice_number, invoice_date, raw_drive_url, ai_scan_status, ai_scan_error, ai_scan_attempt")
      .range(from, from + step - 1)
      .order("submitted_at", { ascending: false });
    if (isNull) q = q.is("ai_scan_status", null);
    else if (eq) q = q.eq("ai_scan_status", eq);
    const { data, error } = await q;
    if (error) throw new Error(`page query failed: ${error.message}`);
    out.push(...data);
    if (data.length < step) break;
    from += step;
  }
  return out;
}

// ── Compute a staggered next_attempt_at ──
function scheduleFor(rank, paceHour, startAt = new Date()) {
  // rank 0 -> immediate (a tiny 60s cushion so it lands after the
  // current worker tick if one is running); rank N -> now + N/paceHour hours
  const cushionMs = 60 * 1000;
  const spacingMs = (60 * 60 * 1000) / paceHour;
  return new Date(startAt.getTime() + cushionMs + rank * spacingMs);
}

// ── pg_failed one-off: DELETE-then-INSERT per Kevin's ruling ──
async function deleteLineItemsFor(clientUuid) {
  // Look up submission.id via client_uuid (line items FK on submission.id).
  const { data: sub, error: subErr } = await supa
    .from("invoice_submissions")
    .select("id")
    .eq("client_uuid", clientUuid)
    .maybeSingle();
  if (subErr || !sub) throw new Error(`sub lookup failed: ${subErr?.message || "not found"}`);

  const { count: preCount } = await supa
    .from("ai_line_items")
    .select("*", { count: "exact", head: true })
    .eq("invoice_uuid", sub.id);
  console.log(`[backfill]   ${clientUuid} PG has ${preCount} ai_line_items rows to delete.`);
  if (!EXECUTE) {
    console.log(`[backfill]   DRY RUN - skipping delete.`);
    return;
  }
  const { error: delErr } = await supa
    .from("ai_line_items")
    .delete()
    .eq("invoice_uuid", sub.id);
  if (delErr) throw new Error(`delete failed: ${delErr.message}`);
  console.log(`[backfill]   ${clientUuid} deleted ${preCount} rows.`);
}

// ── Update in batches ──
async function queueBatch(rows, startRank, paceHour) {
  let updated = 0;
  const now = new Date();
  let rank = startRank;
  for (const r of rows) {
    const naa = scheduleFor(rank, paceHour, now);
    if (!EXECUTE) {
      rank++;
      continue;
    }
    const { error } = await supa
      .from("invoice_submissions")
      .update({
        ai_scan_status:          "queued",
        ai_scan_error:           null,
        ai_scan_attempt:         0,
        ai_scan_next_attempt_at: naa.toISOString(),
      })
      .eq("client_uuid", r.client_uuid);
    if (error) {
      console.log(`[backfill]   ERROR updating ${r.client_uuid}: ${error.message}`);
      continue;
    }
    updated++;
    rank++;
  }
  return { updated, endRank: rank };
}

// ─── Main ────────────────────────────────────────────────────────────────
async function main() {
  console.log(`[backfill] li-a1 extraction backfill. execute=${EXECUTE} limit=${LIMIT || "all"} pace=${PACE_PER_HOUR}/hr`);
  await preflight();

  const { nulls, failed, pending, pgFailed } = await loadTargets();
  console.log(`[backfill] target counts:`);
  console.log(`[backfill]   NULL:      ${nulls.length}`);
  console.log(`[backfill]   failed:    ${failed.length}`);
  console.log(`[backfill]   pending:   ${pending.length}`);
  console.log(`[backfill]   pg_failed: ${pgFailed.length}  (default: SKIPPED; --include-pg-failed=<uuid> to force)`);
  console.log(`[backfill]   TOTAL:     ${nulls.length + failed.length + pending.length + pgFailed.length}`);

  // Order: newest NULL first (users most likely waiting), then newest
  // failed, then pending. pg_failed handled separately below.
  let combined = [...nulls, ...failed, ...pending];
  // De-dup defensively (shouldn't collide, but the union operator has no set semantics).
  const seen = new Set();
  combined = combined.filter((r) => {
    if (seen.has(r.client_uuid)) return false;
    seen.add(r.client_uuid);
    return true;
  });

  if (LIMIT > 0) {
    combined = combined.slice(0, LIMIT);
    console.log(`[backfill] LIMIT applied: processing ${combined.length} rows.`);
  }

  // Preview
  console.log(`[backfill] first 5 rows to be queued:`);
  for (const r of combined.slice(0, 5)) {
    console.log(`[backfill]   ${r.client_uuid}  ${r.submitted_at?.slice(0,10)}  ${r.account_key}  ${r.vendor_name}  (status=${r.ai_scan_status})`);
  }
  console.log(`[backfill] last 5 rows to be queued:`);
  for (const r of combined.slice(-5)) {
    console.log(`[backfill]   ${r.client_uuid}  ${r.submitted_at?.slice(0,10)}  ${r.account_key}  ${r.vendor_name}  (status=${r.ai_scan_status})`);
  }
  console.log(`[backfill] stagger: rank 0 -> ${scheduleFor(0, PACE_PER_HOUR).toISOString()}`);
  console.log(`[backfill] stagger: rank ${combined.length - 1} -> ${scheduleFor(combined.length - 1, PACE_PER_HOUR).toISOString()}`);

  if (!EXECUTE) {
    console.log(`[backfill] DRY RUN. Re-run with --execute to write.`);
  }

  const { updated, endRank } = await queueBatch(combined, 0, PACE_PER_HOUR);
  console.log(`[backfill] main batch: ${EXECUTE ? "updated" : "would update"} ${EXECUTE ? updated : combined.length} rows (rank 0..${endRank - 1}).`);

  // Optional pg_failed inclusion
  if (INCLUDE_PG_FAILED) {
    console.log(`[backfill] --include-pg-failed=${INCLUDE_PG_FAILED}`);
    const target = pgFailed.find((r) => r.client_uuid === INCLUDE_PG_FAILED);
    if (!target) {
      console.log(`[backfill] pg_failed uuid not found in current pg_failed set. skipping.`);
    } else {
      console.log(`[backfill]   ${target.client_uuid}  ${target.account_key}  ${target.vendor_name}`);
      try {
        await deleteLineItemsFor(target.client_uuid);
        const { updated: pgUp } = await queueBatch([target], endRank, PACE_PER_HOUR);
        console.log(`[backfill]   ${EXECUTE ? "queued" : "would queue"} after delete.`);
      } catch (e) {
        console.log(`[backfill]   ERROR: ${e.message}`);
      }
    }
  }

  // pg_failed reporting - print exact commands to hand-process each.
  if (pgFailed.length > 0 && !INCLUDE_PG_FAILED) {
    console.log(``);
    console.log(`[backfill] pg_failed rows (${pgFailed.length}) - hand-process per Kevin's 2026-08-12 ruling:`);
    for (const r of pgFailed) {
      console.log(`[backfill]   ${r.client_uuid}  ${r.submitted_at?.slice(0,10)}  ${r.account_key}  ${r.vendor_name}`);
      console.log(`[backfill]     err: ${(r.ai_scan_error || "").slice(0, 120)}`);
      console.log(`[backfill]     re-run: node --env-file=.env.local scripts/backfill-queued-line-items.mjs --execute --include-pg-failed=${r.client_uuid}`);
    }
  }
}

main().catch((e) => {
  console.error(`[backfill] FATAL: ${e.message}`);
  process.exit(1);
});
