// Find which category_id maps to "**Please Select A Category**"
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function parseCsvLine(line) {
  const out = []; let cur = ""; let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuote = false; }
      else cur += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur); return out;
}
const raw = fs.readFileSync("/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv", "utf8");
const records = [];
{ let cur = ""; let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') { if (inQuote && raw[i + 1] === '"') { cur += '""'; i++; } else { cur += c; inQuote = !inQuote; } }
    else if (c === "\n" && !inQuote) { records.push(cur); cur = ""; }
    else if (c === "\r" && !inQuote) {} else cur += c;
  }
  if (cur.length) records.push(cur);
}
const header = parseCsvLine(records[0]);
const catNameIdx = header.indexOf("Category Name");
const txnIdIdx = header.indexOf("Transaction ID");
const psTxns = [];
for (let n = 1; n < records.length; n++) {
  const cells = parseCsvLine(records[n]);
  const nm = cells[catNameIdx];
  if (nm === "**Please Select A Category**") psTxns.push(cells[txnIdIdx]);
}
console.log(`CSV rows with "**Please Select A Category**": ${psTxns.length}`);
console.log(`First txn: ${psTxns[0]}`);

// Look up in DB via ilike
const { data } = await supa.from("rippling_raw_spend_lines_latest")
  .select("category_id, external_id, merchant_name")
  .ilike("external_id", `%${psTxns[0]}%`)
  .limit(1);
console.log("first CSV txn -> DB cat_id:", data);

// Look up all cats named
const cats = new Set();
for (const t of psTxns.slice(0, 100)) {
  const { data } = await supa.from("rippling_raw_spend_lines_latest").select("category_id").ilike("external_id", `%${t}%`).limit(1);
  if (data && data[0]) cats.add(data[0].category_id);
}
console.log(`distinct cat_ids for first 100 Please-Select txns: ${cats.size}`);
for (const c of cats) console.log("  ", c);
