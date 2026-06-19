// ════════════════════════════════════════════════════════════════════════════
// PROBE: corpus invoice classification harness
//
// READ-ONLY. Calls Claude vision API to classify each invoice in the
// corpus folder into one of 6 structure families (+ 2 skip categories
// + UNKNOWN). Writes NOTHING to DB or Sheets. Writes incremental results
// to a JSONL file in --out-dir for resumability + audit.
//
// IMAGE/PDF HANDLING
//   - PDFs: sent directly to Anthropic's API using the `document` content
//     type (`application/pdf`). Claude handles page rasterization +
//     rotation metadata server-side. No pdftoppm / poppler dependency.
//   - Images (JPG/PNG/WebP/GIF): sent as `image` content blocks.
//   - Page-1-only by default; the model decides if it needs more pages
//     (we send the whole PDF, model sees what it sees).
//   - Orientation: PDFs with /Rotate metadata are handled by Claude.
//     Smartphone-captured images with EXIF rotation may classify
//     suboptimally; if F5 accuracy is low in results, add explicit
//     EXIF rotation handling in a follow-up.
//
// COST AWARENESS
//   The default Step 1 (no --classify flag) is FREE — just walks the
//   folder. Step 2 makes ~one Claude call per invoice. Estimate before
//   running: with Sonnet 4 vision, ~$0.01-0.03 per invoice. The
//   inventory pass tells you N before you commit to N × $0.02.
//
// USAGE
//   Step 1 (inventory only, no API calls):
//     node --import ./scripts/_setup/register-aliases.mjs \
//          --env-file=.env.local scripts/_probe_corpus_classification.mjs
//
//   Step 2 (classify everything; idempotent + resumable):
//     node --import ./scripts/_setup/register-aliases.mjs \
//          --env-file=.env.local scripts/_probe_corpus_classification.mjs --classify
//
//   Args:
//     --folder=/path/to/corpus       default /Users/kevinfietek/Documents/Claude/2026
//     --out-dir=/path/to/results     default ./_corpus_results
//     --classify                     run Step 2; otherwise stop after inventory
//     --limit=N                      cap classification to first N files (testing)
//     --delay-ms=1000                ms between API calls (default 1000)
//     --force                        re-classify files already in results
//     --vendors="sysco,kuna,..."     restrict classify queue to files whose
//                                    filename-parsed vendor matches any of these
//                                    tokens (substring match, case-insensitive).
//                                    When set with --limit, distributes the limit
//                                    roughly evenly across the requested vendors.
//
// FILTERED OUT OF THE CORPUS
//   Files whose name contains "FIXED" or "RESUBMITTED" as a token are
//   skipped — they're re-uploads of an already-submitted invoice, so
//   including them would double-count in the volume census + waste
//   API calls. Count is reported in the inventory pass.
//
//   SEPARATE DATA-CLEANUP NOTE (future, not this probe's concern):
//   "FIXED_RESUBMITTED" filenames imply the original + the corrected
//   version both flowed into ai_line_items as line items, which is a
//   potential DUPLICATE source in the actual inventory data. Worth a
//   follow-up pass that finds (account, invoice_number) pairs with more
//   than one set of line items and dedups them. NOT in scope here.
// ════════════════════════════════════════════════════════════════════════════

import { readdir, readFile, writeFile, mkdir, stat, appendFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, extname, dirname } from "node:path";

const args = process.argv.slice(2);
function getArg(name, fallback) {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq) return eq.split("=", 2)[1];
  return fallback;
}
function hasFlag(name) { return args.includes(`--${name}`); }

const FOLDER     = getArg("folder", "/Users/kevinfietek/Documents/Claude/2026");
const OUT_DIR    = getArg("out-dir", "./_corpus_results");
const LIMIT      = getArg("limit") ? parseInt(getArg("limit"), 10) : null;
const DELAY_MS   = parseInt(getArg("delay-ms", "1000"), 10);
const CLASSIFY   = hasFlag("classify");
const FORCE      = hasFlag("force");
const VENDOR_FILTER = (getArg("vendors", "") || "")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

// ── Env ──
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (CLASSIFY && !ANTHROPIC_API_KEY) {
  console.error("[probe] --classify requires ANTHROPIC_API_KEY in env");
  process.exit(2);
}

