// ─────────────────────────────────────────────────────────────────────────────
// scripts/verify-pr-7-7-opd-archive.mjs
// Post-Studio verify for pr-7-7-opd-archive.sql
//
// What this proves:
//   1. documents.archived + documents.archived_at columns exist
//   2. archive_document(p_doc_id) RPC exists and returns the expected shape
//   3. Round-trip on a sentinel doc + chunks: archive flips both atomically
//      (archived=true AND chunks deleted)
//   4. Idempotency: second archive call on the same doc is a no-op
//   5. Empty result for a doc that doesn't exist (lets the API 404 cleanly)
//
// Sentinel ID is VERIFY-7-7-PROBE - chosen so it can't collide with any
// real catalog ID. Pre-cleanup runs at the start in case a previous verify
// crashed and left it around.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";

const SENTINEL_ID = "VERIFY-7-7-PROBE";
const NONEXISTENT_ID = "VERIFY-7-7-DOES-NOT-EXIST";

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

let failures = 0;
const ok  = (m) => console.log(`  ok    ${m}`);
const bad = (m) => { console.error(`  FAIL  ${m}`); failures++; };

console.log("verify pr-7-7-opd-archive (post-Studio)\n");

// ── [0] Pre-cleanup ──────────────────────────────────────────────────────────
console.log("[0] pre-cleanup any prior probe data");
{
  await sb.from("document_chunks").delete().eq("doc_id", SENTINEL_ID);
  await sb.from("documents").delete().eq("id", SENTINEL_ID);
  ok("cleanup complete (any stale probe rows removed)");
}

// ── [1] Column + RPC presence ────────────────────────────────────────────────
console.log("\n[1] archived column + archive_document RPC visible");
{
  const { error: colErr } = await sb
    .from("documents")
    .select("id, archived, archived_at")
    .limit(1);
  if (colErr) {
    bad(`archived column not visible: ${colErr.code || "?"}: ${colErr.message}`);
    bad("paste pr-7-7-opd-archive.sql in Studio first, then re-run");
    process.exit(1);
  }
  ok("documents.archived + archived_at columns present");

  const { data: emptyResp, error: rpcErr } = await sb.rpc("archive_document", {
    p_doc_id: NONEXISTENT_ID,
  });
  if (rpcErr) {
    if (rpcErr.code === "PGRST202" || /function.*does not exist/i.test(rpcErr.message)) {
      bad("archive_document RPC not found");
      bad("paste pr-7-7-opd-archive.sql in Studio first, then re-run");
      process.exit(1);
    }
    bad(`RPC call failed: ${rpcErr.code || "?"}: ${rpcErr.message}`);
  } else if (!emptyResp || emptyResp.length === 0) {
    ok("RPC returns 0 rows for nonexistent doc (API can 404 cleanly)");
  } else {
    bad(`RPC returned ${emptyResp.length} row(s) for nonexistent doc (expected 0)`);
  }
}

// ── [2] Setup sentinel doc + chunks ──────────────────────────────────────────
console.log("\n[2] insert sentinel doc + 2 chunks");
{
  const { error: docErr } = await sb.from("documents").insert({
    id: SENTINEL_ID,
    title: "Verify Probe 7.7",
    doc_class: "STD",
    status: "Pending",
    is_historical: false,
    archived: false,
  });
  if (docErr) {
    bad(`sentinel doc insert failed: ${docErr.code || "?"}: ${docErr.message}`);
    process.exit(1);
  }
  ok("sentinel doc inserted (archived=false)");

  // Realistic 1536-dim vector - values don't matter, just need the right shape.
  const probeVec = Array.from({ length: 1536 }, (_, i) => (i % 7) * 0.01);
  const { error: chunksErr } = await sb.from("document_chunks").insert([
    {
      doc_id: SENTINEL_ID,
      chunk_index: 0,
      language: "en",
      content: "verify probe chunk 0",
      token_count: 8,
      embedding: probeVec,
    },
    {
      doc_id: SENTINEL_ID,
      chunk_index: 1,
      language: "en",
      content: "verify probe chunk 1",
      token_count: 8,
      embedding: probeVec,
    },
  ]);
  if (chunksErr) {
    bad(`sentinel chunks insert failed: ${chunksErr.code || "?"}: ${chunksErr.message}`);
    await sb.from("documents").delete().eq("id", SENTINEL_ID); // best-effort cleanup
    process.exit(1);
  }
  ok("2 sentinel chunks inserted");
}

