// _probe_sc_landing_data_health.mjs
// 2026-09-09 - SC landing data-health sweep across every person with
// SC access. Follows the Claire Parry finding: her landing bug was
// not an unmapped role but a free-text field with the wrong KIND of
// value in it (surname typed into a role column). This probe finds
// every equivalent case before training rather than during.
//
// Two findings surfaced per person:
//   1) contacts.role does not map to a known tier
//      -> ROLE_TIERS lookup returns "unknown"
//      -> landing falls to Season overview instead of Period
//         workspace (may or may not be intended for the role)
//   2) people.account_key disagrees with contacts.team_key
//      -> user_accounts_derived reads people.account_key, so
//         auto-select lands them on the people-side account, but
//         contacts thinks they belong to the team_key account -
//         disagreement is the shape that produces "it put me on
//         the wrong site" complaints
//
// Reports only. Groups findings by KIND (unmapped role vs account
// mismatch). Ranks each group by whether the person is a live
// training-week user (TBR / TBJ site leader) or not.
//
// Run:
//   node --env-file=.env.local scripts/probes/_probe_sc_landing_data_health.mjs

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL) { console.error("SUPABASE_URL: ABSENT"); process.exit(2); }
if (!SERVICE_KEY)  { console.error("SUPABASE_SERVICE_ROLE_KEY: ABSENT"); process.exit(2); }
const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

// ROLE_TIERS verbatim from src/app/service-calendar/computeInitialView.js.
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
const KNOWN_ROLE_KEYS = new Set(Object.keys(ROLE_TIERS));

const TRAINING_WEEK_ACCOUNTS = new Set(["TBR - FL", "TBJ - FL"]);

// ─── Load population ───────────────────────────────────────────────
// Every person with SC access = anyone the mount path would resolve.
// Union of:
//   - user_accounts_derived (drives defaultAccount + hasHomeAccount)
//   - contacts (drives roles[]; a person with a contact row and no
//     derived row can still land on the SC, just without an auto-
//     selected account)
console.log(`\n[sc-landing-data-health]  ${new Date().toISOString().slice(0, 10)}\n`);

const [derivedRes, contactsRes, peopleRes] = await Promise.all([
  supa.from("user_accounts_derived").select("email, account"),
  supa.from("contacts").select("email, name, role, team_key"),
  supa.from("people").select("work_email, display_name, account_key, title, status, is_site_leader")
    .eq("status", "ACTIVE"),
]);
if (derivedRes.error)  { console.error(`derived: ${derivedRes.error.message}`); process.exit(2); }
if (contactsRes.error) { console.error(`contacts: ${contactsRes.error.message}`); process.exit(2); }
if (peopleRes.error)   { console.error(`people: ${peopleRes.error.message}`); process.exit(2); }

// Normalize + index.
const byEmail = new Map(); // email lower -> merged record
function upsert(email, patch) {
  const k = email.trim().toLowerCase();
  const cur = byEmail.get(k) || {
    email: k,
    peopleName: null,
    contactNames: new Set(),
    peopleAccountKey: null,
    peopleTitle: null,
    peopleStatus: null,
    isSiteLeader: null,
    derivedAccount: null,
    contactRoles: [],       // [{role, team_key}]
  };
  Object.assign(cur, patch);
  byEmail.set(k, cur);
}

for (const p of peopleRes.data || []) {
  if (!p.work_email) continue;
  upsert(p.work_email, {
    peopleName: p.display_name,
    peopleAccountKey: p.account_key || null,
    peopleTitle: p.title || null,
    peopleStatus: p.status,
    isSiteLeader: !!p.is_site_leader,
  });
}
for (const d of derivedRes.data || []) {
  if (!d.email) continue;
  const cur = byEmail.get(d.email.trim().toLowerCase());
  if (cur) cur.derivedAccount = d.account || null;
  else upsert(d.email, { derivedAccount: d.account || null });
}
for (const c of contactsRes.data || []) {
  if (!c.email) continue;
  const k = c.email.trim().toLowerCase();
  const cur = byEmail.get(k) || null;
  if (cur) {
    cur.contactNames.add(c.name || "");
    cur.contactRoles.push({ role: c.role || null, team_key: c.team_key || null });
  } else {
    const rec = {
      email: k, peopleName: null, contactNames: new Set([c.name || ""]),
      peopleAccountKey: null, peopleTitle: null, peopleStatus: null,
      isSiteLeader: null, derivedAccount: null,
      contactRoles: [{ role: c.role || null, team_key: c.team_key || null }],
    };
    byEmail.set(k, rec);
  }
}

console.log(`  Population loaded:`);
console.log(`    user_accounts_derived rows:  ${derivedRes.data.length}`);
console.log(`    contacts rows (with email):  ${contactsRes.data.filter(c => c.email).length}`);
console.log(`    people rows (ACTIVE):        ${peopleRes.data.filter(p => p.work_email).length}`);
console.log(`    merged unique emails:        ${byEmail.size}\n`);