// ── Walk folder recursively, find candidate invoice files ──
const INVOICE_EXTS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".tif", ".tiff"]);
const SKIP_NAMES   = new Set([".DS_Store", "Thumbs.db", ".gitkeep"]);
const SKIP_DIR_NAMES = new Set(["__MACOSX", ".Trash", ".git", "node_modules"]);

// Detects RAW_FIXED_RESUBMITTED_* and FIXED_* and *_RESUBMITTED_* style names.
// Tokenizes the filename and checks for FIXED or RESUBMITTED as a discrete token.
function isResubmittedFile(filename) {
  const tokens = filename.toLowerCase().split(/[_\-. ]+/);
  return tokens.includes("fixed") || tokens.includes("resubmitted");
}

async function walk(dir, acc = [], skipped = [], filteredResub = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch (e) { skipped.push({ path: dir, reason: `readdir failed: ${e.message}` }); return acc; }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIR_NAMES.has(ent.name) || ent.name.startsWith(".")) continue;
      await walk(full, acc, skipped, filteredResub);
    } else if (ent.isFile()) {
      if (SKIP_NAMES.has(ent.name)) continue;
      if (ent.name.startsWith(".")) continue;
      const ext = extname(ent.name).toLowerCase();
      if (INVOICE_EXTS.has(ext)) {
        if (isResubmittedFile(ent.name)) {
          filteredResub.push(full);
        } else {
          acc.push(full);
        }
      } else if (ext === ".zip") {
        skipped.push({ path: full, reason: "zip archive (unprocessed)" });
      } else {
        skipped.push({ path: full, reason: `non-invoice ext: ${ext}` });
      }
    }
  }
  return acc;
}

// ── Parse vendor hint from filename ──
// Convention: RAW_Vendor_Invoice#_Date.ext  (loose — accept lots of variants)
function parseFilenameVendor(fname) {
  const stem = basename(fname, extname(fname));
  // Drop leading "RAW_" or "raw_" if present
  const trimmed = stem.replace(/^raw[_-]/i, "");
  // Split on underscore or dash
  const parts = trimmed.split(/[_\-]+/);
  // Heuristic: first 1-2 segments are the vendor token (until we hit something that looks like an invoice number or date)
  const vendorParts = [];
  for (const p of parts) {
    if (/^\d{4,}$/.test(p)) break;           // pure-number invoice id
    if (/^\d{4}[-/]?\d{2}[-/]?\d{2}/.test(p)) break;  // date
    if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}/.test(p)) break; // US date
    vendorParts.push(p);
    if (vendorParts.length >= 3) break;     // safety: don't accumulate forever
  }
  return vendorParts.join(" ").trim() || null;
}

function normalizeVendor(name) {
  return String(name || "").trim().replace(/\s+/g, " ").toLowerCase();
}

// ── RAW / non-RAW pair dedup ──
// The corpus contains paired files for many invoices: the original "RAW_Xxx.pdf"
// scan AND the post-submission processed "Xxx.pdf" (the intranet adds a thin
// metadata caption strip in the page-margin whitespace). Both render to the
// same invoice content. Prefer the NON-RAW version because production
// extraction operates on the SUBMITTED file, so classifying that mirrors what
// extraction actually sees. Singleton RAW-only and non-RAW-only files are kept
// as-is.
function dedupPairs(allFiles) {
  const groups = new Map();
  for (const f of allFiles) {
    const fname = basename(f);
    const logical = fname.replace(/^RAW_/i, "");
    if (!groups.has(logical)) groups.set(logical, []);
    groups.get(logical).push(f);
  }
  const kept = [];
  const dropped = [];
  for (const paths of groups.values()) {
    if (paths.length === 1) { kept.push(paths[0]); continue; }
    const nonRaw = paths.find((p) => !/^RAW_/i.test(basename(p)));
    if (nonRaw) {
      kept.push(nonRaw);
      for (const p of paths) if (p !== nonRaw) dropped.push(p);
    } else {
      // No non-RAW twin (multiple RAW variants — unusual). Keep first, drop rest.
      kept.push(paths[0]);
      for (let i = 1; i < paths.length; i++) dropped.push(paths[i]);
    }
  }
  return { kept, dropped };
}

