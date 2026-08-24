// PR2 R2 revision - sentinel probe: TBR-FL P8 gl 3200.1 billcom
// Confirms the $39,373.74 figure is unmoved by the Fix 1 revision.
// Fix 1 revision only touches display binding on BucketCard - no data.
import { createClient } from "@supabase/supabase-js";
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const P8_START = "2026-07-13";
const P8_END = "2026-08-09";
const ACCOUNT = "TBR - FL";
const GL = "3200.1";

// The route's billsOnlySpentForGl reads from `purchasing_actuals` where
// source='billcom' and gl_line_code=gl. Excluded rows already filtered
// upstream. Replicate that.
// Explore columns
const { data: sample } = await supa.from("purchasing_actuals").select("*").limit(1);
console.log("columns:", Object.keys(sample?.[0] || {}).join(","));

// Try `date` or `activity_date` or `week_start`
const { data, error } = await supa
  .from("purchasing_actuals")
  .select("*")
  .eq("account_key", ACCOUNT)
  .eq("gl_line_code", GL)
  .eq("source", "billcom")
  .gte("txn_date", P8_START)
  .lte("txn_date", P8_END)
  .limit(5000);

if (error) {
  console.log("query err:", error.message);
  process.exit(2);
}

const nonExcluded = (data || []).filter(r => !r.excluded);
const sum = nonExcluded.reduce((s, r) => s + Number(r.amount || 0), 0);
console.log("rows total:", data?.length ?? 0);
console.log("rows non-excluded:", nonExcluded.length);
console.log("bills-only sum (billcom source, excluded=false):", sum.toFixed(2));
console.log("target sentinel: 39373.74");
console.log("match:", Math.abs(sum - 39373.74) < 0.01);
