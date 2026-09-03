// ═══════════════════════════════════════════════════════════════════
// qboAdapter - POST invoices to QuickBooks via the ngrok proxy.
// PR-C of the SC -> QBO billing arc. 2026-08-11.
// ═══════════════════════════════════════════════════════════════════
//
// Spec authority: docs/SC_QBO_SHAPE_SPEC.md §7 (posting protocol) +
// §9 (notification design). PR-B built the pure payload; PR-C
// carries it into QBO with the idempotency, retry, and test-marking
// discipline the spec calls for.
//
// ─── HARD FENCES (PR-F: per-mode allowlist) ───────────────────────
//
// 1. `allowedCustomerIdsFor(mode, accountMap)` returns the singleton
//    allowlist that applies to a given mode+account:
//      test mode -> Set(["22463"])            (ZZ TEST customer)
//      live mode -> Set([accountMap.qbo_customer_id])
//    Any payload whose CustomerRef.value is not in the resolved set
//    is REFUSED at the top of postInvoiceDraft, BEFORE the network.
//    Enforcement is by constant (test mode) + by explicit read from
//    the account_map row (live mode) - a code path cannot silently
//    reach a customer other than the one the mode+account authorize.
//
//    PR-D shipped a stub that returned 'test' for both pilots; PR-F
//    swaps that for the real read from sc_qbo_account_map.qbo_mode
//    (sc-35). Both pilots stay in 'test' when this PR merges.
//
// 2. **No send path exists.** No call sets EmailStatus. No call
//    hits QBO's SendInvoice operation. QBO drafts stay drafts
//    forever from this PR's perspective. Sebastian sends manually.
//    grep -RIn 'EmailStatus\|SendInvoice\|/send' src/lib/billing
//    finds zero hits after this PR merges.
//
// 3. Kevin's proxy key is READ-ONLY until Josh enables write; POST
//    attempts fail with an HTTP auth error while that is true. The
//    adapter records those failures the same way it records any
//    other 4xx: 'failed' ledger row, no retry, error text captured.
//
// ─── Test-marking (spec test protocol, Kevin ruled 2026-08-10) ────
//
// When `isTest: true`, the adapter mutates a COPY of the payload
// before hashing / posting:
//   - CustomerRef -> { value: '22463', name: 'ZZ TEST - KitchFix Intranet' }
//   - TxnDate     -> same weekday in 2029 (keeps test invoices out of
//                    every real reporting period + A/R bucket)
//   - CustomerMemo -> loud warning literal (spec §7)
//   - PrivateNote  -> loud warning + account + real week span +
//                     payload hash (traceability post-mortem)
//   - every Line.Description -> `TEST - ${original}`
//   - ledger row: is_test=true, status='test' on success
//
// When `isTest: false`, the payload passes through unchanged. The
// fence still checks CustomerRef.value; if it is not 22463 the POST
// never happens (in this PR - by design).
//
// ─── Idempotency (spec §7 rule 1) ──────────────────────────────────
//
// Before any network call, SELECT sc_export_ledger for the
// (account, week_start, invoice_slot) tuple filtered to the LIVE
// status set. For non-test posts that means WHERE
// status='created' AND is_test=false (matches the partial unique
// index). For test posts we skip the idempotency guard - a re-post
// of the same test creates a new attempt row (spec §7 explicitly
// allows this so Sebastian can re-generate a demo without needing
// to delete rows). Test rows still get monotonically-increasing
// attempt numbers so the ledger stays audit-friendly.
//
// A live row makes the call a no-op returning the prior
// { qboInvoiceId, qboDocNumber, ledgerRowId, wasNoOp: true }.
// This is the single most important guard in the file - duplicate
// posting is the worst failure mode available here, and the
// partial unique index will refuse the DUPLICATE INSERT even if
// this guard misses. Two independent locks.
//
// ─── Retry policy (spec §7 rule 3) ─────────────────────────────────
//
// One retry on 5xx or network error, with 500ms jitter. Never on
// 4xx (4xx = payload the API rejects; retrying will produce the
// same rejection). Final failure writes a `failed` ledger row and
// throws. Never swallow.
//
// ─── Wire-shape discipline (owner correction 2026-08-11) ──────────
//
// The builder wraps each invoice with two convenience fields for
// callers: `_slot` (main|rehab) and `_preTaxSubtotal`. Those are
// internal markers - QBO's Invoice API rejects any unknown property
// with a 400 (verified 2026-08-11: code 2010 "Request has invalid
// or unsupported property"). The adapter therefore:
//   1. Reads `_slot` off the raw payload into a local (used to
//      compose the ledger row).
//   2. Calls `stripInternalMarkers` before hashing + POST, so both
//      the fingerprint stored in the ledger AND the bytes sent to
//      QBO are the exact same clean shape.
// Assertion in the test suite: no key starting with `_` survives
// into a posted payload.
//
// ─── URL composition ──────────────────────────────────────────────
//
// URL is composed from two env vars: QBO_PROXY_BASE (proxy prefix,
// e.g. `https://chief.ngrok.app/qbo`) + QBO_REALM_ID (numeric realm,
// e.g. `1219933770`). Assembly is `${base}/v3/company/${realm}/invoice
// ?minorversion=75`. `composeInvoiceUrl` strips trailing slashes off
// the base and URL-encodes the realm. Splitting them lets Josh
// rotate proxy hosting without touching realm and vice versa.

