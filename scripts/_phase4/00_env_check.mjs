// Phase 4 env check. No secrets exposed. Presence-only.
import dotenv from "/Users/kevinfietek/dev/kitchfix-intranet/node_modules/dotenv/lib/main.js";
dotenv.config({ path: "/Users/kevinfietek/dev/kitchfix-intranet/.env.local", quiet: true });

const need = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"];
let ok = true;
for (const k of need) {
  const alt = k === "SUPABASE_URL" ? "NEXT_PUBLIC_SUPABASE_URL" : null;
  const present = !!(process.env[k] || (alt && process.env[alt]));
  console.log(`  ${k}: ${present ? "present" : "MISSING"}`);
  if (!present) ok = false;
}
console.log(ok ? "PRE-FLIGHT PASS" : "PRE-FLIGHT FAIL");
process.exit(ok ? 0 : 1);
