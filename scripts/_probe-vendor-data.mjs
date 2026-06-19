// READ-ONLY vendor system recon. Queries PG (vendors, vendor_aliases,
// vendor_accounts) and reports counts + cross-references vs the
// inventory primaryVendor strings from the earlier probe.

import { createClient } from "@supabase/supabase-js";
import { safeRead, SHEET_IDS } from "../src/lib/sheets.js";
import { normalizeVendorName } from "../src/lib/vendorMatching.js";

const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const asStr = (v) => (v == null ? "" : String(v).trim());

async function main() {
  // ─── vendors ───
  console.log(`=== vendors (PG) ===`);
  const { data: vendors, error: vErr } = await supa
    .from("vendors")
    .select("id, name, category, deleted_at, created_at");
  if (vErr) throw new Error(vErr.message);
  const liveVendors = vendors.filter((v) => v.deleted_at == null);
  const deletedVendors = vendors.filter((v) => v.deleted_at != null);
  console.log(`total rows: ${vendors.length}`);
  console.log(`live (deleted_at IS NULL): ${liveVendors.length}`);
  console.log(`soft-deleted: ${deletedVendors.length}`);

  // case-insensitive name dupes (since vendors has no UNIQUE on name)
  const lowerCounts = new Map();
  for (const v of liveVendors) {
    const k = v.name.toLowerCase().trim();
    lowerCounts.set(k, (lowerCounts.get(k) || 0) + 1);
  }
  const lowerDupes = [...lowerCounts.entries()].filter(([, n]) => n > 1);
  console.log(`live-vendor names with case-insensitive duplicates: ${lowerDupes.length}`);
  for (const [n, c] of lowerDupes) console.log(`  "${n}" (${c}x)`);

  // ─── vendor_aliases ───
  console.log(``);
  console.log(`=== vendor_aliases (PG) ===`);
  const { data: aliases, error: aErr } = await supa
    .from("vendor_aliases")
    .select("vendor_id, alias_text, source, learned_at");
  if (aErr) throw new Error(aErr.message);
  console.log(`total aliases: ${aliases.length}`);
  const bySource = {};
  for (const a of aliases) {
    const s = a.source || "(empty)";
    bySource[s] = (bySource[s] || 0) + 1;
  }
  console.log(`by source:`);
  for (const [s, n] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${s}: ${n}`);
  }
  // Per-vendor alias count distribution
  const aliasesPerVendor = {};
  for (const a of aliases) aliasesPerVendor[a.vendor_id] = (aliasesPerVendor[a.vendor_id] || 0) + 1;
  const aliasCounts = Object.values(aliasesPerVendor).sort((a, b) => b - a);
  console.log(`vendors with >=1 alias: ${aliasCounts.length} of ${liveVendors.length}`);
  console.log(`alias-count distribution: max=${aliasCounts[0] || 0}  median=${aliasCounts[Math.floor(aliasCounts.length / 2)] || 0}`);

  // ─── vendor_accounts ───
  console.log(``);
  console.log(`=== vendor_accounts (PG) ===`);
  const { data: vaccs, error: vaErr } = await supa
    .from("vendor_accounts")
    .select("vendor_id, account_key, active");
  if (vaErr) throw new Error(vaErr.message);
  console.log(`total: ${vaccs.length}`);
  const active = vaccs.filter((r) => r.active);
  const inactive = vaccs.filter((r) => !r.active);
  console.log(`active=${active.length}  inactive=${inactive.length}`);
  const distinctAccts = new Set(vaccs.map((r) => r.account_key));
  console.log(`distinct account_key values: ${distinctAccts.size}`);
  console.log(`account_key values (first 12):`);
  for (const a of [...distinctAccts].slice(0, 12)) console.log(`  "${a}"`);

  // ─── invoice_submissions.vendor_id usage ───
  console.log(``);
  console.log(`=== invoice_submissions.vendor_id (PG) ===`);
  const { count: isubCount, error: ic1Err } = await supa
    .from("invoice_submissions")
    .select("id", { count: "exact", head: true });
  if (ic1Err) throw new Error(ic1Err.message);
  console.log(`invoice_submissions total: ${isubCount}`);
  const { data: isamp, error: isErr } = await supa
    .from("invoice_submissions")
    .select("vendor_id, vendor_name")
    .limit(5000);
  if (isErr) throw new Error(isErr.message);
  const nullVendorId = isamp.filter((r) => !r.vendor_id).length;
  // distinct vendor_ids used
  const vendorIdsInUse = new Set(isamp.map((r) => r.vendor_id).filter(Boolean));
  console.log(`sampled rows: ${isamp.length}  rows with NULL vendor_id: ${nullVendorId}`);
  console.log(`distinct vendor_id values in invoice_submissions sample: ${vendorIdsInUse.size}`);
  // Cross-check: any vendor_name -> vendor_id pairs where vendor_name doesn't match the vendor's canonical name?
  const vendorById = new Map(vendors.map((v) => [v.id, v.name]));
  let nameDriftCount = 0;
  const driftSamples = [];
  for (const r of isamp) {
    if (!r.vendor_id) continue;
    const canonical = vendorById.get(r.vendor_id);
    if (canonical && r.vendor_name && canonical.toLowerCase() !== r.vendor_name.toLowerCase()) {
      nameDriftCount++;
      if (driftSamples.length < 10) driftSamples.push({ vendor_id: r.vendor_id, in_submission: r.vendor_name, canonical });
    }
  }
  console.log(`rows where invoice_submissions.vendor_name != canonical vendors.name: ${nameDriftCount}`);
  for (const d of driftSamples) {
    console.log(`  ${d.vendor_id}  in-sub="${d.in_submission}"  canonical="${d.canonical}"`);
  }

  // ─── ai_line_items.vendor_name ───
  console.log(``);
  console.log(`=== ai_line_items.vendor_name (PG) ===`);
  const { count: aliCount } = await supa
    .from("ai_line_items")
    .select("id", { count: "exact", head: true });
  console.log(`ai_line_items total: ${aliCount}`);
  const { data: aliSamp, error: aliErr } = await supa
    .from("ai_line_items")
    .select("vendor_name")
    .limit(20000);
  if (aliErr) throw new Error(aliErr.message);
  const aliVendorSet = new Set();
  for (const r of aliSamp) {
    if (r.vendor_name) aliVendorSet.add(r.vendor_name.trim());
  }
  console.log(`distinct vendor_name strings in ai_line_items: ${aliVendorSet.size}`);

  // Cross-reference each against PG vendors (exact + normalized)
  const liveVendorNames = liveVendors.map((v) => v.name);
  const lowerSet = new Set(liveVendorNames.map((n) => n.toLowerCase()));
  const normSet = new Set(liveVendorNames.map((n) => normalizeVendorName(n)));
  // Also build alias lookup
  const aliasNormSet = new Set();
  for (const a of aliases) aliasNormSet.add(normalizeVendorName(a.alias_text));
  let exactHit = 0, normHit = 0, aliasHit = 0, unresolved = 0;
  const unresolvedSamples = [];
  for (const v of aliVendorSet) {
    const lower = v.toLowerCase();
    const norm = normalizeVendorName(v);
    if (lowerSet.has(lower)) exactHit++;
    else if (normSet.has(norm)) normHit++;
    else if (aliasNormSet.has(norm)) aliasHit++;
    else {
      unresolved++;
      if (unresolvedSamples.length < 20) unresolvedSamples.push(v);
    }
  }
  console.log(`ai_line_items vendor strings:`);
  console.log(`  exact (case-insensitive) match to vendors.name: ${exactHit}`);
  console.log(`  normalized match to vendors.name: ${normHit}`);
  console.log(`  normalized match to vendor_aliases.alias_text: ${aliasHit}`);
  console.log(`  unresolved against vendors + aliases: ${unresolved}`);
  for (const u of unresolvedSamples) console.log(`    "${u}"`);

  // ─── Inventory primaryVendor (Sheets) cross-check ───
  console.log(``);
  console.log(`=== inventory primaryVendor (Sheets item_catalog col G) vs vendors+aliases ===`);
  const { rows: catalogRows } = await safeRead(SHEET_IDS.INVENTORY, "item_catalog");
  const activeRows = catalogRows.filter((r) => asStr(r[11]).toUpperCase() !== "FALSE");
  const invVendorSet = new Set();
  for (const r of activeRows) {
    const v = asStr(r[6]);
    if (v) invVendorSet.add(v);
  }
  console.log(`distinct primaryVendor in active item_catalog: ${invVendorSet.size}`);
  let iExact = 0, iNorm = 0, iAlias = 0, iUnresolved = 0;
  const iUnresolvedList = [];
  for (const v of invVendorSet) {
    const lower = v.toLowerCase();
    const norm = normalizeVendorName(v);
    if (lowerSet.has(lower)) iExact++;
    else if (normSet.has(norm)) iNorm++;
    else if (aliasNormSet.has(norm)) iAlias++;
    else {
      iUnresolved++;
      iUnresolvedList.push(v);
    }
  }
  console.log(`  exact (case-insensitive): ${iExact}`);
  console.log(`  normalized to vendors.name: ${iNorm}`);
  console.log(`  normalized to vendor_aliases: ${iAlias}`);
  console.log(`  unresolved: ${iUnresolved}`);
  for (const u of iUnresolvedList) console.log(`    "${u}"`);

  // ─── Vendor-name UNIQUE check at schema level ───
  console.log(``);
  console.log(`=== schema-level constraints (from information_schema) ===`);
  const { data: cons, error: cErr } = await supa
    .from("information_schema.table_constraints")
    .select("table_name, constraint_name, constraint_type")
    .eq("table_schema", "public")
    .in("table_name", ["vendors", "vendor_aliases", "vendor_accounts"]);
  if (cErr) {
    console.log(`(could not query information_schema: ${cErr.message})`);
  } else {
    for (const c of cons) console.log(`  ${c.table_name}: ${c.constraint_type} ${c.constraint_name}`);
  }
}

main().catch((e) => {
  console.error(`[probe] FATAL: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
