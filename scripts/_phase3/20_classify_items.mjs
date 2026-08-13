// Classify distinct item descriptions across the three axes (quality,
// preparation, storage). Batch 25 items per LLM call; single call returns all
// three axes for the batch. Cache to disk (idempotent by input hash).
//
// Model: claude-sonnet-4-6 (matches invoiceActions.js production use).
// Output cache: item_classifications.json (Kevin's spec location).

import fs from "node:fs";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/dotenv/lib/main.js";

dotenv.config({ path: "/Users/kevinfietek/dev/kitchfix-intranet/.env.local", quiet: true });

const AUGMENTED_JSON = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/scripts_phase3/_augmented.json";
const CACHE_JSON = "/Users/kevinfietek/dev/purchase-discovery-2026-08-12/item_classifications.json";
const MODEL = "claude-sonnet-4-6";
const BATCH_SIZE = 25;

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const LIMIT_BATCHES = args.has("--limit-batches") ? Number(process.argv[process.argv.indexOf("--limit-batches") + 1]) : null;
const CONCURRENCY = args.has("--concurrency") ? Number(process.argv[process.argv.indexOf("--concurrency") + 1]) : 6;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("[classify] Missing ANTHROPIC_API_KEY");
  process.exit(2);
}
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Load augmented dataset. Distinct classification key = (vendor_id, description).
const aug = JSON.parse(fs.readFileSync(AUGMENTED_JSON, "utf8"));
const dollarSet = aug.rows.filter((r) => r.review_reason !== "invoice_over_extracted");
const pairs = new Map();
for (const r of dollarSet) {
  const desc = (r.description || "").trim();
  if (!desc) continue;
  const key = `${r.vendor_id || "NO-VENDOR"}::${desc}`;
  if (!pairs.has(key)) {
    pairs.set(key, {
      key,
      normalized_description: desc,
      vendor_id: r.vendor_id || null,
      vendor_name: r.vendor_name,
      example_category: r.category,
      example_pack_size: r.pack_size,
    });
  }
}
console.log("[classify] distinct (vendor_id, description) pairs in DOLLAR SET:", pairs.size);

// Load / init cache
let cache = { model: MODEL, classified_at: null, items: {} };
if (fs.existsSync(CACHE_JSON)) {
  cache = JSON.parse(fs.readFileSync(CACHE_JSON, "utf8"));
  console.log("[classify] loaded existing cache with", Object.keys(cache.items).length, "items");
}
if (!cache.items) cache.items = {};

const todo = [];
for (const [key, obj] of pairs) {
  if (cache.items[key]) continue; // already classified
  todo.push(obj);
}
console.log("[classify] TODO:", todo.length);

if (todo.length === 0) {
  console.log("[classify] nothing to classify. Exiting.");
  process.exit(0);
}