// ── Step 1: inventory pass (always runs) ──
console.log("─".repeat(80));
console.log(`[probe] folder: ${FOLDER}`);
console.log(`[probe] out-dir: ${OUT_DIR}`);
console.log(`[probe] mode: ${CLASSIFY ? "CLASSIFY (--classify)" : "INVENTORY only (default)"}`);
console.log("─".repeat(80));
console.log("");

try { await stat(FOLDER); }
catch { console.error(`[probe] folder does not exist: ${FOLDER}`); process.exit(2); }

const skipped = [];
const filteredResub = [];
const allCandidates = await walk(FOLDER, [], skipped, filteredResub);
allCandidates.sort();

// Collapse RAW / non-RAW pair duplicates (non-RAW preferred — see dedupPairs).
const { kept: files, dropped: pairDups } = dedupPairs(allCandidates);

console.log(`[probe] candidate invoice files: ${files.length}  (after filtering ${filteredResub.length} FIXED/RESUBMITTED + ${pairDups.length} RAW/non-RAW pair duplicates)`);

// Extension breakdown
const extCounts = new Map();
for (const f of files) {
  const e = extname(f).toLowerCase();
  extCounts.set(e, (extCounts.get(e) || 0) + 1);
}
console.log("");
console.log("EXTENSION BREAKDOWN");
for (const [e, n] of [...extCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${e.padEnd(8)} ${String(n).padStart(5)}`);
}

// Vendor histogram from filenames
const filenameVendor = new Map();
let unparseableNames = 0;
for (const f of files) {
  const v = parseFilenameVendor(basename(f));
  if (!v) { unparseableNames++; continue; }
  const k = normalizeVendor(v);
  filenameVendor.set(k, (filenameVendor.get(k) || 0) + 1);
}
console.log("");
console.log("VENDOR HISTOGRAM PARSED FROM FILENAMES (top 30)");
const vendorsByName = [...filenameVendor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
for (const [v, n] of vendorsByName) {
  console.log(`  ${String(n).padStart(5)}  ${v}`);
}
if (filenameVendor.size > 30) console.log(`  (+${filenameVendor.size - 30} more vendor tokens)`);
console.log("");
console.log(`unparseable filenames: ${unparseableNames}`);
console.log(`total distinct filename-vendor tokens: ${filenameVendor.size}`);
console.log("");

// Skipped files
if (skipped.length > 0) {
  console.log(`SKIPPED ${skipped.length} non-invoice item(s):`);
  const reasonCounts = new Map();
  for (const s of skipped) reasonCounts.set(s.reason, (reasonCounts.get(s.reason) || 0) + 1);
  for (const [r, n] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${r}`);
  }
  console.log("");
}

// FIXED/RESUBMITTED re-uploads (separate bucket — they're real invoice files,
// just duplicates of an already-submitted version, so we exclude them from
// the volume census to avoid double-counting. See header comment.)
console.log(`FIXED/RESUBMITTED RE-UPLOADS FILTERED: ${filteredResub.length}`);
if (filteredResub.length > 0) {
  console.log("  (these are excluded from both the inventory count and the classify queue)");
  // Show a sample so the user can sanity-check the filter
  for (const f of filteredResub.slice(0, 5)) {
    console.log(`  e.g. ${basename(f)}`);
  }
  if (filteredResub.length > 5) console.log(`  (+${filteredResub.length - 5} more)`);
}
console.log("");

// RAW / non-RAW pair dedup report
console.log(`RAW / NON-RAW PAIR DUPLICATES DROPPED: ${pairDups.length}  (non-RAW preferred — see dedupPairs)`);
if (pairDups.length > 0) {
  for (const f of pairDups.slice(0, 5)) {
    console.log(`  e.g. dropped ${basename(f)}`);
  }
  if (pairDups.length > 5) console.log(`  (+${pairDups.length - 5} more)`);
}
console.log("");

if (!CLASSIFY) {
  console.log("─".repeat(80));
  console.log("INVENTORY PASS COMPLETE. Re-run with --classify to hit the Claude API.");
  console.log(`Estimated API cost at ~$0.02/invoice with Sonnet 4 vision: ~$${(files.length * 0.02).toFixed(2)}`);
  console.log(`(actual cost depends on model + image complexity)`);
  console.log("─".repeat(80));
  process.exit(0);
}

// ════════════════════════════════════════════════════════════════════════════
// Step 2: classification pass
// ════════════════════════════════════════════════════════════════════════════

