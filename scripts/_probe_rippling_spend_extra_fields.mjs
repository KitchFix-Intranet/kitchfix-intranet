// scripts/_probe_rippling_spend_extra_fields.mjs
//
// Investigate: does spend_transaction carry ANY field beyond
// display_value + has_perm + id? And what does the top-level `name`
// field look like on a spend line?
//
// Counts + shape info only. No cardholder names, no client dollars.

import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const sample = await supa.from("rippling_raw_spend_lines_latest").select("rippling_id, raw").limit(50);
if (sample.error) { console.error(sample.error); process.exit(1); }

const spendTxKeys = new Set();
const workLocKeys = new Set();
const deptKeys = new Set();
const catShapes = new Set();
const topKeys = new Set();
const nameShapes = new Set();
for (const r of sample.data || []) {
  const raw = r.raw || {};
  for (const k of Object.keys(raw)) topKeys.add(k);
  const st = raw.spend_transaction;
  if (st && typeof st === "object") for (const k of Object.keys(st)) spendTxKeys.add(k);
  const wl = raw.work_location;
  if (wl && typeof wl === "object") for (const k of Object.keys(wl)) workLocKeys.add(k);
  const d = raw.department;
  if (d && typeof d === "object") for (const k of Object.keys(d)) deptKeys.add(k);
  catShapes.add(typeof raw.category);
  nameShapes.add(typeof raw.name);
}
console.log(`top-level keys (union across 50 samples): ${[...topKeys].sort().join(", ")}`);
console.log(`spend_transaction keys (union):           ${[...spendTxKeys].sort().join(", ")}`);
console.log(`work_location keys (union):               ${[...workLocKeys].sort().join(", ")}`);
console.log(`department keys (union):                  ${[...deptKeys].sort().join(", ")}`);
console.log(`category shapes seen:                     ${[...catShapes].join(", ")}`);
console.log(`name shapes seen:                         ${[...nameShapes].join(", ")}`);

// Sample raw.name values (first 5). name is a rippling label field -
// print, but note: rippling calls it a "spend line name" not a
// cardholder name. Still redact to be safe: only print if it does not
// look like a person name (heuristic: contains a digit, quote, or the
// word "for").
const names = [];
for (const r of sample.data || []) {
  const n = r.raw?.name;
  if (typeof n === "string" && n.length) names.push(n);
  if (names.length >= 5) break;
}
console.log(`\nfirst 5 raw.name values (redacted if resembles person):`);
for (const n of names) {
  const looksLikePerson = /^[A-Z][a-z]+ [A-Z][a-z]+/.test(n) && !/\d|["\/]|\bfor\b/i.test(n);
  console.log(`  ${looksLikePerson ? "[REDACTED_MAYBE_PERSON]" : n}`);
}
