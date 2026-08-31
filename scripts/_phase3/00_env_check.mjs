// Env + DB connectivity check for Phase 3.
// Read-only. No env values printed.

import dotenv from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/dotenv/lib/main.js";
import { createClient } from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/@supabase/supabase-js/dist/index.mjs";

dotenv.config({ path: "/Users/kevinfietek/dev/kitchfix-intranet/.env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

console.log("[env] SUPABASE_URL present:", !!url);
console.log("[env] SUPABASE_SERVICE_ROLE_KEY present:", !!key);
console.log("[env] ANTHROPIC_API_KEY present:", !!anthropicKey);

if (!url || !key || !anthropicKey) {
  console.error("[env] Missing env; exiting.");
  process.exit(2);
}

const supa = createClient(url, key, { auth: { persistSession: false } });

// Basic checks.
const { count: aliCount, error: aliErr } = await supa
  .from("ai_line_items")
  .select("id", { count: "exact", head: true });
console.log("[db] ai_line_items rows total:", aliCount, "err:", aliErr?.message || null);

const { data: cols, error: colsErr } = await supa
  .from("ai_line_items")
  .select("needs_review, review_reason, parsed_weight_source")
  .limit(1);
if (colsErr) console.log("[db] cols err:", colsErr.message);
else console.log("[db] cols check ok, sample keys:", Object.keys(cols[0] || {}));

// Check needs_review distribution
const { data: nr, error: nrErr } = await supa
  .from("ai_line_items")
  .select("review_reason", { count: "exact" })
  .eq("needs_review", true)
  .limit(1);
console.log("[db] needs_review=true sample:", nr, "err:", nrErr?.message || null);

// Meals denominator table
const { count: actCount } = await supa
  .from("sc_daily_actuals")
  .select("service_date", { count: "exact", head: true });
console.log("[db] sc_daily_actuals rows:", actCount);

const { count: projCount } = await supa
  .from("sc_daily_projections")
  .select("service_date", { count: "exact", head: true });
console.log("[db] sc_daily_projections rows:", projCount);

// invoice_submissions
const { count: subCount } = await supa
  .from("invoice_submissions")
  .select("id", { count: "exact", head: true });
console.log("[db] invoice_submissions rows:", subCount);

console.log("[env] OK");