// Setup output dir + results file
if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });
const RESULTS_PATH = join(OUT_DIR, "classifications.jsonl");
const REPORT_PATH  = join(OUT_DIR, "report.txt");

// Load existing results (resumability)
const done = new Map();
if (existsSync(RESULTS_PATH)) {
  const raw = await readFile(RESULTS_PATH, "utf-8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      if (obj.path) done.set(obj.path, obj);
    } catch { /* skip */ }
  }
  console.log(`[probe] loaded ${done.size} prior classifications from ${RESULTS_PATH}`);
}

// Filter to files needing work
let queue = files.filter((f) => FORCE || !done.has(f));

// --vendors filter: restrict to files whose filename-vendor matches any token
if (VENDOR_FILTER.length > 0) {
  const before = queue.length;
  queue = queue.filter((f) => {
    const v = (parseFilenameVendor(basename(f)) || "").toLowerCase();
    return VENDOR_FILTER.some((vf) => v.includes(vf));
  });
  console.log(`[probe] --vendors filter narrowed queue: ${before} -> ${queue.length}`);

  // When LIMIT is also set, distribute evenly across the requested vendors
  if (LIMIT) {
    const perVendor = Math.ceil(LIMIT / VENDOR_FILTER.length);
    const sampled = [];
    const sampledSet = new Set();
    for (const vf of VENDOR_FILTER) {
      const matches = queue.filter((f) => {
        const v = (parseFilenameVendor(basename(f)) || "").toLowerCase();
        return v.includes(vf);
      });
      let taken = 0;
      for (const m of matches) {
        if (sampledSet.has(m)) continue;
        if (taken >= perVendor) break;
        sampled.push(m);
        sampledSet.add(m);
        taken++;
      }
      console.log(`[probe]   "${vf}": ${matches.length} available, ${taken} sampled`);
    }
    queue = sampled.slice(0, LIMIT);
  }
} else if (LIMIT) {
  queue = queue.slice(0, LIMIT);
}

console.log(`[probe] queued for classification: ${queue.length} file(s)${LIMIT ? ` (--limit=${LIMIT})` : ""}`);
console.log("");

