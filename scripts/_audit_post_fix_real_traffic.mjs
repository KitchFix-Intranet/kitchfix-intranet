// READ-ONLY: post-fix real-traffic audit.
// Fix bundle landed 2026-06-12 (PR #138 visibility + pr-9-1 migration in Studio
// + PR #139 line_num re-sequence). Anything submitted after that should
// benefit from all three. Cutoff: 2026-06-13T00:00:00Z (full day after fix).
import { createClient } from "@supabase/supabase-js";
const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// pr-9-1 migration applied between 17:56 (last pg_failed for missing amount column)
// and 18:22 (first clean complete invoice). Use 17:57 UTC as the fix line.
const POST_FIX_CUTOFF = "2026-06-12T17:57:00Z";

// ── Q1+Q4: status breakdown for post-fix invoices ─────────────────────────
const PAGE = 1000;
let postFixSubs = [];
for (let off = 0; ; off += PAGE) {
  const { data, error } = await supa
    .from("invoice_submissions")
    .select("id, client_uuid, account_key, vendor_name, invoice_number, submitted_at, ai_scan_status, ai_scan_error, is_historical")
    .eq("is_historical", false)
    .gte("submitted_at", POST_FIX_CUTOFF)
    .order("submitted_at", { ascending: false })
    .range(off, off + PAGE - 1);
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) break;
  postFixSubs = postFixSubs.concat(data);
  if (data.length < PAGE) break;
}

console.log("════════════════════════════════════════════════════════════════════");
console.log(`  POST-FIX REAL-TRAFFIC AUDIT (since ${POST_FIX_CUTOFF})`);
console.log("════════════════════════════════════════════════════════════════════");
console.log("");
console.log(`Total post-fix invoice_submissions (live, not historical): ${postFixSubs.length}`);

// Status breakdown
const statusCount = new Map();
for (const s of postFixSubs) {
  const st = s.ai_scan_status || "(null)";
  statusCount.set(st, (statusCount.get(st) || 0) + 1);
}
console.log("");
console.log("Status breakdown:");
for (const [st, ct] of [...statusCount.entries()].sort((a, b) => b[1] - a[1])) {
  const pct = ((ct / postFixSubs.length) * 100).toFixed(1);
  console.log(`  ${st.padEnd(12)} ${String(ct).padStart(4)}  (${pct}%)`);
}

// Date breakdown
console.log("");
console.log("By submitted_at date:");
const byDate = new Map();
for (const s of postFixSubs) {
  const d = String(s.submitted_at).slice(0, 10);
  byDate.set(d, (byDate.get(d) || 0) + 1);
}
for (const [d, ct] of [...byDate.entries()].sort()) {
  console.log(`  ${d}  ${ct}`);
}

// ── Q1: pg_failed verbatim ──────────────────────────────────────────────
const pgFailed = postFixSubs.filter((s) => s.ai_scan_status === "pg_failed");
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log(`  Q1 - pg_failed count: ${pgFailed.length}`);
console.log("════════════════════════════════════════════════════════════════════");
if (pgFailed.length === 0) {
  console.log("  ✓ CLEAN - zero post-fix pg_failed");
} else {
  // Group by error signature
  const byErr = new Map();
  for (const s of pgFailed) {
    const sig = (s.ai_scan_error || "(null)").slice(0, 200);
    if (!byErr.has(sig)) byErr.set(sig, []);
    byErr.get(sig).push(s);
  }
  for (const [sig, rows] of [...byErr.entries()].sort((a, b) => b[1].length - a[1].length)) {
    console.log("");
    console.log(`  ── ${rows.length} invoice(s) with ai_scan_error: ──`);
    console.log(`     ${sig}`);
    console.log("");
    for (const r of rows.slice(0, 5)) {
      console.log(`     ${r.client_uuid.slice(0,8)}  ${r.submitted_at}  ${r.account_key}  "${r.vendor_name}"  inv#=${r.invoice_number}`);
    }
    if (rows.length > 5) console.log(`     ... and ${rows.length - 5} more`);
  }
}

