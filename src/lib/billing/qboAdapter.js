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
//
// ─── SC-generated DocNumber (sc-49, Kevin ruling 2026-09-26) ──────
//
// Invoices posted by this adapter carry a DocNumber the SC owns:
//   live mode -> deterministic, derived from the invoice's own
//                identity via buildInvoiceDocNumber:
//                  KF{accountCode}{YYMMDD}{slotCode}{revision?}
//                e.g. KFTXRAZ260921MN (first issue),
//                     KFTXRAZ260921MN2 (after one supersede).
//                No sequence, no counter. Same inputs always produce
//                the same number, so a retry after a lost response
//                re-sends the same DocNumber and QBO's duplicate
//                fault (code 6140) is the safety net rather than a
//                second real invoice.
//   test mode -> KFT000000001, KFT000000002, ... from
//                sc_invoice_test_number_seq (sc-48). Kept counter-
//                based because Kevin re-runs tests against the same
//                (account, week, slot); a deterministic test number
//                would collide with itself on the second run.
//
// Why deterministic on live: the sc-48 sequence shared a namespace
// with QBO's own auto-increment. Any manual invoice created in the
// QBO UI silently took our next number (2026-09-26: Sebastian's
// manual invoice consumed KF000000005 before Liz's push tried to).
// A number derived from (account, week, slot, revision) cannot
// collide with a counter because it is not one.
//
// What deterministic gains besides collision-safety:
//   1. Nothing to burn on failure - failed rows record the same
//      number the next attempt will use, so re-submits are exactly
//      that: the same number resent.
//   2. Gaps disappear as a class - no sequence, no gaps.
//   3. Retry-after-lost-response is now safe: two POSTs with the
//      same DocNumber either both succeed (QBO idempotent by
//      DocNumber via the 6140 fault) or the second is refused. The
//      client is never double-billed.
//
// The 6140 handler (Kevin ruling 2026-09-26): on a non-ok POST with
// QBO fault code 6140 (Duplicate Document Number), read the invoice
// QBO already has under that number.
//   - CustomerRef matches our account's qbo_customer_id: adopt.
//     Our own POST landed and the response was lost; record the
//     ledger row as 'created' with the found qbo_invoice_id and
//     return success.
//   - CustomerRef is a different customer: hard fail. Someone else
//     took our number (the Sebastian case). Ledger 'failed' with
//     error text naming the conflicting TxnId + customer; N2 fires.
//   - Not found: hard fail with a distinct error string.
// Never adopt on customer mismatch.
//
// Legacy sequence sc-48 (sc_invoice_number_seq) is RETIRED but not
// dropped. KF000000001..004 issued from it stay in the ledger; the
// sequence is left in place with a COMMENT ON SEQUENCE naming its
// retirement so audit continues to name a real object. See
// docs/GOTCHAS.md for the "KF000000005 is not ours" entry.
//
// Echo assertion (sc-48, Kevin ruling 2026-09-18): the QBO create
// response echoes DocNumber back. If the echoed value differs from
// the value we sent, that is a silent-override signal - either the
// tenant's "Custom transaction numbers" preference is off (verified
// ON at build time but could flip), or QBO's API rejected the sent
// value for some other reason and defaulted. We halt on mismatch,
// write a failed row with the sent value + echoed value, and route
// through the existing N2 notification path so Kevin sees it
// immediately.

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

// sc BillEmail (Kevin ruling 2026-09-24). The invoice payload has never
// carried BillEmail, so Sebastian had to type one in QBO before he
// could send. Read the customer's PrimaryEmailAddr from QBO at push
// time and copy it onto BillEmail. Same shape as composeInvoiceUrl but
// against /customer/<id>.
export function composeCustomerUrl(proxyBase, realmId, customerId) {
  if (!proxyBase) throw new Error("composeCustomerUrl: proxyBase required");
  if (!realmId)   throw new Error("composeCustomerUrl: realmId required");
  if (!customerId) throw new Error("composeCustomerUrl: customerId required");
  const stripped = String(proxyBase).replace(/\/+$/, "");
  return `${stripped}/v3/company/${encodeURIComponent(realmId)}/customer/${encodeURIComponent(customerId)}?minorversion=75`;
}

