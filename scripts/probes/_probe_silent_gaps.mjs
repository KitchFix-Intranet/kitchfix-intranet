// ════════════════════════════════════════════════════════════════════════════
// PROBE: silent-gap invoices (ai_scan_complete=TRUE but 0 ai_line_items)
//
// READ-ONLY. No --execute flag, no writes ever. Safe to run as often as
// you want.
//
// WHAT IT DOES
//   Mirrors check2() in scripts/reconciliation-alarm.mjs verbatim, then
//   adds two columns the alarm doesn't compute:
//     - PG ai_line_items count per candidate (sanity check; should be 0
//       for true silent gaps; if > 0 then the alarm is a false positive
//       for that row)
//     - Sheets-side ai_line_items count per candidate (alarm only reads
//       PG; we need Sheets too because insertAILineItemsSheets is a plain
//       appendRowsSA with no dedup, so re-extraction on a Sheets-nonzero
//       invoice would silently duplicate)
//
//   Window is overridable via args so we can confirm no stranded invoices
//   exist outside the alarm's 7d..24h bound.
//
// WHAT IT OUTPUTS
//   Untruncated table: uuid + client_uuid + account + vendor + invoice# +
//   invoice_date + total + submitted_at + ai_scan_status + page_count +
//   raw_drive_url present? + drive_urls[] length + PG count + Sheets count
//
//   Plus a summary classifier:
//     - PG=0 AND Sheets=0          → CANARY CANDIDATES (safe to re-extract)
//     - PG=0 AND Sheets>0          → re-extract would duplicate Sheets-side
//     - PG=0 AND Sheets unread     → tab read failed; investigate
//     - PG>0                       → alarm false positive (line items exist)
//
// BACKGROUND
//   The generator of silent gaps as a class is invoiceActions.js:1337 where
//   markScanStatus('complete') runs unconditionally after the try block,
//   even when parsed.lineItems is empty or when insertAILineItems threw
//   (the inner try/catch at line 1331 swallows the error and execution
//   falls through to the complete marker). HIGH-priority separate followup:
//   move markScanStatus('complete') inside a conditional that only fires
//   when insertAILineItems actually succeeded with > 0 rows, and call
//   markScanStatus('failed') on either of those two paths instead.
//
// ARGS
//   --lookback-days=N      default 7    (alarm default)
//   --gap-min-age-hours=H  default 24   (alarm default)
//   --since=YYYY-MM-DD     override start of window (skips lookback-days)
//   --until=YYYY-MM-DD     override end of window (skips gap-min-age-hours)
//
// USAGE
//   Default window (matches alarm):
//     node --import ./scripts/_setup/register-aliases.mjs \
//          --env-file=.env.local scripts/_probe_silent_gaps.mjs
//
//   Wider lookback (find older stranded invoices):
//     node ... scripts/_probe_silent_gaps.mjs --lookback-days=30
//
//   Explicit range:
//     node ... scripts/_probe_silent_gaps.mjs --since=2026-05-01 --until=2026-06-08
// ════════════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import { safeRead, SHEET_IDS } from "../../src/lib/sheets.js";

// ── Args ──
const args = process.argv.slice(2);
function getArg(name, fallback) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=", 2)[1];
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return fallback;
}
const LOOKBACK_DAYS = parseInt(getArg("lookback-days", "7"), 10);
const GAP_MIN_AGE_HOURS = parseInt(getArg("gap-min-age-hours", "24"), 10);
const SINCE_OVERRIDE = getArg("since");
const UNTIL_OVERRIDE = getArg("until");

// ── Env ──
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[probe] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(2);
}
const supa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Window resolution ──
const since = SINCE_OVERRIDE
  ? new Date(SINCE_OVERRIDE + "T00:00:00Z").toISOString()
  : new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
const cutoff = UNTIL_OVERRIDE
  ? new Date(UNTIL_OVERRIDE + "T23:59:59Z").toISOString()
  : new Date(Date.now() - GAP_MIN_AGE_HOURS * 60 * 60 * 1000).toISOString();

console.log(`[probe] ──────────────────────────────────────────────────────────`);
console.log(`[probe] SILENT-GAP PROBE  (read-only, no writes)`);
console.log(`[probe] ──────────────────────────────────────────────────────────`);
console.log(`[probe] filter : ai_scan_complete=TRUE AND is_historical=FALSE`);
console.log(`[probe] window : submitted_at >= ${since}`);
console.log(`[probe]          submitted_at <= ${cutoff}`);
if (SINCE_OVERRIDE || UNTIL_OVERRIDE) {
  console.log(`[probe]          (overridden via --since / --until)`);
} else {
  console.log(`[probe]          (lookback ${LOOKBACK_DAYS}d, gap-min-age ${GAP_MIN_AGE_HOURS}h)`);
}
console.log("");

// ── 1. Mirror check2() candidates ──
const { data: candidates, error: candErr } = await supa
  .from("invoice_submissions")
  .select("id, client_uuid, account_key, vendor_name, vendor_id, invoice_number, invoice_date, submitted_at, status, ai_scan_status, page_count, raw_drive_url, drive_urls, total_amount")
  .eq("ai_scan_complete", true)
  .eq("is_historical", false)
  .gte("submitted_at", since)
  .lte("submitted_at", cutoff)
  .order("submitted_at", { ascending: false });

if (candErr) {
  console.error(`[probe] candidate query failed: ${candErr.message}`);
  process.exit(1);
}

if (!candidates || candidates.length === 0) {
  console.log("[probe] No candidates in window. No silent gaps reachable from this window.");
  process.exit(0);
}

