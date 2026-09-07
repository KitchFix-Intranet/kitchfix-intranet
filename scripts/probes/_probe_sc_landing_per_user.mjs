// _probe_sc_landing_per_user.mjs
// 2026-09-09 - SC training-week landing report per named user.
//
// Traces the mount-landing shape for a named user through the two
// signals sc-accounts returns and computeInitialView consumes:
//
//   1) defaultAccount from user_accounts_derived (ACTIVE people rows
//      + user_accounts_manual overlay). Drives hasHomeAccount.
//   2) roles[] from contacts.role. Multiple rows per email possible.
//      Client resolves tier via tierFromRoles (floor-wins tiebreaker).
//
// computeInitialView precedence (recap from
// src/app/service-calendar/computeInitialView.js):
//   1) urlView === "admin" + isAdmin      -> admin surface
//   2) urlPeriod matches /^P\d+$/         -> period deep-link
//   3) tier === "floor" + hasHomeAccount  -> Period workspace, auto-
//                                            selects the home account
//   4) leadership / unknown / floor-w/o-  -> Season overview.
//      home                                  ServiceCalendar.js:743's
//                                            account-fallback chain
//                                            (URL account -> derived
//                                            defaultAccount -> CIN-AZ)
//                                            still auto-selects a
//                                            SC account for them.
//
// Run:
//   node --env-file=.env.local scripts/probes/_probe_sc_landing_per_user.mjs

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL) { console.error("SUPABASE_URL: ABSENT"); process.exit(2); }
if (!SERVICE_KEY)  { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(2); }
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const NAMES = [
  "Joe Coppolino",
  "Desiree Colone",
  "Steve Groves",
  "Diego Diaz",
  "Claire Parry",
  "Marjorie Richards",
  "Shane Lynch",
];

// Role -> tier map (verbatim from src/app/service-calendar/computeInitialView.js).
const ROLE_TIERS = {
  "executive chef":         "floor",
  "sous chef":              "floor",
  "chef de cuisine":        "floor",
  "hospitality manager":    "floor",
  "general manager":        "floor",
  "ceo":                              "leadership",
  "vp operations":                    "leadership",
  "vp of operations":                 "leadership",
  "director of operations":           "leadership",
  "director of culinary":             "leadership",
  "human resources":                  "leadership",
  "staff accountant":                 "leadership",
  "regional director east":           "leadership",
  "regional director west":           "leadership",
  "regional director":                "leadership",
  "corporate field chef":             "leadership",
};
function roleTier(role) {
  if (!role) return "unknown";
  return ROLE_TIERS[String(role).trim().toLowerCase()] || "unknown";
}
function tierFromRoles(roles) {
  if (!Array.isArray(roles) || roles.length === 0) return "unknown";
  const tiers = roles.map(roleTier);
  if (tiers.includes("floor")) return "floor";
  if (tiers.includes("leadership")) return "leadership";
  return "unknown";
}

// Load the SC account list (active accounts only, matches sc-accounts).
const acctRes = await supa
  .from("accounts")
  .select("team_key")
  .eq("active", true);
if (acctRes.error) { console.error(`accounts read: ${acctRes.error.message}`); process.exit(2); }
const activeAccountKeys = new Set(acctRes.data.map((r) => r.team_key));

// Real schemas (verified):
//   people:   display_name, work_email, account_key, title, status, ...
//   contacts: name, email, role, team_key, ...
//   user_accounts_derived: email, account
async function findEmailsForName(fullName) {
  const wild = `%${fullName}%`;
  const p = await supa.from("people")
    .select("display_name, work_email, account_key, title, status, is_site_leader")
    .ilike("display_name", wild);
  const c = await supa.from("contacts")
    .select("name, email, role, team_key")
    .ilike("name", wild);
  const peopleHits = (p.data || []).filter((r) => !!r.work_email);
  const contactHits = (c.data || []).filter((r) => !!r.email);
  const emails = new Set();
  for (const r of peopleHits) emails.add(r.work_email.toLowerCase());
  for (const r of contactHits) emails.add(r.email.toLowerCase());
  return { peopleHits, contactHits, emails: [...emails] };
}

