// src/lib/academy/resolveIdentity.js
//
// The ONE authority for Academy identity + scope. Every Academy
// screen resolves through this function. See
// `docs/opd/ACADEMY_MASTER_SPEC.md` Sections 2.4, 3.1, 3.2, 3.3, 3.4
// for the design contract.
//
// Sources it reads (spec Section 3.2, allowed set):
//   - people                         (roster, work_email, is_site_leader, ...)
//   - accounts                       (team_key -> region)
//   - academy_person_stints          (worker_id -> person_id)
//   - academy_eligibility_exceptions (include/exclude override)
//   - academy_grants                 (library_admin / academy_admin)
//   - academy_region_leads           (region -> RDO email)
//
// Sources it MUST NOT read (spec Section 3.2, forbidden set):
//   - contacts.role                  (free-text titles; drift-prone)
//   - src/lib/admin.js allowlists    (ops-team gates, not academy)
//   - user_accounts_derived          (single-account projection)
//   - user_accounts_manual           (SC overlay)
//
// If a future change appears to need one of the forbidden sources,
// stop and open a ruling. Silently adding one voids spec 3.2's whole
// point (a coherent role model composed only from clean tables).
//
// Return shape (AcademyIdentity | null)
// ─────────────────────────────────────
//   {
//     workerId,       // the Rippling stint id, from people.worker_id
//     personId,       // stable across stints, from academy_person_stints
//     displayName,
//     eligible,       // false only if exception row says so
//     isSalaried,     // pinned to people.is_salaried (overtime_exemption)
//     accountKey,     // people.account_key
//     region,         // accounts.region for this account
//     isSiteLeader,   // people.is_site_leader (owner-maintained, one/account)
//     isCorp,         // people.is_corp
//     grants: [],     // 'library_admin' | 'academy_admin'
//     scope: {
//       kind: 'company' | 'region' | 'site' | 'self',
//       region: null,     // set for kind='region'
//       accounts: [],     // account_keys this person may view
//     },
//   }
//
// Scope precedence (spec Section 3.4, strict order, first match wins):
//   1. holds 'academy_admin'        -> company (all active accounts)
//   2. email in academy_region_leads -> region (accounts in that region)
//   3. is_site_leader                -> site (own account_key)
//   4. otherwise                     -> self (empty)
//
// Being corporate (is_corp = TRUE) is deliberately NOT a visibility
// grant. It is an audience-targeting fact (who gets assigned
// corporate modules). Sebastian Castro is corporate and has no
// business seeing everyone's training status. Visibility is granted,
// never inherited from an account key. See PR 4 report for the
// open ruling on whether company-wide standing visibility deserves
// its own third grant type.
//
// Seasonal-rehire discipline (spec Section 2.4)
// ─────────────────────────────────────────────
// The join to `people` REQUIRES `status = 'ACTIVE'`. 142 of the
// 887 humans in the roster hold multiple worker_id rows because
// seasonal staff are rehired under a new stint each season while
// keeping the same work_email. Omitting the filter returns multiple
// rows for one login. If the filter is present and MORE THAN ONE
// active row still matches, that is a defect (unique-index breach
// or leaked non-active row), NOT a fallback: this resolver logs it
// loudly and returns null rather than silently picking the first.
// Same discipline as `src/lib/kpi/roleGate.js:157-198`.
//
// PII posture
// ───────────
// This module never selects `personal_email` or `natural_key` and
// never returns either. The hourly-portal identity path (which uses
// personal_email inside a server-only send function per spec 2.5)
// is a separate module in a later PR and does not share this
// resolver's return shape.
//
// Cache posture
// ─────────────
// No process-lifetime cache. This resolver runs per request. If a
// hot path needs caching later, wrap this function; do not thread
// caching inside it - the fewer surfaces of truth, the fewer
// staleness bugs.

import { getServiceClient } from "@/lib/supabase";

// ═══════════════════════════════════════════════════════════════
// ACADEMY PREVIEW FENCE - 2026-08-31.
// v1 is a Kevin-only pilot (spec Section 15). The resolver logic
// is complete and correct for everyone; the fence gates the SURFACES
// (routes, UI), not the resolution. That way widening to one site,
// then to all 30 salaried, then to hourly is a one-line constant
// edit and never a rewrite. Follows the exact pattern established
// by `src/lib/kpi/roleGate.js:69-70` (KPI_PREVIEW_ONLY).
//
// A hardcoded constant, not an env var, on purpose: it is greppable,
// diff-visible in review, and cannot drift between environments.
// ═══════════════════════════════════════════════════════════════
export const ACADEMY_PREVIEW_ONLY = true;
export const ACADEMY_PREVIEW_ALLOWLIST = ["k.fietek@kitchfix.com"];

function normEmail(e) {
  return String(e || "").trim().toLowerCase();
}

/**
 * Resolve the signed-in email to an Academy identity.
 *
 * @param {string} sessionEmail  the address from session.user.email
 * @param {{ supa?: object }} [opts]  optional injected supabase client
 * @returns {Promise<object|null>}    AcademyIdentity or null (see file header)
 */