console.log(`[probe] ${candidates.length} candidate(s) in window`);
console.log("");

// ── 2. PG ai_line_items counts (batched 200, matches check2 pattern) ──
const pgCountByUuid = new Map();
for (let i = 0; i < candidates.length; i += 200) {
  const slice = candidates.slice(i, i + 200);
  const { data: ali, error: aliErr } = await supa
    .from("ai_line_items")
    .select("invoice_uuid")
    .in("invoice_uuid", slice.map((c) => c.id));
  if (aliErr) {
    console.error(`[probe] ai_line_items batch failed: ${aliErr.message}`);
    process.exit(1);
  }
  for (const r of ali || []) {
    pgCountByUuid.set(r.invoice_uuid, (pgCountByUuid.get(r.invoice_uuid) || 0) + 1);
  }
}

// ── 3. Sheets-side counts (one tab read per unique account) ──
// safeRead can throw on transient Sheets API errors; cache "null" so a
// failed tab read shows up as a separate category in the summary.
const tabCache = new Map(); // accountKey -> Map<uuid, count> | null
async function getSheetsCount(uuid, accountKey) {
  if (!tabCache.has(accountKey)) {
    try {
      const { rows } = await safeRead(SHEET_IDS.AI_LINE_ITEMS, accountKey);
      const map = new Map();
      for (const r of rows || []) {
        const id = String(r[0] || "").trim();
        if (!id) continue;
        map.set(id, (map.get(id) || 0) + 1);
      }
      tabCache.set(accountKey, map);
    } catch (e) {
      console.warn(`[probe]   WARN sheets read failed for tab "${accountKey}": ${e.message}`);
      tabCache.set(accountKey, null);
    }
  }
  const m = tabCache.get(accountKey);
  if (m === null) return null;
  return m.get(uuid) || 0;
}

// ── 4. Per-candidate output ──
console.log(`[probe] ──────────────────────────────────────────────────────────`);
console.log(`[probe] FULL LIST  (untruncated)`);
console.log(`[probe] ──────────────────────────────────────────────────────────`);

let pgZero = 0, pgHasItems = 0;
let bothZero = 0, pgZeroSheetsHas = 0, sheetsUnread = 0;
const canaryCandidates = [];

for (const c of candidates) {
  const pgCount = pgCountByUuid.get(c.id) || 0;
  const sheetsCount = await getSheetsCount(c.id, c.account_key);
  const driveUrls = Array.isArray(c.drive_urls) ? c.drive_urls.length : 0;
  const hasRawDrive = !!(c.raw_drive_url && c.raw_drive_url.trim());

  if (pgCount === 0) {
    pgZero++;
    if (sheetsCount === null) sheetsUnread++;
    else if (sheetsCount === 0) {
      bothZero++;
      if (hasRawDrive) canaryCandidates.push(c.id);
    } else {
      pgZeroSheetsHas++;
    }
  } else {
    pgHasItems++;
  }

  console.log(`[probe] ${c.id}`);
  console.log(`[probe]   client_uuid     : ${c.client_uuid}`);
  console.log(`[probe]   account_key     : ${c.account_key}`);
  console.log(`[probe]   vendor_name     : ${c.vendor_name || "(null)"}  vendor_id=${c.vendor_id || "(null)"}`);
  console.log(`[probe]   invoice         : #${c.invoice_number || "(null)"}  date=${c.invoice_date || "(null)"}  total=$${Number(c.total_amount || 0).toFixed(2)}`);
  console.log(`[probe]   submitted_at    : ${(c.submitted_at || "").slice(0, 19)}`);
  console.log(`[probe]   ai_scan_status  : ${c.ai_scan_status}`);
  console.log(`[probe]   page_count      : ${c.page_count == null ? "(null)" : c.page_count}`);
  console.log(`[probe]   raw_drive_url   : ${hasRawDrive ? "present" : "MISSING"}`);
  console.log(`[probe]   drive_urls[]    : ${driveUrls} entrie(s)`);
  console.log(`[probe]   PG ai_line_items     : ${pgCount}`);
  console.log(`[probe]   Sheets ai_line_items : ${sheetsCount === null ? "(read failed)" : sheetsCount}`);
  console.log("");
}

// ── 5. Summary ──
console.log(`[probe] ──────────────────────────────────────────────────────────`);
console.log(`[probe] SUMMARY`);
console.log(`[probe] ──────────────────────────────────────────────────────────`);
console.log(`[probe]   total candidates              : ${candidates.length}`);
console.log(`[probe]   PG = 0 (silent gaps confirmed): ${pgZero}`);
console.log(`[probe]     ↳ Sheets = 0 (canary safe)  : ${bothZero}`);
console.log(`[probe]     ↳ Sheets > 0 (would dupe)   : ${pgZeroSheetsHas}`);
console.log(`[probe]     ↳ Sheets read failed        : ${sheetsUnread}`);
console.log(`[probe]   PG > 0 (alarm false-positive) : ${pgHasItems}`);
console.log("");
if (canaryCandidates.length > 0) {
  console.log(`[probe] CANARY-SAFE UUIDs (PG=0, Sheets=0, raw_drive_url present): ${canaryCandidates.length}`);
  for (const id of canaryCandidates) console.log(`[probe]   ${id}`);
  console.log("");
  console.log(`[probe] Next: pick one and run scripts/_rescan_silent_gap.mjs --uuid=<id>  (dry-run first)`);
}
console.log(`[probe] ──────────────────────────────────────────────────────────`);