// ── Classification prompt ──
const CLASSIFICATION_PROMPT = `You are an invoice STRUCTURE classifier. Examine this invoice and classify it into ONE family based on how QUANTITY, PRICE, and AMOUNT are laid out. We're cataloging structure for an extraction system, not extracting the data itself.

FAMILIES:

F1 — CLEAN PRINTED: quantity in a printed column (single column OR ordered+shipped pair); per-unit printed price column; printed amount column. Catch-weight (when present) shows weight in the qty column OR in a "Case Weights / TOTAL" sub-line. Typical vendors: Peddler's Son, Fresh Point, Sunfresh Produce, What Chefs Want (non-credit), Fortune Fish Gourmet, Rolling Lawns Farm, Katz Coffee.

F2 — WEIGHT-AS-QUANTITY: the qty column literally holds the weight, often with unit words inline like "10.60 pounds" or just "38.60"; per-pound pricing; weight × unit_price = amount; minimal/sparse layout. Typical vendors: City Seafood, Samuels Seafood.

F3 — PRINTED CASES + CATCH-WEIGHT SUB-LINE: printed Cases column for the count; catch-weight items add a "Total Weight ##.##" sub-line, priced per-lb; pack-size like "2/2 LB" appears as a separate descriptor column. Typical vendor: Ben E Keith.

F4 — HANDWRITTEN CASES: printed Weight / UnitPrice / Amount columns, BUT the Cases/quantity column is HANDWRITTEN or CIRCLED in pen (often faint, leftmost data column); catch-weight detected structurally via a printed Weight column where weight × unitPrice ≈ amount. Typical vendor: Cheney Brothers.

F5 — ROTATED / DENSE GRID: page is sideways OR layout is dense boxed/cramped cells; ordered/shipped columns are present but cramped/faint; catch-weight via "T/WT=" markers (Sysco style) or "Weights: TOTAL=" sub-lines (Kuna style). Typical vendors: Sysco, Kuna Foodservice, Shamrock Foods.

F6 — BEVERAGE DISTRIBUTOR: multi-section structure with SALES + DEPOSITS/RETURNS + DELIVERY/CATEGORY RECAP sections; quantity printed but in a dense line format; UPC or material codes; DEPOSIT and RETURN lines may be NEGATIVE (e.g., CO2/keg/bottle deposits). Typical vendors: Swire Coca-Cola, Grey Eagle.

SKIP-A — CREDIT MEMO: negative invoice total OR "CREDIT" watermark OR "Credit #" header. This is a refund document, not a sale.

SKIP-B — NON-FOOD VENDOR: the document is for a service or supplier that does not stock kitchen inventory: uniforms, knife/equipment sharpening service, linen rental, pest control, cleaning chemicals service contracts, etc. Known examples: Alsco (uniforms), Cintas (uniforms), Vestis (uniforms/linen), Cozzini (knife sharpening). FLAG any other vendor that looks like a recurring service charge rather than a food/beverage purchase.

UNKNOWN — none of the families fit. This is the MOST IMPORTANT outcome — flag any structure we haven't catalogued yet. Describe what you see in the rationale.

LIGHT EXTRACTION CHECK
After classifying, attempt to read 3 sample lines and report whether qty × unit_price ≈ amount (within ~5%). This is a per-family sanity signal: if the rules of that family say "qty is in column X" and the math doesn't foot, our family rules don't fit this invoice — UNKNOWN may be correct.

CRITICAL OUTPUT FORMAT: Your response MUST start with { and contain nothing else - no preamble, no explanation, no markdown fences, no commentary before or after the JSON. The first character of your output MUST be { and the last character MUST be }. If you have observations that don't fit the schema, put them in the "rationale" field.

JSON schema (return exactly this shape):
{
  "family": "F1|F2|F3|F4|F5|F6|SKIP-A|SKIP-B|UNKNOWN",
  "vendorName": "vendor name as printed on the invoice",
  "confidence": 0.85,
  "rationale": "1-2 sentence reason for the family choice; for UNKNOWN, describe the structure you see",
  "lightExtraction": {
    "lineCount": 12,
    "sampleLines": [
      { "description": "Arugula 4/2.5 LB", "qty": 1, "unitPrice": 19.57, "amount": 19.57 },
      { "description": "Beef Chuck", "qty": 1, "unitPrice": 14.53, "amount": 1496.59 }
    ],
    "footsCheck": "OK|FAIL|N/A",
    "footsRationale": "brief: do qty * unitPrice ≈ amount on the samples?"
  }
}`;

// ── API helpers ──
async function classifyOne(filePath) {
  const ext = extname(filePath).toLowerCase();
  const bytes = await readFile(filePath);
  const base64 = bytes.toString("base64");

  let contentBlock;
  if (ext === ".pdf") {
    contentBlock = {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: base64 },
    };
  } else {
    let media;
    if (ext === ".jpg" || ext === ".jpeg") media = "image/jpeg";
    else if (ext === ".png") media = "image/png";
    else if (ext === ".webp") media = "image/webp";
    else if (ext === ".gif") media = "image/gif";
    else throw new Error(`unsupported extension: ${ext}`);
    contentBlock = {
      type: "image",
      source: { type: "base64", media_type: media, data: base64 },
    };
  }

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: [contentBlock, { type: "text", text: CLASSIFICATION_PROMPT }],
      }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API ${res.status}: ${errText.slice(0, 300)}`);
  }
  const j = await res.json();
  const text = j.content?.[0]?.text || "";
  const cleaned = text.replace(/```json\s*|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch (parseErr) {
    // Salvage: model sometimes returns conversational text + JSON despite the
    // prompt's instruction. Regex-extract the first {...} block (greedy across
    // newlines) and retry the parse before recording an error.
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); }
      catch { /* fall through to throw */ }
    }
    throw new Error(`JSON parse failed: ${parseErr.message} | raw preview: ${cleaned.slice(0, 200)}`);
  }
}

const VALID_FAMILIES = new Set(["F1", "F2", "F3", "F4", "F5", "F6", "SKIP-A", "SKIP-B", "UNKNOWN"]);

// ── Run the queue with pacing + incremental writes ──
let nDone = 0, nErr = 0;
const startedAt = Date.now();

