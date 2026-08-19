// src/lib/kpi/roleGate.js
//
// The ONE authority for KPI role gating. See
// docs/KPI_ROLE_GATES_SPEC.md for the design contract (Kevin,
// 2026-08-19, four owner rulings). Nothing else re-decides.
//
// The four roles + how they resolve
//   1. kpi_roles.role='corporate'            -> corporate, scope null
//   2. kpi_roles.role='rdo'                  -> rdo, scope=region
//   3. people.is_site_leader=true            -> site_leader, scope=account_key
//                                               (intentionally does NOT
//                                                check worker_class, so a
//                                                contractor Kevin has
//                                                designated a real site
//                                                leader still qualifies -
//                                                see spec §8 OQ-4)
//   4. people.worker_class='salaried'
//      AND people.account_key IS NOT NULL
//      AND people.status='ACTIVE'            -> site_manager, scope=account_key
//   5. otherwise                             -> null (no access)
//
// First match wins. All email comparisons are trim + lowercase; the
// people derive normalises `work_email` on ingest (spec §8c) and the
// resolver still compares case-insensitively as belt-and-braces.
//
// Seasonal rehires (spec §8, Kevin 2026-08-19): the same work_email
// can appear on multiple people rows because seasonal staff are
// rehired under a new worker_id each season while keeping their
// address. `status='ACTIVE'` is LOAD-BEARING on both site rules -
// without it, one login could resolve to several rows and pick a
// stale account_key or a stale leader flag. The resolver must return
// AT MOST ONE row per email; if it sees more than one active match,
// it throws (probe P-dup covers this).
//
// Cache posture
// ─────────────
// Two table reads per request (kpi_roles, accounts). people is
// queried per unique email and cached inside the closure so a
// repeated resolveKpiRole call for the same email is one DB hit,
// not two. A role change takes effect on the next request without
// a redeploy.
//
// PII posture: emails travel through the closure but are never
// logged. Errors surface as { error, ... } on the caller.

const PSEUDO_KEYS = new Set(["ALL", "EAST", "WEST"]);
const PSEUDO_TO_REGION = new Map([["EAST", "East"], ["WEST", "West"]]);
const REGION_TO_PSEUDO = new Map([["East", "EAST"], ["West", "WEST"]]);

function normEmail(e) {
  return String(e || "").trim().toLowerCase();
}

/**
 * Load the KPI role gate for one request.
 *
 * @returns {Promise<{
 *   resolveKpiRole:  (email: string) => Promise<{role: string, scope: string|null} | null>,
 *   canViewAccount:  (caller: {role: string, scope: string|null} | null, requestedAccount: string) => boolean,
 *   canSeeSalary:    (caller: {role: string, scope: string|null} | null, requestedAccount: string) => boolean,
 *   landingAccount:  (caller: {role: string, scope: string|null} | null) => string | null,
 *   error?: string,
 * }>}
 */
