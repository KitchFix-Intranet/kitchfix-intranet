#!/usr/bin/env node
/* G3 step 4: extract distinct (Category ID, Category Name, FYTD $)
   from the CSV. Cross-reference with DB spend_category_map.
   Parse GL codes via Part A rule. Report parse rate. */

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const CSV = "/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// simple CSV parser handling quoted fields with commas
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuote = false; }
      else { cur += c; }
    } else {
      if (c === '"') inQuote = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

const raw = fs.readFileSync(CSV, "utf8");
const lines = raw.split("\n").filter(l => l.trim().length > 0);
const header = parseCsvLine(lines[0]);
console.log("header cols:", header.length);
const catIdIdx = header.indexOf("Category");
const catNameIdx = header.indexOf("Category Name");
const amtIdx = header.indexOf("Amount (by category)");
const vendIdx = header.indexOf("Vendor name");
console.log(`Category col idx=${catIdIdx}, Category Name idx=${catNameIdx}, Amount idx=${amtIdx}, Vendor idx=${vendIdx}`);

// aggregate by category_id
const byId = new Map();   // id -> { name, fytd, merchants: Map<vendor, count>, count }
for (let i = 1; i < lines.length; i++) {
  const cells = parseCsvLine(lines[i]);
  const id = cells[catIdIdx];
  const name = cells[catNameIdx];
  const amt = Number(cells[amtIdx] || 0);
  const vendor = cells[vendIdx];
  if (!id) continue;
  if (!byId.has(id)) byId.set(id, { name, fytd: 0, merchants: new Map(), count: 0 });
  const r = byId.get(id);
  r.fytd += amt;
  r.count++;
  if (vendor) r.merchants.set(vendor, (r.merchants.get(vendor) || 0) + 1);
  // keep first non-null name
  if (!r.name || r.name === "null") r.name = name;
}

console.log(`\nCSV distinct categories: ${byId.size}`);

// cross-ref: which are in DB?
const scm = [];
{ let from = 0; const step = 1000;
  while (true) {
    const { data, error } = await supa.from("spend_category_map").select("category_id, category_label, merchant_sample").order("category_id").range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    scm.push(...data);
    if (data.length < step) break;
    from += step;
  }
}
const dbIds = new Set(scm.map(r => r.category_id));
const csvIds = new Set(byId.keys());
const inBothCount = [...csvIds].filter(id => dbIds.has(id)).length;
const csvOnly = [...csvIds].filter(id => !dbIds.has(id));
const dbOnly = [...dbIds].filter(id => !csvIds.has(id));
console.log(`  in DB scm: ${dbIds.size}`);
console.log(`  in both:   ${inBothCount}`);
console.log(`  CSV-only:  ${csvOnly.length}`);
console.log(`  DB-only:   ${dbOnly.length}`);
if (dbOnly.length) {
  for (const id of dbOnly.slice(0, 20)) {
    const row = scm.find(r => r.category_id === id);
    console.log(`    DB-only ${id}: label="${row?.category_label}" merchant="${row?.merchant_sample}"`);
  }
}

// Part A parse: leading \d{4}(\.\d+)*
const parseRe = /^(\d{4}(?:\.\d+)*)/;
let parsed = 0;
const parsedList = [];
const unparsedList = [];
for (const [id, r] of byId) {
  const m = parseRe.exec((r.name || "").trim());
  if (m) { parsed++; parsedList.push({ id, name: r.name, gl: m[1] }); }
  else { unparsedList.push({ id, name: r.name, fytd: r.fytd }); }
}
console.log(`\nCSV Part-A parse rate: ${parsed} / ${byId.size} (${((parsed/byId.size)*100).toFixed(1)}%)`);
console.log("\nUnparsed:");
const sortedUnparsed = unparsedList.sort((a, b) => b.fytd - a.fytd);
for (const r of sortedUnparsed) console.log(`  $${r.fytd.toFixed(2).padStart(12)}  ${r.id}  "${r.name}"`);

// Also: any parsed names that "look" GL-coded but the regex missed?
// (Look for names starting with digit or containing an apparent code.)
console.log(`\nParsed sample:`);
for (const r of parsedList.slice(0, 10)) console.log(`  ${r.gl.padEnd(10)}  ${r.id}  "${r.name}"`);
