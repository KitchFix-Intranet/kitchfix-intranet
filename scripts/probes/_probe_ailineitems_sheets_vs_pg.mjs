import { createClient } from "@supabase/supabase-js";
const supa = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const accounts = ["STL - FL","STL - MO","CIN - OH","TXR - TX - H","TXR - TX - V","TXR - AZ","CIN - AZ","TBR - FL","TBJ - FL"];
console.log("Per-account PG ai_line_items counts (account_key match):");
let pgTotal = 0;
for (const a of accounts) {
  const { count } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("account_key", a);
  console.log("  " + a.padEnd(18) + " " + count);
  pgTotal += count;
}
console.log("  SUM across 9 accounts: " + pgTotal);

const { count: pgGrandTotal } = await supa.from("ai_line_items").select("*", { count: "exact", head: true });
console.log("  TOTAL all rows in PG:  " + pgGrandTotal);

const { count: hist } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("is_historical", true);
const { count: live } = await supa.from("ai_line_items").select("*", { count: "exact", head: true }).eq("is_historical", false);
console.log("  is_historical TRUE:  " + hist);
console.log("  is_historical FALSE: " + live);

console.log();
console.log("PG created_at per day (last 14 days):");
const since = new Date(Date.now() - 14*86400*1000).toISOString();
let allRecent = [];
const PAGE = 1000;
for (let off = 0; ; off += PAGE) {
  const { data } = await supa.from("ai_line_items").select("account_key, created_at").gte("created_at", since).range(off, off + PAGE - 1);
  if (!data || data.length === 0) break;
  allRecent = allRecent.concat(data);
  if (data.length < PAGE) break;
}
const byDay = new Map();
for (const r of allRecent) {
  const d = String(r.created_at).slice(0, 10);
  const a = r.account_key;
  const k = d + "::" + a;
  byDay.set(k, (byDay.get(k) || 0) + 1);
}
const days = [...new Set([...byDay.keys()].map((k) => k.split("::")[0]))].sort();
console.log("Date        " + accounts.map((a) => a.slice(0,9).padStart(9)).join("  "));
for (const d of days) {
  console.log(d + "  " + accounts.map((a) => String(byDay.get(d+"::"+a) || ".").padStart(9)).join("  "));
}
console.log();
console.log("Total recent rows scanned: " + allRecent.length);
