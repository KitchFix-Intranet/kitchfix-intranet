#!/usr/bin/env node
/*
 * R16 P3: enumerate category names in billcom_ref_accounts + evaluate
 * what a greedier prefix strip would do.
 *
 * "STL Reimbursables" leaks on the STL - MO card because the current
 * strip rule matches exact "STL - MO " and the name is "STL Reimbursables"
 * (missing the "- MO " part).
 *
 * Report every category name in billcom_ref_accounts under the three
 * candidate rules:
 *   R0 (current): strip "<accountKey> "  (exact match, trailing space)
 *   R1: also strip first token of accountKey + " "  (STL, CIN, TXR, TBR, TBJ)
 *   R2: strip anything that starts with a known team prefix + word boundary
 *
 * For each candidate rule, list which names change and what they become.
 */
import { createClient } from "@supabase/supabase-js";
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
console.log(`env: ${SB_URL ? "PRESENT" : "ABSENT"} / ${SB_KEY ? "PRESENT" : "ABSENT"}`);
if (!SB_URL || !SB_KEY) process.exit(2);
const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

// Load every account row from billcom_ref_accounts (chart of accounts).
const rows = [];
let from = 0;
while (true) {
  const r = await supa.from("billcom_ref_accounts")
    .select("id, account_number, name, is_active")
    .order("account_number", { ascending: true })
    .range(from, from + 999);
  if (r.error) { console.error("read failed:", r.error.message); process.exit(3); }
  if (!r.data?.length) break;
  rows.push(...r.data);
  if (r.data.length < 1000) break;
  from += 1000;
}
console.log(`billcom_ref_accounts rows: ${rows.length}`);

// Load team_keys from `accounts` table (so we know exhaustive account_key list)
const accts = await supa.from("accounts").select("team_key").neq("team_key", "CORP").order("team_key");
if (accts.error) { console.error("accounts read failed:", accts.error.message); process.exit(3); }
const ACCT_KEYS = accts.data.map(r => r.team_key);
console.log(`account_keys (non-CORP): ${ACCT_KEYS.join(", ")}`);

// First-token set (e.g. STL, CIN, TXR, TBR, TBJ)
const TOKENS = [...new Set(ACCT_KEYS.map(k => k.split(/\s+/)[0]))];
console.log(`first-token set: ${TOKENS.join(", ")}`);

// Current rule (R0): strip "<accountKey> " exact
function stripR0(name, acctKey) {
  const pfx = `${acctKey} `;
  return name.startsWith(pfx) ? name.slice(pfx.length) : name;
}
// R1: also strip "<firstToken> " when accountKey starts with firstToken
function stripR1(name, acctKey) {
  const first = acctKey.split(/\s+/)[0];
  const pfxA = `${acctKey} `;
  const pfxB = `${first} `;
  if (name.startsWith(pfxA)) return name.slice(pfxA.length);
  if (name.startsWith(pfxB)) return name.slice(pfxB.length);
  return name;
}
// R2: strip anything that starts with any known team-first-token + space
// (regardless of which account is viewing).  This is the "greedier" case.
function stripR2(name, acctKey) {
  const first = acctKey.split(/\s+/)[0];
  const pfxA = `${acctKey} `;
  if (name.startsWith(pfxA)) return name.slice(pfxA.length);
  // strip any known token when it matches viewing account's first
  if (name.startsWith(`${first} `)) return name.slice(first.length + 1);
  return name;
}

// For each account_key and each rule, tabulate changes.
console.log(`\n══ Names that would change ══`);
for (const acctKey of ACCT_KEYS) {
  const changes = [];
  for (const row of rows) {
    const name = row.name || "";
    const r0 = stripR0(name, acctKey);
    const r1 = stripR1(name, acctKey);
    if (r1 !== r0) changes.push({ orig: name, r0, r1, acct: row.account_number });
  }
  if (changes.length === 0) continue;
  console.log(`\n  viewing ${acctKey}: ${changes.length} names change under R1 that don't under R0`);
  for (const c of changes.slice(0, 20)) {
    console.log(`    "${c.orig}"  →  R0 keeps: "${c.r0}"  →  R1 strips to: "${c.r1}"`);
  }
  if (changes.length > 20) console.log(`    ...and ${changes.length - 20} more`);
}

// Cross-check: on the STL - MO card, what does "STL Reimbursables" become?
console.log(`\n══ The specific STL Reimbursables case ══`);
const targets = rows.filter(r => (r.name || "").startsWith("STL "));
console.log(`  billcom_ref_accounts rows starting with "STL ": ${targets.length}`);
for (const t of targets.slice(0, 15)) {
  const r0 = stripR0(t.name, "STL - MO");
  const r1 = stripR1(t.name, "STL - MO");
  console.log(`    #${t.account_number}  "${t.name}"  →  R0: "${r0}"  →  R1: "${r1}"`);
}
if (targets.length > 15) console.log(`  ...and ${targets.length - 15} more`);