// ── Q3: clean-write confirmation on a sample of complete invoices ──────
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  Q3 - Stage A field population check (sample of recent complete)");
console.log("════════════════════════════════════════════════════════════════════");
const completeSubs = postFixSubs.filter((s) => s.ai_scan_status === "complete");
const sampleSize = Math.min(10, completeSubs.length);
const sample = completeSubs.slice(0, sampleSize);
console.log(`Sampling ${sampleSize} of ${completeSubs.length} complete post-fix invoices:`);
console.log("");
let allStageAPopulated = 0;
let partialStageA = 0;
let zeroStageA = 0;
for (const s of sample) {
  // Pull line items + check Stage A field population
  const { data: lis, error: liErr } = await supa
    .from("ai_line_items")
    .select("id, line_num, item_number, pack_size, ordered_count, shipped_count, uom_raw, amount, weight_line_value, catch_weight_marker")
    .eq("invoice_uuid", s.id);
  if (liErr) {
    console.log(`  ${s.client_uuid.slice(0,8)}  ERROR reading line items: ${liErr.message}`);
    continue;
  }
  const liCount = lis?.length || 0;
  if (liCount === 0) {
    console.log(`  ${s.client_uuid.slice(0,8)}  ${s.account_key.padEnd(14)}  "${s.vendor_name}"  ROWS=0 ⚠ MISSING`);
    continue;
  }
  // Fraction of line items with at least one Stage A field populated
  const stageARows = lis.filter((li) =>
    li.item_number !== null || li.pack_size !== null ||
    li.ordered_count !== null || li.shipped_count !== null ||
    li.uom_raw !== null || li.amount !== null ||
    li.weight_line_value !== null || li.catch_weight_marker !== null
  );
  const stageAPct = ((stageARows.length / liCount) * 100).toFixed(0);
  let verdict;
  if (stageARows.length === liCount) { verdict = "all-rows-have-stageA"; allStageAPopulated++; }
  else if (stageARows.length > 0)    { verdict = `${stageAPct}% rows have stageA`; partialStageA++; }
  else                                { verdict = "ZERO stageA on any row"; zeroStageA++; }

  // line_num sanity: should be 1..N (re-sequence fix)
  const lineNums = lis.map((li) => li.line_num).sort((a, b) => a - b);
  const expectedSeq = Array.from({ length: liCount }, (_, i) => i + 1);
  const isClean = JSON.stringify(lineNums) === JSON.stringify(expectedSeq);

  console.log(`  ${s.client_uuid.slice(0,8)}  ${s.account_key.padEnd(14)}  "${(s.vendor_name||'').slice(0,24).padEnd(24)}"  rows=${String(liCount).padStart(3)}  ${verdict}  line_num=${isClean ? "1..N ✓" : "NON-SEQ (" + lineNums[0] + ".." + lineNums[lineNums.length-1] + ")"}`);
}
console.log("");
console.log(`Stage A summary across sample of ${sampleSize}:`);
console.log(`  all rows populated: ${allStageAPopulated}`);
console.log(`  partial population: ${partialStageA}`);
console.log(`  zero population:    ${zeroStageA}`);

// ── Q4: pass rate ───────────────────────────────────────────────────────
console.log("");
console.log("════════════════════════════════════════════════════════════════════");
console.log("  Q4 - Pass rate");
console.log("════════════════════════════════════════════════════════════════════");
const complete = statusCount.get("complete") || 0;
const failed   = statusCount.get("failed")   || 0;
const pgF      = statusCount.get("pg_failed")|| 0;
const pending  = statusCount.get("pending")  || 0;
const photoOnly = statusCount.get("photo-only") || 0;
const nullStatus = statusCount.get("(null)") || 0;
const total = postFixSubs.length;
console.log(`  Complete:     ${complete} / ${total}  (${total ? ((complete/total)*100).toFixed(1) : 0}%)`);
console.log(`  failed:       ${failed}  (OCR-side failures + Sheets-side throws)`);
console.log(`  pg_failed:    ${pgF}  (Sheets-succeeded-PG-threw - the silent-gap class)`);
console.log(`  photo-only:   ${photoOnly}  (intentionally not scanned)`);
console.log(`  pending:      ${pending}  (queued, not yet processed)`);
console.log(`  (null):       ${nullStatus}  (no status set yet)`);
console.log("");
const effectivePass = complete;
const effectiveTotal = total - photoOnly - pending - nullStatus;
console.log(`  Effective pass rate (excluding photo-only/pending/null):`);
console.log(`    ${effectivePass} / ${effectiveTotal} = ${effectiveTotal ? ((effectivePass/effectiveTotal)*100).toFixed(1) : 0}%`);
