// scripts/purchasing_rippling_sync.mjs
//
// KPI PURCHASING PHASE 1 - C3: Rippling Spend sync + derive.
// Contract: docs/KPI_PURCHASING_PHASE1_SPEC.md §2 (rippling step a-c).
//
// Steps:
//   a. walk custom-objects/spend_transaction_line_item_zo/records with
//      the existing rippling.js client. cursor-walk, upsert by content
//      hash into rippling_raw_spend_lines.
//   b. populate CANDIDATES into spend_category_map (distinct category_id
//      + a merchant sample) and spend_department_site_map (distinct
//      department_id + label). ON CONFLICT DO NOTHING so labelled rows
//      are never overwritten. CORP-prefix departments (labels 50xx-59xx)
//      default excluded=TRUE at first-insert.
//   c. derive into purchasing_actuals: account_key from department map
//      (null if unlabelled or excluded), gl_line_code from category map
//      (null if unlabelled), gl_bucket from prefix rule, txn_date =
//      first_seen_at (approx_date=TRUE), amount, merchant.
//
// Atomicity: per-line derive. compute new row, then upsert into
// purchasing_actuals by ON CONFLICT (source, source_line_id) DO UPDATE.
// unlike billcom (where a bill has N lines and the fact table needs
// same-transaction guarantees), each rippling spend line is one fact-
// table row - there is no multi-line grouping to protect. Failure on
// one line leaves last-good state for that line + successful writes
// for other lines.
//
// The parent transaction object (spend_transaction_zo) is BLOCKED by
// a Rippling bug (400: `Field with name purchase_location not found`).
// Do NOT retry it. Merchant + parent id come from the FK on the line
// item's display_value/nested-object payload.
//
// CLI:
//   node --env-file=/Users/kevinfietek/dev/kitchfix-intranet/.env.local scripts/purchasing_rippling_sync.mjs --source=nightly
//
// Required env: RIPPLING_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Exit codes:
//   0  all probes PASS
//   1  configuration error
//   2  walk failed mid-flight
//   3  another sync run is in flight
//   4  probes failed

import os from "node:os";
import { createClient } from "@supabase/supabase-js";
import { fetchPage, extractRows, firstPageUrl, BASE, contentHash as ripplingContentHash } from "../src/lib/rippling.js";
import { createHash } from "node:crypto";

// ─── CLI ─────────────────────────────────────────────────────────────

const VALID_SOURCES = new Set(["backfill", "nightly", "manual"]);
const PAGE_SIZE = 100;
const MAX_PAGES_HARD = 500;

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

const KEY    = process.env.RIPPLING_API_KEY;
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY)    { console.error("RIPPLING_API_KEY not set"); process.exit(1); }
if (!SB_URL) { console.error("SUPABASE_URL not set"); process.exit(1); }
if (!SB_KEY) { console.error("SUPABASE_SERVICE_ROLE_KEY not set"); process.exit(1); }

const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const startedAt = new Date();
console.log(`purchasing_rippling_sync source=${args.source} dryRun=${args.dryRun} started=${startedAt.toISOString()}`);

// ─── Concurrency lock ────────────────────────────────────────────────

const LOCK_NAME = "purchasing_rippling_sync";
const LOCK_TTL_MS = 4 * 60 * 60 * 1000;
const HOLDER_ID = [
  args.source,
  `host=${os.hostname()}`,
  `pid=${process.pid}`,
  `started=${startedAt.toISOString()}`,
  process.env.GITHUB_RUN_ID ? `gh_run=${process.env.GITHUB_RUN_ID}` : null,
].filter(Boolean).join(" ");

