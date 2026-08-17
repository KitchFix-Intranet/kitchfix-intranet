// ═══════════════════════════════════════════════════════════════════════════
// /api/cron/extract-line-items - A1 durable extraction worker
// ═══════════════════════════════════════════════════════════════════════════
//
// Companion to docs/migrations/li-2-extraction-worker.sql. Read that
// header for the "why" - this comment covers the "how."
//
// ─── What it does per tick ────────────────────────────────────────────────
//
// 1. Auth check (Bearer CRON_SECRET, same pattern as every other cron
//    route in this repo).
// 2. Compute a wall-clock budget WELL inside maxDuration so we can
//    finish a claim we started even under the worst observed 51s tail.
// 3. Loop: get_extraction_claims(CLAIM_LIMIT, LEASE_SECS, workerId).
//    For each claimed row:
//      a. Download pages from raw_drive_url via downloadAndExtractPages.
//      b. Call extractAndStoreLineItems - the SAME code path submit
//         used to fire-and-forget, unchanged.
//      c. Re-read the row's ai_scan_status + ai_scan_error to see
//         where extractAndStoreLineItems landed it.
//      d. If terminal 'complete' or 'pg_failed': release the lease
//         (claimed_at = null, claimed_by = null), leave status alone.
//         For 'complete' also null out ai_scan_next_attempt_at so the
//         row is out of the queue index.
//      e. If 'failed': classify the cause via classifyExtractionFailure.
//           - retryable-soon and under MAX_ATTEMPTS: flip status back
//             to 'queued', bump ai_scan_next_attempt_at to the backoff
//             time, release the lease. The row rejoins the queue.
//           - retryable-later: SAME as above but with the longer
//             backoff schedule (billing / credit-balance class).
//           - terminal (or attempt-ceiling exhausted): leave status
//             as 'failed' with the cause, release the lease.
//    Break out of the loop as soon as the wall-clock budget is spent.
// 4. Return a JSON summary. This is what phase A3's digest will read
//    (per the A1 spec), so the shape is stable:
//    { ok, tookMs, claimed, complete, retriedSoon, retriedLater,
//      terminal, pgFailed, driveErrors, workerId }
//
// ─── Concurrency ──────────────────────────────────────────────────────────
//
// Two ticks that overlap (because the previous tick ran long) never
// claim the same row. The claim function uses FOR UPDATE SKIP LOCKED
// and returns only the rows this call actually locked. That is the
// SQL-level guarantee, not something enforced in JS. If the previous
// tick's lease is still live (not yet expired), the row is invisible
// to this tick's WHERE clause; if the lease expired (previous tick
// crashed), this tick claims it and increments attempt count.
//
// ─── Time budget ──────────────────────────────────────────────────────────
//
// maxDuration = 300 (Vercel Pro's ceiling; Hobby is 60). Median
// extraction is 22s, tail 51s; a batch that processes 5 in a row
// worst-cases at ~4-5 min. We stop CLAIMING (not extracting) once
// (Date.now() - t0) exceeds BUDGET_MS. Extractions in flight are
// awaited to completion; only the CLAIM loop is time-boxed. That way
// we never leave a row half-processed at wall-clock cutoff.
//
// ─── Cron schedule ────────────────────────────────────────────────────────
//
// vercel.json entry (this PR adds it): every 5 minutes. Vercel Pro
// allows any-minute crons; */5 is the frequency Kevin's spec asked for.
// Faster would spend Anthropic tokens on empty ticks; slower would
// stretch p95 submit-to-complete beyond the 15-minute target.
//
// ─── What it does NOT do ──────────────────────────────────────────────────
//
// - Does not modify extractAndStoreLineItems. That path is preserved
//   byte-identical from pre-A1; the ONLY change is who calls it.
// - Does not touch pg_failed rows. Those need manual DELETE-then-
//   INSERT per Kevin's 2026-08-12 ruling (see backfill script for
//   the ruling application). Worker treats pg_failed as terminal
//   and skips.
// - Does not touch photo-only rows. That status is dead going forward
//   (see the EXTRACTION_PROMPT comment in invoiceActions.js:1307-1314);
//   historical rows keep it and stay out of the queue.
// ═══════════════════════════════════════════════════════════════════════════

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getServiceClient } from "@/lib/supabase";
import { extractAndStoreLineItems } from "@/lib/invoiceActions";
import {
  classifyExtractionFailure,
  nextAttemptAt,
  EXTRACTION_MAX_ATTEMPTS,
} from "@/lib/invoiceActions";
import { updateInvoiceFields } from "@/lib/dataStore";
import { downloadAndExtractPages } from "@/lib/extractionPages";

