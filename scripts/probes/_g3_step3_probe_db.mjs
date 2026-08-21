#!/usr/bin/env node
/* G3 step 3: probe DB state for card mapping work. No writes. */

import { createClient } from "@supabase/supabase-js";

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SB_URL || !SB_KEY) { console.error("env missing"); process.exit(1); }
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

async function paginated(table, opts) {
  const out = [];
  let from = 0;
  const step = 1000;
  while (true) {
    let q = supa.from(table).select(opts.select).order(opts.order || "category_id");
    if (opts.filter) q = opts.filter(q);
    q = q.range(from, from + step - 1);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < step) break;
    from += step;
  }
  return out;
}

// 1. spend_category_map: current state
const scm = await paginated("spend_category_map", { select: "category_id, category_label, gl_line_code, merchant_sample" });
console.log(`spend_category_map: ${scm.length} rows`);
const labelled = scm.filter(r => r.gl_line_code);
console.log(`  with gl_line_code: ${labelled.length}`);
console.log(`  NULL gl_line_code: ${scm.length - labelled.length}`);

// 2. Does provenance column exist?
try {
  const { error } = await supa.from("spend_category_map").select("provenance").limit(1);
  console.log(`  provenance column: ${error ? "ABSENT (" + error.code + ")" : "PRESENT"}`);
} catch (e) { console.log(`  provenance column: ABSENT (${e.message})`); }

// 3. purchasing_actuals: state
const { count: paCount } = await supa.from("purchasing_actuals").select("*", { count: "exact", head: true });
console.log(`\npurchasing_actuals: ${paCount} rows total`);

const { count: paExcl } = await supa.from("purchasing_actuals").select("*", { count: "exact", head: true }).eq("excluded", true);
console.log(`  excluded: ${paExcl}`);

const { count: paNonExcl } = await supa.from("purchasing_actuals").select("*", { count: "exact", head: true }).eq("excluded", false);
console.log(`  non-excluded: ${paNonExcl}`);

const { count: paCard } = await supa.from("purchasing_actuals").select("*", { count: "exact", head: true }).eq("excluded", false).eq("source", "rippling_spend");
console.log(`  non-excluded rippling_spend: ${paCard}`);

const { count: paCardNoGl } = await supa.from("purchasing_actuals").select("*", { count: "exact", head: true }).eq("excluded", false).eq("source", "rippling_spend").is("gl_line_code", null);
console.log(`  non-excluded rippling_spend with NULL gl_line_code: ${paCardNoGl}`);

// 4. total dollars: routed vs unrouted vs excluded
async function sumAmount(filter) {
  let sum = 0;
  let from = 0; const step = 1000;
  while (true) {
    let q = supa.from("purchasing_actuals").select("amount").order("id").range(from, from + step - 1);
    q = filter(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const r of data) sum += Number(r.amount || 0);
    if (data.length < step) break;
    from += step;
  }
  return sum;
}

const excludedSum = await sumAmount(q => q.eq("excluded", true));
const nonExclSum = await sumAmount(q => q.eq("excluded", false));
const nonExclRouted = await sumAmount(q => q.eq("excluded", false).not("gl_line_code", "is", null));
const nonExclUnrouted = await sumAmount(q => q.eq("excluded", false).is("gl_line_code", null));

console.log(`\nDOLLARS`);
console.log(`  excluded:                        $${excludedSum.toFixed(2)}`);
console.log(`  non-excluded:                    $${nonExclSum.toFixed(2)}`);
console.log(`    non-excluded ROUTED (gl set):  $${nonExclRouted.toFixed(2)}`);
console.log(`    non-excluded UNROUTED (null):  $${nonExclUnrouted.toFixed(2)}`);
console.log(`  ---`);
console.log(`  routed + unrouted + excluded:    $${(excludedSum + nonExclSum).toFixed(2)}`);

// per-source
async function bySource(src) {
  const excl = await sumAmount(q => q.eq("excluded", true).eq("source", src));
  const nex = await sumAmount(q => q.eq("excluded", false).eq("source", src));
  const nexRouted = await sumAmount(q => q.eq("excluded", false).eq("source", src).not("gl_line_code", "is", null));
  const nexUnrouted = await sumAmount(q => q.eq("excluded", false).eq("source", src).is("gl_line_code", null));
  console.log(`  ${src}: excl=$${excl.toFixed(2)}  non-excl=$${nex.toFixed(2)}  (routed=$${nexRouted.toFixed(2)}  unrouted=$${nexUnrouted.toFixed(2)})`);
}
console.log(`\nBY SOURCE`);
await bySource("billcom");
await bySource("rippling_spend");
await bySource("upload");

// buckets (non-excluded)
console.log(`\nBUCKETS (non-excluded, ROUTED via gl_line_code prefix)`);
async function bucketPrefix(prefix, label) {
  const s = await sumAmount(q => q.eq("excluded", false).like("gl_line_code", prefix + "%"));
  console.log(`  ${label.padEnd(28)} (prefix ${prefix}): $${s.toFixed(2)}`);
}
await bucketPrefix("3200", "Food");
await bucketPrefix("3400", "Packaging & supplies");
await bucketPrefix("3500", "Vehicle");
await bucketPrefix("5002.5", "Equipment");
await bucketPrefix("5002.1", "R & M");
await bucketPrefix("13", "Reimbursable (13xx)");
// account_key TBR - FL
console.log(`\nTBR - FL BUCKETS`);
async function bucketPrefixAcct(prefix, label, acct) {
  const s = await sumAmount(q => q.eq("excluded", false).like("gl_line_code", prefix + "%").eq("account_key", acct));
  console.log(`  ${label.padEnd(28)} (prefix ${prefix}, ${acct}): $${s.toFixed(2)}`);
}
await bucketPrefixAcct("3200", "Food", "tbr-fl");
await bucketPrefixAcct("3400", "Packaging & supplies", "tbr-fl");
await bucketPrefixAcct("3500", "Vehicle", "tbr-fl");
await bucketPrefixAcct("5002.5", "Equipment", "tbr-fl");
await bucketPrefixAcct("5002.1", "R & M", "tbr-fl");
await bucketPrefixAcct("13", "Reimbursable (13xx)", "tbr-fl");
