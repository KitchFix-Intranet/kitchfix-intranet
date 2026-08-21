// INV-P8b DIG-4 - characterise ours-only inside-window parents
// - Sample raw payload for parent 6a70c59c7a64ce4345de7791 (first inside-window example)
// - Look at the 'name' field on lines (may indicate transaction type)
// - Look at merchant / department / work_location on unpaired subset

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import readline from "node:readline";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("missing env"); process.exit(2); }
const supa = createClient(url, key, { auth: { persistSession: false } });

function fmt(n) { return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
const HEX24 = /^[a-f0-9]{24}$/;
function parseParentFromExternal(external_id) {
  if (!external_id || typeof external_id !== "string") return null;
  const idx = external_id.indexOf("__");
  if (idx <= 0) return null;
  const tok = external_id.slice(0, idx).toLowerCase();
  return HEX24.test(tok) ? tok : null;
}
async function paginate(qBuilder, pageSize = 1000) {
  const out = [];
  let from = 0;
  while (true) {
    const q = await qBuilder(from, from + pageSize - 1);
    if (q.error) throw q.error;
    const rows = q.data || [];
    out.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Load full detail
const ours = await paginate((f, t) => supa
  .from("rippling_raw_spend_lines_latest")
  .select("rippling_id, external_id, amount, currency, department_label, work_location_label, merchant_name, raw")
  .order("rippling_id").range(f, t), 1000);

// Load CSV parent IDs
function parseCsvLine(line) {
  const out = [];
  let i = 0, cur = "", inQ = false;
  while (i < line.length) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i += 2; continue; }
      if (c === '"') { inQ = false; i++; continue; }
      cur += c; i++;
    } else {
      if (c === '"') { inQ = true; i++; continue; }
      if (c === ",") { out.push(cur); cur = ""; i++; continue; }
      cur += c; i++;
    }
  }
  out.push(cur);
  return { fields: out, inQuote: inQ };
}
const rl = readline.createInterface({ input: fs.createReadStream("/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv"), crlfDelay: Infinity });
let n = 0, hdr = null, hdrIdx = {};
const repParents = new Set();
let pend = "";
for await (const raw of rl) {
  n++;
  const line = pend + raw;
  const p = parseCsvLine(line);
  if (p.inQuote) { pend = line + "\n"; continue; }
  pend = "";
  if (!hdr) {
    if (n === 1) { hdr = p.fields; hdrIdx = Object.fromEntries(hdr.map((h, i) => [h, i])); }
    continue;
  }
  if (p.fields.length === 1 && p.fields[0] === "") continue;
  const txn = (p.fields[hdrIdx["Transaction ID"]] || "").toLowerCase();
  repParents.add(txn);
}
console.log(`ours lines: ${ours.length}`);
console.log(`csv parents: ${repParents.size}`);

// Bucket lines by presence-in-report parent
const oursOnlyLines = [];
const inBothLines = [];
for (const r of ours) {
  const p24 = parseParentFromExternal(r.external_id);
  if (!p24) continue;
  if (repParents.has(p24)) inBothLines.push(r);
  else oursOnlyLines.push(r);
}
console.log(`ours-only lines: ${oursOnlyLines.length}`);
console.log(`in-both lines:   ${inBothLines.length}`);

// Compare 'name' field distribution
function nameKey(r) {
  const n = r.raw?.name ?? null;
  if (n == null) return "(null)";
  const s = String(n);
  // Truncate to first 40 chars to avoid printing potentially sensitive strings
  return s.slice(0, 40);
}
// Nope - name contains merchant + memo. Skip.

// Distribution of key fields: purchase_type, gl_billable
function tally(arr, extract) {
  const m = new Map();
  for (const r of arr) {
    const v = extract(r) ?? "(null)";
    m.set(v, (m.get(v) || 0) + 1);
  }
  return m;
}

