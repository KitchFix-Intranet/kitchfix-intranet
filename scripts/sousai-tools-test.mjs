#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// scripts/sousai-tools-test.mjs
// SousAI Phase A - tool-layer probe.
//
// Runs 10 test cases against production PG (7 must-pass, 3 must-fail-as-access)
// plus 1 measurement case (corpus token totals). Exits nonzero on any FAIL.
//
// Run:
//   node --env-file=.env.local scripts/sousai-tools-test.mjs
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from "@supabase/supabase-js";
import { searchDocuments } from "../src/lib/sousai/tools/searchDocuments.js";
import { getDocument } from "../src/lib/sousai/tools/getDocument.js";
import { listDocuments } from "../src/lib/sousai/tools/listDocuments.js";

const results = [];
function pass(name, evidence) { results.push({ name, ok: true, evidence }); }
function fail(name, evidence) { results.push({ name, ok: false, evidence }); }

function log(msg) { console.log(msg); }
function hr() { log("─".repeat(78)); }

// Direct supabase for the runtime setup query (finding an In Build doc id
// for test 7) and for the token-totals measurement (test 11).
const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

log("SousAI Phase A tool-layer probe");
log(`Timestamp: ${new Date().toISOString()}`);
log(`DB: ${process.env.SUPABASE_URL}`);
hr();

// ── Test 1: search allergic-reaction ────────────────────────────────────────
try {
  const res = await searchDocuments("what do I do if someone has an allergic reaction", { accessLevels: ["unrestricted"] });
  const top = res[0];
  const hasPBTop = top?.docId === "PB-002";
  const hasSOP = res.some((d) => d.docId === "SOP-002");
  if (hasPBTop && hasSOP) {
    pass("1 searchDocuments(allergic-reaction, unrestricted)", `top=${top.docId} sim=${top.bestSimilarity.toFixed(4)}; SOP-002 present in ${res.length} docs`);
  } else {
    fail("1 searchDocuments(allergic-reaction, unrestricted)", `top=${top?.docId} (want PB-002); SOP-002-present=${hasSOP}`);
  }
} catch (e) { fail("1 searchDocuments(allergic-reaction, unrestricted)", `THREW: ${e.message}`); }

// ── Test 2: getDocument PB-002 unrestricted ─────────────────────────────────
try {
  const res = await getDocument("PB-002", { accessLevels: ["unrestricted"] });
  const okAvailable = res.available === true;
  const okText = typeof res.text === "string" && res.text.length > 0;
  const okTokens = res.tokenTotal > 0;
  const noNonCanonical = !(res.text || "").includes("<NonCanonical>");
  if (okAvailable && okText && okTokens && noNonCanonical) {
    pass("2 getDocument(PB-002, unrestricted)", `available textChars=${res.text.length} tokenTotal=${res.tokenTotal} sections=${res.sections?.length ?? 0} noNonCanonical=true`);
  } else {
    fail("2 getDocument(PB-002, unrestricted)", `available=${okAvailable} text=${okText} tokens=${okTokens} noNonCanonical=${noNonCanonical}`);
  }
} catch (e) { fail("2 getDocument(PB-002, unrestricted)", `THREW: ${e.message}`); }

// ── Test 3: getDocument FORM-001 unrestricted ───────────────────────────────
try {
  const res = await getDocument("FORM-001", { accessLevels: ["unrestricted"] });
  if (res.available === true) {
    pass("3 getDocument(FORM-001, unrestricted)", `available textChars=${res.text.length} tokenTotal=${res.tokenTotal}`);
  } else {
    fail("3 getDocument(FORM-001, unrestricted)", `available=false reason=${res.reason}`);
  }
} catch (e) { fail("3 getDocument(FORM-001, unrestricted)", `THREW: ${e.message}`); }