import crypto from "node:crypto";
import { getServiceClient } from "@/lib/supabase";

// ─── Fences ───────────────────────────────────────────────────────
// PR-F: per-mode fence. Test mode allows ONLY the ZZ TEST customer;
// live mode allows ONLY the account's own qbo_customer_id. Both
// paths converge on the same "one customer per POST" invariant -
// no code path can post to a customer other than the one the mode +
// accountMap explicitly authorize.
export const TEST_CUSTOMER_ID     = "22463";
export const TEST_CUSTOMER_NAME   = "ZZ TEST - KitchFix Intranet";
export const TEST_MEMO =
  "*** TEST - NOT A REAL INVOICE - GENERATED BY KITCHFIX INTRANET - DO NOT SEND ***";

// Returns the singleton allowlist that applies for a given mode +
// account. Test mode ignores accountMap and locks to 22463; live
// mode returns the account's own customer id and refuses if it is
// missing (guards against a partially-populated account_map row
// slipping through as "any customer").
export function allowedCustomerIdsFor(mode, accountMap) {
  if (mode === "test") return Object.freeze(new Set([TEST_CUSTOMER_ID]));
  if (mode === "live") {
    const id = accountMap?.qbo_customer_id ? String(accountMap.qbo_customer_id) : null;
    if (!id) {
      throw new Error(
        `allowedCustomerIdsFor: live mode requires accountMap.qbo_customer_id (accountKey=${accountMap?.account_key || "?"}).`
      );
    }
    return Object.freeze(new Set([id]));
  }
  throw new Error(`allowedCustomerIdsFor: unknown mode ${JSON.stringify(mode)}`);
}

// Kept for backwards compat with PR-C tests that grep the constant.
// The active fence is allowedCustomerIdsFor above; this export is
// now the test-mode singleton specifically.
export const ALLOWED_CUSTOMER_IDS = Object.freeze(new Set([TEST_CUSTOMER_ID]));

// URL construction reads QBO_PROXY_BASE + QBO_REALM_ID from env
// separately, per owner correction 2026-08-11 after the initial C7
// attempts revealed the env carried the short prefix
// (`https://chief.ngrok.app/qbo`) without `/v3/company/{realm}`.
// Composing here from two env vars means Josh can rotate proxy
// hosting without touching realm, and vice versa. See
// `composeInvoiceUrl` below for the exact assembly.
export function composeInvoiceUrl(proxyBase, realmId) {
  if (!proxyBase) throw new Error("composeInvoiceUrl: proxyBase required");
  if (!realmId)   throw new Error("composeInvoiceUrl: realmId required");
  const stripped = String(proxyBase).replace(/\/+$/, "");
  return `${stripped}/v3/company/${encodeURIComponent(realmId)}/invoice?minorversion=75`;
}

// ─── Errors (named so callers can branch cleanly) ─────────────────
export class NotAllowlistedError extends Error {
  constructor(customerId, mode, allowlist) {
    const listStr = allowlist ? `[${[...allowlist].join(",")}]` : "?";
    super(
      `qboAdapter: CustomerRef.value=${JSON.stringify(customerId)} is not in mode=${mode || "?"} allowlist ${listStr}. Per-mode fence rejected.`
    );
    this.name = "NotAllowlistedError";
    this.customerId = customerId;
    this.mode = mode || null;
    this.allowlist = allowlist ? [...allowlist] : null;
  }
}

