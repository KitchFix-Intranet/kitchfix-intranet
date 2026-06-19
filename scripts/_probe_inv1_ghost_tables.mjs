import { createClient } from "@supabase/supabase-js";
const sb = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const GHOSTS = ["item_catalog", "vendor_master", "zone_corrections"];
for (const t of GHOSTS) {
  console.log("\n── " + t + " ──");
  // 1. Try a head-only count (most permissive)
  let { count: cHead, error: eHead } = await sb.from(t).select("*", { count: "exact", head: true });
  console.log("  head:true count =", cHead, "error =", eHead ? `${eHead.code}/${eHead.message}` : "(none)");
  // 2. Try a normal select (forces a real query)
  let { data: dSel, error: eSel } = await sb.from(t).select("*").limit(1);
  console.log("  limit(1)  rows =", dSel ? dSel.length : "(null)", "error =", eSel ? `${eSel.code}/${eSel.message}` : "(none)");
  if (dSel && dSel.length > 0) {
    console.log("  sample row keys =", Object.keys(dSel[0]).join(", "));
  }
  // 3. Try a count(*) via PostgREST
  let { count: cExact, error: eExact } = await sb.from(t).select("id", { count: "exact" }).limit(1);
  console.log("  exact count =", cExact, "error =", eExact ? `${eExact.code}/${eExact.message}` : "(none)");
}

// Also: query the public.pg_proc list via PostgREST's introspection
// by trying rpc names we know don't exist
console.log("\n── trying alternative rpc names ──");
for (const fn of ["pg_query", "run_sql", "execute_sql", "_exec_sql", "_admin_sql"]) {
  const { data, error } = await sb.rpc(fn, {});
  console.log("  " + fn + ":", error ? error.message.slice(0, 80) : "OK (data=" + JSON.stringify(data).slice(0, 80) + ")");
}
process.exit(0);
