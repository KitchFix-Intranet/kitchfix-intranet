// src/lib/labor/salaryGate.js
//
// Salary PR 2 · commit 1. The ONLY authority for deciding whether a
// caller can see salary. The route reads the gate once per request
// (via loadSalaryGate) and every downstream figure - budget, actuals,
// aggregates, per-row `salaried` flags, the `salary_available` field
// PR 3 reads to render the toggle - flows through the returned
// closure. Nothing else re-decides.
//
// Spec R-1 / R-2 / R-3 / R-4.
//
// Contract:
//   corporate  scope=NULL             -> true for every account +
//                                        pseudo (ALL / EAST / WEST)
//   rdo        scope='East'|'West'    -> true for the matching pseudo
//                                        and any team_key whose
//                                        accounts.region equals the
//                                        scope; false for ALL and
//                                        for accounts in the other
//                                        region
//   site       scope=<account_key>    -> false, always, even for
//                                        their own account (spec R-2)
//   not in kpi_roles                  -> false (default deny)
//
// Caching posture: this module caches nothing at module scope. Each
// request calls loadSalaryGate(supa) which does two small SELECTs
// (kpi_roles, accounts). A role change or a region-move takes effect
// on the next request without a redeploy - spec R-2.
//
// PII posture: role emails travel through the closure but are never
// logged. Errors surface as `error: "server_error", scope` on the
// caller side; the shape matches the labor route's safeError helper.

const PSEUDO_KEYS = new Set(["ALL", "EAST", "WEST"]);

// Pseudo -> canonical region name mapping. The route ships
// `?account=EAST` on the wire; accounts.region is 'East'. Kept here
// so callers do not have to know the case rule.
const PSEUDO_TO_REGION = new Map([
  ["EAST", "East"],
  ["WEST", "West"],
]);

/**
 * Load the salary gate for one request.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supa
 * @returns {Promise<{
 *   canSeeSalary: (email: string, requestedAccountKey: string) => boolean,
 *   salaryAvailable: (email: string, requestedAccountKey: string) => boolean,
 *   error?: string,
 * }>}
 */
export async function loadSalaryGate(supa) {
  const [rolesQ, accountsQ] = await Promise.all([
    supa.from("kpi_roles").select("email, role, scope"),
    supa.from("accounts").select("team_key, region"),
  ]);
  if (rolesQ.error)    return { error: `kpi_roles: ${rolesQ.error.message}`,   canSeeSalary: () => false, salaryAvailable: () => false };
  if (accountsQ.error) return { error: `accounts: ${accountsQ.error.message}`, canSeeSalary: () => false, salaryAvailable: () => false };

  // Normalize on load. Emails go through lowercase+trim consistently
  // with user_accounts seeding.
  const rolesByEmail = new Map();
  for (const r of rolesQ.data || []) {
    const email = String(r.email || "").toLowerCase().trim();
    if (!email) continue;
    rolesByEmail.set(email, { role: r.role, scope: r.scope || null });
  }
  // account_key -> region ('East' | 'West' | null)
  const regionByAccount = new Map();
  for (const a of accountsQ.data || []) {
    regionByAccount.set(String(a.team_key), a.region || null);
  }

  function canSeeSalary(email, requestedAccountKey) {
    if (!email || !requestedAccountKey) return false;
    const key = String(email).toLowerCase().trim();
    const r = rolesByEmail.get(key);
    if (!r) return false;                            // not in kpi_roles - default deny
    if (r.role === "corporate") return true;         // corp scope=null -> unrestricted
    if (r.role === "rdo") {
      const scopeRegion = r.scope;                   // 'East' | 'West'
      if (!scopeRegion) return false;
      // pseudo path: EAST/WEST resolves to a region name, must equal scope
      if (PSEUDO_KEYS.has(requestedAccountKey)) {
        if (requestedAccountKey === "ALL") return false;   // rdo does not cover ALL
        const askedRegion = PSEUDO_TO_REGION.get(requestedAccountKey);
        return askedRegion === scopeRegion;
      }
      // team_key path: account must be in the rdo's scope region
      const acctRegion = regionByAccount.get(requestedAccountKey);
      return acctRegion === scopeRegion;
    }
    // site role: never sees salary, including for their own account.
    // spec R-2 is explicit; site leaders must never see it at site
    // grain (playbook 8.2 subtraction attack).
    return false;
  }

  // Same predicate under a different name so PR 3 can only render the
  // toggle for callers the route would grant. Two names for one truth.
  const salaryAvailable = canSeeSalary;

  return { canSeeSalary, salaryAvailable };
}