// ── Test 4: getDocument on one Live POST-class doc (stub) ───────────────────
try {
  const { data: postCandidates } = await sb
    .from("documents")
    .select("id")
    .eq("doc_class", "POST")
    .eq("status", "Live")
    .eq("archived", false)
    .eq("access_level", "unrestricted")
    .order("id", { ascending: true })
    .limit(1);
  if (!postCandidates || postCandidates.length === 0) {
    fail("4 getDocument(Live POST-class stub, unrestricted)", "no Live+unrestricted POST doc found in PG");
  } else {
    const target = postCandidates[0].id;
    const res = await getDocument(target, { accessLevels: ["unrestricted"] });
    if (res.available === true && res.docClass === "POST" && typeof res.text === "string" && res.text.length > 0) {
      pass("4 getDocument(Live POST-class stub, unrestricted)", `doc=${target} available docClass=POST textChars=${res.text.length}`);
    } else {
      fail("4 getDocument(Live POST-class stub, unrestricted)", `doc=${target} available=${res.available} docClass=${res.docClass} textChars=${res.text?.length ?? 0} reason=${res.reason}`);
    }
  }
} catch (e) { fail("4 getDocument(Live POST-class stub, unrestricted)", `THREW: ${e.message}`); }

// ── Test 5: listDocuments REC manager scope, expect 11 ──────────────────────
try {
  const res = await listDocuments({ docClass: "REC", accessLevels: ["unrestricted", "restricted"] });
  if (res.length === 11) {
    pass("5 listDocuments({docClass:REC, unrestricted+restricted})", `rows=${res.length}`);
  } else {
    fail("5 listDocuments({docClass:REC, unrestricted+restricted})", `rows=${res.length} want=11`);
  }
} catch (e) { fail("5 listDocuments({docClass:REC, unrestricted+restricted})", `THREW: ${e.message}`); }

// ── Test 6: listDocuments unrestricted, no non-Live, no non-unrestricted ────
try {
  const res = await listDocuments({ accessLevels: ["unrestricted"] });
  const badStatus = res.filter((r) => r.status !== "Live");
  const badLevel = res.filter((r) => r.access_level !== "unrestricted");
  if (badStatus.length === 0 && badLevel.length === 0) {
    pass("6 listDocuments({unrestricted}) - all Live + unrestricted", `rows=${res.length} zero non-Live, zero non-unrestricted`);
  } else {
    fail("6 listDocuments({unrestricted})", `bad-status=${badStatus.length} bad-level=${badLevel.length}`);
  }
} catch (e) { fail("6 listDocuments({unrestricted})", `THREW: ${e.message}`); }

// ── Test 7: getDocument on an In Build doc, manager scope, expect not_live ──
try {
  // Find one In Build doc id at runtime.
  const { data: candidates } = await sb
    .from("documents")
    .select("id, access_level")
    .eq("status", "In Build")
    .eq("archived", false)
    .in("access_level", ["unrestricted", "restricted"])
    .limit(1);
  if (!candidates || candidates.length === 0) {
    fail("7 getDocument(any In Build, manager scope)", "no In Build doc found in PG");
  } else {
    const target = candidates[0].id;
    const res = await getDocument(target, { accessLevels: ["unrestricted", "restricted"] });
    if (res.available === false && res.reason === "not_live") {
      pass("7 getDocument(In Build doc, manager scope)", `doc=${target} available=false reason=not_live`);
    } else {
      fail("7 getDocument(In Build doc, manager scope)", `doc=${target} available=${res.available} reason=${res.reason}`);
    }
  }
} catch (e) { fail("7 getDocument(In Build doc, manager scope)", `THREW: ${e.message}`); }

// ── Test 8: getDocument REC-101 unrestricted, expect access refusal ─────────
try {
  const res = await getDocument("REC-101", { accessLevels: ["unrestricted"] });
  const noContent = !("text" in res) && !("sections" in res) && !("tokenTotal" in res);
  if (res.available === false && res.reason === "access" && noContent) {
    pass("8 getDocument(REC-101, unrestricted) - access refusal, no content leak", `available=false reason=access no-content-fields=true`);
  } else {
    fail("8 getDocument(REC-101, unrestricted)", `available=${res.available} reason=${res.reason} no-content=${noContent}`);
  }
} catch (e) { fail("8 getDocument(REC-101, unrestricted)", `THREW: ${e.message}`); }

