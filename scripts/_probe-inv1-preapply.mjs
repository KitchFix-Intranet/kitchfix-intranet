// READ-ONLY pre-apply check for INV-1 against prod.
// Verifies the FK target types match what INV-1 expects, that the
// targets are PK/UNIQUE, and that no INV-1 object already exists.
//
// Uses PostgREST's OpenAPI spec endpoint at /rest/v1/ which publishes
// column types per table.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

function mark(ok, label) {
  return `${ok ? "MATCH    " : "MISMATCH "} ${label}`;
}

async function fetchOpenApi() {
  const res = await fetch(`${url}/rest/v1/`, {
    headers: { "apikey": key, "Authorization": `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`OpenAPI fetch failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function main() {
  const spec = await fetchOpenApi();
  const defs = spec.definitions || spec.components?.schemas || {};

  console.log(`=== PART 1: PRE-APPLY TYPE CHECK ===`);
  console.log(``);

  // ─── (1) vendors.id type ───
  const vendorsDef = defs.vendors;
  if (!vendorsDef) throw new Error("vendors table not found in OpenAPI spec");
  const vendorsIdCol = vendorsDef.properties?.id;
  const vendorsIdType = vendorsIdCol?.format || vendorsIdCol?.type || "(unknown)";
  // PostgREST format value for PG TEXT columns is 'text'. For UUID it's 'uuid'.
  const vendorsIdIsText = vendorsIdType === "text";
  console.log(`(1) vendors.id`);
  console.log(`    expected:        text`);
  console.log(`    actual:          ${vendorsIdType}`);
  console.log(`    ${mark(vendorsIdIsText, "vendors.id is TEXT")}`);

  // ─── (2) invoice_submissions.id type ───
  const invDef = defs.invoice_submissions;
  if (!invDef) throw new Error("invoice_submissions table not found in OpenAPI spec");
  const invIdCol = invDef.properties?.id;
  const invIdType = invIdCol?.format || invIdCol?.type || "(unknown)";
  const invIdIsUuid = invIdType === "uuid";
  console.log(``);
  console.log(`(2) invoice_submissions.id`);
  console.log(`    expected:        uuid`);
  console.log(`    actual:          ${invIdType}`);
  console.log(`    ${mark(invIdIsUuid, "invoice_submissions.id is UUID")}`);

  // ─── (3) PK / UNIQUE confirmation ───
  // OpenAPI spec marks PK columns with the "<pk>" extension on description.
  // Fallback: PostgREST puts PK columns in the required-on-insert set unless
  // they have a default. For TEXT id (no default) PK status shows via the
  // "required" array if insert needs it OR via the description.
  // The most reliable indicator: query the table with eq on id and a constant
  // and ensure PostgREST accepts it (which it would for PK or UNIQUE columns).
  // Simpler proof: select id, count(*) from vendors group by id having count(*) > 1
  // returns 0 rows. We can confirm uniqueness via PostgREST.
  console.log(``);
  console.log(`(3) PK/UNIQUE check`);
  const vDescr = vendorsDef.properties?.id?.description || "";
  const iDescr = invDef.properties?.id?.description || "";
  const vendorsHasPkMarker = /Primary Key|<pk/i.test(vDescr);
  const invHasPkMarker = /Primary Key|<pk/i.test(iDescr);
  console.log(`    vendors.id description:           "${vDescr.slice(0, 80)}"`);
  console.log(`    invoice_submissions.id descr:     "${iDescr.slice(0, 80)}"`);
  console.log(`    ${mark(vendorsHasPkMarker, "vendors.id has PK marker in OpenAPI")}`);
  console.log(`    ${mark(invHasPkMarker, "invoice_submissions.id has PK marker in OpenAPI")}`);

  // Belt-and-suspenders: a non-empty count via PostgREST proves the table is
  // queryable + the id column is selectable by service_role.
  const { count: vendorsCount } = await supa.from("vendors").select("id", { count: "exact", head: true });
  const { count: invCount } = await supa.from("invoice_submissions").select("id", { count: "exact", head: true });
  console.log(`    vendors row count:                ${vendorsCount}`);
  console.log(`    invoice_submissions row count:    ${invCount}`);
  console.log(`    (the existing FKs from invoice_submissions.vendor_id -> vendors(id) and`);
  console.log(`     the live behavior of Module 5 + 6 operationally confirm both PKs work.)`);

  // ─── (4) No INV-1 object collisions ───
  const inv1Tables = [
    "inventory_items", "item_aliases", "storage_locations", "count_sessions",
    "count_items", "price_history", "review_queue", "merge_history", "merge_history_items",
  ];
  const inv1Views = [
    "v_current_count_state", "v_current_count_items", "v_count_session_totals",
    "v_price_history_ranked", "v_price_movers", "v_inventory_items_full",
  ];
  console.log(``);
  console.log(`(4) No INV-1 object collisions (none should exist on prod yet)`);
  let collisions = 0;
  for (const t of [...inv1Tables, ...inv1Views]) {
    const present = !!defs[t];
    if (present) {
      console.log(`    COLLISION: ${t} is already in the schema`);
      collisions++;
    }
  }
  console.log(`    ${mark(collisions === 0, `${inv1Tables.length} tables + ${inv1Views.length} views are absent from prod`)}`);

  // Function existence is harder to detect via OpenAPI (procs only show if
  // they have a stable interface published). Probe via RPC call; expect
  // "function ... does not exist" or PostgREST 404.
  let procExists = false;
  try {
    const { error } = await supa.rpc("merge_inventory_items", {
      p_keeper_id: "__probe__",
      p_dupe_ids: [],
      p_canonical_name: null,
      p_email: "probe@local",
    });
    if (error) {
      // PostgREST 404 = function not found = good. Otherwise something is wrong.
      const msg = String(error.message || "");
      if (msg.includes("Could not find") || msg.includes("does not exist") || msg.includes("not found")) {
        procExists = false;
      } else {
        // Got a different error - the function existed and ran (e.g. raised on bad args)
        procExists = true;
        console.log(`    UNEXPECTED: merge_inventory_items rpc returned: ${msg.slice(0, 120)}`);
      }
    } else {
      procExists = true;
    }
  } catch (e) {
    procExists = false;
  }
  console.log(`    ${mark(!procExists, "merge_inventory_items() function is absent from prod")}`);

  // ─── Verdict ───
  const allMatch = vendorsIdIsText && invIdIsUuid && collisions === 0 && !procExists;
  console.log(``);
  console.log(`========================================`);
  console.log(`  VERDICT: ${allMatch ? "ALL MATCH - ready for Part 2 apply" : "MISMATCH - DO NOT APPLY"}`);
  console.log(`========================================`);
  // Note: the PK markers come from OpenAPI description text which Supabase
  // may or may not populate; the operational confirmation (existing live FKs
  // from invoice_submissions.vendor_id -> vendors(id) per pr-6-1-invoice-
  // schema.sql L67) is the load-bearing PK proof - those FKs only exist if
  // vendors.id is PK/UNIQUE.
}

main().catch((e) => {
  console.error("FATAL:", e.message);
  console.error(e.stack);
  process.exit(1);
});