// ── [3] Archive round-trip via RPC ───────────────────────────────────────────
console.log("\n[3] archive_document RPC: flip + chunk delete in one transaction");
{
  const { data, error } = await sb.rpc("archive_document", { p_doc_id: SENTINEL_ID });
  if (error) {
    bad(`RPC error: ${error.code || "?"}: ${error.message}`);
  } else if (!data || data.length === 0) {
    bad("RPC returned empty (expected 1 row for an existing doc)");
  } else {
    const row = data[0];
    if (row.archived === true) ok("RPC reports archived=true");
    else bad(`RPC reports archived=${row.archived} (expected true)`);
    if (row.chunks_deleted === 2) ok("RPC reports chunks_deleted=2 (matches the 2 sentinel chunks)");
    else bad(`RPC reports chunks_deleted=${row.chunks_deleted} (expected 2)`);
    if (row.document_id === SENTINEL_ID) ok(`RPC reports document_id=${row.document_id}`);
    else bad(`RPC reports document_id=${row.document_id} (expected ${SENTINEL_ID})`);
  }
}

// ── [4] Verify post-archive doc state ────────────────────────────────────────
console.log("\n[4] post-archive: documents row state");
{
  const { data: doc, error } = await sb
    .from("documents")
    .select("id, archived, archived_at, status")
    .eq("id", SENTINEL_ID)
    .single();
  if (error) {
    bad(`doc lookup failed: ${error.message}`);
  } else {
    if (doc.archived === true) ok("documents.archived = true");
    else bad(`documents.archived = ${doc.archived}`);
    if (doc.archived_at) ok(`documents.archived_at set to ${doc.archived_at}`);
    else bad("documents.archived_at is null (expected timestamp)");
    if (doc.status === "Pending") ok(`status preserved: ${doc.status} (orthogonal to archived)`);
    else bad(`status = ${doc.status} (expected Pending - archive should NOT change status)`);
  }
}

// ── [5] Verify post-archive chunk state ──────────────────────────────────────
console.log("\n[5] post-archive: document_chunks for sentinel");
{
  const { count, error } = await sb
    .from("document_chunks")
    .select("*", { count: "exact", head: true })
    .eq("doc_id", SENTINEL_ID);
  if (error) bad(`chunk count failed: ${error.message}`);
  else if (count === 0) ok("0 chunks remaining for sentinel (Sous-integrity guarantee held)");
  else bad(`${count} chunks still present for sentinel (expected 0)`);
}

// ── [6] Idempotency: second archive call is a no-op ──────────────────────────
console.log("\n[6] idempotency: second archive_document call is a no-op");
{
  const { data, error } = await sb.rpc("archive_document", { p_doc_id: SENTINEL_ID });
  if (error) {
    bad(`second RPC call failed: ${error.message}`);
  } else if (!data || data.length === 0) {
    bad("second RPC call returned empty (expected 1 row - doc still exists)");
  } else {
    const row = data[0];
    if (row.archived === true) ok("second call: archived still true");
    else bad(`second call: archived=${row.archived}`);
    if (row.chunks_deleted === 0) ok("second call: chunks_deleted=0 (no-op, chunks already gone)");
    else bad(`second call: chunks_deleted=${row.chunks_deleted} (expected 0)`);
  }
}

// ── [7] Cleanup sentinel ─────────────────────────────────────────────────────
console.log("\n[7] cleanup sentinel doc");
{
  const { error } = await sb.from("documents").delete().eq("id", SENTINEL_ID);
  if (error) bad(`cleanup failed: ${error.message}`);
  else ok("sentinel deleted");
}

console.log();
if (failures === 0) {
  console.log("PASS — pr-7-7 archive_document RPC verified.");
  console.log("       Atomic archive (archived=true + chunks deleted) is one transaction.");
  console.log("       Idempotent on re-runs. Returns empty for nonexistent docs.");
} else {
  console.log(`FAIL — ${failures} check(s) did not pass.`);
  process.exit(1);
}
