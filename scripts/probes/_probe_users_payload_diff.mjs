#!/usr/bin/env node
/**
 * Instrument the users-hash-still-differs case. The suppression
 * probe reported 100/100 differ even after excluding `updated_at`
 * and `photos` from the hash input, so there is at least one more
 * volatile field. This probe diffs ONE user's STORED payload
 * (rippling_raw_users_latest) against the FRESH API payload at the
 * leaf level and reports which keys moved, with the dot path.
 *
 * No field VALUES are printed by default. Only paths are printed,
 * so a leaked signed URL / email / name is not possible from the
 * output. Pass --values to also print the two values side by side
 * when a diff is small (<= 200 chars each) - use with care, this
 * will print signed URLs if that is where the diff is.
 *
 * READ-ONLY. One Rippling GET, one Supabase SELECT.
 *
 * CLI:
 *   node --env-file=.env.local scripts/probes/_probe_users_payload_diff.mjs [--values]
 *
 * Exit codes:
 *   0  probe ran
 *   1  configuration missing, API/DB call failed, or no row to diff
 */
import { createClient } from "@supabase/supabase-js";
import { fetchPage, extractRows, firstPageUrl } from "../../src/lib/rippling.js";

const SHOW_VALUES = process.argv.slice(2).includes("--values");

function pres(name) {
  const v = process.env[name];
  console.log(`env ${name.padEnd(32)}: ${v ? "PRESENT" : "ABSENT"}`);
  return !!v;
}

console.log(`users_payload_diff_probe started=${new Date().toISOString()}`);
const okKey  = pres("RIPPLING_API_KEY");
const okUrl  = pres("SUPABASE_URL");
const okRole = pres("SUPABASE_SERVICE_ROLE_KEY");
if (!okKey || !okUrl || !okRole) { console.error("STOP: required env ABSENT."); process.exit(1); }

const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

// Fetch page 1 and pick a stable ID.
const url = firstPageUrl("users", 10);
const res = await fetchPage(url, process.env.RIPPLING_API_KEY);
if (!res.ok) { console.error(`FAIL ${res.status}: ${res.error}`); process.exit(1); }
const rows = extractRows(res.body);
if (!rows.length) { console.error("empty page"); process.exit(1); }

// Use the first id for which a stored row exists.
let targetId = null;
let freshPayload = null;
for (const r of rows) {
  if (!r.id) continue;
  const { data } = await supa.from("rippling_raw_users_latest")
    .select("rippling_id, payload").eq("rippling_id", String(r.id)).limit(1).maybeSingle();
  if (data) {
    targetId = String(r.id);
    freshPayload = r;
    var storedPayload = data.payload;
    break;
  }
}
if (!targetId) { console.error("no overlap between page-1 ids and stored latest"); process.exit(1); }

console.log("");
console.log(`diffing rippling_id=${targetId}`);

// Recursive leaf-level diff. Returns list of { path, left, right }
// where left is the STORED value and right is the FRESH value.
function diffNode(a, b, path, out) {
  if (a === b) return;
  if (a == null || b == null || typeof a !== typeof b) {
    out.push({ path: path || "<root>", left: a, right: b });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) diffNode(a[i], b[i], `${path}[${i}]`, out);
    return;
  }
  if (typeof a === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diffNode(a[k], b[k], path ? `${path}.${k}` : k, out);
    return;
  }
  if (a !== b) out.push({ path, left: a, right: b });
}

const diffs = [];
diffNode(storedPayload, freshPayload, "", diffs);

console.log(`total leaf-level diffs: ${diffs.length}`);
if (diffs.length === 0) {
  console.log("payloads are byte-identical. If the hash still differs, the hash function is poisoned by something else.");
  process.exit(0);
}

// Group diffs by TOP-LEVEL key for the summary.
function topKey(path) {
  const m = path.match(/^([^.[]+)/);
  return m ? m[1] : path;
}
const byTop = new Map();
for (const d of diffs) {
  const t = topKey(d.path);
  byTop.set(t, (byTop.get(t) || 0) + 1);
}
console.log("");
console.log("diffs by top-level key:");
for (const [k, n] of [...byTop.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(32)} ${n}`);
}

console.log("");
console.log("per-leaf paths (first 60):");
for (const d of diffs.slice(0, 60)) {
  if (SHOW_VALUES) {
    const l = JSON.stringify(d.left);
    const r = JSON.stringify(d.right);
    const ls = l && l.length > 200 ? l.slice(0, 200) + "..." : l;
    const rs = r && r.length > 200 ? r.slice(0, 200) + "..." : r;
    console.log(`  ${d.path}`);
    console.log(`    stored: ${ls}`);
    console.log(`    fresh : ${rs}`);
  } else {
    console.log(`  ${d.path}`);
  }
}
process.exit(0);