export async function loadRoleGate(supa) {
  const [rolesQ, accountsQ] = await Promise.all([
    supa.from("kpi_roles").select("email, role, scope"),
    supa.from("accounts").select("team_key, region"),
  ]);
  if (rolesQ.error)    return errorGate(`kpi_roles: ${rolesQ.error.message}`);
  if (accountsQ.error) return errorGate(`accounts: ${accountsQ.error.message}`);

  const rolesByEmail = new Map();
  for (const r of rolesQ.data || []) {
    const email = normEmail(r.email);
    if (!email) continue;
    // Rule 7 (spec §7 G7 + §8 OQ-1): kpi_roles.role='site' is
    // superseded by people. Ignore any residual rows before the
    // cleanup migration runs so a stale row cannot leak site access.
    if (r.role !== "corporate" && r.role !== "rdo") continue;
    rolesByEmail.set(email, { role: r.role, scope: r.scope || null });
  }
  const regionByAccount = new Map();
  for (const a of accountsQ.data || []) {
    regionByAccount.set(String(a.team_key), a.region || null);
  }

  const cache = new Map();   // normEmail -> {role, scope} | null

  async function resolveKpiRole(email) {
    const e = normEmail(email);
    if (!e) return null;
    if (cache.has(e)) return cache.get(e);

    // Rules 1 + 2: kpi_roles.
    const kr = rolesByEmail.get(e);
    if (kr?.role === "corporate") { const v = { role: "corporate", scope: null }; cache.set(e, v); return v; }
    if (kr?.role === "rdo")       { const v = { role: "rdo", scope: kr.scope };   cache.set(e, v); return v; }

    // Rule 3: site_leader. Match on is_site_leader alone; do NOT
    // add a worker_class check - the leader flag is owner-set and
    // must override worker_class (spec §8 OQ-4, contract RD case).
    // status='ACTIVE' is load-bearing (spec §2 update): seasonal
    // staff are rehired under a new worker_id each season and keep
    // the same work_email. Without the ACTIVE filter an email could
    // resolve to a terminated row carrying a stale is_site_leader
    // flag from a prior season. The partial UNIQUE
    // (account_key) WHERE is_site_leader enforces at most one
    // active leader per account; the probe asserts no duplication
    // for our 11 seeded emails.
    const leadQ = await supa
      .from("people")
      .select("worker_id, account_key, status")
      .eq("status", "ACTIVE")
      .eq("is_site_leader", true)
      .ilike("work_email", e);
    if (leadQ.error) throw new Error(`role gate: people leader lookup: ${leadQ.error.message}`);
    const leaders = leadQ.data || [];
    if (leaders.length > 1) throw new Error(`role gate: ${leaders.length} leader rows match one email`);
    if (leaders.length === 1) {
      const v = { role: "site_leader", scope: leaders[0].account_key };
      cache.set(e, v);
      return v;
    }

    // Rule 4: site_manager. Two load-bearing filters:
    //   - status='ACTIVE' defeats the seasonal-rehire trap (a
    //     terminated row can share a work_email with a current
    //     worker; without ACTIVE the wrong row wins).
    //   - account_key <> 'CORP' (spec §2 update): CORP is a value
    //     in rippling_department_map, not an account on the board.
    //     Without this clause every corporate salaried person not
    //     already in kpi_roles would become 'site_manager scoped to
    //     CORP', holding a site that does not exist. Corporate
    //     membership is a DECISION recorded in kpi_roles, never
    //     derived from a department.
    const mgrQ = await supa
      .from("people")
      .select("worker_id, account_key")
      .eq("status", "ACTIVE")
      .eq("worker_class", "salaried")
      .not("account_key", "is", null)
      .neq("account_key", "CORP")
      .ilike("work_email", e);
    if (mgrQ.error) throw new Error(`role gate: people manager lookup: ${mgrQ.error.message}`);
    const managers = mgrQ.data || [];
    if (managers.length > 1) throw new Error(`role gate: ${managers.length} active-salaried rows match one email`);
    if (managers.length === 1) {
      const v = { role: "site_manager", scope: managers[0].account_key };
      cache.set(e, v);
      return v;
    }

    cache.set(e, null);
    return null;
  }

  function canViewAccount(caller, requestedAccount) {
    if (!caller || !requestedAccount) return false;
    const { role, scope } = caller;
    if (role === "corporate") return true;
    if (role === "rdo") return true;                    // §1: RDOs see full picture
    // site_leader / site_manager: own account only, aggregates locked
    if (PSEUDO_KEYS.has(requestedAccount)) return false;
    return requestedAccount === scope;
  }

  function canSeeSalary(caller, requestedAccount) {
    if (!caller || !requestedAccount) return false;
    const { role, scope } = caller;
    if (role === "corporate") return true;
    if (role === "rdo") return true;
    if (role === "site_leader") {
      if (PSEUDO_KEYS.has(requestedAccount)) return false;   // aggregates never
      return requestedAccount === scope;
    }
    // site_manager: never, even for their own account (§5 + §6)
    return false;
  }

  function landingAccount(caller) {
    if (!caller) return null;
    const { role, scope } = caller;
    if (role === "corporate") return "ALL";
    if (role === "rdo") return REGION_TO_PSEUDO.get(scope) || "ALL";
    // site_leader / site_manager
    return scope;
  }

  return { resolveKpiRole, canViewAccount, canSeeSalary, landingAccount };
}

function errorGate(msg) {
  return {
    error: msg,
    resolveKpiRole: async () => null,
    canViewAccount: () => false,
    canSeeSalary:   () => false,
    landingAccount: () => null,
  };
}