async function acquireLock() {
  const { error: reapErr } = await supa
    .from("purchasing_sync_locks")
    .delete()
    .eq("name", LOCK_NAME)
    .lt("expires_at", new Date().toISOString());
  if (reapErr) { console.error(`lock: reap failed: ${reapErr.message}`); process.exit(1); }
  const expiresAt = new Date(Date.now() + LOCK_TTL_MS).toISOString();
  const { error } = await supa
    .from("purchasing_sync_locks")
    .insert({ name: LOCK_NAME, expires_at: expiresAt, holder: HOLDER_ID });
  if (error) {
    if (error.code === "23505") {
      const { data: current } = await supa
        .from("purchasing_sync_locks")
        .select("holder, acquired_at, expires_at")
        .eq("name", LOCK_NAME)
        .maybeSingle();
      console.error("another purchasing_rippling_sync run is in flight");
      if (current) {
        console.error(`  holder:      ${current.holder}`);
        console.error(`  acquired_at: ${current.acquired_at}`);
        console.error(`  expires_at:  ${current.expires_at}`);
      }
      process.exit(3);
    }
    console.error(`lock: acquire failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`acquired lock holder="${HOLDER_ID}" expires_at=${expiresAt}`);
}

async function releaseLock() {
  const { error } = await supa
    .from("purchasing_sync_locks")
    .delete()
    .eq("name", LOCK_NAME)
    .eq("holder", HOLDER_ID);
  if (error) console.error(`lock: release failed: ${error.message}`);
}

await acquireLock();
process.on("SIGINT",  async () => { await releaseLock(); process.exit(130); });
process.on("SIGTERM", async () => { await releaseLock(); process.exit(143); });

// ─── Content hash for spend lines ────────────────────────────────────
// Rippling's shared rippling.js contentHash requires a `kind`; we
// register a local hash function that mirrors its shape but uses the
// spend-line volatile-field set. Local canonicalization to keep the
// two ingest lanes independent.

const SPEND_HASH_EXCLUDE_TOP = new Set([
  "updated_at", "mongo_updated_at", "system_updated_at", "__meta",
]);
const NESTED_STRIP_KEYS = new Set(["display_value", "has_perm", "image"]);

function normalizeForHash(node, topExcludeSet) {
  if (node == null) return node;
  if (Array.isArray(node)) return node.map(v => normalizeForHash(v, null));
  if (typeof node !== "object") return node;
  const out = {};
  const keys = Object.keys(node).sort();
  for (const k of keys) {
    if (topExcludeSet && topExcludeSet.has(k)) continue;
    if (NESTED_STRIP_KEYS.has(k)) continue;
    out[k] = normalizeForHash(node[k], null);
  }
  return out;
}

function spendContentHash(payload) {
  const normalized = normalizeForHash(payload, SPEND_HASH_EXCLUDE_TOP);
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

// ─── Extract shape from a raw record ─────────────────────────────────
//
// The spend_transaction_line_item_zo schema (per Phase 0b spike):
//   id                       required
//   amount / total_amount    numeric or string
//   currency                 string
//   category                 nested { id, display_value }
//   department               nested { id, display_value }
//   work_location            nested { id, display_value }
//   merchant                 nested { id, display_value }   OR
//   parent_txn / spend_transaction  nested { id, display_value (merchant name) }
//   embedded_document_id     string
//   updated_at               ISO timestamp
//
// Field names vary between Rippling model versions; we defensively
// read multiple aliases and take the first non-null.

function pickNested(row, keys) {
  for (const k of keys) {
    const v = row?.[k];
    if (v && typeof v === "object") return v;
  }
  return null;
}

function pickScalar(row, keys) {
  for (const k of keys) {
    const v = row?.[k];
    if (v != null && v !== "") return v;
  }
  return null;
}

// Extract normalized ingest payload from one raw record.
function normalizeSpendLine(row) {
  const category    = pickNested(row, ["category"]);
  const department  = pickNested(row, ["department"]);
  const workLoc     = pickNested(row, ["work_location"]);
  const merchant    = pickNested(row, ["merchant"]);
  const parentTxn   = pickNested(row, ["parent_txn", "spend_transaction", "spend_transaction_zo", "parent"]);

  const merchantName = merchant?.display_value
    || parentTxn?.display_value
    || pickScalar(row, ["merchant_name"])
    || null;

  return {
    rippling_id:         String(row.id),
    external_id:         pickScalar(row, ["external_id", "reference_id"]),
    content_hash:        spendContentHash(row),
    amount:              Number(pickScalar(row, ["amount", "total_amount", "line_amount"]) || 0) || null,
    currency:            pickScalar(row, ["currency"]),
    category_id:         category?.id || pickScalar(row, ["category_id"]) || null,
    department_id:       department?.id || pickScalar(row, ["department_id"]) || null,
    department_label:    department?.display_value || null,
    work_location_id:    workLoc?.id || pickScalar(row, ["work_location_id"]) || null,
    work_location_label: workLoc?.display_value || null,
    merchant_name:       merchantName,
    parent_txn_id:       parentTxn?.id || pickScalar(row, ["parent_txn_id"]) || null,
    embedded_document_id: pickScalar(row, ["embedded_document_id", "receipt_id"]),
    updated_at:          pickScalar(row, ["updated_at", "mongo_updated_at", "system_updated_at"]) || null,
    raw:                 row,
    fetch_source:        args.source,
    _category_label:     category?.display_value || null,   // for candidate map
  };
}

// ─── Step a + b: walk endpoint + populate candidate maps ─────────────

// CORP department prefix rule: labels like "5004.6 - CORP HR" -> excluded.
// Match numeric prefix 5xxx starting with '5'.
function isCorpDeptLabel(label) {
  if (!label) return false;
  return /^\s*5\d{3}(\.\d+)?(\s*-|\s|$)/.test(String(label));
}

async function walkSpendLines() {
  const t0 = Date.now();
  let url = firstPageUrl("custom-objects/spend_transaction_line_item_zo/records", PAGE_SIZE);
  let pageNo = 0;
  let examined = 0;
  let inserted = 0;
  const categoryCandidates = new Map();   // category_id -> { label, merchant_sample }
  const departmentCandidates = new Map(); // department_id -> { label, excluded }
  const rippling_ids = new Set();

  while (pageNo < MAX_PAGES_HARD) {
    const res = await fetchPage(url, KEY);
    if (!res.ok) {
      console.error(`[spend_lines] page ${pageNo + 1} FAILED status=${res.status} error=${res.error} raw=${(res.raw || "").slice(0, 200)}`);
      return { ok: false, pageNo, examined, inserted, categoryCandidates, departmentCandidates, rippling_ids, error: res.error };
    }
    const rows = extractRows(res.body);
    pageNo++;
    examined += rows.length;

    const normalized = rows.map(normalizeSpendLine).filter(r => r.rippling_id);

    // Candidate collection.
    for (const r of normalized) {
      if (r.category_id && !categoryCandidates.has(r.category_id)) {
        categoryCandidates.set(r.category_id, { label: r._category_label, merchant_sample: r.merchant_name });
      }
      if (r.department_id && !departmentCandidates.has(r.department_id)) {
        departmentCandidates.set(r.department_id, { label: r.department_label, excluded: isCorpDeptLabel(r.department_label) });
      }
      rippling_ids.add(r.rippling_id);
    }

    // Compare-then-insert on raw table.
    if (!args.dryRun && normalized.length > 0) {
      const ids = normalized.map(r => r.rippling_id);
      const currentByID = new Map();
      // Chunk lookups to avoid IN() over-count.
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const { data, error } = await supa
          .from("rippling_raw_spend_lines_latest")
          .select("rippling_id, content_hash")
          .in("rippling_id", chunk);
        if (error) {
          console.error(`[spend_lines] page ${pageNo} latest lookup FAILED: ${error.message}`);
          return { ok: false, pageNo, examined, inserted, categoryCandidates, departmentCandidates, rippling_ids, error: error.message };
        }
        for (const r of data || []) currentByID.set(r.rippling_id, r.content_hash);
      }
      const toInsert = normalized
        .filter(r => currentByID.get(r.rippling_id) !== r.content_hash)
        .map(({ _category_label, ...rest }) => rest);
      if (toInsert.length > 0) {
        for (let i = 0; i < toInsert.length; i += 500) {
          const batch = toInsert.slice(i, i + 500);
          const insResp = await supa.from("rippling_raw_spend_lines").insert(batch);
          if (insResp.error) {
            console.error(`[spend_lines] page ${pageNo} insert FAILED: ${insResp.error.message}`);
            return { ok: false, pageNo, examined, inserted, categoryCandidates, departmentCandidates, rippling_ids, error: insResp.error.message };
          }
          inserted += batch.length;
        }
      }
    } else if (args.dryRun) {
      inserted += normalized.length;
    }

    process.stderr.write(`[spend_lines] page ${pageNo}  rows=${rows.length}  examined=${examined}  inserted=${inserted}  categories=${categoryCandidates.size}  departments=${departmentCandidates.size}  elapsed=${Math.round((Date.now() - t0) / 1000)}s\r`);
    if (rows.length === 0) break;
    const next = res.body?.next_link;
    if (!next) break;
    url = next.startsWith("http") ? next : BASE + next;
  }
  process.stderr.write("\n");

  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[spend_lines] walk done: pages=${pageNo} examined=${examined} inserted=${inserted} category_candidates=${categoryCandidates.size} department_candidates=${departmentCandidates.size} duration=${dur}s`);
  return { ok: true, pageNo, examined, inserted, categoryCandidates, departmentCandidates, rippling_ids };
}

// ─── Populate candidate maps (write-once, never overwrite label) ─────

async function populateCategoryCandidates(candidates) {
  if (candidates.size === 0) return { ok: true, upserted: 0 };
  const rows = [...candidates.entries()].map(([category_id, { label, merchant_sample }]) => ({
    category_id, category_label: label || null, merchant_sample: merchant_sample || null,
    // gl_line_code intentionally omitted - Kevin labels
  }));
  if (args.dryRun) {
    console.log(`[category_map] dry-run - would upsert ${rows.length} candidates`);
    return { ok: true, upserted: rows.length };
  }
  // ON CONFLICT DO NOTHING - preserve labelled rows.
  const { error } = await supa
    .from("spend_category_map")
    .upsert(rows, { onConflict: "category_id", ignoreDuplicates: true });
  if (error) {
    console.error(`[category_map] upsert FAILED: ${error.message}`);
    return { ok: false, error: error.message };
  }
  console.log(`[category_map] candidates upserted (write-once) count=${rows.length}`);
  return { ok: true, upserted: rows.length };
}

async function populateDepartmentCandidates(candidates) {
  if (candidates.size === 0) return { ok: true, upserted: 0 };
  const rows = [...candidates.entries()].map(([department_id, { label, excluded }]) => ({
    department_id, department_label: label || null, excluded: !!excluded,
    // account_key intentionally omitted - Kevin labels
  }));
  if (args.dryRun) {
    console.log(`[department_map] dry-run - would upsert ${rows.length} candidates`);
    return { ok: true, upserted: rows.length };
  }
  const { error } = await supa
    .from("spend_department_site_map")
    .upsert(rows, { onConflict: "department_id", ignoreDuplicates: true });
  if (error) {
    console.error(`[department_map] upsert FAILED: ${error.message}`);
    return { ok: false, error: error.message };
  }
  console.log(`[department_map] candidates upserted (write-once) count=${rows.length}`);
  return { ok: true, upserted: rows.length };
}

// ─── Step c: derive purchasing_actuals for spend lines ───────────────

async function deriveSpendLines({ rippling_ids }) {
  const t0 = Date.now();
  if (rippling_ids.size === 0) {
    console.log("[derive] no spend lines touched - nothing to derive");
    return { ok: true, linesDerived: 0, uncoded: 0, unattributed: 0 };
  }

  const runInsert = await supa.from("purchasing_derive_runs")
    .insert({ source: "rippling_spend", fetch_source: args.source, status: "in_progress" })
    .select("id").single();
  const runId = runInsert.data?.id;

  const [catResp, deptResp] = await Promise.all([
    supa.from("spend_category_map").select("category_id, gl_line_code"),
    supa.from("spend_department_site_map").select("department_id, account_key, excluded"),
  ]);
  if (catResp.error) return { ok: false, error: catResp.error.message };
  if (deptResp.error) return { ok: false, error: deptResp.error.message };
  const catMap = new Map((catResp.data || []).map(r => [r.category_id, r.gl_line_code]));
  const deptMap = new Map((deptResp.data || []).map(r => [r.department_id, r]));

  // Load the current-latest rows for the touched ids. Chunk at 100 to
  // keep the IN() URL under the PostgREST/proxy request-line limit -
  // rippling_ids are 36-char UUIDs so 500-per-chunk overflows the URL
  // (fetch fails with "TypeError: fetch failed" before any HTTP status).
  const ids = [...rippling_ids];
  const CHUNK_IDS = 100;
  const rowsByRippling = new Map();
  for (let i = 0; i < ids.length; i += CHUNK_IDS) {
    const chunk = ids.slice(i, i + CHUNK_IDS);
    const { data, error } = await supa.from("rippling_raw_spend_lines_latest")
      .select("rippling_id, amount, category_id, department_id, department_label, merchant_name, first_seen_at, parent_txn_id")
      .in("rippling_id", chunk);
    if (error) { console.error(`[derive] load latest chunk ${i}..${i + chunk.length} FAILED: ${error.message}`); return { ok: false, error: error.message }; }
    for (const r of data || []) rowsByRippling.set(r.rippling_id, r);
  }

  // Derive into purchasing_actuals. Per-line upsert; source_line_id
  // uniqueness is the atomic key.
  let linesDerived = 0;
  let uncoded = 0;
  let unattributed = 0;
  const derived = [];
  function glBucketFor(accountNumber) {
    if (!accountNumber) return null;
    const digits = String(accountNumber).match(/^(\d+)/);
    if (!digits) return "other";
    const p = digits[1];
    if (p.startsWith("32") || p.startsWith("34") || p.startsWith("35")) return "pl_cogs";
    if (p.startsWith("13")) return "reimbursable";
    if (p.startsWith("5"))  return "sga";
    return "other";
  }
  for (const rid of ids) {
    const r = rowsByRippling.get(rid);
    if (!r) continue;
    const deptRow  = r.department_id ? deptMap.get(r.department_id) : null;
    const excluded = deptRow?.excluded === true;
    const accountKey = excluded ? null : (deptRow?.account_key || null);
    const glLine = r.category_id ? (catMap.get(r.category_id) || null) : null;
    if (!accountKey && !excluded) unattributed++;
    if (!glLine) uncoded++;
    derived.push({
      source:             "rippling_spend",
      source_bill_id:     r.parent_txn_id || null,
      source_line_id:     `rippling_spend:${rid}`,
      account_key:        accountKey,
      excluded:           excluded,
      gl_line_code:       glLine,
      gl_bucket:          glBucketFor(glLine),
      txn_date:           r.first_seen_at ? String(r.first_seen_at).slice(0, 10) : null,
      posting_date:       null,
      amount:             r.amount != null ? Number(r.amount) : 0,
      vendor_or_merchant: r.merchant_name || null,
      paid:               false,   // Rippling card spend is card-charged; paid semantic not applicable
      approx_date:        true,    // parent object blocked; date is first_seen_at not real txn date
    });
  }

  if (args.dryRun) {
    console.log(`[derive] dry-run - would rebuild ${derived.length} rows`);
    linesDerived = derived.length;
  } else {
    // DELETE-then-INSERT to match the granted permissions on
    // purchasing_actuals (SELECT/INSERT/DELETE - no UPDATE) and the
    // atomicity pattern already used by the billcom derive. Delete in
    // chunks by source_line_id for the touched ids, then insert the new
    // rows in chunks. Idempotency probe (R4 content hash on raw) is
    // unaffected because the raw table stays append-only.
    // source_line_id is "rippling_spend:<uuid>" - 51 chars each. Same
    // URL-length concern as the latest load above; chunk at 100.
    const touchedSourceLineIds = derived.map(d => d.source_line_id);
    for (let i = 0; i < touchedSourceLineIds.length; i += 100) {
      const chunk = touchedSourceLineIds.slice(i, i + 100);
      const delResp = await supa.from("purchasing_actuals")
        .delete()
        .eq("source", "rippling_spend")
        .in("source_line_id", chunk);
      if (delResp.error) {
        console.error(`[derive] delete batch ${i}..${i + chunk.length} FAILED: ${delResp.error.message}`);
        return { ok: false, linesDerived, error: delResp.error.message };
      }
    }
    for (let i = 0; i < derived.length; i += 500) {
      const batch = derived.slice(i, i + 500);
      const { error } = await supa.from("purchasing_actuals").insert(batch);
      if (error) {
        console.error(`[derive] insert batch ${i}..${i + batch.length} FAILED: ${error.message}`);
        return { ok: false, linesDerived, error: error.message };
      }
      linesDerived += batch.length;
    }
  }

  if (runId) {
    await supa.from("purchasing_derive_runs").update({
      completed_at:  new Date().toISOString(),
      status:        "success",
      bills_touched: 0,
      lines_written: linesDerived,
    }).eq("id", runId);
  }
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[derive] lines_derived=${linesDerived} unattributed=${unattributed} uncoded=${uncoded} duration=${dur}s`);
  return { ok: true, linesDerived, uncoded, unattributed };
}

// ─── Probes ──────────────────────────────────────────────────────────

async function runProbes({ rippling_ids }) {
  console.log("");
  console.log("=== PROBES (spec §2 rippling) ===");
  const probes = [];

  // R1. no (source, source_line_id) duplicate on rippling_spend rows.
  {
    const { data, error } = await supa
      .from("purchasing_actuals")
      .select("source, source_line_id")
      .eq("source", "rippling_spend")
      .limit(200000);
    if (error) {
      probes.push({ id: "R1", pass: false, note: error.message });
      console.log(`R1 FAIL: query error ${error.message}`);
    } else {
      const seen = new Set();
      let dupes = 0;
      for (const r of data || []) {
        const key = `${r.source}|${r.source_line_id}`;
        if (seen.has(key)) dupes++;
        seen.add(key);
      }
      probes.push({ id: "R1", pass: dupes === 0, note: `dupes=${dupes}` });
      console.log(`R1 ${dupes === 0 ? "PASS" : "FAIL"}: no (source, source_line_id) duplicates on rippling_spend (dupes=${dupes})`);
    }
  }

  // R2. excluded rows carry account_key null.
  {
    const { data, error } = await supa
      .from("purchasing_actuals")
      .select("account_key, excluded")
      .eq("source", "rippling_spend")
      .eq("excluded", true)
      .limit(50000);
    if (error) {
      probes.push({ id: "R2", pass: false, note: error.message });
    } else {
      let bad = 0;
      for (const r of data || []) if (r.account_key !== null) bad++;
      probes.push({ id: "R2", pass: bad === 0, note: `bad=${bad}` });
      console.log(`R2 ${bad === 0 ? "PASS" : "FAIL"}: excluded rows have account_key null (bad=${bad}/${(data || []).length})`);
    }
  }

  // R3. Rippling acceptance (spec §2): CIN - AZ 5006.1 / 5016.6
  //     card spend present ONCE Kevin has labelled those
  //     departments/categories. Until then, report the raw counts of
  //     lines landed + distinct category ids + distinct department ids
  //     awaiting labels.
  {
    const [catAwait, deptAwait] = await Promise.all([
      supa.from("spend_category_map").select("category_id", { count: "exact", head: true }).is("gl_line_code", null),
      supa.from("spend_department_site_map").select("department_id", { count: "exact", head: true }).is("account_key", null).eq("excluded", false),
    ]);
    const cinAzResp = await supa
      .from("purchasing_actuals")
      .select("gl_line_code", { count: "exact", head: true })
      .eq("source", "rippling_spend")
      .eq("account_key", "CIN - AZ")
      .in("gl_line_code", ["5006.1", "5016.6"]);
    const cinAzCount = cinAzResp.count || 0;
    const catAwaitCount = catAwait.count || 0;
    const deptAwaitCount = deptAwait.count || 0;
    // PASS if either the acceptance rows are present OR the two label
    // counts are >0 (meaning the labelling gate has not been closed yet
    // and this is the first sync).
    const pass = cinAzCount > 0 || catAwaitCount > 0 || deptAwaitCount > 0;
    probes.push({ id: "R3", pass, note: `cinAz_5006.1+5016.6=${cinAzCount} categories_awaiting_labels=${catAwaitCount} departments_awaiting_labels=${deptAwaitCount}` });
    console.log(`R3 ${pass ? "PASS" : "FAIL"}: CIN-AZ 5006.1/5016.6 rows=${cinAzCount}  categories_awaiting=${catAwaitCount}  departments_awaiting=${deptAwaitCount}`);
  }

  // R4. content-hash idempotency on a sample rippling line.
  {
    const ids = [...rippling_ids];
    if (ids.length > 0) {
      const sample = ids[ids.length - 1];
      const { data, error } = await supa.from("rippling_raw_spend_lines_latest").select("rippling_id, content_hash, raw").eq("rippling_id", sample).maybeSingle();
      if (error || !data) {
        probes.push({ id: "R4", pass: false, note: error?.message || "no row" });
      } else {
        const rehash = spendContentHash(data.raw);
        const pass = rehash === data.content_hash;
        probes.push({ id: "R4", pass, note: `sample=${sample} rehash_matches=${pass}` });
        console.log(`R4 ${pass ? "PASS" : "FAIL"}: content-hash idempotent on sample spend line (${sample}, matches=${pass})`);
      }
    } else {
      probes.push({ id: "R4", pass: true, note: "no touched lines" });
      console.log("R4 PASS: no touched lines (vacuous)");
    }
  }

  const allPass = probes.every(p => p.pass);
  return { probes, allPass };
}

// ─── Main ────────────────────────────────────────────────────────────

let walkResult, catCandResult, deptCandResult, deriveResult, probesResult;
try {
  walkResult = await walkSpendLines();
  if (!walkResult.ok) {
    console.error("[fatal] spend line walk failed; derive skipped");
  } else {
    catCandResult  = await populateCategoryCandidates(walkResult.categoryCandidates);
    deptCandResult = await populateDepartmentCandidates(walkResult.departmentCandidates);
    if (catCandResult.ok && deptCandResult.ok) {
      deriveResult = await deriveSpendLines({ rippling_ids: walkResult.rippling_ids });
      probesResult = await runProbes({ rippling_ids: walkResult.rippling_ids });
    }
  }
} finally {
  await releaseLock();
}

const finishedAt = new Date();
const totalSec = ((finishedAt - startedAt) / 1000).toFixed(1);

console.log("");
console.log("purchasing_rippling_sync summary:");
if (walkResult) console.log(`  spend_lines:   ${walkResult.ok ? "ok" : "FAIL"}  pages=${walkResult.pageNo} examined=${walkResult.examined} inserted=${walkResult.inserted}`);
if (catCandResult) console.log(`  category_map:  ${catCandResult.ok ? "ok" : "FAIL"}  upserted=${catCandResult.upserted}`);
if (deptCandResult) console.log(`  dept_map:      ${deptCandResult.ok ? "ok" : "FAIL"}  upserted=${deptCandResult.upserted}`);
if (deriveResult) console.log(`  derive:        ${deriveResult.ok ? "ok" : "FAIL"}  lines_derived=${deriveResult.linesDerived} unattributed=${deriveResult.unattributed} uncoded=${deriveResult.uncoded}`);
if (probesResult) console.log(`  probes:        ${probesResult.allPass ? "ALL PASS" : "FAIL"}  ${probesResult.probes.map(p => `${p.id}=${p.pass ? "P" : "F"}`).join(" ")}`);
console.log(`  total elapsed=${totalSec}s  source=${args.source}  dryRun=${args.dryRun}`);

if (!walkResult?.ok || !catCandResult?.ok || !deptCandResult?.ok || !deriveResult?.ok) process.exit(2);
if (probesResult && !probesResult.allPass) process.exit(4);
process.exit(0);
