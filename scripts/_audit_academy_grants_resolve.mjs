// Permanent audit: report any academy_grants.email that does NOT
// match an active people.work_email. Grants to unresolvable emails
// insert cleanly and grant nothing to nobody, silently.
//
// This shipped in production 2026-09-01: two admin grants were
// inserted for `j.katt@` and `j.lessard@` when the actual addresses
// are `josh@` and `joe@`. They resolved to nobody and nothing
// indicated a problem until a probe caught it.
//
// Deliberately NOT a foreign key. work_email is not unique-constrained
// (the seasonal-rehire discipline is orthogonal) and a grant should
// survive its holder leaving the roster. A REPORT-ONLY check catches
// typos at authoring time without either constraint.
//
// Report-only in this pass. Same reasoning as the unbounded-select
// audit - establish signal first, wire in separately once the
// false-positive rate is known.
//
// Run:
//   node --env-file=.env.local scripts/_audit_academy_grants_resolve.mjs

import { createClient } from "@supabase/supabase-js";

for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[k]) {
    console.error(`ABSENT: ${k} - run with --env-file=.env.local`);
    process.exit(1);
  }
}

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function norm(e) {
  return String(e || "").trim().toLowerCase();
}

// 1. Every grant row.
const grantsQ = await sb
  .from("academy_grants")
  .select("email, grant_type, granted_by, granted_at")
  .order("email");
if (grantsQ.error) {
  console.error(`FATAL: academy_grants read: ${grantsQ.error.message}`);
  process.exit(2);
}
const grants = grantsQ.data || [];

// 2. Every active people row's work_email.
// Uses .not(work_email, "is", null) to skip hourly rows (which carry
// work_email IS NULL by policy). Pagination guard: 30 salaried today,
// well under the 1000-row cap. The count-exact HEAD keeps us honest
// if that population ever grows past the cap.
const countQ = await sb
  .from("people")
  .select("*", { count: "exact", head: true })
  .is("end_date", null)
  .not("work_email", "is", null);
if (countQ.error) {
  console.error(`FATAL: people count: ${countQ.error.message}`);
  process.exit(2);
}
const activeSalariedCount = countQ.count ?? 0;
if (activeSalariedCount > 900) {
  // Well under the 1000 cap today; warn early so this audit does not
  // become the next silent-truncation defect. If we ever cross this
  // threshold, replace the single select below with a paginated walk.
  console.error(`WARN: active salaried count = ${activeSalariedCount} - approaching PostgREST 1000 cap; convert this audit to paginated walk before it silently truncates`);
}
const peopleQ = await sb
  .from("people")
  .select("worker_id, display_name, work_email, status")
  .is("end_date", null)
  .not("work_email", "is", null)
  .order("work_email");
if (peopleQ.error) {
  console.error(`FATAL: people read: ${peopleQ.error.message}`);
  process.exit(2);
}
const people = peopleQ.data || [];

// 3. Build the resolvable-email set (normalized).
const resolvable = new Set();
for (const p of people) {
  const e = norm(p.work_email);
  if (e) resolvable.add(e);
}

// 4. Cross-check every grant.
const unresolved = [];
const resolvedCount = new Map(); // email -> count of grants
for (const g of grants) {
  const e = norm(g.email);
  resolvedCount.set(e, (resolvedCount.get(e) || 0) + 1);
  if (!resolvable.has(e)) {
    unresolved.push({ email: e, grant_type: g.grant_type, granted_by: g.granted_by, granted_at: g.granted_at });
  }
}

console.log(`academy_grants resolve audit (report only):`);
console.log(`  academy_grants rows:                 ${grants.length}`);
console.log(`  distinct emails granted:             ${resolvedCount.size}`);
console.log(`  active salaried (people.work_email): ${people.length}`);
console.log(`  UNRESOLVED grants (email not in active people): ${unresolved.length}`);
console.log("");

if (unresolved.length > 0) {
  console.log("Unresolved grants:");
  for (const u of unresolved) {
    console.log(`  ${u.email}  ${u.grant_type}  granted_by=${u.granted_by} granted_at=${u.granted_at}`);
  }
} else {
  console.log("All grant emails resolve to an active people.work_email.");
  // Show the resolved set for the audit trail.
  console.log("");
  console.log("Resolved (all rows):");
  for (const [email, count] of [...resolvedCount.entries()].sort()) {
    console.log(`  ${email}  x${count}`);
  }
}

// Report-only. Do not exit non-zero on unresolved grants; the
// operator decides.