export const runtime      = "nodejs";
export const dynamic      = "force-dynamic";
// Vercel Pro allows up to 300s per function. Median extraction is 22s,
// tail 51s; 300s leaves comfortable headroom for a small batch.
export const maxDuration  = 300;

// ─── Tunables ─────────────────────────────────────────────────────────────
// CLAIM_LIMIT: max rows a single get_extraction_claims call takes. Small
// enough that the SQL lock hold is short; the loop can call again if
// there's budget.
const CLAIM_LIMIT = 3;
// LEASE_SECS: how long a claim is exclusive. Must exceed maxDuration so
// that a killed worker's claim is guaranteed to have expired by the
// next tick (5 min cron cadence + 5 min lease = never overlap).
const LEASE_SECS = 300;
// BUDGET_MS: stop CLAIMING once we've spent this much wall-clock.
// Extraction in flight is awaited to completion; only new claims stop.
const BUDGET_MS = 240_000; // 4 min - leaves 60s headroom under maxDuration.

export async function GET(request) {
  // ─── Auth ────────────────────────────────────────────────────────────
  const authHeader = request.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Vercel injects a stable-per-invocation id header; falls back to a
  // uuid for local runs or when the header is missing. This is written
  // to ai_scan_claimed_by so log-grepping can pair a claim to its worker.
  const workerId = request.headers.get("x-vercel-id") || `local-${randomUUID().slice(0, 8)}`;

  const t0 = Date.now();
  const summary = {
    ok: true,
    workerId,
    tookMs: 0,
    claimed: 0,
    complete: 0,
    retriedSoon: 0,
    retriedLater: 0,
    terminal: 0,
    pgFailed: 0,
    driveErrors: 0,
    perInvoice: [],
  };

  const supabase = getServiceClient();

  // ─── Claim loop ──────────────────────────────────────────────────────
  while (Date.now() - t0 < BUDGET_MS) {
    let claims;
    try {
      const { data, error } = await supabase.rpc("get_extraction_claims", {
        p_limit:         CLAIM_LIMIT,
        p_lease_seconds: LEASE_SECS,
        p_worker_id:     workerId,
      });
      if (error) {
        summary.ok = false;
        summary.claimError = error.message;
        break;
      }
      claims = data || [];
    } catch (e) {
      summary.ok = false;
      summary.claimError = e.message;
      break;
    }

    if (claims.length === 0) {
      // Nothing to do this tick.
      break;
    }
    summary.claimed += claims.length;

    for (const claim of claims) {
      // Re-check budget between claims - a slow extraction can eat the
      // remainder even though we already had headroom when we claimed.
      // We still process THIS claim (never abandon a claimed row) but
      // won't fetch another batch after.
      const clientUuid = claim.client_uuid;
      const perRow = {
        uuid: clientUuid,
        account: claim.account_key,
        vendor: claim.vendor_name,
        attempt: claim.ai_scan_attempt,
        outcome: null,
        elapsedMs: 0,
      };

      const rowT0 = Date.now();

      // 1. Look up raw_drive_url. get_extraction_claims doesn't return
      //    it (kept the function payload minimal so a schema change on
      //    invoice_submissions doesn't force a function-signature change);
      //    a targeted read here is one round-trip.
      const { data: sub, error: subErr } = await supabase
        .from("invoice_submissions")
        .select("raw_drive_url, invoice_number, invoice_date, type")
        .eq("client_uuid", clientUuid)
        .maybeSingle();
      if (subErr || !sub) {
        perRow.outcome = "lookup_error";
        perRow.error = subErr?.message || "row disappeared between claim and lookup";
        await releaseAsFailed(supabase, clientUuid, perRow.error, claim.ai_scan_attempt);
        summary.terminal++;
        perRow.elapsedMs = Date.now() - rowT0;
        summary.perInvoice.push(perRow);
        continue;
      }

      if (!sub.raw_drive_url) {
        // Cannot extract without a source PDF. Terminal.
        perRow.outcome = "no_raw_drive_url";
        await releaseAsFailed(supabase, clientUuid, "raw_drive_url missing - cannot re-extract", claim.ai_scan_attempt);
        summary.terminal++;
        perRow.elapsedMs = Date.now() - rowT0;
        summary.perInvoice.push(perRow);
        continue;
      }

      // 2. Download pages from Drive.
      const { pages, error: dlErr } = await downloadAndExtractPages(sub.raw_drive_url);
      if (dlErr || !pages || pages.length === 0) {
        summary.driveErrors++;
        const cause = dlErr || "no extractable pages in PDF";
        const cls = classifyExtractionFailure(cause);
        const naa = nextAttemptAt(cls.class, claim.ai_scan_attempt);
        if (naa === null) {
          perRow.outcome = "drive_terminal";
          perRow.error = cause;
          await releaseAsFailed(supabase, clientUuid, cause, claim.ai_scan_attempt);
          summary.terminal++;
        } else {
          perRow.outcome = "drive_retry";
          perRow.error = cause;
          await releaseAsRetry(supabase, clientUuid, naa);
          if (cls.class === "retryable-later") summary.retriedLater++;
          else summary.retriedSoon++;
        }
        perRow.elapsedMs = Date.now() - rowT0;
        summary.perInvoice.push(perRow);
        continue;
      }

      // 3. Run the SAME production extraction path. This writes both
      //    stores via the orchestrator and calls markScanStatus at
      //    the end. We do NOT change that behavior in A1.
      const metadata = {
        account:       claim.account_key,
        vendor:        claim.vendor_name || "",
        invoiceNumber: sub.invoice_number || "",
        invoiceDate:   sub.invoice_date || "",
        formType:      sub.type || "invoice",
      };
      try {
        await extractAndStoreLineItems(clientUuid, pages, metadata);
      } catch (throwErr) {
        // extractAndStoreLineItems catches internally; a throw here is
        // exceptional (a bug in the retry helper, or updateInvoiceFields
        // threw). Treat as retryable-soon under the attempt ceiling.
        const cause = `worker: extractAndStoreLineItems threw: ${throwErr.message}`;
        const cls = classifyExtractionFailure(cause);
        const naa = nextAttemptAt(cls.class, claim.ai_scan_attempt);
        if (naa === null) {
          perRow.outcome = "worker_throw_terminal";
          perRow.error = cause;
          await releaseAsFailed(supabase, clientUuid, cause, claim.ai_scan_attempt);
          summary.terminal++;
        } else {
          perRow.outcome = "worker_throw_retry";
          perRow.error = cause;
          await releaseAsRetry(supabase, clientUuid, naa);
          summary.retriedSoon++;
        }
        perRow.elapsedMs = Date.now() - rowT0;
        summary.perInvoice.push(perRow);
        continue;
      }

      // 4. Re-read the row to see where extractAndStoreLineItems
      //    landed it. markScanStatus wrote the terminal state; we
      //    interpret it and release the lease.
      const { data: post } = await supabase
        .from("invoice_submissions")
        .select("ai_scan_status, ai_scan_error, ai_scan_attempt")
        .eq("client_uuid", clientUuid)
        .maybeSingle();

      const finalStatus = post?.ai_scan_status;
      perRow.finalStatus = finalStatus;

      if (finalStatus === "complete") {
        perRow.outcome = "complete";
        await updateInvoiceFields(clientUuid, {
          aiScanClaimedAt: null,
          aiScanClaimedBy: null,
          aiScanNextAttemptAt: null,
          aiScanError: null,
        }, { module: "ops" });
        summary.complete++;
      } else if (finalStatus === "pg_failed") {
        // Terminal per Kevin's ruling - Sheets has the rows, PG needs
        // manual DELETE-then-INSERT. Don't loop.
        perRow.outcome = "pg_failed";
        perRow.error = post?.ai_scan_error;
        await updateInvoiceFields(clientUuid, {
          aiScanClaimedAt: null,
          aiScanClaimedBy: null,
        }, { module: "ops" });
        summary.pgFailed++;
      } else if (finalStatus === "failed") {
        // Classify and decide retry vs terminal.
        const cause = post?.ai_scan_error || "unknown (ai_scan_error null)";
        const cls = classifyExtractionFailure(cause);
        const naa = nextAttemptAt(cls.class, claim.ai_scan_attempt);
        if (naa === null) {
          // Terminal - already at 'failed', just release the lease and
          // clear next_attempt_at so it's out of the queue index.
          perRow.outcome = "terminal";
          perRow.error = cause;
          perRow.class = cls.class;
          await updateInvoiceFields(clientUuid, {
            aiScanClaimedAt: null,
            aiScanClaimedBy: null,
            aiScanNextAttemptAt: null,
          }, { module: "ops" });
          summary.terminal++;
        } else {
          // Retry - flip 'failed' back to 'queued' with backoff so the
          // eligibility predicate in get_extraction_claims picks it up.
          perRow.outcome = "retry";
          perRow.error = cause;
          perRow.class = cls.class;
          perRow.nextAttemptAt = naa.toISOString();
          await updateInvoiceFields(clientUuid, {
            aiScanStatus: "queued",
            aiScanNextAttemptAt: naa,
            aiScanClaimedAt: null,
            aiScanClaimedBy: null,
          }, { module: "ops" });
          if (cls.class === "retryable-later") summary.retriedLater++;
          else summary.retriedSoon++;
        }
      } else {
        // Any other state (queued still, photo-only, null) is anomalous
        // for a row that just went through extraction. Log and release
        // the lease; leave the status alone so we can triage.
        perRow.outcome = "anomalous_final_status";
        perRow.error = `finalStatus=${finalStatus}`;
        await updateInvoiceFields(clientUuid, {
          aiScanClaimedAt: null,
          aiScanClaimedBy: null,
        }, { module: "ops" });
        summary.terminal++;
      }

      perRow.elapsedMs = Date.now() - rowT0;
      summary.perInvoice.push(perRow);
    }
  }

  summary.tookMs = Date.now() - t0;
  return NextResponse.json(summary);
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function releaseAsFailed(supabase, clientUuid, cause, attempt) {
  try {
    await updateInvoiceFields(clientUuid, {
      aiScanStatus: "failed",
      aiScanError: cause,
      aiScanClaimedAt: null,
      aiScanClaimedBy: null,
      aiScanNextAttemptAt: null,
      aiScanAttempt: attempt,
    }, { module: "ops" });
  } catch (e) {
    console.error(`[extract-line-items] releaseAsFailed ${clientUuid} threw:`, e.message);
  }
}

async function releaseAsRetry(supabase, clientUuid, nextAt) {
  try {
    await updateInvoiceFields(clientUuid, {
      aiScanStatus: "queued",
      aiScanNextAttemptAt: nextAt,
      aiScanClaimedAt: null,
      aiScanClaimedBy: null,
    }, { module: "ops" });
  } catch (e) {
    console.error(`[extract-line-items] releaseAsRetry ${clientUuid} threw:`, e.message);
  }
}