// System + user prompt
const SYSTEM_PROMPT = `You are classifying restaurant/catering food purchase line items across three axes for a spend analysis. You will receive a JSON array of items (each with vendor_name, description, and hint fields). Return JSON only.

FOR EACH ITEM, EMIT ALL THREE AXES with 6 fields each (axis label + integer confidence 0-100 + short reason string).

AXIS 1 - QUALITY:
  premium: named-brand, prime/choice grade, artisan/organic/local, house-cut steaks, whole primal cuts, single-source seafood, DOP/PDO products. Examples: "PRIME RIBEYE BONELESS", "SOCKEYE SALMON WILD", "DOP SAN MARZANO TOMATO", "MURRAY'S CHEESE MANCHEGO", "BERKSHIRE PORK BUTT".
  commodity: generic/store-brand, no grade specified, standard case pack, low-cost line. Examples: "SYS CLS SUGAR BROWN", "PORK BUTT BONE IN", "OIL FRYER BLND", "CHICKEN LEG QTR", "MAYO 1GAL".
  neutral: mixed-use ingredients or items where quality isn't the distinguishing feature. Examples: "TOMATO ROMA", "GARLIC PEELED", "SALT KOSHER", "MILK 2%", "FLOUR AP".
  Confidence expresses how sure you are about the label given the description text alone.

AXIS 2 - PREPARATION:
  prefabricated: portioned, pre-cooked, pre-breaded, pre-cut, ready-to-heat, IQF individual portions, deli-sliced meats. Examples: "CHICKEN TENDER BREADED IQF", "MEATBALL COOKED 1OZ", "PIZZA DOUGH BALL 8OZ FROZEN", "TURKEY SLICED ROAST DELI".
  scratch-input: raw whole ingredient, bulk primal, unprocessed produce, dry staples, bulk dairy. Examples: "BEEF BRISKET WHOLE", "ONION YELLOW 50#", "FLOUR AP 50#", "TOMATO CASE 25#".
  neutral: could go either way; multi-purpose. Examples: "CHEESE MOZZARELLA SHRED", "OIL OLIVE EXTRA VIRGIN", "PASTA PENNE".
  Confidence: how confident given the description.

AXIS 3 - STORAGE:
  frozen: explicitly frozen, IQF, deep-frozen, freezer-only. Look for "FRZ", "FROZEN", "IQF".
  fresh: refrigerated/perishable, produce/dairy/deli. No freeze marker.
  shelf-stable: canned, dry, boxed, oil, sugar, flour, spice, non-perishable.
  unknown: cannot determine from description.
  Confidence: how confident.

RULES:
- "Neutral" and "unknown" are CORRECT answers. Do not force verdicts.
- If confidence < 70 for an axis, the row will be excluded from headline percentages but still recorded.
- Every reason must be one short phrase (< 15 words). No boilerplate.
- Return valid JSON only. No prose.

OUTPUT FORMAT (exact):
{
  "items": [
    {
      "key": "<verbatim key from input>",
      "quality_axis": "premium|commodity|neutral",
      "quality_confidence": 85,
      "quality_reason": "prime grade named in description",
      "preparation_axis": "prefabricated|scratch-input|neutral",
      "preparation_confidence": 90,
      "preparation_reason": "IQF individual portions",
      "storage_axis": "frozen|fresh|shelf-stable|unknown",
      "storage_confidence": 95,
      "storage_reason": "explicit FRZ marker"
    },
    ...
  ]
}
`;

function batchInputHash(batch) {
  const s = JSON.stringify(batch.map((b) => `${b.key}|${b.normalized_description}|${b.vendor_name || ""}`));
  return crypto.createHash("sha256").update(s).digest("hex");
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const batches = chunk(todo, BATCH_SIZE);
console.log("[classify] batches:", batches.length, "of size", BATCH_SIZE);
const willRun = LIMIT_BATCHES != null ? Math.min(LIMIT_BATCHES, batches.length) : batches.length;
console.log("[classify] will run:", willRun, DRY_RUN ? "(DRY RUN - no API calls)" : "");

if (!cache.batch_hashes) cache.batch_hashes = {};

let apiCalls = 0;
let apiTokensIn = 0;
let apiTokensOut = 0;
let failures = 0;
let consecutiveFailures = 0;
const FAILURE_LIMIT = 3; // rule 8: two failures same root cause = STOP. With
                           // retry-on-transient inside the API call, any
                           // FAILURE_LIMIT-hit here is a genuinely persistent
                           // fault (schema drift, credit balance, permanent
                           // rejection).
let stopRequested = false;

console.log(`[classify] concurrency=${CONCURRENCY}`);

async function callAnthropicWithRetry(userMsg, maxRetries = 3) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await anthropic.messages.create({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }],
      });
    } catch (err) {
      lastErr = err;
      const msg = String(err.message || err);
      // Retry on transient errors (connection, timeout, 5xx, 429)
      const transient = /connection|timeout|ECONN|ETIMEDOUT|network|fetch failed|429|500|502|503|504/i.test(msg);
      if (!transient) throw err;
      if (attempt >= maxRetries) throw err;
      const backoff = 1500 * Math.pow(2, attempt) + Math.random() * 500;
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

async function processBatch(bi) {
  const batch = batches[bi];
  const hash = batchInputHash(batch);
  if (cache.batch_hashes[hash]) {
    return { skipped: true, bi };
  }
  if (DRY_RUN) {
    console.log(`[classify] DRY: would send batch ${bi + 1}/${willRun}, items ${batch.length}`);
    return { skipped: true, bi };
  }
  const userMsg = JSON.stringify(
    {
      items: batch.map((b) => ({
        key: b.key,
        vendor_name: b.vendor_name,
        description: b.normalized_description,
        hint_category: b.example_category,
        hint_pack_size: b.example_pack_size,
      })),
    },
    null,
    0
  );
  const resp = await callAnthropicWithRetry(userMsg);
  apiTokensIn += resp.usage?.input_tokens || 0;
  apiTokensOut += resp.usage?.output_tokens || 0;
  apiCalls += 1;
  const text = resp.content?.map((c) => c.text || "").join("") || "";
  let parsed;
  try {
    const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) parsed = JSON.parse(match[0]);
    else throw e;
  }
  if (!parsed?.items || !Array.isArray(parsed.items)) throw new Error("no items array");
  const byKey = new Map(batch.map((b) => [b.key, b]));
  let matched = 0;
  for (const it of parsed.items) {
    const b = byKey.get(it.key);
    if (!b) continue;
    cache.items[b.key] = {
      normalized_description: b.normalized_description,
      vendor_id: b.vendor_id,
      vendor_name: b.vendor_name,
      quality_axis: it.quality_axis,
      quality_confidence: Number(it.quality_confidence) || 0,
      quality_reason: it.quality_reason || "",
      preparation_axis: it.preparation_axis,
      preparation_confidence: Number(it.preparation_confidence) || 0,
      preparation_reason: it.preparation_reason || "",
      storage_axis: it.storage_axis,
      storage_confidence: Number(it.storage_confidence) || 0,
      storage_reason: it.storage_reason || "",
      classified_at: new Date().toISOString(),
      model_used: MODEL,
    };
    matched += 1;
  }
  cache.batch_hashes[hash] = { classified_at: new Date().toISOString(), item_count: matched };
  return { bi, matched, in: resp.usage?.input_tokens, out: resp.usage?.output_tokens };
}

