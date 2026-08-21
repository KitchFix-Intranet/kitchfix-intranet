// INV-1 schema recon v2 - PostgREST OpenAPI introspection
// (no exec_sql available; use the /rest/v1 spec endpoint instead).
const URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const TARGETS = [
  "inventory_items", "item_catalog", "item_aliases", "price_history",
  "review_queue", "ai_line_items", "vendors", "vendor_master", "vendor_aliases",
  "invoice_submissions", "count_sessions", "count_items", "storage_locations",
  "merge_history", "merge_history_items", "zone_corrections",
];

console.log("Hitting " + URL + "/rest/v1/ for OpenAPI spec...");
const res = await fetch(URL + "/rest/v1/", {
  headers: {
    apikey: KEY,
    Authorization: "Bearer " + KEY,
    Accept: "application/openapi+json",
  },
});
if (!res.ok) {
  console.log("OpenAPI fetch failed: " + res.status + " " + (await res.text()).slice(0, 300));
  process.exit(1);
}
const spec = await res.json();
const defs = spec.definitions || {};

console.log();
console.log("Tables/views found in OpenAPI spec: " + Object.keys(defs).length);
console.log();
const targetSet = new Set(TARGETS);
const found = Object.keys(defs).filter((k) => targetSet.has(k)).sort();
const missing = TARGETS.filter((t) => !defs[t]);
console.log("Targets PRESENT in PostgREST schema: " + found.length);
console.log("Targets MISSING from PostgREST schema: " + missing.length + (missing.length ? " [" + missing.join(", ") + "]" : ""));

console.log();
console.log("═══════════════════════════════════════════════════════════════");
console.log("PER-TARGET COLUMN LISTS (verbatim from OpenAPI)");
console.log("═══════════════════════════════════════════════════════════════");
for (const name of found) {
  const def = defs[name];
  console.log();
  console.log("── " + name + " ──");
  const required = new Set(def.required || []);
  const props = def.properties || {};
  for (const [col, meta] of Object.entries(props)) {
    const typ = meta.format || meta.type || "?";
    const nul = required.has(col) ? "NOT NULL" : "NULL";
    const def_ = meta.default !== undefined ? ` DEFAULT ${JSON.stringify(meta.default)}` : "";
    const desc = meta.description ? ` -- ${meta.description.split("\n")[0].slice(0, 120)}` : "";
    const enumVals = meta.enum ? ` enum(${meta.enum.join(",")})` : "";
    console.log("  " + col.padEnd(28) + " " + typ + enumVals + " " + nul + def_ + desc);
  }
}

// Look at the spec for foreign key hints (PostgREST annotates them in descriptions)
console.log();
console.log("═══════════════════════════════════════════════════════════════");
console.log("FOREIGN KEY HINTS (from PostgREST 'Note:' descriptions)");
console.log("═══════════════════════════════════════════════════════════════");
for (const name of found) {
  const def = defs[name];
  const props = def.properties || {};
  const fks = [];
  for (const [col, meta] of Object.entries(props)) {
    const d = meta.description || "";
    const m = d.match(/Note:\s*This is a Foreign Key to `([^`]+)`\.<fk[^>]+>/);
    if (m) fks.push("    " + col + " -> " + m[1]);
    else if (/foreign key/i.test(d)) fks.push("    " + col + " -> ? (" + d.split("\n")[0].slice(0, 80) + ")");
  }
  if (fks.length) {
    console.log();
    console.log("── " + name + " ──");
    for (const fk of fks) console.log(fk);
  }
}

// Also dump views that match our patterns
console.log();
console.log("═══════════════════════════════════════════════════════════════");
console.log("INVENTORY-RELATED VIEWS present");
console.log("═══════════════════════════════════════════════════════════════");
const views = Object.keys(defs).filter((k) => k.startsWith("v_")).sort();
for (const v of views) console.log("  " + v);

// And explicitly compare PostgREST presence to direct existence
process.exit(0);