console.log("");
console.log("=== purchase_type distribution ===");
console.log("in-both lines:");
for (const [k, n] of [...tally(inBothLines, r => r.raw?.purchase_type).entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(k).padEnd(30)}  ${n}`);
}
console.log("ours-only lines:");
for (const [k, n] of [...tally(oursOnlyLines, r => r.raw?.purchase_type).entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(k).padEnd(30)}  ${n}`);
}

console.log("");
console.log("=== amortized distribution ===");
console.log("in-both:");
for (const [k, n] of [...tally(inBothLines, r => String(r.raw?.amortized)).entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(k).padEnd(30)}  ${n}`);
}
console.log("ours-only:");
for (const [k, n] of [...tally(oursOnlyLines, r => String(r.raw?.amortized)).entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(k).padEnd(30)}  ${n}`);
}

console.log("");
console.log("=== work_location_label top 20 ===");
console.log("in-both:");
for (const [k, n] of [...tally(inBothLines, r => r.work_location_label).entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${String(k).padEnd(50)}  ${n}`);
}
console.log("ours-only:");
for (const [k, n] of [...tally(oursOnlyLines, r => r.work_location_label).entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${String(k).padEnd(50)}  ${n}`);
}

// Full payload dump for parent 6a70c59c7a64ce4345de7791 (one ours-only inside-window example)
console.log("");
console.log("=== raw payload KEY SCHEMA + non-sensitive values for a ours-only inside-window sample ===");
const targetParent = "6a70c59c7a64ce4345de7791";
const targetLines = oursOnlyLines.filter(r => parseParentFromExternal(r.external_id) === targetParent);
console.log(`sample parent: ${targetParent}   lines here: ${targetLines.length}`);
if (targetLines[0]) {
  const raw = targetLines[0].raw || {};
  // Print only keys + types + safe-to-print values (numeric / boolean / short id / null)
  function safeVal(k, v) {
    // Suppress fields that might contain PII / names
    const PII_FIELDS = new Set(["name", "created_by", "last_modified_by", "gl_customer", "display_value", "external_id"]);
    if (v == null) return "null";
    if (typeof v === "boolean") return String(v);
    if (typeof v === "number") return String(v);
    if (typeof v === "string") {
      if (PII_FIELDS.has(k)) return `<string, ${v.length} chars, suppressed>`;
      if (v.length > 30) return `<string, ${v.length} chars>`;
      return JSON.stringify(v);
    }
    if (Array.isArray(v)) return `[array len=${v.length}]`;
    if (typeof v === "object") return "{object}";
    return String(v);
  }
  for (const [k, v] of Object.entries(raw)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      console.log(`  ${k}:`);
      for (const [k2, v2] of Object.entries(v)) {
        console.log(`    ${k2}: ${safeVal(k2, v2)}`);
      }
    } else {
      console.log(`  ${k}: ${safeVal(k, v)}`);
    }
  }
}

// One more angle: check department_id + work_location_id on ours-only vs in-both
// - is ours-only concentrated on a particular dept/wl that report excludes?
console.log("");
console.log("=== department_id top 15 ===");
console.log("in-both:");
for (const [k, n] of [...tally(inBothLines, r => r.raw?.department?.display_value).entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${String(k).padEnd(50)}  ${n}`);
}
console.log("ours-only:");
for (const [k, n] of [...tally(oursOnlyLines, r => r.raw?.department?.display_value).entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
  console.log(`  ${String(k).padEnd(50)}  ${n}`);
}

// Check the ratio of unique parents per work location - is ours-only mostly ONE location?
const oursOnlyParentsByWL = new Map();
for (const r of oursOnlyLines) {
  const p = parseParentFromExternal(r.external_id);
  const wl = r.work_location_label || "(null)";
  if (!oursOnlyParentsByWL.has(wl)) oursOnlyParentsByWL.set(wl, new Set());
  oursOnlyParentsByWL.get(wl).add(p);
}
console.log("");
console.log("=== unique parent COUNT per work_location for ours-only (top 15) ===");
for (const [wl, s] of [...oursOnlyParentsByWL.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 15)) {
  console.log(`  ${String(wl).padEnd(50)}  ${s.size}`);
}

console.error("[done]");