for (const filePath of queue) {
  nDone++;
  const fname = basename(filePath);
  const stem = fname.slice(0, 60);
  process.stdout.write(`[${String(nDone).padStart(4)}/${queue.length}] ${stem.padEnd(60)} ... `);

  let result;
  try {
    result = await classifyOne(filePath);
  } catch (e) {
    nErr++;
    console.log(`ERROR ${e.message.slice(0, 80)}`);
    const errRec = {
      path: filePath,
      filename: fname,
      filenameVendor: parseFilenameVendor(fname),
      ts: new Date().toISOString(),
      error: e.message,
    };
    await appendFile(RESULTS_PATH, JSON.stringify(errRec) + "\n");
    if (DELAY_MS) await new Promise((r) => setTimeout(r, DELAY_MS));
    continue;
  }

  // Validate family + cross-check vendor
  const family = VALID_FAMILIES.has(result?.family) ? result.family : "UNKNOWN";
  const fnameVendor = parseFilenameVendor(fname);
  const modelVendor = result?.vendorName || null;
  const filenameVsModelMismatch = (() => {
    if (!fnameVendor || !modelVendor) return false;
    const a = normalizeVendor(fnameVendor);
    const b = normalizeVendor(modelVendor);
    if (a === b) return false;
    if (a.length >= 4 && b.includes(a)) return false;
    if (b.length >= 4 && a.includes(b)) return false;
    return true;
  })();

  const rec = {
    path: filePath,
    filename: fname,
    filenameVendor: fnameVendor,
    ts: new Date().toISOString(),
    family,
    vendorName: modelVendor,
    confidence: result?.confidence ?? null,
    rationale: result?.rationale || "",
    lineCount: result?.lightExtraction?.lineCount ?? null,
    footsCheck: result?.lightExtraction?.footsCheck ?? null,
    footsRationale: result?.lightExtraction?.footsRationale || "",
    sampleLines: result?.lightExtraction?.sampleLines || [],
    filenameVsModelMismatch,
  };

  await appendFile(RESULTS_PATH, JSON.stringify(rec) + "\n");
  console.log(`${family.padEnd(7)} ${(modelVendor || "?").slice(0, 30).padEnd(30)} foots=${rec.footsCheck || "?"}`);

  if (DELAY_MS) await new Promise((r) => setTimeout(r, DELAY_MS));
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
console.log("");
console.log(`[probe] classification pass complete: ${nDone - nErr} ok, ${nErr} error, in ${elapsed}s`);
console.log("");

// ════════════════════════════════════════════════════════════════════════════
// Aggregate report
// ════════════════════════════════════════════════════════════════════════════

// Reload full results (includes anything from prior runs)
const allResults = [];
{
  const raw = await readFile(RESULTS_PATH, "utf-8");
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try { allResults.push(JSON.parse(line)); } catch { /* skip */ }
  }
}

// Only count classifications for files that survived RAW/non-RAW dedup.
// Prior runs may have classified RAW twins that the dedup now drops; those
// JSONL records still exist on disk but are excluded from the aggregate so
// volume weights aren't inflated.
const keptSet = new Set(files);
const inKeptSet = allResults.filter((r) => keptSet.has(r.path));
const okResults = inKeptSet.filter((r) => !r.error);
const errCount = inKeptSet.length - okResults.length;
const orphanCount = allResults.length - inKeptSet.length;
if (orphanCount > 0) {
  console.log(`[probe] note: ${orphanCount} prior classification(s) in JSONL belong to RAW twins now dropped by dedup — excluded from this report.`);
  console.log("");
}

function logBoth(s) {
  console.log(s);
  return s + "\n";
}

let report = "";
report += logBoth("═".repeat(80));
report += logBoth(`CORPUS CLASSIFICATION REPORT`);
report += logBoth(`generated: ${new Date().toISOString()}`);
report += logBoth(`folder: ${FOLDER}`);
report += logBoth(`total files scanned: ${files.length}`);
report += logBoth(`classified ok: ${okResults.length}`);
report += logBoth(`classification errors: ${errCount}`);
report += logBoth("═".repeat(80));
report += logBoth("");

// Family breakdown
const familyCounts = new Map();
for (const r of okResults) familyCounts.set(r.family, (familyCounts.get(r.family) || 0) + 1);
const totalOk = okResults.length;

report += logBoth("FAMILY BREAKDOWN");
const familyOrder = ["F1", "F2", "F3", "F4", "F5", "F6", "SKIP-A", "SKIP-B", "UNKNOWN"];
for (const fam of familyOrder) {
  const n = familyCounts.get(fam) || 0;
  const pct = totalOk > 0 ? (n / totalOk * 100).toFixed(1) : "0.0";
  report += logBoth(`  ${fam.padEnd(8)} ${String(n).padStart(5)}   ${pct.padStart(5)}%`);
}
report += logBoth("");