export class QboPostError extends Error {
  constructor(status, body) {
    super(`qboAdapter: QBO POST failed status=${status} body=${String(body).slice(0, 200)}`);
    this.name = "QboPostError";
    this.status = status;
    this.body = body;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

// SHA256 over a stable serialization of the payload. Object keys
// serialize in insertion order in JSON.stringify; we accept that
// because the payload builder produces keys in a stable order.
// Result is 64 lowercase hex chars (matches sc_export_ledger CHECK).
export function payloadHash(payload) {
  const json = JSON.stringify(payload);
  return crypto.createHash("sha256").update(json).digest("hex");
}

// Shift an ISO date to the same weekday in 2029. Keeps the test
// invoice's TxnDate structurally recognizable AND makes sure it is
// nowhere near any real accounting period.
export function shiftTxnDateToTestYear(iso) {
  if (typeof iso !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new Error(`shiftTxnDateToTestYear: bad ISO ${iso}`);
  }
  const src = new Date(`${iso}T12:00:00Z`);
  const srcDow = src.getUTCDay(); // 0=Sun..6=Sat
  // Find the FIRST Jan 1 of 2029 and walk forward to the same weekday.
  const y2029Jan1 = new Date(Date.UTC(2029, 0, 1, 12, 0, 0));
  const target = new Date(y2029Jan1);
  const delta = (srcDow - target.getUTCDay() + 7) % 7;
  target.setUTCDate(target.getUTCDate() + delta);
  return target.toISOString().slice(0, 10);
}

// Strip builder-only markers (`_slot`, `_preTaxSubtotal`) before
// serializing for POST. QBO's Invoice API rejects any unsupported
// property with a 400 - verified 2026-08-11 on the second C7 attempt.
// _slot is read into the ledger via ctx; _preTaxSubtotal is
// recomputed from Line[] via sumPretaxCents.
export function stripInternalMarkers(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const { _slot, _preTaxSubtotal, ...clean } = payload;
  return clean;
}

// Rewrite a payload for test posting. Returns a deep-cloned payload
// with all test markers applied.
export function markPayloadAsTest(payload, { accountKey, weekStart, weekEnd }) {
  // Deep clone via JSON. Adequate for the payload shape (no
  // functions, no circular refs, no Date instances).
  const clone = JSON.parse(JSON.stringify(payload));

  clone.CustomerRef = { value: TEST_CUSTOMER_ID, name: TEST_CUSTOMER_NAME };
  clone.TxnDate     = shiftTxnDateToTestYear(clone.TxnDate);
  clone.CustomerMemo = { value: TEST_MEMO };

  // PrivateNote includes traceability so a post-mortem can find the
  // real account/week this test was cloned from. Hash is over the
  // ORIGINAL payload (pre-mark), computed by the caller before this
  // function so we do not compute it twice.
  const privateNote =
    `${TEST_MEMO} · account=${accountKey} · real_week=${weekStart}..${weekEnd}`;
  clone.PrivateNote = privateNote;

  // Prefix every line description. Description may be undefined; we
  // preserve that by prefixing only when a description exists.
  for (const line of (clone.Line || [])) {
    if (line.DetailType !== "SalesItemLineDetail") continue;
    if (typeof line.Description === "string" && line.Description.length > 0) {
      line.Description = `TEST - ${line.Description}`;
    } else {
      line.Description = "TEST";
    }
  }

  return clone;
}

// Ledger read: returns the LIVE row (status='created' + is_test=false)
// for (account, week, slot) if one exists. Used for idempotency.
async function readLiveLedgerRow(supa, { accountKey, weekStart, invoiceSlot }) {
  const { data, error } = await supa
    .from("sc_export_ledger")
    .select("id, qbo_invoice_id, qbo_doc_number, pretax_total_cents, attempt")
    .eq("account_key", accountKey)
    .eq("week_start", weekStart)
    .eq("invoice_slot", invoiceSlot)
    .eq("status", "created")
    .eq("is_test", false)
    .maybeSingle();
  if (error) {
    throw new Error(`readLiveLedgerRow: ${error.message}`);
  }
  return data || null;
}

// Ledger read: returns the highest attempt number seen for
// (account, week, slot) regardless of status. Used to bump attempt.
async function readMaxAttempt(supa, { accountKey, weekStart, invoiceSlot }) {
  const { data, error } = await supa
    .from("sc_export_ledger")
    .select("attempt")
    .eq("account_key", accountKey)
    .eq("week_start", weekStart)
    .eq("invoice_slot", invoiceSlot)
    .order("attempt", { ascending: false })
    .limit(1);
  if (error) throw new Error(`readMaxAttempt: ${error.message}`);
  return (data && data[0]?.attempt) || 0;
}

async function writeLedgerRow(supa, row) {
  const { data, error } = await supa
    .from("sc_export_ledger")
    .insert(row)
    .select("id")
    .single();
  if (error) throw new Error(`sc_export_ledger insert: ${error.message}`);
  return data.id;
}

// Sum cents from the payload's Line[] Amount values. UnitPrice x Qty
// is already rounded to cents by the builder (spec §4 rule 5), so
// Amount is a cent-round dollar figure; we multiply by 100 and round.
function sumPretaxCents(payload) {
  let cents = 0;
  for (const line of (payload.Line || [])) {
    if (line.DetailType !== "SalesItemLineDetail") continue;
    cents += Math.round(Number(line.Amount) * 100);
  }
  return cents;
}

// ─── Network layer ────────────────────────────────────────────────

// POST once. Returns { ok, status, body } - never throws on non-2xx
// so the retry/policy code can decide what to do.
async function doPost(url, apiKey, payload) {
  try {
    const res = await fetch(url, {
      method:  "POST",
      headers: { "X-API-Key": apiKey, "Content-Type": "application/json", "Accept": "application/json" },
      body:    JSON.stringify(payload),
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    // Network error (DNS, connection refused, TLS, etc.). We treat
    // it like a 5xx for retry purposes.
    return { ok: false, status: 0, body: `network: ${err?.message || String(err)}` };
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Main entry: postInvoiceDraft ─────────────────────────────────

/**
 * POST an invoice payload to QBO as a DRAFT (never sent). Handles
 * idempotency, test-marking, fence, retry, and ledger write.
 *
 * @param {Object}   payload   Full QBO invoice payload from
 *                             src/lib/billing/buildInvoicePayload.
 *                             Must carry `_slot` (main|rehab).
 * @param {Object}   ctx
 * @param {"test"|"live"} ctx.qboMode  Per-account mode from
 *                                     sc_qbo_account_map.qbo_mode.
 *                                     Test: apply markers + route to
 *                                     22463. Live: pass through +
 *                                     route to accountMap.qbo_customer_id.
 * @param {Object}   ctx.accountMap  Full sc_qbo_account_map row for
 *                                   the account. Used for the live
 *                                   fence lookup + as a schema anchor.
 * @param {string}   ctx.accountKey  Real account (used for ledger + trace).
 * @param {string}   ctx.weekStart   ISO Monday of the real week.
 * @param {string}   ctx.weekEnd     ISO closing Sunday of the real week.
 * @param {string}   ctx.cadenceUnit 'weekly' | 'biweekly'.
 * @param {string}   ctx.createdBy   Actor identity for the ledger.
 * @param {Object}   [ctx.deps]      { supa, fetchImpl } for testing.
 *
 * @returns {Promise<{
 *   wasNoOp: boolean, ledgerRowId: string, qboInvoiceId?: string,
 *   qboDocNumber?: string, status: 'created'|'test'|'failed'
 * }>}
 */
export async function postInvoiceDraft(payload, ctx) {
  if (!payload) throw new Error("postInvoiceDraft: payload required");
  if (!ctx?.accountKey) throw new Error("postInvoiceDraft: accountKey required");
  if (!ctx?.weekStart)  throw new Error("postInvoiceDraft: weekStart required");
  if (!ctx?.weekEnd)    throw new Error("postInvoiceDraft: weekEnd required");
  if (!ctx?.cadenceUnit) throw new Error("postInvoiceDraft: cadenceUnit required");
  if (!ctx?.createdBy)  throw new Error("postInvoiceDraft: createdBy required");
  if (ctx?.qboMode !== "test" && ctx?.qboMode !== "live") {
    throw new Error(
      `postInvoiceDraft: ctx.qboMode required to be 'test' or 'live', got ${JSON.stringify(ctx?.qboMode)}. See sc-35 + addendum §A5.`
    );
  }
  if (ctx.qboMode === "live" && !ctx?.accountMap?.qbo_customer_id) {
    throw new Error(
      "postInvoiceDraft: live mode requires ctx.accountMap.qbo_customer_id (per-mode fence read)."
    );
  }
  // sc-41: parity guard with qbo_customer_id above. buildInvoicePayload
  // has already thrown on missing qbo_class_id at build time, so a
  // live payload reaching this call site with a valid CustomerRef but
  // no class id shouldn't be possible; the adapter still checks the
  // fence so a hand-built payload cannot slip through unclassed.
  if (ctx.qboMode === "live" && !ctx?.accountMap?.qbo_class_id) {
    throw new Error(
      "postInvoiceDraft: live mode requires ctx.accountMap.qbo_class_id (per-line ClassRef seed)."
    );
  }

  const invoiceSlot = payload._slot || "main";
  const isTest = ctx.qboMode === "test";
  const supa   = ctx.deps?.supa   || getServiceClient();
  const doHttp = ctx.deps?.fetchImpl || doPost;

  // ─── Idempotency check (non-test only) ────────────────────────
  if (!isTest) {
    const live = await readLiveLedgerRow(supa, {
      accountKey:  ctx.accountKey,
      weekStart:   ctx.weekStart,
      invoiceSlot,
    });
    if (live) {
      return {
        wasNoOp: true,
        ledgerRowId:   live.id,
        qboInvoiceId:  live.qbo_invoice_id,
        qboDocNumber:  live.qbo_doc_number,
        status:        "created",
      };
    }
  }

  // ─── Test-marking (if isTest) ─────────────────────────────────
  // Applied BEFORE the fence so the fence sees the post-mark
  // CustomerRef (22463). Applied AFTER idempotency so a re-post of
  // the same real week can still find its live ledger row when the
  // caller flips isTest off in the future.
  const marked = isTest
    ? markPayloadAsTest(payload, {
        accountKey: ctx.accountKey,
        weekStart:  ctx.weekStart,
        weekEnd:    ctx.weekEnd,
      })
    : payload;

  // ─── Strip builder-only internal markers ───────────────────────
  // Owner correction 2026-08-11: the payload_hash must be computed
  // on the EXACT bytes that will be POSTed (and stored in the
  // ledger under that same hash). Stripping FIRST guarantees that
  // (a) the fence sees only the wire-shape payload, (b) the hash
  // stored in the ledger is a fingerprint of the actual wire bytes,
  // and (c) QBO never sees any underscore-prefixed key (spec §7
  // rule 1: unknown property -> 400, verified 2026-08-11).
  const outgoing = stripInternalMarkers(marked);

  // ─── Fence: per-mode allow-list ────────────────────────────────
  // Test mode: only 22463 (structural override applied above already
  // rewrote CustomerRef via markPayloadAsTest, so this is a
  // defensive re-check that a caller cannot silently short-circuit).
  // Live mode: only the account's mapped customer id - refuses any
  // payload targeted at a different customer even if the caller
  // constructs one by mistake.
  const allowlist = allowedCustomerIdsFor(ctx.qboMode, ctx.accountMap);
  const customerId = outgoing?.CustomerRef?.value;
  if (!allowlist.has(String(customerId))) {
    const attempt = (await readMaxAttempt(supa, {
      accountKey:  ctx.accountKey,
      weekStart:   ctx.weekStart,
      invoiceSlot,
    })) + 1;
    const ledgerRowId = await writeLedgerRow(supa, {
      account_key:        ctx.accountKey,
      week_start:         ctx.weekStart,
      week_end:           ctx.weekEnd,
      cadence_unit:       ctx.cadenceUnit,
      invoice_slot:       invoiceSlot,
      payload_hash:       payloadHash(outgoing),
      qbo_invoice_id:     null,
      qbo_doc_number:     null,
      pretax_total_cents: sumPretaxCents(outgoing),
      status:             "failed",
      attempt,
      error:              `NotAllowlistedError: CustomerRef.value=${customerId} not in mode=${ctx.qboMode} allowlist [${[...allowlist].join(",")}]. PR-C per-mode fence rejected.`,
      is_test:            isTest,
      created_by:         ctx.createdBy,
    });
    const err = new NotAllowlistedError(customerId, ctx.qboMode, allowlist);
    err.ledgerRowId = ledgerRowId;
    throw err;
  }

  // ─── Compute pre-post ledger snapshot ─────────────────────────
  // hash + pretax both derived from `outgoing` (stripped, wire-shape).
  const hash        = payloadHash(outgoing);
  const pretaxCents = sumPretaxCents(outgoing);
  const attempt     = (await readMaxAttempt(supa, {
    accountKey:  ctx.accountKey,
    weekStart:   ctx.weekStart,
    invoiceSlot,
  })) + 1;

  // ─── POST (with one retry on 5xx / network) ───────────────────
  // apiKey required at runtime; skipped when tests inject fetchImpl
  // (the injected fake never reads the header).
  const apiKey    = process.env.QBO_PROXY_KEY || (ctx.deps?.fetchImpl ? "test-key" : null);
  const proxyBase = process.env.QBO_PROXY_BASE || (ctx.deps?.fetchImpl ? "https://test.example/qbo" : null);
  const realmId   = process.env.QBO_REALM_ID   || (ctx.deps?.fetchImpl ? "TEST_REALM" : null);
  if (!apiKey)    throw new Error("postInvoiceDraft: QBO_PROXY_KEY required (never echoed)");
  if (!proxyBase) throw new Error("postInvoiceDraft: QBO_PROXY_BASE required");
  if (!realmId)   throw new Error("postInvoiceDraft: QBO_REALM_ID required");
  const url = composeInvoiceUrl(proxyBase, realmId);

  let attemptRes = await doHttp(url, apiKey, outgoing);
  const retriable =
    !attemptRes.ok && (attemptRes.status === 0 || attemptRes.status >= 500);
  if (retriable) {
    await sleep(500);
    attemptRes = await doHttp(url, apiKey, outgoing);
  }

  // ─── Write ledger + return ────────────────────────────────────
  if (!attemptRes.ok) {
    const ledgerRowId = await writeLedgerRow(supa, {
      account_key:        ctx.accountKey,
      week_start:         ctx.weekStart,
      week_end:           ctx.weekEnd,
      cadence_unit:       ctx.cadenceUnit,
      invoice_slot:       invoiceSlot,
      payload_hash:       hash,
      qbo_invoice_id:     null,
      qbo_doc_number:     null,
      pretax_total_cents: pretaxCents,
      status:             "failed",
      attempt,
      error:              String(attemptRes.body).slice(0, 4000),
      is_test:            isTest,
      created_by:         ctx.createdBy,
    });
    const err = new QboPostError(attemptRes.status, attemptRes.body);
    err.ledgerRowId = ledgerRowId;
    throw err;
  }

  // Success. Parse response for id + DocNumber.
  let parsed;
  try { parsed = JSON.parse(attemptRes.body); }
  catch (e) {
    // Body was 2xx but not JSON. Save as failed for safety (payment
    // may have posted; owner + Sebastian read the ledger to reconcile).
    const ledgerRowId = await writeLedgerRow(supa, {
      account_key:        ctx.accountKey,
      week_start:         ctx.weekStart,
      week_end:           ctx.weekEnd,
      cadence_unit:       ctx.cadenceUnit,
      invoice_slot:       invoiceSlot,
      payload_hash:       hash,
      qbo_invoice_id:     null,
      qbo_doc_number:     null,
      pretax_total_cents: pretaxCents,
      status:             "failed",
      attempt,
      error:              `2xx non-JSON body: ${String(attemptRes.body).slice(0, 400)}`,
      is_test:            isTest,
      created_by:         ctx.createdBy,
    });
    throw new QboPostError(attemptRes.status, `2xx non-JSON: ${e?.message}`);
  }
  const qboInvoiceId = parsed?.Invoice?.Id || parsed?.QueryResponse?.Invoice?.[0]?.Id;
  const qboDocNumber = parsed?.Invoice?.DocNumber || parsed?.QueryResponse?.Invoice?.[0]?.DocNumber;

  const ledgerRowId = await writeLedgerRow(supa, {
    account_key:        ctx.accountKey,
    week_start:         ctx.weekStart,
    week_end:           ctx.weekEnd,
    cadence_unit:       ctx.cadenceUnit,
    invoice_slot:       invoiceSlot,
    payload_hash:       hash,
    qbo_invoice_id:     qboInvoiceId || null,
    qbo_doc_number:     qboDocNumber || null,
    pretax_total_cents: pretaxCents,
    status:             isTest ? "test" : "created",
    attempt,
    error:              null,
    is_test:            isTest,
    created_by:         ctx.createdBy,
  });

  return {
    wasNoOp:      false,
    ledgerRowId,
    qboInvoiceId,
    qboDocNumber,
    status:       isTest ? "test" : "created",
  };
}

// Exposed for tests and the live-test post script.
export const _internals = {
  payloadHash,
  shiftTxnDateToTestYear,
  markPayloadAsTest,
  stripInternalMarkers,
  sumPretaxCents,
  composeInvoiceUrl,
  allowedCustomerIdsFor,
  doPost,
};
