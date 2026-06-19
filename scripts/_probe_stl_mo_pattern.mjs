import { createClient } from "@supabase/supabase-js";
const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const ACCOUNT = "STL - MO";
const SINCE = "2026-04-01";

// All STL-MO submissions since April
const { data: subs } = await supa.from("invoice_submissions")
  .select("id, client_uuid, vendor_name, invoice_number, invoice_date, total_amount, submitted_at, status, ai_scan_status, ai_scan_complete")
  .eq("account_key", ACCOUNT).gte("submitted_at", SINCE)
  .order("submitted_at", { ascending: true });
console.log("STL-MO submissions since " + SINCE + ": " + (subs?.length || 0));

// Vendor breakdown
const byVendor = new Map();
for (const s of subs || []) {
  if (!byVendor.has(s.vendor_name)) byVendor.set(s.vendor_name, []);
  byVendor.get(s.vendor_name).push(s);
}
console.log("\nVendor breakdown (STL-MO since " + SINCE + "):");
for (const [v, list] of [...byVendor.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log("  " + v.padEnd(30) + " " + list.length);
}

// For each invoice get sum_extended and compare to total
const ids = (subs || []).map((s) => s.id);
const { data: lines } = await supa.from("ai_line_items")
  .select("invoice_uuid, extended_price").in("invoice_uuid", ids);
const sumByInv = new Map();
const countByInv = new Map();
for (const l of lines || []) {
  sumByInv.set(l.invoice_uuid, (sumByInv.get(l.invoice_uuid) || 0) + Number(l.extended_price || 0));
  countByInv.set(l.invoice_uuid, (countByInv.get(l.invoice_uuid) || 0) + 1);
}

// Bucket each invoice by extraction quality
let cleanCt = 0, undercountCt = 0, overcountCt = 0, emptyCt = 0;
const overcountByVendor = new Map();
const emptyByVendor = new Map();
const allOvercount = [];
for (const s of subs || []) {
  const sum = sumByInv.get(s.id) || 0;
  const count = countByInv.get(s.id) || 0;
  const total = Number(s.total_amount || 0);
  if (count === 0) {
    emptyCt++;
    emptyByVendor.set(s.vendor_name, (emptyByVendor.get(s.vendor_name) || 0) + 1);
  } else if (total === 0) {
    cleanCt++; // weird but not bad-extraction
  } else if (sum > total * 1.01) {
    overcountCt++;
    overcountByVendor.set(s.vendor_name, (overcountByVendor.get(s.vendor_name) || 0) + 1);
    allOvercount.push({ ...s, sum, count, total, ratio: sum / total });
  } else if (sum < total * 0.5) {
    undercountCt++;
  } else {
    cleanCt++;
  }
}
console.log("");
console.log("Extraction quality buckets:");
console.log("  Clean:       " + cleanCt);
console.log("  Undercount (sum < 50% of total): " + undercountCt);
console.log("  Overcount (sum > 101% of total):  " + overcountCt);
console.log("  Empty (no ai_line_items):         " + emptyCt);

console.log("");
console.log("OVERCOUNT by vendor:");
for (const [v, c] of [...overcountByVendor.entries()].sort((a, b) => b[1] - a[1])) {
  console.log("  " + v.padEnd(30) + " " + c);
}
console.log("");
console.log("EMPTY by vendor:");
for (const [v, c] of [...emptyByVendor.entries()].sort((a, b) => b[1] - a[1])) {
  console.log("  " + v.padEnd(30) + " " + c);
}

console.log("");
console.log("All OVERCOUNT invoices with ratio:");
allOvercount.sort((a, b) => b.ratio - a.ratio);
for (const o of allOvercount) {
  console.log("  " + o.vendor_name.padEnd(20) + " inv=" + String(o.invoice_number).padEnd(12) + " date=" + o.invoice_date + " total=$" + o.total.toFixed(2).padStart(8) + " sum=$" + o.sum.toFixed(2).padStart(9) + " ratio=" + o.ratio.toFixed(2) + "x lines=" + o.count);
}