// Per-family foots-check pass rate (sanity signal)
report += logBoth("PER-FAMILY EXTRACTION-SANITY (does qty*unit ≈ amount on the family's rules?)");
for (const fam of ["F1", "F2", "F3", "F4", "F5", "F6"]) {
  const inFam = okResults.filter((r) => r.family === fam);
  if (inFam.length === 0) continue;
  const okFoots = inFam.filter((r) => r.footsCheck === "OK").length;
  const failFoots = inFam.filter((r) => r.footsCheck === "FAIL").length;
  const naFoots   = inFam.filter((r) => r.footsCheck === "N/A" || !r.footsCheck).length;
  const pct = inFam.length > 0 ? (okFoots / inFam.length * 100).toFixed(1) : "0.0";
  report += logBoth(`  ${fam.padEnd(8)} n=${String(inFam.length).padStart(4)}   OK=${String(okFoots).padStart(4)} (${pct.padStart(5)}%)   FAIL=${String(failFoots).padStart(4)}   N/A=${String(naFoots).padStart(4)}`);
}
report += logBoth("");

// UNKNOWN list — the most important output
const unknowns = okResults.filter((r) => r.family === "UNKNOWN");
report += logBoth(`UNKNOWN / NEW STRUCTURES (${unknowns.length})`);
report += logBoth("These are invoices that don't fit any catalogued family — surface 7th+ structures.");
for (const r of unknowns) {
  report += logBoth(`  ${r.filename}`);
  report += logBoth(`     vendor: ${r.vendorName || "?"}`);
  report += logBoth(`     rationale: ${r.rationale}`);
  report += logBoth("");
}
report += logBoth("");

// Vendor → family observed mapping
report += logBoth("OBSERVED VENDOR → FAMILY MAPPING (top vendors by count)");
const vendorFamily = new Map();   // normVendor → { display, byFamily: {fam: count} }
for (const r of okResults) {
  const v = normalizeVendor(r.vendorName);
  if (!v) continue;
  if (!vendorFamily.has(v)) vendorFamily.set(v, { display: r.vendorName, byFamily: {}, total: 0 });
  const b = vendorFamily.get(v);
  b.byFamily[r.family] = (b.byFamily[r.family] || 0) + 1;
  b.total++;
}
const vendorRanked = [...vendorFamily.values()].sort((a, b) => b.total - a.total);
for (const v of vendorRanked) {
  const fams = Object.entries(v.byFamily).sort((a, b) => b[1] - a[1])
    .map(([f, n]) => `${f}=${n}`).join("  ");
  report += logBoth(`  ${String(v.total).padStart(4)}  ${v.display.padEnd(36)}  ${fams}`);
}
report += logBoth("");

// Non-food vendors found (SKIP-B)
const nonFood = vendorRanked.filter((v) => (v.byFamily["SKIP-B"] || 0) > 0);
report += logBoth(`NON-FOOD VENDORS DETECTED (SKIP-B count > 0)`);
report += logBoth("Add these to the vendor-level skip list when the hybrid hits production.");
for (const v of nonFood) {
  report += logBoth(`  ${v.display}    (SKIP-B count: ${v.byFamily["SKIP-B"]})`);
}
report += logBoth("");

// Filename vs model mismatches
const mismatches = okResults.filter((r) => r.filenameVsModelMismatch);
report += logBoth(`FILENAME vs MODEL VENDOR MISMATCHES (${mismatches.length})`);
report += logBoth("Cases where the parsed-from-filename vendor token doesn't agree with what the model read off the invoice.");
for (const r of mismatches.slice(0, 50)) {
  report += logBoth(`  filename="${r.filenameVendor}"   model="${r.vendorName}"   family=${r.family}   file=${r.filename}`);
}
if (mismatches.length > 50) report += logBoth(`  (+${mismatches.length - 50} more)`);
report += logBoth("");

await writeFile(REPORT_PATH, report);
console.log(`[probe] full report written to: ${REPORT_PATH}`);
console.log(`[probe] raw per-file results in JSONL: ${RESULTS_PATH}`);