// ─── Finding 1: contacts.role that does not map to a known tier ───
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`FINDING 1 - contacts.role does NOT map to a known tier`);
console.log(`  Consequence: falls to Season overview instead of the`);
console.log(`  Period workspace (may or may not be intended).`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

const unmapped = [];
for (const [email, r] of byEmail.entries()) {
  for (const cr of r.contactRoles) {
    if (!cr.role) continue; // no role set is a separate class
    const key = String(cr.role).trim().toLowerCase();
    if (!KNOWN_ROLE_KEYS.has(key)) {
      unmapped.push({ email, r, cr });
    }
  }
}

// Rank: training-week users first.
unmapped.sort((a, b) => {
  const aTw = TRAINING_WEEK_ACCOUNTS.has(a.r.peopleAccountKey) || TRAINING_WEEK_ACCOUNTS.has(a.cr.team_key);
  const bTw = TRAINING_WEEK_ACCOUNTS.has(b.r.peopleAccountKey) || TRAINING_WEEK_ACCOUNTS.has(b.cr.team_key);
  if (aTw !== bTw) return aTw ? -1 : 1;
  return a.email.localeCompare(b.email);
});

if (unmapped.length === 0) {
  console.log(`  (none)\n`);
} else {
  for (const { email, r, cr } of unmapped) {
    const tw = TRAINING_WEEK_ACCOUNTS.has(r.peopleAccountKey) || TRAINING_WEEK_ACCOUNTS.has(cr.team_key);
    console.log(`  ${tw ? "[TRAINING WK]" : "[background] "} ${email}`);
    console.log(`    display_name (people):    ${r.peopleName || "(no ACTIVE people row)"}`);
    console.log(`    contacts.name:            ${[...r.contactNames].filter(Boolean).join(" / ") || "(none)"}`);
    console.log(`    contacts.role value:      "${cr.role}"   ← does not map`);
    console.log(`    contacts.team_key:        ${cr.team_key || "(none)"}`);
    console.log(`    people.title:             ${r.peopleTitle || "(none)"}`);
    console.log(`    people.account_key:       ${r.peopleAccountKey || "(none)"}`);
    console.log(``);
  }
}

// ─── Finding 2: people.account_key disagrees with contacts.team_key ───
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`FINDING 2 - people.account_key ≠ contacts.team_key`);
console.log(`  Consequence: user_accounts_derived reads`);
console.log(`  people.account_key; auto-select lands them on the`);
console.log(`  people-side account. If they were expecting the`);
console.log(`  contacts-side account they will report "wrong site."`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

const mismatches = [];
for (const [email, r] of byEmail.entries()) {
  if (!r.peopleAccountKey) continue; // no people row means no mismatch to detect
  for (const cr of r.contactRoles) {
    if (!cr.team_key) continue;
    if (cr.team_key !== r.peopleAccountKey) {
      mismatches.push({ email, r, cr });
    }
  }
}

// Dedupe: a person with multiple contacts.role rows all pointing at
// the same wrong team_key produces N mismatch entries. Collapse per
// (email, contacts.team_key) pair.
const mismatchSeen = new Set();
const mismatchesDedup = [];
for (const m of mismatches) {
  const k = `${m.email}|${m.cr.team_key}`;
  if (mismatchSeen.has(k)) continue;
  mismatchSeen.add(k);
  mismatchesDedup.push(m);
}

// Rank: training-week users first.
mismatchesDedup.sort((a, b) => {
  const aTw = TRAINING_WEEK_ACCOUNTS.has(a.r.peopleAccountKey) || TRAINING_WEEK_ACCOUNTS.has(a.cr.team_key);
  const bTw = TRAINING_WEEK_ACCOUNTS.has(b.r.peopleAccountKey) || TRAINING_WEEK_ACCOUNTS.has(b.cr.team_key);
  if (aTw !== bTw) return aTw ? -1 : 1;
  return a.email.localeCompare(b.email);
});

if (mismatchesDedup.length === 0) {
  console.log(`  (none)\n`);
} else {
  for (const { email, r, cr } of mismatchesDedup) {
    const tw = TRAINING_WEEK_ACCOUNTS.has(r.peopleAccountKey) || TRAINING_WEEK_ACCOUNTS.has(cr.team_key);
    console.log(`  ${tw ? "[TRAINING WK]" : "[background] "} ${email}`);
    console.log(`    display_name:             ${r.peopleName || "(no ACTIVE people row)"}`);
    console.log(`    people.account_key:       ${r.peopleAccountKey}   ← auto-select uses this`);
    console.log(`    contacts.team_key:        ${cr.team_key}   ← disagrees`);
    console.log(`    contacts.role:            "${cr.role || "(none)"}"`);
    console.log(`    people.title:             ${r.peopleTitle || "(none)"}`);
    console.log(``);
  }
}

// ─── Summary counts ─────────────────────────────────────────────
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`SUMMARY`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`  Finding 1 (unmapped contacts.role):`);
const twUnmapped = unmapped.filter(u => TRAINING_WEEK_ACCOUNTS.has(u.r.peopleAccountKey) || TRAINING_WEEK_ACCOUNTS.has(u.cr.team_key));
console.log(`    training-week users:  ${twUnmapped.length}`);
console.log(`    background users:     ${unmapped.length - twUnmapped.length}`);
console.log(`    TOTAL:                ${unmapped.length}\n`);
console.log(`  Finding 2 (people.account_key ≠ contacts.team_key):`);
const twMismatch = mismatchesDedup.filter(m => TRAINING_WEEK_ACCOUNTS.has(m.r.peopleAccountKey) || TRAINING_WEEK_ACCOUNTS.has(m.cr.team_key));
console.log(`    training-week users:  ${twMismatch.length}`);
console.log(`    background users:     ${mismatchesDedup.length - twMismatch.length}`);
console.log(`    TOTAL:                ${mismatchesDedup.length}\n`);

process.exit(0);
