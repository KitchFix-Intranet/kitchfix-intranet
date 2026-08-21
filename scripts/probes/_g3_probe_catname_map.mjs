// Replicate worksheet's buildCategoryIdToName and print entries for the
// three no-name cats.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";
const CSV = "/Users/kevinfietek/Downloads/Custom_report-6a87456dd3e0e4d972a07439.csv";
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
function loadCsvRecords(path) {
  const raw = fs.readFileSync(path, "utf8");
  const records = []; let cur = ""; let inQuote = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c === '"') { if (inQuote && raw[i + 1] === '"') { cur += '""'; i++; } else { cur += c; inQuote = !inQuote; } }
    else if (c === "\n" && !inQuote) { records.push(cur); cur = ""; }
    else if (c === "\r" && !inQuote) {}
    else cur += c;
  }
  if (cur.length) records.push(cur);
  return records;
}

const records = loadCsvRecords(CSV);
const header = parseCsvLine(records[0]);
const txnIdIdx = header.indexOf("Transaction ID");
const catNameIdx = header.indexOf("Category Name");
const csvTxnToName = new Map();
for (let n = 1; n < records.length; n++) {
  const cells = parseCsvLine(records[n]);
  const t = cells[txnIdIdx]; if (!t) continue;
  const nm = cells[catNameIdx];
  if (!csvTxnToName.has(t) && nm) csvTxnToName.set(t, nm);
}
const dbTxnToCat = new Map();
const PAGE = 1000;
let from = 0;
for (;;) {
  const { data } = await supa.from("rippling_raw_spend_lines_latest").select("category_id, external_id").order("id").range(from, from + PAGE - 1);
  if (!data || data.length === 0) break;
  for (const r of data) {
    if (!r.external_id) continue;
    const idx = r.external_id.indexOf("__line_item");
    const t = idx > 0 ? r.external_id.slice(0, idx) : null;
    if (t && r.category_id && !dbTxnToCat.has(t)) dbTxnToCat.set(t, r.category_id);
  }
  if (data.length < PAGE) break;
  from += PAGE;
}
const catIdToName = new Map();
for (const [t, name] of csvTxnToName) {
  const cid = dbTxnToCat.get(t);
  if (!cid) continue;
  if (!catIdToName.has(cid) && name && name !== "null") catIdToName.set(cid, name);
}
const targets = ["65aad3b6ecda651e1c45f987", "69154ddc92e0a2bc50ca6307", "692f1cf10e3aaafc506fd705"];
for (const t of targets) console.log(`${t}: name=${catIdToName.get(t) || "(none)"}`);
