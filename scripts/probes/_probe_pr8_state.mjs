// Recon probe for PR 8: verify the current Academy state before building.
// USE-not-SEE for env; presence checks only.
import { createClient } from "@supabase/supabase-js";

for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) {
    console.error(`ABSENT: ${k}`);
    process.exit(1);
  }
}
console.log("SUPABASE_URL:", process.env.SUPABASE_URL ? "PRESENT" : "ABSENT");
console.log("SUPABASE_SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "PRESENT" : "ABSENT");

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const KEVIN_EMAIL = "k.fietek@kitchfix.com";

// 1. Kevin's people row + worker_id
const p = await sb.from("people").select("worker_id, display_name, is_salaried, is_site_leader, is_corp, account_key, status, end_date").eq("status", "ACTIVE").ilike("work_email", KEVIN_EMAIL);
console.log("\n--- Kevin's people row ---");
console.log(JSON.stringify(p.data, null, 2));
if (p.error) { console.error("ERR:", p.error.message); process.exit(1); }
const workerId = p.data?.[0]?.worker_id;

// 2. All cycles (state)
const c = await sb.from("academy_cycles").select("cycle_id, label, period_start, period_end, status, audience_scope, published_at").order("period_start");
console.log("\n--- All academy_cycles ---");
console.log(JSON.stringify(c.data, null, 2));

// 3. All requirements (state)
const r = await sb.from("academy_requirements").select("requirement_id, worker_id, person_id, doc_id, obligation_key, doc_version, est_minutes, source, cycle_id, due_date", { count: "exact" });
console.log("\n--- academy_requirements total count:", r.count);
console.log("Sample rows:", JSON.stringify((r.data || []).slice(0, 3), null, 2));

// 4. Kevin's requirements
if (workerId) {
  const kr = await sb.from("academy_requirements").select("requirement_id, doc_id, obligation_key, doc_version, est_minutes, source, cycle_id, due_date, waived_at").eq("worker_id", workerId).order("due_date");
  console.log(`\n--- Kevin's requirements (worker_id=${workerId}): count=${(kr.data || []).length} ---`);
  console.log(JSON.stringify(kr.data, null, 2));
}

// 5. Obligations count
const o = await sb.from("academy_obligations").select("obligation_id, doc_id, obligation_key, doc_version, source_section, type, cadence, est_minutes, applies_to", { count: "exact" });
console.log("\n--- academy_obligations count:", o.count);
console.log("All obligations:", JSON.stringify(o.data, null, 2));

// 6. Eligible people in Kevin's scope (company-wide, since he's academy_admin)
const grants = await sb.from("academy_grants").select("email, grant_type").eq("email", KEVIN_EMAIL);
console.log("\n--- Kevin's grants ---", JSON.stringify(grants.data, null, 2));

const activeAccounts = await sb.from("accounts").select("team_key, region, active, state").neq("active", false).order("region").order("team_key");
console.log("\n--- Active accounts:", (activeAccounts.data || []).length);

const activePeople = await sb.from("people").select("worker_id, account_key, is_salaried", { count: "exact" }).is("end_date", null).order("worker_id");
console.log("\n--- Active people (end_date IS NULL) count:", activePeople.count);
if (workerId) {
  const others = (activePeople.data || []).filter((x) => x.worker_id !== workerId);
  const salaried = others.filter((x) => x.is_salaried).length;
  const hourly = others.filter((x) => !x.is_salaried).length;
  console.log(`  Excluding Kevin: total=${others.length} salaried=${salaried} hourly=${hourly}`);
}

// 7. Region-leads presence
const rl = await sb.from("academy_region_leads").select("region, email");
console.log("\n--- academy_region_leads:", JSON.stringify(rl.data, null, 2));

// 8. document_content for one obligation doc (verify it exists so Focus view works)
const cd = await sb.from("document_content").select("doc_id, lang, content_hash, rendered_at").in("doc_id", ["PB-014", "AGR-001", "PB-006"]).eq("lang", "en");
console.log("\n--- document_content for pilot obligation docs:", JSON.stringify(cd.data, null, 2));

console.log("\nDONE");
