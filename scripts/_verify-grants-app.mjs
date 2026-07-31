// Direct call to find_contact and list_accounts. Sanity confirmation after
// the 2026-07-31 grant revoke.
//
// Rationale: `contacts` and `accounts` are two of the 23 tables the pre-apply
// migration-file enumeration missed. They live in production but were created
// directly in Supabase without a migration file. Exercising them directly
// (rather than only through the aggregated spike harness) is the
// least-hypothetical way to check the revoke landed without incident. Reads
// go through the service_role client, so this cannot prove the revoke was
// safe for anon/authenticated - it only proves the tables still read cleanly
// for the role the app uses.
//
// See docs/audits/GRANT_HYGIENE_2026-07-29.md §8 for the full verification
// scope statement.
//
// Run: node --env-file=.env.local scripts/_verify-grants-app.mjs

import { findContact } from "../src/lib/sousai/tools/data/findContact.js";
import { listAccounts } from "../src/lib/sousai/tools/data/listAccounts.js";

function log(label, r) {
  console.log(`\n== ${label} ==`);
  console.log("  source: ", r.source);
  console.log("  loaded: ", r.loaded);
  if (r.error) console.log("  ERROR:  ", r.error);
  if (r.total != null) console.log("  total:  ", r.total);
  if (r.matches) console.log("  matches:", JSON.stringify(r.matches, null, 2).slice(0, 500));
  if (r.accounts) console.log("  accounts count:", r.accounts.length);
}

log("find_contact('Kelsey')", await findContact({ nameQuery: "Kelsey" }));
log("list_accounts()", await listAccounts({}));