// sc-49: URL for the QBO query endpoint. Used to look up whoever
// holds a DocNumber when we hit a 6140 duplicate fault, and to
// answer the audit question "which invoice does this DocNumber
// belong to" without adding another entity endpoint.
export function composeQueryUrl(proxyBase, realmId, queryText) {
  if (!proxyBase) throw new Error("composeQueryUrl: proxyBase required");
  if (!realmId)   throw new Error("composeQueryUrl: realmId required");
  if (!queryText) throw new Error("composeQueryUrl: queryText required");
  const stripped = String(proxyBase).replace(/\/+$/, "");
  return `${stripped}/v3/company/${encodeURIComponent(realmId)}/query?query=${encodeURIComponent(queryText)}&minorversion=75`;
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

// sc-48: raised when the DocNumber the SC sent (KF000000042) differs
// from the DocNumber QBO echoed back in the create response. That is
// the only signal we have that QBO silently ignored our sent value -
// either the tenant's Custom transaction numbers preference flipped
// off, or the API rejected the value for some other reason and
// defaulted its own. Halts the ledger write in the "created" shape
// and routes through the existing failure path so N2 fires.
export class DocNumberEchoMismatchError extends Error {
  constructor(sent, echoed) {
    super(
      `qboAdapter: DocNumber echo mismatch. sent=${JSON.stringify(sent)} echoed=${JSON.stringify(echoed)}. ` +
      "QBO silently overrode the sent value - check the tenant's Custom transaction numbers setting."
    );
    this.name = "DocNumberEchoMismatchError";
    this.sent = sent;
    this.echoed = echoed;
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

// sc-48 test path: reserve the next KFT DocNumber from the test
// sequence. Kept counter-based (Kevin ruling 2026-09-26): Kevin re-
// runs tests against the same (account, week, slot), so a
// deterministic test number would collide with itself. sc-49
// switched only the live path.
//
// PostgreSQL sequence semantics: nextval() serialises across
// concurrent callers and advances on rollback. That was load-bearing
// for the sc-48 live sequence (uniqueness under duplicate-refuse);
// for the test path it just means the ledger sees monotonically-
// increasing KFT numbers.
export async function reserveInvoiceDocNumber(supa, isTest) {
  if (!isTest) {
    throw new Error(
      "reserveInvoiceDocNumber: live path retired at sc-49; use buildInvoiceDocNumber for live pushes."
    );
  }
  const rpc = "nextval_sc_invoice_test_number";
  const { data, error } = await supa.rpc(rpc);
  if (error) throw new Error(`reserveInvoiceDocNumber(${rpc}): ${error.message}`);
  if (data == null || !Number.isFinite(Number(data))) {
    throw new Error(`reserveInvoiceDocNumber(${rpc}): non-numeric sequence value ${JSON.stringify(data)}`);
  }
  return `KFT${String(Number(data)).padStart(9, "0")}`;
}

// sc-49: pure function. Live DocNumber derived from the invoice's
// own identity - no I/O, no sequence, no counter. Same inputs
// always produce the same output. Format:
//
//   KF{accountCode}{YYMMDD}{slotCode}{revision?}
//
// Example: KFTXRAZ260921MN   (TXR - AZ, week 2026-09-21, slot MN, first issue)
//          KFTXRAZ260921MN2  (same slot after one supersede)
//
// accountKey drives accountCode: strip non-alphanumerics + uppercase.
// The 14 current account_keys all map to codes that are 4-6 chars,
// distinct, and no code is a prefix of another - so undelimited
// concatenation is unambiguous. Block C of the migration re-asserts
// this at apply time.
//
// weekStart is the service-week Monday (biweekly: the pair start).
// Formatted YYMMDD so a text sort is a date sort. The number must
// match the week_start the ledger writes or idempotency misses.
//
// slotCode is an explicit 2-3 uppercase-letter column on
// sc_qbo_service_map (sc-49 migration). Application layer refuses
// to invoice a slot with a NULL code - fail loudly upstream of the
// reservation seam, do not paper over here.
//
// revision omits the suffix on first issue (1). Suffix appears from
// revision 2 upward, incremented ONLY by superseded ledger rows
// (Kevin ruling): a failed row does NOT bump - re-sending the same
// number is exactly what makes retry-after-lost-response safe, and
// a created row cannot be reached because the idempotency guard
// short-circuits before this call.
//
// Throws BuildDocNumberError (named for callers to branch on) if any
// input is missing or malformed. Missing slotCode surfaces here as
// the last defense; scWeekFinalize is expected to fail loudly first.
export class BuildDocNumberError extends Error {
  constructor(message, field) {
    super(`buildInvoiceDocNumber: ${message}`);
    this.name = "BuildDocNumberError";
    this.field = field || null;
  }
}

export function computeAccountCode(accountKey) {
  if (typeof accountKey !== "string" || !accountKey.trim()) {
    throw new BuildDocNumberError(`accountKey required (got ${JSON.stringify(accountKey)})`, "accountKey");
  }
  const code = accountKey.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (!code) {
    throw new BuildDocNumberError(`accountKey ${JSON.stringify(accountKey)} produced empty code`, "accountKey");
  }
  return code;
}

export function formatWeekStartYYMMDD(weekStart) {
  if (typeof weekStart !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) {
    throw new BuildDocNumberError(`weekStart must be ISO YYYY-MM-DD (got ${JSON.stringify(weekStart)})`, "weekStart");
  }
  return weekStart.slice(2, 4) + weekStart.slice(5, 7) + weekStart.slice(8, 10);
}

export function buildInvoiceDocNumber({ accountKey, weekStart, slotCode, revision }) {
  const code = computeAccountCode(accountKey);
  const yy   = formatWeekStartYYMMDD(weekStart);
  if (typeof slotCode !== "string" || !/^[A-Z]{2,3}$/.test(slotCode)) {
    throw new BuildDocNumberError(`slotCode must match /^[A-Z]{2,3}$/ (got ${JSON.stringify(slotCode)})`, "slotCode");
  }
  const rev = revision == null ? 1 : Number(revision);
  if (!Number.isInteger(rev) || rev < 1) {
    throw new BuildDocNumberError(`revision must be a positive integer (got ${JSON.stringify(revision)})`, "revision");
  }
  const suffix = rev > 1 ? String(rev) : "";
  return `KF${code}${yy}${slotCode}${suffix}`;
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

// GET a QBO entity via the proxy. Same shape as doPost + AbortController
// so a hang on the QBO customer read cannot stall the invoice push.
// Never throws. Timeout absorbed as { ok:false, status:0 }.
const CUSTOMER_READ_TIMEOUT_MS = 8000;
async function doGetCustomer(url, apiKey, { timeoutMs = CUSTOMER_READ_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method:  "GET",
      headers: { "X-API-Key": apiKey, "Accept": "application/json" },
      signal:  controller.signal,
    });
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: `network: ${err?.message || String(err)}` };
  } finally {
    clearTimeout(timer);
  }
}

// Read the customer's PrimaryEmailAddr.Address from QBO. Never throws;
// returns the email string on success or null on any failure (missing
// email, HTTP error, non-JSON body, timeout, network). Logs one line
// per outcome so operators can trace why BillEmail was omitted.
async function readCustomerBillEmail({ proxyBase, realmId, apiKey, customerId, accountKey, fetchImpl }) {
  if (!customerId) {
    console.warn(`[qboAdapter] customer read skipped: no customerId (accountKey=${accountKey || "?"})`);
    return null;
  }
  const url = composeCustomerUrl(proxyBase, realmId, customerId);
  const res = await fetchImpl(url, apiKey);
  if (!res.ok) {
    console.warn(`[qboAdapter] customer read failed for ${accountKey || "?"} customer=${customerId} status=${res.status} - BillEmail omitted`);
    return null;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(res.body);
  } catch (err) {
    console.warn(`[qboAdapter] customer read parse failed for ${accountKey || "?"} customer=${customerId}: ${err?.message || String(err)} - BillEmail omitted`);
    return null;
  }
  const addr = parsed?.Customer?.PrimaryEmailAddr?.Address;
  if (typeof addr !== "string" || !addr.trim()) {
    console.warn(`[qboAdapter] customer has no PrimaryEmailAddr in QBO for ${accountKey || "?"} customer=${customerId} - BillEmail omitted`);
    return null;
  }
  return addr.trim();
}

// sc-49: parse a QBO error body and extract the first Fault Error's
// code + message. QBO returns
//   { Fault: { Error: [{ code: "6140", Message: "...", Detail: "..." }] } }
// on rejection. Returns { code, message, detail } or null if the body
// is not a parseable QBO fault. Never throws.
export function parseQboFaultCode(body) {
  if (body == null) return null;
  const text = typeof body === "string" ? body : String(body);
  if (!text.trim().startsWith("{")) return null;
  let parsed;
  try { parsed = JSON.parse(text); } catch { return null; }
  const err = parsed?.Fault?.Error?.[0] || parsed?.fault?.error?.[0];
  if (!err) return null;
  const code = err.code || err.Code || null;
  return {
    code:    code == null ? null : String(code),
    message: err.Message || err.message || null,
    detail:  err.Detail  || err.detail  || null,
  };
}

// sc-49: read the QBO invoice that currently holds a given
// DocNumber, so the 6140 handler can branch on whether that invoice
// is ours (adopt) or someone else's (hard fail). Same shape as
// readCustomerBillEmail - never throws, returns the invoice object
// on success or null on any failure (not found, HTTP error, timeout,
// network). Uses the QBO query endpoint:
//   SELECT * FROM Invoice WHERE DocNumber = '<val>'
async function readInvoiceByDocNumber({ proxyBase, realmId, apiKey, docNumber, fetchImpl }) {
  if (!docNumber) {
    console.warn(`[qboAdapter] invoice lookup skipped: no docNumber`);
    return null;
  }
  const safe = String(docNumber).replace(/'/g, "");
  const url = composeQueryUrl(proxyBase, realmId,
    `SELECT * FROM Invoice WHERE DocNumber = '${safe}'`);
  const res = await fetchImpl(url, apiKey);
  if (!res.ok) {
    console.warn(`[qboAdapter] invoice lookup failed for docNumber=${docNumber} status=${res.status}`);
    return null;
  }
  let parsed;
  try { parsed = JSON.parse(res.body); }
  catch (err) {
    console.warn(`[qboAdapter] invoice lookup parse failed for docNumber=${docNumber}: ${err?.message || String(err)}`);
    return null;
  }
  const inv = parsed?.QueryResponse?.Invoice?.[0] || null;
  if (!inv) {
    console.warn(`[qboAdapter] invoice lookup returned no rows for docNumber=${docNumber}`);
    return null;
  }
  return inv;
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
 * @param {string}   [ctx.slotCode]  sc-49: slot code for the live
 *                                    DocNumber, e.g. 'MN'. Required
 *                                    on live pushes; ignored in test
 *                                    mode (KFT stays counter-based).
 *                                    scWeekFinalize threads this from
 *                                    sc_qbo_service_map.slot_code.
 * @param {number}   [ctx.revision]  sc-49: revision integer for the
 *                                    live DocNumber. 1 (default) omits
 *                                    the suffix; >=2 appends the digit.
 *                                    scWeekFinalize computes this from
 *                                    the count of `superseded` ledger
 *                                    rows for (account, week, slot).
 * @param {Object}   [ctx.deps]      { supa, fetchImpl, fetchCustomerImpl,
 *                                    fetchInvoiceQueryImpl } for testing.
 *
 * @returns {Promise<{
 *   wasNoOp: boolean, ledgerRowId: string, qboInvoiceId?: string,
 *   qboDocNumber?: string, status: 'created'|'test'|'failed',
 *   adopted?: boolean
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
  // sc-49: slotCode required on live push. scWeekFinalize reads it
  // from sc_qbo_service_map.slot_code and threads it via ctx; we
  // never query for it here (the reservation-seam design property is
  // that nothing that can fail sits AT the seam). This throw is the
  // last defense; the finalize layer is expected to fail loudly
  // first with an operator-language error.
  if (ctx.qboMode === "live" && !ctx?.slotCode) {
    throw new Error(
      "postInvoiceDraft: live mode requires ctx.slotCode (sc_qbo_service_map.slot_code). See sc-49."
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
  // pretaxCents + attempt are DocNumber-independent so they compute
  // here; the payload_hash moves down to after the DocNumber inject
  // so it fingerprints the actual wire bytes (which now include the
  // KF/KFT DocNumber).
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

  // ─── sc BillEmail: read customer's PrimaryEmailAddr from QBO ──
  // Kevin ruling 2026-09-24. The invoice payload has never carried
  // BillEmail, so Sebastian had to type one in QBO before sending.
  // QBO stays source of truth for client contacts; sc_qbo_account_map
  // does not store BillEmail, so the two systems cannot drift.
  //
  // Placed BEFORE the DocNumber reservation seam. A failed customer
  // read AFTER reservation would burn a live KF number for an
  // invoice that never posts. Before the seam, failures cost nothing.
  //
  // NON-FATAL. If the customer has no PrimaryEmailAddr in QBO, if
  // the read returns non-2xx, or if the read errors/times out, we
  // omit BillEmail, log the reason, and push the invoice anyway.
  // The invoice matters more than the pre-filled email field.
  //
  // Test mode: skipped. The test-mode CustomerRef is 22463 (ZZ TEST),
  // whose PrimaryEmailAddr is not the address we want on real
  // invoices; test pushes never need a BillEmail.
  //
  // Test injection: `deps.fetchCustomerImpl` opts a test into
  // exercising this branch. When `deps.fetchImpl` is set but
  // `deps.fetchCustomerImpl` is not, the read is skipped so existing
  // adapter tests don't accidentally hit the real QBO proxy or need
  // to mock a second endpoint.
  const customerFetch = ctx.deps?.fetchCustomerImpl
    ?? (ctx.deps?.fetchImpl ? null : doGetCustomer);
  if (!isTest && customerFetch) {
    const billEmail = await readCustomerBillEmail({
      proxyBase, realmId, apiKey,
      customerId: outgoing?.CustomerRef?.value,
      accountKey: ctx.accountKey,
      fetchImpl: customerFetch,
    });
    if (billEmail) outgoing.BillEmail = { Address: billEmail };
  }

  // ─── DocNumber: build (live) or reserve (test) ────────────────
  // sc-49 (Kevin ruling 2026-09-26):
  //   Live: deterministic - buildInvoiceDocNumber({accountKey,
  //     weekStart, slotCode, revision}). No I/O, no counter. The
  //     same inputs always produce the same number, so a retry
  //     after a lost response re-sends the same DocNumber and QBO's
  //     duplicate fault (6140) is the safety net.
  //   Test: still counter-based - reserveInvoiceDocNumber(supa, true)
  //     against sc_invoice_test_number_seq. Kevin re-runs tests
  //     against the same (account, week, slot); a deterministic
  //     test number would collide with itself.
  //
  // Reservation-seam discipline: buildInvoiceDocNumber is pure, so
  // the seam is now the POST itself. All the properties the sc-48
  // header names still hold - nothing that can fail sits between
  // number resolution and the network. The retry-on-5xx below
  // reuses the SAME docNumber (which under sc-49 is deterministic
  // anyway) - a 5xx is a retry within one attempt, not a new
  // attempt.
  const docNumber = isTest
    ? await reserveInvoiceDocNumber(supa, true)
    : buildInvoiceDocNumber({
        accountKey: ctx.accountKey,
        weekStart:  ctx.weekStart,
        slotCode:   ctx.slotCode,
        revision:   ctx.revision == null ? 1 : ctx.revision,
      });
  outgoing.DocNumber = docNumber;

  // Hash AFTER DocNumber injection so it fingerprints the actual
  // wire bytes. The ledger's payload_hash then uniquely identifies
  // each attempt (different DocNumber -> different hash).
  const hash = payloadHash(outgoing);

  let attemptRes = await doHttp(url, apiKey, outgoing);
  const retriable =
    !attemptRes.ok && (attemptRes.status === 0 || attemptRes.status >= 500);
  if (retriable) {
    await sleep(500);
    attemptRes = await doHttp(url, apiKey, outgoing);
  }

  // ─── Write ledger + return ────────────────────────────────────
  if (!attemptRes.ok) {
    // sc-49: handle QBO duplicate-DocNumber fault (code 6140) before
    // recording a plain failure. Look up whoever holds our DocNumber.
    //   - Ours (CustomerRef matches account's qbo_customer_id):
    //     ADOPT. Our POST landed and the response was lost; write
    //     the ledger as 'created' with the found qbo_invoice_id and
    //     return success. This is what makes retry-after-lost-
    //     response safe.
    //   - Someone else's: HARD FAIL with an error string naming the
    //     conflicting TxnId + customer. Never adopt on mismatch.
    //   - Not found: HARD FAIL with a distinct error string.
    // Test-mode 6140 does not adopt: the test path is counter-based
    // and a 6140 there would mean the test sequence collided with
    // itself, which is a distinct kind of bug (bump the sequence).
    const fault = parseQboFaultCode(attemptRes.body);
    if (!isTest && fault?.code === "6140") {
      const queryFetch = ctx.deps?.fetchInvoiceQueryImpl
        ?? (ctx.deps?.fetchImpl ? null : doGetCustomer);
      const foundInvoice = queryFetch
        ? await readInvoiceByDocNumber({
            proxyBase, realmId, apiKey,
            docNumber, fetchImpl: queryFetch,
          })
        : null;
      const ourCustomerId  = String(ctx.accountMap?.qbo_customer_id || "");
      const foundCustomerId = String(foundInvoice?.CustomerRef?.value || "");
      const foundInvoiceId  = String(foundInvoice?.Id || "");
      if (foundInvoice && ourCustomerId && foundCustomerId === ourCustomerId) {
        // Adopt.
        const ledgerRowId = await writeLedgerRow(supa, {
          account_key:        ctx.accountKey,
          week_start:         ctx.weekStart,
          week_end:           ctx.weekEnd,
          cadence_unit:       ctx.cadenceUnit,
          invoice_slot:       invoiceSlot,
          payload_hash:       hash,
          qbo_invoice_id:     foundInvoiceId,
          qbo_doc_number:     docNumber,
          pretax_total_cents: pretaxCents,
          status:             "created",
          attempt,
          error:              null,
          is_test:            false,
          created_by:         ctx.createdBy,
        });
        console.info(`[qboAdapter] 6140 adopted for ${ctx.accountKey} week=${ctx.weekStart} slot=${invoiceSlot} docNumber=${docNumber} qboInvoiceId=${foundInvoiceId}`);
        return {
          wasNoOp:      false,
          adopted:      true,
          ledgerRowId,
          qboInvoiceId: foundInvoiceId,
          qboDocNumber: docNumber,
          status:       "created",
        };
      }
      // Hard-fail: name the conflict so N2 carries the whole story.
      const errorText = foundInvoice
        ? `docnumber_conflict: QBO error 6140 - ${docNumber} is assigned to TxnId=${foundInvoiceId} for CustomerRef.value=${foundCustomerId || "?"} which does not match our qbo_customer_id=${ourCustomerId || "?"}. Adopt refused. QBO fault: ${fault?.message || ""}`
        : `docnumber_conflict_not_found: QBO error 6140 for ${docNumber} but query returned no matching Invoice. QBO fault: ${fault?.message || ""}`;
      const ledgerRowId = await writeLedgerRow(supa, {
        account_key:        ctx.accountKey,
        week_start:         ctx.weekStart,
        week_end:           ctx.weekEnd,
        cadence_unit:       ctx.cadenceUnit,
        invoice_slot:       invoiceSlot,
        payload_hash:       hash,
        qbo_invoice_id:     null,
        qbo_doc_number:     docNumber,
        pretax_total_cents: pretaxCents,
        status:             "failed",
        attempt,
        error:              errorText.slice(0, 4000),
        is_test:            false,
        created_by:         ctx.createdBy,
      });
      const err = new QboPostError(attemptRes.status, errorText);
      err.ledgerRowId = ledgerRowId;
      err.faultCode = "6140";
      throw err;
    }

    const ledgerRowId = await writeLedgerRow(supa, {
      account_key:        ctx.accountKey,
      week_start:         ctx.weekStart,
      week_end:           ctx.weekEnd,
      cadence_unit:       ctx.cadenceUnit,
      invoice_slot:       invoiceSlot,
      payload_hash:       hash,
      qbo_invoice_id:     null,
      // sc-49: DocNumber is deterministic on the live path, so a
      // failed row records the same number the next attempt will
      // rebuild - no "burned number" to explain. Recorded here for
      // auditor trace.
      qbo_doc_number:     docNumber,
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
    // sc-48: burned KF is recorded here too. See docs/backlog/
    // sc-invoice-double-charge-reconciliation.md for the double-
    // charge risk this class carries.
    const ledgerRowId = await writeLedgerRow(supa, {
      account_key:        ctx.accountKey,
      week_start:         ctx.weekStart,
      week_end:           ctx.weekEnd,
      cadence_unit:       ctx.cadenceUnit,
      invoice_slot:       invoiceSlot,
      payload_hash:       hash,
      qbo_invoice_id:     null,
      qbo_doc_number:     docNumber,
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

  // sc-48: echo assertion. QBO returns DocNumber in the create
  // response; if it does not match what we sent, QBO silently
  // overrode the sent value (Custom transaction numbers preference
  // off, or the API rejected the value for some other reason and
  // defaulted). Halt on mismatch, write a failed row with the
  // burned KF value + explicit error text, and throw so the
  // finalize caller fires N2.
  if (qboDocNumber !== docNumber) {
    const ledgerRowId = await writeLedgerRow(supa, {
      account_key:        ctx.accountKey,
      week_start:         ctx.weekStart,
      week_end:           ctx.weekEnd,
      cadence_unit:       ctx.cadenceUnit,
      invoice_slot:       invoiceSlot,
      payload_hash:       hash,
      qbo_invoice_id:     qboInvoiceId || null,
      qbo_doc_number:     docNumber,
      pretax_total_cents: pretaxCents,
      status:             "failed",
      attempt,
      error:              `docnumber_echo_mismatch: sent=${JSON.stringify(docNumber)} echoed=${JSON.stringify(qboDocNumber)}. QBO may have overridden the sent value silently; verify tenant Custom transaction numbers setting.`,
      is_test:            isTest,
      created_by:         ctx.createdBy,
    });
    const err = new DocNumberEchoMismatchError(docNumber, qboDocNumber);
    err.ledgerRowId = ledgerRowId;
    throw err;
  }

  const ledgerRowId = await writeLedgerRow(supa, {
    account_key:        ctx.accountKey,
    week_start:         ctx.weekStart,
    week_end:           ctx.weekEnd,
    cadence_unit:       ctx.cadenceUnit,
    invoice_slot:       invoiceSlot,
    payload_hash:       hash,
    qbo_invoice_id:     qboInvoiceId || null,
    qbo_doc_number:     qboDocNumber,   // sc-48: equals docNumber post-assertion
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
  composeCustomerUrl,
  composeQueryUrl,
  allowedCustomerIdsFor,
  doPost,
  readInvoiceByDocNumber,
};