// ── Test 9: listDocuments REC unrestricted, expect zero rows ────────────────
try {
  const res = await listDocuments({ docClass: "REC", accessLevels: ["unrestricted"] });
  if (res.length === 0) {
    pass("9 listDocuments({docClass:REC, unrestricted}) - zero rows", `rows=${res.length}`);
  } else {
    fail("9 listDocuments({docClass:REC, unrestricted})", `rows=${res.length} want=0; ids=${res.map((r)=>r.id).join(",")}`);
  }
} catch (e) { fail("9 listDocuments({docClass:REC, unrestricted})", `THREW: ${e.message}`); }

// ── Test 10: searchDocuments unrestricted on REC-target query, no REC docs ──
try {
  const res = await searchDocuments("service fee billed rate account record", { accessLevels: ["unrestricted"] });
  const recResults = res.filter((d) => d.docClass === "REC");
  if (recResults.length === 0) {
    pass("10 searchDocuments(REC-target query, unrestricted) - zero REC docs", `docs=${res.length} REC-count=0; top=${res[0]?.docId ?? "(empty)"}`);
  } else {
    fail("10 searchDocuments(REC-target query, unrestricted)", `REC docs leaked: ${recResults.map((r)=>r.docId).join(",")}`);
  }
} catch (e) { fail("10 searchDocuments(REC-target query, unrestricted)", `THREW: ${e.message}`); }

// ── Print per-test summary ──────────────────────────────────────────────────
hr();
log("Per-test result:");
for (const r of results) {
  log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
  log(`         ${r.evidence}`);
}
const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
hr();
log(`SUMMARY: ${passed} PASS, ${failed} FAIL, out of ${results.length}`);

// ── Test 11 (measurement): corpus token totals ──────────────────────────────
hr();
log("11 MEASUREMENT: corpus token totals from document_chunks.token_count");

const { data: chunkTotals, error: totalsErr } = await sb
  .from("document_chunks")
  .select("doc_id, token_count");
if (totalsErr) {
  log(`  ERROR: ${totalsErr.code || "?"}: ${totalsErr.message}`);
} else {
  // Paginated bulk without ORDER BY is unreliable (learned this 2026-07-24;
  // the counts miss chunks past 1000). Instead: fetch all with an ORDER BY
  // for stability, or count via per-doc head. For this measurement, get
  // per-doc counts via head count.
  const { data: allDocs } = await sb
    .from("documents")
    .select("id, doc_class, status, archived");
  const perDoc = {};
  let grand = 0;
  const byClass = {};
  for (const d of allDocs || []) {
    const { data: rows } = await sb
      .from("document_chunks")
      .select("token_count")
      .eq("doc_id", d.id);
    const sum = (rows || []).reduce((a, r) => a + (r.token_count ?? 0), 0);
    if (sum > 0) {
      perDoc[d.id] = { sum, doc_class: d.doc_class };
      grand += sum;
      byClass[d.doc_class] = (byClass[d.doc_class] || 0) + sum;
    }
  }
  log(`  GRAND TOTAL tokens: ${grand.toLocaleString()}`);
  log(`  Docs with chunks: ${Object.keys(perDoc).length}`);
  log("");
  log("  Per doc_class:");
  for (const [k, v] of Object.entries(byClass).sort((a, b) => b[1] - a[1])) {
    log(`    ${k.padEnd(6)} ${v.toLocaleString()}`);
  }
  log("");
  log("  Top 10 largest docs by token count:");
  const top = Object.entries(perDoc)
    .sort((a, b) => b[1].sum - a[1].sum)
    .slice(0, 10);
  for (const [id, info] of top) {
    log(`    ${id.padEnd(12)} [${info.doc_class}]  ${info.sum.toLocaleString()}`);
  }
}

hr();
if (failed > 0) {
  log(`EXIT: nonzero (${failed} FAIL)`);
  process.exit(1);
}
log("EXIT: 0 (all tests passed)");
process.exit(0);