async function traceLanding(email) {
  const [derivedRes, contactRolesRes] = await Promise.all([
    supa.from("user_accounts_derived").select("account").ilike("email", email).limit(1),
    supa.from("contacts").select("role, team_key").ilike("email", email),
  ]);
  const defaultAccount = derivedRes.data?.[0]?.account || null;
  const roles = (contactRolesRes.data || [])
    .map((r) => r.role)
    .filter((r) => r != null && String(r).trim() !== "");
  const contactAccounts = (contactRolesRes.data || [])
    .map((r) => r.team_key)
    .filter((a) => a != null && String(a).trim() !== "");
  const tier = tierFromRoles(roles);
  const hasHomeAccount = !!(defaultAccount && activeAccountKeys.has(defaultAccount));

  // Landing verdict per ServiceCalendar.js mount + computeInitialView.
  // Two orthogonal questions:
  //   Q1 - which SC account is auto-selected on mount?
  //   Q2 - which scope/lens is the operator dropped into?
  let selectedAccount, viewLanding;

  // Q1: ServiceCalendar.js:742-748 account-fallback chain:
  //   URL account (none here for a fresh mount)
  //   -> defaultAccount from user_accounts_derived (if in the SC list)
  //   -> "CIN - AZ" (unmapped-operator default)
  //   -> sorted[0].key (first account in the list)
  if (defaultAccount && activeAccountKeys.has(defaultAccount)) {
    selectedAccount = `${defaultAccount} (auto - user_accounts_derived match)`;
  } else if (activeAccountKeys.has("CIN - AZ")) {
    selectedAccount = `CIN - AZ (fallback - no derived match)`;
  } else {
    selectedAccount = `<first account in the sorted list>`;
  }

  // Q2: computeInitialView tier landing.
  if (tier === "floor" && hasHomeAccount) {
    viewLanding = `Period workspace @ current period on the auto-selected account`;
  } else {
    viewLanding = `Season overview (Period lens per PR #1068 + #1050) on the auto-selected account`;
  }

  return {
    defaultAccount, roles, contactAccounts, tier, hasHomeAccount,
    selectedAccount, viewLanding,
  };
}

console.log(`\n[sc-landing-per-user]  training-week landing trace  ${new Date().toISOString().slice(0, 10)}\n`);
console.log(`  Active SC account keys the dropdown carries:`);
console.log(`    ${[...activeAccountKeys].sort().join(", ")}\n`);

for (const name of NAMES) {
  console.log(`─── ${name} ──────────────────────────────────────────`);
  const found = await findEmailsForName(name);
  if (found.emails.length === 0) {
    console.log(`  NOT FOUND by name search on people.display_name or contacts.name.\n`);
    continue;
  }
  if (found.peopleHits.length > 0) {
    for (const p of found.peopleHits) {
      console.log(`  people row:    display_name="${p.display_name}"  work_email=${p.work_email}  account_key=${p.account_key || "(none)"}  title="${p.title || ""}"  status=${p.status}  is_site_leader=${p.is_site_leader}`);
    }
  }
  if (found.contactHits.length > 0) {
    for (const c of found.contactHits) {
      console.log(`  contacts row:  name="${c.name}"  email=${c.email}  role="${c.role || ""}"  team_key=${c.team_key || "(none)"}`);
    }
  }
  for (const email of found.emails) {
    const trace = await traceLanding(email);
    console.log(``);
    console.log(`  ${email}`);
    console.log(`    user_accounts_derived → defaultAccount:  ${trace.defaultAccount || "(none)"}`);
    console.log(`    hasHomeAccount (defaultAccount live?):   ${trace.hasHomeAccount}`);
    console.log(`    contacts.role (all rows):                ${trace.roles.length ? trace.roles.join(" | ") : "(none)"}`);
    console.log(`    contacts.team_key (all rows):            ${trace.contactAccounts.length ? [...new Set(trace.contactAccounts)].join(" | ") : "(none)"}`);
    console.log(`    resolved tier (floor-wins):              ${trace.tier}`);
    console.log(``);
    console.log(`    ▸ ACCOUNT AUTO-SELECT:  ${trace.selectedAccount}`);
    console.log(`    ▸ VIEW LANDING:         ${trace.viewLanding}`);
  }
  console.log(``);
}

process.exit(0);
