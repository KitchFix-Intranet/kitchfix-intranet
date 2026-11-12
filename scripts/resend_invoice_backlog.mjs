#!/usr/bin/env node
// scripts/resend_invoice_backlog.mjs
//
// P0 recovery (2026-11-12). Chef submissions since 2026-10-16 that
// never reached AP because the user-OAuth Gmail send in step 5 of
// invoiceActions.js failed with `Request had invalid authentication
// credentials. Expected OAuth 2 access token`. The invoice row saved,
// the email did not go, nobody was told. This one-off script resends
// each affected invoice through the system mailbox (sendEmailSA),
// then flips `email_sent = true` via updateInvoiceFields (keeping
// Sheets dual-write intact).
//
// Not in scripts/probes/. Kept.
//
// SELECTION (not hardcoded to any account or submitter):
//   invoice_submissions where email_sent = false
//                        AND status in ('sent', 'returned')
//                        AND submitted_at >= '2026-10-16'
// If this returns anything other than Kevin's expected 33 TXR - AZ
// rows, the script reports the difference and still reports each row;
// Kevin decides whether to proceed.
//
// EMAIL:
//   Subject: "RESENT - " + buildInvoiceSubject(data)
//   Body:    the same invoice HTML the live path emits, with a single
//            "Resent by the intranet on <date>. Originally submitted
//             <submitted date> by <submitter>. The original email was
//             not delivered." line injected at the top.
//   To:      INVOICE_AP_TO_EMAIL (env, same as live)
//   Cc:      original submitter + the shared AP_CC list (minus To/sender)
//   Bcc:     AUDIT_BCC via the shared auditBccFor helper
//   Reply-To: original submitter
//   Sender:  system mailbox (SENDER_EMAIL env), display "KitchFix Invoice Capture"
//
// PACING:
//   One at a time, 1.5s between sends. Stops on the 3rd consecutive
//   failure and reports (idempotent: a rerun picks up the untouched rows).
//
// BILL.COM MATCH CHECK (reporting only, do not send-or-skip decision):
//   For each row, print whether a matching bill already exists in bill.com:
//     - same normalized invoice_number in billcom_raw_bills_latest, OR
//     - same account_key + same amount within $0.01 + txn_date within 7d
//       in purchasing_actuals where source in (billcom, billcom_credit, upload).
//   Kevin decides send-or-skip after reading the dry run. Default if
//   he says nothing: skip the bill.com-matched rows (pass --skip-matched).
//
// USAGE:
//   # dry run (default):
//   node --env-file=.env.local scripts/resend_invoice_backlog.mjs
//
//   # single test send to Kevin only, using the first eligible row:
//   node --env-file=.env.local scripts/resend_invoice_backlog.mjs --test-to k.fietek@kitchfix.com
//
//   # send the batch (bill.com-matched rows sent unless --skip-matched set):
//   node --env-file=.env.local scripts/resend_invoice_backlog.mjs --send
//
//   # send the batch, skipping already-in-bill.com rows:
//   node --env-file=.env.local scripts/resend_invoice_backlog.mjs --send --skip-matched

import { createClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { buildInvoiceSubject, buildInvoiceEmailHtml, sendEmailSA, auditBccFor, AUDIT_BCC_EMAIL } from "@/lib/gmail";
import { extractDriveFileId } from "@/lib/extractionPages";
import { getServiceAccountDriveClient } from "@/lib/sheets";
import { updateInvoiceFields } from "@/lib/dataStore/invoice";

const CUTOFF_SUBMITTED_AT = "2026-10-16T00:00:00Z";
// 2026-11-12 Fix 1. No env fallback for the live AP recipient. The
// --send path requires an explicit --ap-to <addr>. The dry-run has
// no AP recipient at all (nothing leaves the process). gmail.js's
// hardcoded default ("k.fietek@kitchfix.com") is treated as a BAD
// recipient here - if anyone accidentally passes it we refuse to
// send. That default is a Part 2 PR finding, not fixed here.
const GMAIL_HARDCODED_DEFAULT = "k.fietek@kitchfix.com";
const AP_CC = ["k.fietek@kitchfix.com"];
const SENDER_MAILBOX = process.env.INVOICE_RESEND_SENDER || process.env.SA_SENDER || AUDIT_BCC_EMAIL;
const SENDER_DISPLAY = "KitchFix Invoice Capture";
const PACE_MS = 1500;

function parseArgs(argv) {
  const a = { send: false, testTo: null, skipMatched: false, apTo: null, markOnly: false, invoices: null };
  for (let i = 2; i < argv.length; i += 1) {
    const x = argv[i];
    if (x === "--send") a.send = true;
    else if (x === "--skip-matched") a.skipMatched = true;
    else if (x === "--test-to") a.testTo = argv[++i];
    else if (x.startsWith("--test-to=")) a.testTo = x.slice(10);
    else if (x === "--ap-to") a.apTo = argv[++i];
    else if (x.startsWith("--ap-to=")) a.apTo = x.slice(8);
    // 2026-11-12. --mark-only reconciles email_sent across stores for an
    // explicit list of invoice numbers, with NO email build and NO
    // email send. Used to close the Sheets side after a direct PG
    // update Chat-Claude did earlier today. Safety: send code paths
    // are gated behind `!args.markOnly`; this flag cannot reach them.
    else if (x === "--mark-only") a.markOnly = true;
    else if (x === "--invoices") a.invoices = argv[++i];
    else if (x.startsWith("--invoices=")) a.invoices = x.slice(11);
    else { console.error(`unknown arg: ${x}`); process.exit(1); }
  }
  return a;
}
const args = parseArgs(process.argv);

function stamp() { return new Date().toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC"); }
function money(n) { return "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function normInv(s) { return String(s || "").replace(/[^A-Za-z0-9]/g, "").toLowerCase(); }

function requireEnv(name) {
  if (!process.env[name]) { console.error(`${name} is required`); process.exit(1); }
}
requireEnv("SUPABASE_URL");
requireEnv("SUPABASE_SERVICE_ROLE_KEY");
requireEnv("GOOGLE_SERVICE_ACCOUNT_EMAIL");
requireEnv("GOOGLE_PRIVATE_KEY");

const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// 2026-11-12 Fix 1. AP recipient validation. Dry-run: no recipient
// resolution at all, nothing leaves the process. Test-send: resolves
// to --test-to (Kevin only, AP not copied). Live send: --ap-to is
// required and must not be the gmail.js hardcoded default, must not
// be empty, and must not be a member of AP_CC (prevents the sender
// from also being on CC which would land as "sent to self" and
// confuse the audit trail).
function validateApRecipient(resolved) {
  const issues = [];
  if (!resolved || typeof resolved !== "string" || resolved.trim() === "") issues.push("AP recipient is empty");
  if (resolved === GMAIL_HARDCODED_DEFAULT) issues.push(`AP recipient equals gmail.js hardcoded default (${GMAIL_HARDCODED_DEFAULT}) - refuse`);
  if (AP_CC.includes(resolved)) issues.push(`AP recipient is on the CC list (${resolved}) - refuse`);
  return issues;
}
// Headers that WOULD be used on a live send (for dry-run disclosure only).
const dryRunHeaderAp = args.apTo || "(not provided; --send would refuse)";
const dryRunHeaderCc = [...AP_CC];
const dryRunHeaderBcc = [AUDIT_BCC_EMAIL];
const dryRunValidationIssues = args.send ? validateApRecipient(args.apTo) : validateApRecipient(args.apTo || "");

console.log(`# resend_invoice_backlog  ${stamp()}`);
console.log(`# mode:         ${args.testTo ? `test-to ${args.testTo}` : (args.send ? "SEND" : "dry-run")}`);
console.log(`# cutoff:       submitted_at >= ${CUTOFF_SUBMITTED_AT}`);
console.log(`# RESOLVED ADDRESSES (what a live send WOULD use):`);
console.log(`#   To (AP):     ${dryRunHeaderAp}`);
console.log(`#   Cc base:     ${dryRunHeaderCc.join(", ")}  (+ original submitter per row)`);
console.log(`#   Bcc:         ${dryRunHeaderBcc.join(", ")}`);
console.log(`#   Reply-To:    original submitter (per row)`);
console.log(`#   From:        ${SENDER_MAILBOX}  (display "${SENDER_DISPLAY}")`);
if (args.apTo) {
  if (dryRunValidationIssues.length === 0) console.log(`#   ap-to check: OK (would allow live send to ${args.apTo})`);
  else console.log(`#   ap-to check: WOULD REFUSE SEND - ${dryRunValidationIssues.join("; ")}`);
} else {
  console.log(`#   ap-to check: no --ap-to provided; --send would REFUSE`);
}
console.log(`# skip-matched: ${args.skipMatched}`);
console.log(``);

// Hard refuse at the top of the send phase (checked again below) so
// the dry-run output is self-contained. Skipped when --mark-only is
// set: mark-only writes DB only, never sends email, so AP validation
// is irrelevant and would otherwise force a bogus --ap-to on a run
// that goes nowhere.
if (args.send && !args.markOnly) {
  const issues = validateApRecipient(args.apTo);
  if (issues.length > 0) {
    console.error(`# REFUSED: ${issues.join("; ")}`);
    console.error(`# Use: --send --ap-to <AP address>`);
    process.exit(3);
  }
}

// ── 1. SELECT ────────────────────────────────────────────────────────
// 2026-11-12. BUGFIX: added `client_uuid` to the SELECT and switched the
// `updateInvoiceFields(...)` arg from `r.id` to `r.client_uuid`. The
// Sheets side of the dual-write looks up col A, which stores
// `client_uuid`, NOT the PG primary key `id`. The original batch
// passed `id`, Sheets lookup correctly returned null, and every mark
// call threw "uuid not found". Emails WERE delivered; only the
// email_sent flag mark failed. See the Change 1a report
// 2026-11-12 for the investigation trail.
//
// --mark-only: a parallel selection that filters to an explicit
// invoice-number list, so this run reconciles ONLY the rows Kevin
// names (not the 11 bill.com-matched rows). Dry-run still prints.
const invoiceFilter = args.markOnly && args.invoices
  ? args.invoices.split(",").map(s => s.trim()).filter(Boolean)
  : null;
if (args.markOnly && !invoiceFilter) {
  console.error(`# --mark-only requires --invoices <csv of invoice numbers>`);
  process.exit(1);
}

const selQ = supa.from("invoice_submissions")
  .select("id, client_uuid, account_key, submitter_email, vendor_name, vendor_id, invoice_number, invoice_date, total_amount, status, type, gl_breakdown, drive_urls, raw_drive_url, submitted_at, email_sent")
  .in("status", ["sent", "returned"])
  .gte("submitted_at", CUTOFF_SUBMITTED_AT)
  .order("submitted_at", { ascending: true });
// Send mode: email_sent must still be false. Mark-only: can target
// already-sent rows (that is the point - PG is true, Sheets is false).
const sel = await (args.markOnly
  ? selQ.in("invoice_number", invoiceFilter)
  : selQ.eq("email_sent", false));
if (sel.error) { console.error(`select: ${sel.error.message}`); process.exit(2); }
const rows = sel.data || [];
console.log(`# selected: ${rows.length} rows`);
if (rows.length === 0) { console.log(`# nothing to do.`); process.exit(0); }

// Finding: accounts and submitters in the selection.
const byAccount = new Map(), bySubmitter = new Map();
for (const r of rows) {
  byAccount.set(r.account_key, (byAccount.get(r.account_key) || 0) + 1);
  bySubmitter.set(r.submitter_email, (bySubmitter.get(r.submitter_email) || 0) + 1);
}
console.log(`# accounts in selection: ${[...byAccount.entries()].map(([k, n]) => `${k}=${n}`).join(", ")}`);
console.log(`# submitters:            ${[...bySubmitter.entries()].map(([k, n]) => `${k}=${n}`).join(", ")}`);
const EXPECTED_COUNT = 33;
const EXPECTED_ACCOUNT = "TXR - AZ";
if (rows.length !== EXPECTED_COUNT || [...byAccount.keys()].some(k => k !== EXPECTED_ACCOUNT)) {
  console.log(`# FINDING: selection differs from Kevin's expected (${EXPECTED_COUNT} rows, ${EXPECTED_ACCOUNT} only).`);
}

// ── 2. bill.com match set: pull ALL candidate billcom records once ───
// Invoice-number match: billcom_raw_bills_latest invoice_number (normalized).
// Account+amount+date match: purchasing_actuals source in (billcom,
// billcom_credit, upload) for the accounts in play, within the window.
const accountsInPlay = [...byAccount.keys()];
const windowStart = rows.reduce((a, r) => (r.invoice_date && (a == null || r.invoice_date < a)) ? r.invoice_date : a, null);
const windowEnd   = rows.reduce((a, r) => (r.invoice_date && (a == null || r.invoice_date > a)) ? r.invoice_date : a, null);
// Pad by 7 days for the amount-within-7d check.
function addDays(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
async function paginate(builder, pageSize = 1000) {
  const out = [];
  let from = 0;
  while (true) {
    const q = await builder(from, from + pageSize - 1);
    if (q.error) throw new Error(q.error.message);
    out.push(...(q.data || []));
    if ((q.data || []).length < pageSize) break;
    from += pageSize;
  }
  return out;
}
let billcomBills = [];
let purchActualsBilled = [];
try {
  billcomBills = await paginate((f, t) =>
    supa.from("billcom_raw_bills_latest")
      .select("bill_id, invoice_number, invoice_date, amount, vendor_id")
      .order("invoice_date", { ascending: true })
      .range(f, t)
  );
  if (windowStart && windowEnd) {
    purchActualsBilled = await paginate((f, t) =>
      supa.from("purchasing_actuals")
        .select("account_key, source, source_bill_id, txn_date, amount, vendor_or_merchant")
        .in("account_key", accountsInPlay)
        .in("source", ["billcom", "billcom_credit", "upload"])
        .gte("txn_date", addDays(windowStart, -7))
        .lte("txn_date", addDays(windowEnd, 7))
        .range(f, t)
    );
  }
} catch (e) {
  console.error(`bill.com match preload: ${e.message}`);
  process.exit(2);
}
const billcomByInv = new Map();
for (const b of billcomBills) {
  const k = normInv(b.invoice_number);
  if (!k) continue;
  (billcomByInv.get(k) || billcomByInv.set(k, []).get(k)).push(b);
}
function billcomMatchFor(sub) {
  const invKey = normInv(sub.invoice_number);
  const byInv = invKey ? billcomByInv.get(invKey) : null;
  if (byInv && byInv.length > 0) {
    const hit = byInv[0];
    return { kind: "invoice_number", bill_id: hit.bill_id, invoice_number: hit.invoice_number, amount: hit.amount, invoice_date: hit.invoice_date };
  }
  // Fall back to amount within $0.01, |date| within 7d, same account.
  const subAmt = Math.abs(Number(sub.total_amount || 0));
  const subDateMs = sub.invoice_date ? new Date(sub.invoice_date + "T00:00:00Z").getTime() : null;
  if (subDateMs == null) return null;
  for (const r of purchActualsBilled) {
    if (r.account_key !== sub.account_key) continue;
    const amt = Math.abs(Number(r.amount || 0));
    if (Math.abs(amt - subAmt) > 0.01) continue;
    const rMs = r.txn_date ? new Date(r.txn_date + "T00:00:00Z").getTime() : null;
    if (rMs == null) continue;
    if (Math.abs(rMs - subDateMs) / 86400000 > 7) continue;
    return { kind: "amount_and_date", source: r.source, source_bill_id: r.source_bill_id, amount: r.amount, txn_date: r.txn_date };
  }
  return null;
}

// ── MARK-ONLY path (ruling 2, 2026-11-12). ────────────────────────────
// Short-circuits here so the Drive fetcher, email builder, and send
// loop below are physically unreachable when --mark-only is set.
// Only calls updateInvoiceFields to reconcile the Sheets side with
// a direct-PG update Kevin ran earlier. Dry-run by default; --send
// executes the writes.
if (args.markOnly) {
  console.log(``);
  console.log(`# ─── MARK-ONLY: ${rows.length} rows match invoice filter ─────`);
  if (rows.length === 0) { console.log(`# nothing to mark.`); process.exit(0); }
  const expected = (args.invoices || "").split(",").map(s => s.trim()).filter(Boolean);
  const got = new Set(rows.map(r => String(r.invoice_number || "").trim()));
  const missing = expected.filter(x => !got.has(x));
  if (missing.length > 0) {
    console.log(`# WARNING: ${missing.length} invoice number(s) from --invoices did not match any row: ${missing.join(", ")}`);
  }
  for (const r of rows) {
    console.log(`#  ${(r.invoice_number || "(no#)").padEnd(14)}  ${(r.vendor_name || "").padEnd(16)}  client_uuid=${(r.client_uuid || "").slice(0, 8)}...  pg_email_sent=${r.email_sent}`);
  }
  if (!args.send) {
    console.log(``);
    console.log(`# DRY-RUN complete. ${rows.length} rows would be marked email_sent=true via updateInvoiceFields.`);
    console.log(`# Rerun with --send --mark-only --invoices <csv> to execute.`);
    process.exit(0);
  }
  console.log(``);
  console.log(`# ─── EXECUTING mark-only writes ───────────────────────────`);
  const results = { ok: 0, failed: 0, errors: [] };
  for (const r of rows) {
    try {
      await updateInvoiceFields(r.client_uuid, { emailSent: true }, { module: "ops" });
      console.log(`#  OK   ${(r.invoice_number || "(no#)").padEnd(14)}  client_uuid=${r.client_uuid.slice(0, 8)}...`);
      results.ok += 1;
    } catch (e) {
      console.log(`#  FAIL ${(r.invoice_number || "(no#)").padEnd(14)}  client_uuid=${r.client_uuid.slice(0, 8)}...  err=${e.message}`);
      results.failed += 1;
      results.errors.push({ invoice: r.invoice_number, err: e.message });
    }
  }
  console.log(``);
  console.log(`# mark-only summary: ok=${results.ok}  failed=${results.failed}  emails_sent=0`);
  process.exit(results.failed === 0 ? 0 : 2);
}

// ── 3. Drive fetcher (SA; shared read-only client per run) ────────────
const drive = getServiceAccountDriveClient(["https://www.googleapis.com/auth/drive.readonly"]);
async function fetchPdfBase64(driveUrls, rawDriveUrl) {
  const url = (Array.isArray(driveUrls) && driveUrls[0]) || rawDriveUrl;
  if (!url) return { ok: false, error: "no drive_url" };
  const fileId = extractDriveFileId(url);
  if (!fileId) return { ok: false, error: `could not parse fileId from ${url}` };
  try {
    const res = await drive.files.get({ fileId, alt: "media", supportsAllDrives: true }, { responseType: "arraybuffer" });
    const buf = Buffer.from(res.data);
    return { ok: true, base64: buf.toString("base64"), bytes: buf.length };
  } catch (e) {
    return { ok: false, error: `Drive fetch: ${e.message}` };
  }
}

// ── 4. Email builder (reuses the exact AP-facing subject + HTML) ──────
function buildResendEmail(sub) {
  const data = {
    account: sub.account_key,
    vendor: sub.vendor_name,
    vendorId: sub.vendor_id,
    invoiceNumber: sub.invoice_number,
    invoiceDate: sub.invoice_date,
    totalAmount: sub.total_amount,
    glRows: Array.isArray(sub.gl_breakdown) ? sub.gl_breakdown : [],
    driveUrls: Array.isArray(sub.drive_urls) ? sub.drive_urls : [],
    pageCount: 1,
    formType: sub.type || "invoice",
  };
  const typeLabel = data.formType === "credit" ? "Credit / Return"
    : data.formType === "cc_receipt" ? "CC Receipt"
    : "Vendor Invoice";
  const baseSubject = buildInvoiceSubject(data);
  const subject = `RESENT - ${baseSubject}`;
  const liveHtml = buildInvoiceEmailHtml(data, typeLabel, sub.submitter_email);
  // 2026-11-12 Fix 2. Central-time, defensive formatting. Chat-Claude
  // flagged the banner rendering `Originally submitted  by` with
  // nothing between - the string path was fragile. Explicit parse +
  // explicit tz + a plain-string fallback for anything that comes
  // through as not-a-date.
  const fmtCentral = (iso) => {
    if (!iso) return null;
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      timeZone: "America/Chicago",
    });
  };
  const submittedAtStr = fmtCentral(sub.submitted_at) || (sub.submitted_at ? String(sub.submitted_at).slice(0, 10) : "(unknown date)");
  const todayStr = fmtCentral(new Date().toISOString()) || "today";
  const resentBanner = `
    <div style="font-family:Inter,-apple-system,Segoe UI,sans-serif;max-width:600px;margin:0 auto 12px;padding:10px 14px;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;color:#78350f;font-size:13px;">
      Resent by the intranet on ${todayStr}. Originally submitted ${submittedAtStr} by ${sub.submitter_email}. The original email was not delivered.
    </div>`;
  const html = `${resentBanner}${liveHtml}`;
  return { subject, html, bannerText: `Resent by the intranet on ${todayStr}. Originally submitted ${submittedAtStr} by ${sub.submitter_email}. The original email was not delivered.` };
}

// ── 5. Dry-run report + send loop ────────────────────────────────────
const totals = { p11: 0, p12: 0, other: 0, netAmount: 0 };
function periodOfISO(iso) {
  // Fiscal periods for FY2026. P11: 2026-10-05 .. 2026-11-01. P12: 2026-11-02 .. 2026-11-29.
  if (!iso) return null;
  if (iso >= "2026-10-05" && iso <= "2026-11-01") return "P11";
  if (iso >= "2026-11-02" && iso <= "2026-11-29") return "P12";
  return "?";
}

console.log(``);
console.log(`# ─── PER-ROW DRY-RUN TABLE ─────────────────────────────────────`);
console.log(`#   idx  period  type      invoice#            date         amount         pdf           billcom_match       subject`);

const working = [];
for (let i = 0; i < rows.length; i += 1) {
  const r = rows[i];
  const p = periodOfISO(r.invoice_date);
  totals.netAmount += Number(r.total_amount || 0);
  if (p === "P11") totals.p11 += 1;
  else if (p === "P12") totals.p12 += 1;
  else totals.other += 1;

  const fetchRes = await fetchPdfBase64(r.drive_urls, r.raw_drive_url);
  const pdfTag = fetchRes.ok ? `${(fetchRes.bytes / 1024).toFixed(0)}KB` : `MISSING (${fetchRes.error})`;
  const match = billcomMatchFor(r);
  const matchTag = match ? `${match.kind === "invoice_number" ? "by_number" : "by_amount"}` : "none";
  const { subject } = buildResendEmail(r);

  const invNum = (r.invoice_number || "").padEnd(18).slice(0, 18);
  const vendor = (r.vendor_name || "").padEnd(14).slice(0, 14);
  console.log(`#  ${String(i + 1).padStart(3)}  ${(p || "?").padEnd(6)}  ${(r.type || "invoice").padEnd(8)}  ${invNum}  ${(r.invoice_date || "?").padEnd(10)}  ${money(r.total_amount).padStart(12)}  ${pdfTag.padEnd(12)}  ${matchTag.padEnd(18)}  ${subject.slice(0, 80)}`);

  working.push({ row: r, fetch: fetchRes, match, built: buildResendEmail(r), vendor, period: p });
}

console.log(``);
console.log(`# totals:  rows=${rows.length}  P11=${totals.p11}  P12=${totals.p12}  other=${totals.other}  net=${money(totals.netAmount)}`);
const fetchFailed = working.filter(w => !w.fetch.ok);
const billcomMatched = working.filter(w => w.match);
console.log(`# pdfs:    ok=${working.length - fetchFailed.length}  failed=${fetchFailed.length}`);
console.log(`# bill.com matches: ${billcomMatched.length} (${billcomMatched.filter(w => w.match.kind === "invoice_number").length} by invoice#, ${billcomMatched.filter(w => w.match.kind === "amount_and_date").length} by amount+date)`);

// Banner-text spot check (Fix 2 acceptance): show one P11 and one P12 row.
const p11Example = working.find(w => w.period === "P11");
const p12Example = working.find(w => w.period === "P12");
console.log(``);
console.log(`# ─── BANNER TEXT SPOT CHECK ─────────────────────────────────`);
if (p11Example) console.log(`#  P11 (${p11Example.row.invoice_number}): ${p11Example.built.bannerText}`);
if (p12Example) console.log(`#  P12 (${p12Example.row.invoice_number}): ${p12Example.built.bannerText}`);

// ── 6. Send phase (only when --send or --test-to) ────────────────────
if (!args.send && !args.testTo) {
  console.log(``);
  console.log(`# DRY-RUN complete. No emails sent. Rerun with --send to execute.`);
  process.exit(0);
}

// --test-to: send ONLY the first eligible row to Kevin (overrides AP_TO).
if (args.testTo) {
  const eligible = working.find(w => w.fetch.ok);
  if (!eligible) { console.error(`# no eligible row with a fetchable PDF for the test send`); process.exit(2); }
  console.log(``);
  console.log(`# ─── TEST SEND to ${args.testTo} ──────────────────────────────`);
  const r = eligible.row;
  const attachment = { filename: `RESENT_${r.invoice_number || "invoice"}.pdf`, mimeType: "application/pdf", base64: eligible.fetch.base64 };
  const result = await sendEmailSA({
    sender: SENDER_MAILBOX, displayName: SENDER_DISPLAY,
    to: args.testTo,
    cc: null, // test send: no AP or submitter CC
    subject: `[TEST] ${eligible.built.subject}`,
    html: `<p style="font-family:Inter;color:#64748b;font-size:12px;">TEST SEND, not AP. Content below is exactly what AP would receive on the batch run.</p>${eligible.built.html}`,
    replyTo: r.submitter_email,
    attachments: [attachment],
  });
  console.log(`# test send result: ${result}`);
  console.log(`# invoice: ${r.invoice_number}  vendor: ${r.vendor_name}  amount: ${money(r.total_amount)}`);
  process.exit(result === "sent" ? 0 : 2);
}

// --send: batch loop. AP recipient already validated above; re-check as defense in depth.
const AP_TO_EMAIL = args.apTo;
const apIssues = validateApRecipient(AP_TO_EMAIL);
if (apIssues.length > 0) {
  console.error(`# REFUSED (second-pass): ${apIssues.join("; ")}`);
  process.exit(3);
}
console.log(``);
console.log(`# ─── BATCH SEND to ${AP_TO_EMAIL} ──────────────────────────────`);
let consecutiveFailures = 0;
const results = [];
for (const w of working) {
  const r = w.row;
  const invNum = r.invoice_number || "(no#)";
  if (!w.fetch.ok) {
    console.log(`# SKIP (no pdf)  ${invNum}  ${w.vendor}  ${money(r.total_amount)}  reason=${w.fetch.error}`);
    results.push({ row: r, status: "skip_no_pdf", reason: w.fetch.error });
    continue;
  }
  if (args.skipMatched && w.match) {
    console.log(`# SKIP (billcom) ${invNum}  ${w.vendor}  ${money(r.total_amount)}  match=${w.match.kind}`);
    results.push({ row: r, status: "skip_billcom", match: w.match });
    continue;
  }

  const ccList = AP_CC
    .filter((e) => e !== AP_TO_EMAIL && e !== SENDER_MAILBOX && e !== r.submitter_email);
  // Add the submitter to CC (brief: CC the original submitter).
  if (r.submitter_email && r.submitter_email !== AP_TO_EMAIL && !ccList.includes(r.submitter_email)) {
    ccList.push(r.submitter_email);
  }
  const attachment = {
    filename: `RESENT_${(r.invoice_number || "invoice").replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`,
    mimeType: "application/pdf",
    base64: w.fetch.base64,
  };
  const sendResult = await sendEmailSA({
    sender: SENDER_MAILBOX,
    displayName: SENDER_DISPLAY,
    to: AP_TO_EMAIL,
    cc: ccList,
    subject: w.built.subject,
    html: w.built.html,
    replyTo: r.submitter_email,
    attachments: [attachment],
  });
  const ok = sendResult === "sent";
  if (ok) {
    consecutiveFailures = 0;
    // Mark email_sent = true via the shared dataStore path (keeps Sheets
    // dual-write intact). 2026-11-12: must pass client_uuid, NOT the PG
    // primary key `id` - Sheets col A is client_uuid and the lookup fails
    // on the wrong key. See the SELECT block comment.
    let markOk = false, markErr = null;
    try {
      await updateInvoiceFields(r.client_uuid, { emailSent: true }, { module: "ops" });
      markOk = true;
    } catch (e) {
      markErr = e.message;
    }
    console.log(`# SENT  ${invNum}  ${w.vendor}  ${money(r.total_amount)}  mark_email_sent=${markOk ? "ok" : "FAILED: " + markErr}`);
    results.push({ row: r, status: "sent", markOk, markErr });
  } else {
    consecutiveFailures += 1;
    console.log(`# FAIL  ${invNum}  ${w.vendor}  ${money(r.total_amount)}  sendResult=${sendResult}  (consecutive failures: ${consecutiveFailures})`);
    results.push({ row: r, status: "fail" });
    if (consecutiveFailures >= 3) {
      console.log(`# ABORT: 3 consecutive failures. ${results.filter(x => x.status === "sent").length} rows sent so far. Stop and report.`);
      break;
    }
  }
  await new Promise((res) => setTimeout(res, PACE_MS));
}

console.log(``);
console.log(`# ─── BATCH SUMMARY ────────────────────────────────────────────`);
const sent = results.filter(x => x.status === "sent").length;
const skipPdf = results.filter(x => x.status === "skip_no_pdf").length;
const skipBc = results.filter(x => x.status === "skip_billcom").length;
const failed = results.filter(x => x.status === "fail").length;
console.log(`# sent:    ${sent}`);
console.log(`# failed:  ${failed}`);
console.log(`# skipped: no_pdf=${skipPdf}  billcom_matched=${skipBc}`);
console.log(`# ${stamp()} done.`);