// Concurrency-limited runner
let cursor = 0;
let doneCount = 0;
let lastPersist = Date.now();
let lockPersist = false;
async function worker(wid) {
  while (!stopRequested) {
    const bi = cursor++;
    if (bi >= willRun) return;
    try {
      const r = await processBatch(bi);
      doneCount += 1;
      if (r.skipped) {
        console.log(`[classify] batch ${bi + 1}/${willRun} skipped (cached or dry) [w${wid}] done=${doneCount}`);
      } else {
        console.log(`[classify] batch ${bi + 1}/${willRun} ok m=${r.matched} in=${r.in} out=${r.out} [w${wid}] done=${doneCount}`);
        consecutiveFailures = 0;
      }
      // NOTE: persistence handled by the interval-driven `persistLoop` below,
      // not by workers. This avoids race conditions where JSON.stringify a huge
      // cache took long enough for another worker to mutate cache.items mid-walk.
    } catch (err) {
      failures += 1;
      consecutiveFailures += 1;
      console.error(`[classify] batch ${bi + 1}/${willRun} FAILED [w${wid}]:`, err.message || err);
      if (consecutiveFailures >= FAILURE_LIMIT) {
        console.error(`[classify] STOP: ${FAILURE_LIMIT} consecutive failures. Rule 8.`);
        stopRequested = true;
        return;
      }
      // Small backoff for rate limits
      if (String(err.message || "").match(/429|rate/i)) {
        console.error(`[classify] rate limit hit, backing off 10s`);
        await new Promise((r) => setTimeout(r, 10000));
      }
    }
  }
}

// Interval-driven persister: no worker mutates cache during a stringify pass.
async function persistLoop() {
  while (!stopRequested && cursor < willRun) {
    await new Promise((r) => setTimeout(r, 15000));
    try {
      cache.classified_at = new Date().toISOString();
      const snapshot = JSON.stringify(cache, null, 2);
      const tmp = CACHE_JSON + ".tmp";
      fs.writeFileSync(tmp, snapshot);
      fs.renameSync(tmp, CACHE_JSON);
      console.log(`[classify] persisted cache: items=${Object.keys(cache.items).length} batches=${Object.keys(cache.batch_hashes).length}`);
    } catch (e) {
      console.error("[classify] persist error:", e.message);
    }
  }
}

const workers = [];
for (let w = 0; w < CONCURRENCY; w++) workers.push(worker(w));
const persister = persistLoop();
await Promise.all(workers);
await persister;

cache.classified_at = new Date().toISOString();
{
  const tmp = CACHE_JSON + ".tmp." + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2));
  fs.renameSync(tmp, CACHE_JSON);
}
console.log("\n[classify] DONE");
console.log("  api calls:", apiCalls);
console.log("  tokens in :", apiTokensIn);
console.log("  tokens out:", apiTokensOut);
console.log("  failures  :", failures);
console.log("  cache size:", Object.keys(cache.items).length);
// Rough cost estimate for claude-sonnet-4-6 (public rate ~ $3/M in, $15/M out)
const cost = (apiTokensIn / 1_000_000) * 3 + (apiTokensOut / 1_000_000) * 15;
console.log("  est cost  : $" + cost.toFixed(2));