export async function resolveAcademyIdentity(sessionEmail, { supa } = {}) {
  const email = normEmail(sessionEmail);
  if (!email) return null;
  const db = supa || getServiceClient();

  // Step 1. Roster resolution. status='ACTIVE' is LOAD-BEARING - see
  // the seasonal-rehire discipline note in the file header.
  const peopleQ = await db
    .from("people")
    .select(
      "worker_id, display_name, account_key, is_corp, is_salaried, is_site_leader, status"
    )
    .eq("status", "ACTIVE")
    .ilike("work_email", email);
  if (peopleQ.error) {
    console.error("[academy/resolveIdentity] people lookup:", peopleQ.error.message);
    return null;
  }
  const rows = peopleQ.data || [];
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    // Defect, not a fallback. Log with the email and the worker_ids
    // so the drift is visible and traceable, then decline.
    const workerIds = rows.map((r) => r.worker_id).join(",");
    console.error(
      `[academy/resolveIdentity] duplicate active people rows for one email: email=${email} worker_ids=${workerIds}`
    );
    return null;
  }
  const p = rows[0];
  const workerId = p.worker_id;
  const accountKey = p.account_key;

  // Steps 2-6 fan out in parallel. Every one of these queries is
  // small (single-key point read or a short list) and none depend on
  // one another's results. Doing them serially would be five
  // needless round-trips.
  const [
    stintQ,
    excQ,
    grantsQ,
    regionLeadQ,
    accountRegionQ,
  ] = await Promise.all([
    db
      .from("academy_person_stints")
      .select("person_id")
      .eq("worker_id", workerId)
      .maybeSingle(),
    db
      .from("academy_eligibility_exceptions")
      .select("eligible")
      .eq("worker_id", workerId)
      .maybeSingle(),
    db
      .from("academy_grants")
      .select("grant_type")
      .eq("email", email),
    db
      .from("academy_region_leads")
      .select("region")
      .eq("email", email),
    accountKey
      ? db.from("accounts").select("region").eq("team_key", accountKey).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  // person_id: absence is expected drift until the derive extension
  // ships (see academy-1 P2 probe comment). Not fatal - return null
  // for personId and log.
  let personId = null;
  if (stintQ.error) {
    console.error("[academy/resolveIdentity] stint lookup:", stintQ.error.message);
  } else if (stintQ.data) {
    personId = stintQ.data.person_id;
  } else {
    console.warn(
      `[academy/resolveIdentity] no academy_person_stints row for worker_id=${workerId} (derive drift; expected once new hires arrive before derive extension ships)`
    );
  }

  // eligible: absence means eligible. An exception row's value wins
  // whether it is true or false.
  let eligible = true;
  if (excQ.error) {
    console.error("[academy/resolveIdentity] exception lookup:", excQ.error.message);
  } else if (excQ.data) {
    eligible = !!excQ.data.eligible;
  }

  // grants: zero or more rows. Deduplicate defensively.
  const grants = [];
  if (grantsQ.error) {
    console.error("[academy/resolveIdentity] grants lookup:", grantsQ.error.message);
  } else {
    const seen = new Set();
    for (const g of grantsQ.data || []) {
      if (!seen.has(g.grant_type)) {
        seen.add(g.grant_type);
        grants.push(g.grant_type);
      }
    }
  }

  // region: from accounts.region for this account_key. Independent
  // of scope resolution below - the identity's own region is a fact
  // regardless of whether they hold visibility scope.
  let region = null;
  if (accountRegionQ.error) {
    console.error("[academy/resolveIdentity] account region:", accountRegionQ.error.message);
  } else if (accountRegionQ.data) {
    region = accountRegionQ.data.region || null;
  }

  // Region-lead lookup: the resolver only needs to know that THIS
  // email leads SOME region for scope precedence. The specific region
  // string (which may differ from `region` above if a CORP-resident
  // RDO leads East/West) drives scope.region below.
  let leadsRegion = null;
  if (regionLeadQ.error) {
    console.error("[academy/resolveIdentity] region lead lookup:", regionLeadQ.error.message);
  } else if ((regionLeadQ.data || []).length > 0) {
    leadsRegion = regionLeadQ.data[0].region;
  }

  // Scope (spec Section 3.4, strict precedence, first match wins).
  const scope = { kind: "self", region: null, accounts: [] };

  if (grants.includes("academy_admin")) {
    // Company scope: all active accounts.
    const accountsQ = await db
      .from("accounts")
      .select("team_key, active")
      .neq("active", false); // NULL treated as active, matches SC pattern
    if (accountsQ.error) {
      console.error("[academy/resolveIdentity] all-accounts:", accountsQ.error.message);
    } else {
      scope.kind = "company";
      scope.region = null;
      scope.accounts = (accountsQ.data || [])
        .map((a) => a.team_key)
        .filter(Boolean);
    }
  } else if (leadsRegion) {
    const accountsQ = await db
      .from("accounts")
      .select("team_key, active")
      .eq("region", leadsRegion)
      .neq("active", false);
    if (accountsQ.error) {
      console.error("[academy/resolveIdentity] region-accounts:", accountsQ.error.message);
    } else {
      scope.kind = "region";
      scope.region = leadsRegion;
      scope.accounts = (accountsQ.data || [])
        .map((a) => a.team_key)
        .filter(Boolean);
    }
  } else if (p.is_site_leader && accountKey) {
    scope.kind = "site";
    scope.region = null;
    scope.accounts = [accountKey];
  } else {
    scope.kind = "self";
    scope.region = null;
    scope.accounts = [];
  }

  return {
    workerId,
    personId,
    displayName: p.display_name || null,
    eligible,
    isSalaried: !!p.is_salaried,
    accountKey: accountKey || null,
    region,
    isSiteLeader: !!p.is_site_leader,
    isCorp: !!p.is_corp,
    grants,
    scope,
  };
}

/**
 * Standing card visibility (spec Section 3.3, the "scope-not-title"
 * rule). Returns true only when at least one eligible person OTHER
 * than the viewer sits inside scope.accounts.
 *
 * Eligible means: people row with end_date IS NULL, in scope.accounts,
 * excluding the viewer's worker_id, excluding any worker with an
 * eligible=false exception row.
 *
 * Five of eleven site leaders are the only eligible salaried person
 * at their site (Atherton, Bailey, Gilman, Forkner, Rogers); two of
 * those sites also have zero hourly staff. A title-based rule would
 * render them a team card containing exactly one person, themselves.
 * This function returns false for those cases.
 *
 * @param {object|null} identity  return of resolveAcademyIdentity
 * @param {{ supa?: object }} [opts]
 * @returns {Promise<boolean>}
 */
export async function canSeeStandingCard(identity, { supa } = {}) {
  if (!identity) return false;
  const { scope, workerId } = identity;
  if (!scope || !Array.isArray(scope.accounts) || scope.accounts.length === 0) {
    return false;
  }
  const db = supa || getServiceClient();

  // LEFT JOIN excluded via NOT EXISTS: keep the query legible and
  // let Postgres pick the plan. The exception table is tiny (1 row
  // today) so cost is trivial.
  const query = db
    .from("people")
    .select("worker_id, end_date, account_key", { count: "exact", head: true })
    .is("end_date", null)
    .in("account_key", scope.accounts)
    .neq("worker_id", workerId);
  const totalQ = await query;
  if (totalQ.error) {
    console.error("[academy/canSeeStandingCard] eligible count:", totalQ.error.message);
    return false;
  }
  const total = totalQ.count || 0;
  if (total === 0) return false;

  // Subtract explicit exclusions. Load the exception list once and
  // filter in JS - the table is tiny and this keeps the SQL simple.
  const excQ = await db
    .from("academy_eligibility_exceptions")
    .select("worker_id")
    .eq("eligible", false);
  if (excQ.error) {
    console.error("[academy/canSeeStandingCard] exception scan:", excQ.error.message);
    // Fail closed on the count math: if we cannot subtract exclusions,
    // do not lie by returning the raw total.
    return false;
  }
  const excluded = new Set((excQ.data || []).map((r) => r.worker_id));
  if (excluded.size === 0) return total > 0;

  // Re-check with exclusions applied. Cheapest correct path: one
  // more scoped query that ALSO filters by not-in the exception list.
  const excludedIds = [...excluded];
  const refinedQ = await db
    .from("people")
    .select("worker_id", { count: "exact", head: true })
    .is("end_date", null)
    .in("account_key", scope.accounts)
    .neq("worker_id", workerId)
    .not("worker_id", "in", `(${excludedIds.map((id) => `"${id}"`).join(",")})`);
  if (refinedQ.error) {
    console.error("[academy/canSeeStandingCard] refined count:", refinedQ.error.message);
    return false;
  }
  return (refinedQ.count || 0) > 0;
}

/**
 * Count of eligible people in scope, excluding the viewer.
 * Same math as canSeeStandingCard; returned as a number for the
 * whoami debug route so Kevin can see the denominator.
 *
 * @param {object|null} identity
 * @param {{ supa?: object }} [opts]
 * @returns {Promise<number>}
 */
export async function eligibleCountInScope(identity, { supa } = {}) {
  if (!identity) return 0;
  const { scope, workerId } = identity;
  if (!scope || !Array.isArray(scope.accounts) || scope.accounts.length === 0) return 0;
  const db = supa || getServiceClient();

  const excQ = await db
    .from("academy_eligibility_exceptions")
    .select("worker_id")
    .eq("eligible", false);
  if (excQ.error) {
    console.error("[academy/eligibleCountInScope] exception scan:", excQ.error.message);
    return 0;
  }
  const excludedIds = (excQ.data || []).map((r) => r.worker_id);

  let q = db
    .from("people")
    .select("worker_id", { count: "exact", head: true })
    .is("end_date", null)
    .in("account_key", scope.accounts)
    .neq("worker_id", workerId);
  if (excludedIds.length > 0) {
    q = q.not("worker_id", "in", `(${excludedIds.map((id) => `"${id}"`).join(",")})`);
  }
  const r = await q;
  if (r.error) {
    console.error("[academy/eligibleCountInScope] count:", r.error.message);
    return 0;
  }
  return r.count || 0;
}
