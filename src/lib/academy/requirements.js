// src/lib/academy/requirements.js
//
// The requirements issuance engine. See
// `docs/opd/ACADEMY_MASTER_SPEC.md` Sections 5, 6 for the design.
//
// One eligibility filter. Every trigger (cycle publish, onboarding,
// rehire) resolves audience through the SAME evaluateEligibility()
// function. Duplicating that logic is the drift risk this file
// deliberately closes.
//
// Sources it reads (all clean tables):
//   - people                          roster
//   - accounts                        for state scope (via account_key)
//   - academy_obligations             obligation shape + applies_to
//   - academy_cycles                  cycle status + dates
//   - academy_cycle_modules           what a cycle contains
//   - academy_person_stints           worker_id -> person_id
//   - academy_eligibility_exceptions  include/exclude override
//   - academy_requirements            for idempotency + rehire detection
//
// Sources it MUST NOT read (spec Section 3.2):
//   - contacts.role                   free text, drift-prone
//   - src/lib/admin.js allowlists     ops-team gates
//   - user_accounts_derived / _manual
//
// Version re-certification (source = 'version_recert') is
// DELIBERATELY NOT IMPLEMENTED here. It requires reading
// academy_attestations to find who signed the prior version, and
// that table does not exist yet - it lands with the signature
// layer (migration 6+), the same PR that creates the thing it
// depends on. The `source` CHECK already permits the value; the
// value simply has no producer today.

import { getServiceClient } from "@/lib/supabase";

// ═══════════════════════════════════════════════════════════════
// The onboarding boundary. Recommended default: NO backfill.
// Onboarding issues only when status = 'HIRED' OR start_date >=
// ACADEMY_LAUNCH_DATE. Existing staff receive their training
// through cycles - that is what cycles are for.
//
// A single named constant so the boundary decision is greppable
// and edit-visible. If Kevin rules "backfill everyone at launch,"
// change ACADEMY_LAUNCH_DATE to a past date OR call
// planOnboarding({ backfill: true }); the engine reports both
// counts in dry-run so the decision is informed.
// ═══════════════════════════════════════════════════════════════
export const ACADEMY_LAUNCH_DATE = "2026-09-01";

const REQUIREMENT_SOURCE_CYCLE       = "cycle";
const REQUIREMENT_SOURCE_ONBOARDING  = "onboarding";
const REQUIREMENT_SOURCE_REHIRE      = "rehire";

// ─── eligibility (spec Section 5.2, one implementation) ────────────
// person:      { worker_id, is_salaried, account_key, end_date, ... }
// obligation:  { doc_id, obligation_key, applies_to, ... } (applies_to
//              may be a JSONB string "company-wide" or an object)
// context:     { excludedWorkerIds: Set<string>, accountStateMap: Map<string,string> }
//
// Returns { eligible: boolean, reason: string|null, roleWarning?: true }.
// The reason describes WHY someone was excluded so the dry-run can
// explain itself.
//
// Exported so tests + the dry-run explanations use the same
// function; no other code path duplicates this logic.
export function evaluateEligibility(person, obligation, context = {}) {
  const excludedWorkerIds = context.excludedWorkerIds || new Set();
  const accountStateMap   = context.accountStateMap   || new Map();

  // 1. end_date IS NULL
  if (person.end_date != null) {
    return { eligible: false, reason: "end_date not null" };
  }
  // 2. Not in the exclusion table
  if (excludedWorkerIds.has(person.worker_id)) {
    return { eligible: false, reason: "eligibility exception (excluded)" };
  }

  // Parse applies_to - two valid shapes per frontmatter schema oneOf:
  //   - the string "company-wide"
  //   - an object with any subset of {states, account, role, worker_class}
  // Absent (null / undefined / empty object) is treated as company-wide.
  const at = obligation.applies_to;
  let scope = null; // object form; null means "company-wide"
  if (at == null) {
    scope = null;
  } else if (typeof at === "string") {
    if (at !== "company-wide") {
      return { eligible: false, reason: `applies_to string "${at}" is not "company-wide"` };
    }
    scope = null;
  } else if (typeof at === "object") {
    scope = at;
  } else {
    // Unknown shape: fail closed to avoid mis-assignment.
    return { eligible: false, reason: `applies_to shape unknown (${typeof at})` };
  }

  if (scope) {
    // 3. worker_class - absent means "all"
    const wc = scope.worker_class;
    if (wc != null) {
      if (wc === "all") {
        // matches everyone
      } else if (wc === "salaried") {
        if (!person.is_salaried) {
          return { eligible: false, reason: "worker_class=salaried, viewer is hourly" };
        }
      } else if (wc === "hourly") {
        if (person.is_salaried) {
          return { eligible: false, reason: "worker_class=hourly, viewer is salaried" };
        }
      } else {
        return { eligible: false, reason: `worker_class value unknown ("${wc}")` };
      }
    }

    // 4. account match if present
    if (scope.account != null && scope.account !== "") {
      if (person.account_key !== scope.account) {
        return {
          eligible: false,
          reason: `account "${person.account_key || "(null)"}" does not match applies_to.account "${scope.account}"`,
        };
      }
    }

    // 5. states match through accounts.state
    if (Array.isArray(scope.states) && scope.states.length > 0) {
      const st = accountStateMap.get(person.account_key);
      if (st == null) {
        return {
          eligible: false,
          reason: `applies_to.states set (${scope.states.join(",")}) but no accounts.state for "${person.account_key || "(null)"}"`,
        };
      }
      if (!scope.states.includes(st)) {
        return {
          eligible: false,
          reason: `accounts.state "${st}" not in applies_to.states [${scope.states.join(",")}]`,
        };
      }
    }

    // 6. role - CANNOT be honoured in v1 (spec Section 3.2).
    // Skip the obligation and flag it. Zero obligations use `role`
    // today; the guard exists so authoring one later produces a
    // visible warning rather than a silent mis-assignment.
    if (scope.role != null && scope.role !== "") {
      return {
        eligible: false,
        reason: `applies_to.role="${scope.role}" - v1 cannot honour role scope (spec Section 3.2)`,
        roleWarning: true,
      };
    }
  }

  return { eligible: true, reason: null };
}


// ─── shared loaders ────────────────────────────────────────────────

async function loadExcludedWorkerIds(supa) {
  const q = await supa
    .from("academy_eligibility_exceptions")
    .select("worker_id")
    .eq("eligible", false);
  if (q.error) throw new Error(`load exceptions: ${q.error.message}`);
  return new Set((q.data || []).map((r) => r.worker_id));
}

async function loadAccountStateMap(supa) {
  const q = await supa.from("accounts").select("team_key, state");
  if (q.error) throw new Error(`load accounts: ${q.error.message}`);
  const m = new Map();
  for (const a of q.data || []) {
    if (a.team_key) m.set(a.team_key, a.state || null);
  }
  return m;
}

async function loadPeoplePool(supa, options = {}) {
  const { includeHired = true, includeActive = true } = options;
  const q = await supa
    .from("people")
    .select("worker_id, display_name, is_salaried, account_key, status, start_date, end_date")
    .is("end_date", null);
  if (q.error) throw new Error(`load people: ${q.error.message}`);
  let rows = q.data || [];
  if (!includeHired)   rows = rows.filter((r) => r.status !== "HIRED");
  if (!includeActive)  rows = rows.filter((r) => r.status !== "ACTIVE");
  return rows;
}

async function loadStintMap(supa) {
  const q = await supa.from("academy_person_stints").select("worker_id, person_id");
  if (q.error) throw new Error(`load stints: ${q.error.message}`);
  const m = new Map();
  for (const s of q.data || []) m.set(s.worker_id, s.person_id);
  return m;
}

// ─── cycle audience scope (academy-6) ──────────────────────────────
//
// Composes with evaluateEligibility, does NOT replace it. The
// resolution order for cycle issuance is fixed:
//   1. Obligation audience via evaluateEligibility
//   2. Then cycle audience_scope via evaluateCycleScope
// Both must pass. The two return distinct exclusion reasons so a
// dry-run reader can tell "this obligation does not apply to you"
// (spec) from "this cycle was not published to you" (operator
// choice) - they are different facts.

const VALID_SCOPE_WORKER_CLASS = new Set(["all", "salaried", "hourly"]);

/**
 * Validate an audience_scope's values against live reference data.
 * Returns an array of human-readable error strings; empty means
 * every value resolves. Called before publish so a scope typo
 * refuses loudly rather than silently producing an empty result.
 *
 * @param {object} scope             the cycle's audience_scope (may be null/{})
 * @param {object} ctx
 * @param {Set<string>} ctx.knownAccountKeys
 * @param {Set<string>} ctx.knownRegions
 * @param {Set<string>} ctx.activeWorkerIdsSet
 * @returns {string[]}
 */
export function validateAudienceScope(scope, ctx) {
  const errors = [];
  if (scope == null) return errors;
  if (typeof scope !== "object" || Array.isArray(scope)) {
    return [`audience_scope must be an object, got ${Array.isArray(scope) ? "array" : typeof scope}`];
  }
  if (scope.worker_class != null) {
    if (!VALID_SCOPE_WORKER_CLASS.has(scope.worker_class)) {
      errors.push(
        `audience_scope.worker_class "${scope.worker_class}" is not one of all|salaried|hourly`
      );
    }
  }
  if (scope.accounts != null) {
    if (!Array.isArray(scope.accounts)) {
      errors.push("audience_scope.accounts must be an array");
    } else {
      for (const a of scope.accounts) {
        if (typeof a !== "string" || !ctx.knownAccountKeys.has(a)) {
          errors.push(`audience_scope.accounts entry "${a}" does not exist in accounts.team_key`);
        }
      }
    }
  }
  if (scope.regions != null) {
    if (!Array.isArray(scope.regions)) {
      errors.push("audience_scope.regions must be an array");
    } else {
      for (const r of scope.regions) {
        if (typeof r !== "string" || !ctx.knownRegions.has(r)) {
          errors.push(`audience_scope.regions entry "${r}" does not exist in accounts.region`);
        }
      }
    }
  }
  if (scope.worker_ids != null) {
    if (!Array.isArray(scope.worker_ids)) {
      errors.push("audience_scope.worker_ids must be an array");
    } else {
      for (const w of scope.worker_ids) {
        if (typeof w !== "string" || !ctx.activeWorkerIdsSet.has(w)) {
          errors.push(
            `audience_scope.worker_ids entry "${w}" is not a people row with end_date IS NULL`
          );
        }
      }
    }
  }
  return errors;
}

/**
 * Per-person cycle-scope check. Runs AFTER evaluateEligibility.
 * Absent/empty scope matches everyone (no narrowing).
 *
 * @param {object} person
 * @param {object} audienceScope
 * @param {object} ctx
 * @param {Map<string,string>} ctx.accountRegionMap
 * @returns {{inScope: boolean, reason: string|null}}
 */
export function evaluateCycleScope(person, audienceScope, ctx = {}) {
  if (audienceScope == null || typeof audienceScope !== "object") {
    return { inScope: true, reason: null };
  }
  const keys = Object.keys(audienceScope);
  if (keys.length === 0) return { inScope: true, reason: null };

  if (audienceScope.worker_class != null) {
    const wc = audienceScope.worker_class;
    if (wc === "salaried" && !person.is_salaried) {
      return { inScope: false, reason: "cycle scope worker_class=salaried, viewer is hourly" };
    }
    if (wc === "hourly" && person.is_salaried) {
      return { inScope: false, reason: "cycle scope worker_class=hourly, viewer is salaried" };
    }
    // "all" matches; unknown values are refused by validateAudienceScope
  }
  if (Array.isArray(audienceScope.accounts) && audienceScope.accounts.length > 0) {
    if (!audienceScope.accounts.includes(person.account_key)) {
      return {
        inScope: false,
        reason: `cycle scope accounts excludes viewer's account "${person.account_key || "(none)"}"`,
      };
    }
  }
  if (Array.isArray(audienceScope.regions) && audienceScope.regions.length > 0) {
    const accountRegionMap = ctx.accountRegionMap || new Map();
    const region = accountRegionMap.get(person.account_key);
    if (!audienceScope.regions.includes(region)) {
      return {
        inScope: false,
        reason: `cycle scope regions excludes viewer's region "${region || "(none)"}"`,
      };
    }
  }
  if (Array.isArray(audienceScope.worker_ids) && audienceScope.worker_ids.length > 0) {
    if (!audienceScope.worker_ids.includes(person.worker_id)) {
      return {
        inScope: false,
        reason: `cycle scope worker_ids does not include viewer`,
      };
    }
  }
  return { inScope: true, reason: null };
}

async function loadObligationsByDocKey(supa, docKeyPairs) {
  // docKeyPairs: Array<{ doc_id, obligation_key }>. Returns
  // Map<`${doc_id}|${obligation_key}`, obligation-row>.
  if (docKeyPairs.length === 0) return new Map();
  const uniqueDocs = [...new Set(docKeyPairs.map((p) => p.doc_id))];
  const q = await supa
    .from("academy_obligations")
    .select("doc_id, obligation_key, doc_version, est_minutes, applies_to, type, cadence, owner")
    .in("doc_id", uniqueDocs);
  if (q.error) throw new Error(`load obligations: ${q.error.message}`);
  const m = new Map();
  for (const r of q.data || []) {
    m.set(`${r.doc_id}|${r.obligation_key}`, r);
  }
  return m;
}


// ─── Trigger 1: cycle publish ──────────────────────────────────────
//
// Returns a plan object with the rows to insert plus a report the
// dry-run prints. The plan is exactly what the RPC accepts as
// p_rows; publishing is applyCyclePublish() below.

export async function planCyclePublish(supa, cycleId, options = {}) {
  const db = supa || getServiceClient();

  const cycleQ = await db
    .from("academy_cycles")
    .select("cycle_id, label, period_start, period_end, status, audience_scope")
    .eq("cycle_id", cycleId)
    .maybeSingle();
  if (cycleQ.error) throw new Error(`load cycle ${cycleId}: ${cycleQ.error.message}`);
  if (!cycleQ.data) throw new Error(`cycle ${cycleId} not found`);
  const cycle = cycleQ.data;
  if (cycle.status !== "draft" && !options.force) {
    throw new Error(
      `cycle ${cycleId} is in status "${cycle.status}"; publish only accepts draft. Pass { force: true } to plan against a non-draft (for reporting only; apply will still refuse).`
    );
  }

  const modulesQ = await db
    .from("academy_cycle_modules")
    .select("doc_id, obligation_key, doc_version, est_minutes, sort_order")
    .eq("cycle_id", cycleId)
    .order("sort_order", { ascending: true })
    .order("doc_id", { ascending: true });
  if (modulesQ.error) throw new Error(`load modules: ${modulesQ.error.message}`);
  const modules = modulesQ.data || [];

  // Load accounts once for both state resolution (obligation states
  // scope) and region resolution (cycle scope), and pull the full
  // account catalog into a Set for scope-name validation.
  const accountsQ = await db.from("accounts").select("team_key, state, region");
  if (accountsQ.error) throw new Error(`load accounts: ${accountsQ.error.message}`);
  const accountRegionMap = new Map();
  const knownAccountKeys = new Set();
  const knownRegions = new Set();
  const accountStateMap = new Map();
  for (const a of accountsQ.data || []) {
    if (!a.team_key) continue;
    knownAccountKeys.add(a.team_key);
    if (a.state) accountStateMap.set(a.team_key, a.state);
    if (a.region) {
      accountRegionMap.set(a.team_key, a.region);
      knownRegions.add(a.region);
    }
  }

  const [excluded, people, stints, obligations] = await Promise.all([
    loadExcludedWorkerIds(db),
    loadPeoplePool(db, { includeHired: true, includeActive: true }),
    loadStintMap(db),
    loadObligationsByDocKey(db, modules),
  ]);

  const activeWorkerIdsSet = new Set(people.map((p) => p.worker_id));
  const context = { excludedWorkerIds: excluded, accountStateMap };
  const scopeCtx = { accountRegionMap };

  // Validate the cycle's audience_scope value-set before iterating.
  // An unresolved value (bad account, non-existent worker_id, etc.)
  // becomes a semantic refusal that both the dry-run reader and the
  // apply path can see.
  const scopeRefusals = validateAudienceScope(cycle.audience_scope, {
    knownAccountKeys,
    knownRegions,
    activeWorkerIdsSet,
  });

  // Detect on-hire cadence in cycle modules. It is not a refusal
  // (Kevin may deliberately run a launch catch-up cycle), but it
  // needs to be visible in the dry-run because it conflates two
  // issuance mechanisms - a new hire in October would receive
  // big-rules-onboarding from the onboarding trigger AND again from
  // any October cycle carrying it (different `source` values, both
  // pass the unique index). See PR 7 prompt Part 4.
  const onHireModules = [];

  if (modules.length === 0) {
    return {
      cycle,
      rows: [],
      report: {
        modules: 0,
        audienceScope: cycle.audience_scope || {},
        peopleAffected: 0,
        totalRequirements: 0,
        byClass: {},
        byAccount: {},
        minutesSummary: { min: 0, max: 0, avg: 0, total: 0 },
        skipped: [],
        scopeSkippedByReason: {},
        roleWarnings: [],
        onHireModules: [],
        scopeRefusals,
        wouldRefuseApply: scopeRefusals.length > 0 || true, // zero modules is a de-facto refusal too
        refuseReasons: [
          ...scopeRefusals,
          "cycle has zero modules; publishing writes zero requirements",
        ],
        note: "cycle has zero modules; publishing writes zero requirements",
      },
    };
  }

  const rows = [];
  const skipped = [];
  const roleWarnings = [];
  const scopeSkippedByReason = new Map();
  const seenPeople = new Set();
  const byClass = { salaried: 0, hourly: 0, unknown: 0 };
  const byAccount = {};
  const minutesPerPerson = new Map();

  for (const mod of modules) {
    const key = `${mod.doc_id}|${mod.obligation_key}`;
    const ob = obligations.get(key);
    if (!ob) {
      skipped.push({
        module: key,
        reason:
          "cycle module points at obligation absent from academy_obligations (projection drift; PR 3 obligations RPC has not been re-run since the module was added)",
      });
      continue;
    }
    if (ob.cadence === "on-hire") {
      onHireModules.push(key);
    }

    for (const p of people) {
      // Step 1: obligation audience (existing filter).
      const oblVerdict = evaluateEligibility(p, ob, context);
      if (oblVerdict.roleWarning) {
        roleWarnings.push({ module: key, worker_id: p.worker_id, reason: oblVerdict.reason });
      }
      if (!oblVerdict.eligible) continue;

      // Step 2: cycle audience_scope (new). Distinct exclusion
      // reason so the dry-run tally shows "obligation excluded"
      // and "cycle scope excluded" as separate categories.
      const scopeVerdict = evaluateCycleScope(p, cycle.audience_scope, scopeCtx);
      if (!scopeVerdict.inScope) {
        const r = scopeVerdict.reason || "cycle scope excluded (unknown reason)";
        scopeSkippedByReason.set(r, (scopeSkippedByReason.get(r) || 0) + 1);
        continue;
      }

      const person_id = stints.get(p.worker_id) || null;
      // person_id null is expected drift until the nightly derive
      // extension ships; the requirements table permits null and
      // the row still issues correctly, keyed on worker_id.
      rows.push({
        worker_id: p.worker_id,
        person_id,
        doc_id: mod.doc_id,
        obligation_key: mod.obligation_key,
        // spec Section 13 - a closed cycle must not change when an
        // obligation is re-authored. Denormalize from the cycle
        // module, NOT from the current academy_obligations row.
        doc_version: mod.doc_version,
        est_minutes: mod.est_minutes,
        due_date: cycle.period_end,
      });

      seenPeople.add(p.worker_id);
      if (p.is_salaried === true)       byClass.salaried += 1;
      else if (p.is_salaried === false) byClass.hourly   += 1;
      else                              byClass.unknown  += 1;

      const acct = p.account_key || "(no account)";
      byAccount[acct] = (byAccount[acct] || 0) + 1;

      const acc = minutesPerPerson.get(p.worker_id) || 0;
      minutesPerPerson.set(p.worker_id, acc + (mod.est_minutes || 0));
    }
  }

  // Turn minutes-per-person into a summary distribution.
  const minutesList = [...minutesPerPerson.values()];
  const minutesSummary = minutesList.length === 0
    ? { min: 0, max: 0, avg: 0, total: 0 }
    : {
        min: Math.min(...minutesList),
        max: Math.max(...minutesList),
        avg: Math.round(minutesList.reduce((a, b) => a + b, 0) / minutesList.length),
        total: minutesList.reduce((a, b) => a + b, 0),
      };

  // Publish-time refusals. Two kinds: unresolved scope values
  // (name typos) and zero resolved population (the scope reaches
  // nobody - almost always a scope typo, and if genuinely intended,
  // the operator can say so another way). Both feed the same
  // wouldRefuseApply flag applyCyclePublish honours.
  const refuseReasons = [...scopeRefusals];
  if (rows.length === 0 && modules.length > 0) {
    refuseReasons.push(
      `cycle resolves to zero people (modules=${modules.length}, audience_scope=${JSON.stringify(cycle.audience_scope || {})}). A cycle that reaches nobody is almost always a scope typo; refuse rather than publish an empty cycle that reports "complete".`
    );
  }

  return {
    cycle,
    rows,
    report: {
      modules: modules.length,
      audienceScope: cycle.audience_scope || {},
      peopleAffected: seenPeople.size,
      totalRequirements: rows.length,
      byClass,
      byAccount,
      minutesSummary,
      skipped,
      scopeSkippedByReason: Object.fromEntries(scopeSkippedByReason),
      roleWarnings,
      onHireModules,
      scopeRefusals,
      refuseReasons,
      wouldRefuseApply: refuseReasons.length > 0,
    },
  };
}

export async function applyCyclePublish(supa, cycleId, publishedBy, plan) {
  const db = supa || getServiceClient();

  // Honour the plan's semantic refusals BEFORE calling the RPC.
  // These are audience_scope typos + zero-resolution refusals from
  // planCyclePublish. The RPC would happily accept an empty
  // p_rows (that path exists for a legitimate but rare "cycle
  // with zero eligible people" case that predates cycle scopes),
  // so the JS side owns the "did you really mean to publish to
  // nobody" question.
  if (plan?.report?.wouldRefuseApply) {
    const reasons = (plan.report.refuseReasons || []).map((r) => `  - ${r}`).join("\n");
    throw new Error(
      `applyCyclePublish refused: plan would refuse to publish (see planCyclePublish report). Reasons:\n${reasons || "  (no reasons captured)"}`
    );
  }

  const q = await db.rpc("publish_cycle_atomic", {
    p_cycle_id: cycleId,
    p_published_by: publishedBy,
    p_rows: plan.rows,
  });
  if (q.error) throw new Error(`publish_cycle_atomic: ${q.error.message}`);
  return Array.isArray(q.data) ? q.data[0] : q.data;
}


// ─── Trigger 2: onboarding ─────────────────────────────────────────
//
// Recommended default: NO backfill. A person qualifies for
// onboarding when status = 'HIRED' OR start_date >=
// ACADEMY_LAUNCH_DATE. Existing staff receive their training
// through cycles.
//
// Options:
//   backfill: boolean (default false)   include every current
//                                        person regardless of
//                                        start_date. Reserved for
//                                        the Kevin-ruled full
//                                        launch backfill.
//   launchDate: string (default ACADEMY_LAUNCH_DATE)
//
// Report includes BOTH counts (recommended boundary AND full-
// backfill alternative) so the choice is informed.

export async function planOnboarding(supa, options = {}) {
  const db = supa || getServiceClient();
  const launchDate = options.launchDate || ACADEMY_LAUNCH_DATE;
  const backfill = !!options.backfill;

  const [excluded, accountStates, people, stints, obligationsAll] = await Promise.all([
    loadExcludedWorkerIds(db),
    loadAccountStateMap(db),
    loadPeoplePool(db, { includeHired: true, includeActive: true }),
    loadStintMap(db),
    (async () => {
      const q = await db
        .from("academy_obligations")
        .select("doc_id, obligation_key, doc_version, est_minutes, applies_to, cadence")
        .eq("cadence", "on-hire");
      if (q.error) throw new Error(`load on-hire obligations: ${q.error.message}`);
      return q.data || [];
    })(),
  ]);

  const context = { excludedWorkerIds: excluded, accountStateMap: accountStates };

  // Boundary filters.
  const inBoundary = (p) =>
    p.status === "HIRED" ||
    (p.start_date != null && p.start_date >= launchDate);
  const boundaryPeople = people.filter(inBoundary);

  // Two plans: recommended-boundary rows (the ones we'd insert now)
  // and full-backfill rows (informational count only).
  const rows = [];
  const roleWarnings = [];
  const skippedByReason = new Map();
  let backfillWouldInsert = 0;
  const backfillByClass = { salaried: 0, hourly: 0, unknown: 0 };
  const boundaryByClass = { salaried: 0, hourly: 0, unknown: 0 };

  for (const ob of obligationsAll) {
    for (const p of people) {
      const verdict = evaluateEligibility(p, ob, context);
      if (verdict.roleWarning) {
        roleWarnings.push({
          module: `${ob.doc_id}|${ob.obligation_key}`,
          worker_id: p.worker_id,
          reason: verdict.reason,
        });
      }
      if (!verdict.eligible) {
        const r = verdict.reason || "unknown";
        skippedByReason.set(r, (skippedByReason.get(r) || 0) + 1);
        continue;
      }
      // Would-be-included regardless of boundary
      backfillWouldInsert += 1;
      if (p.is_salaried === true) backfillByClass.salaried += 1;
      else if (p.is_salaried === false) backfillByClass.hourly += 1;
      else backfillByClass.unknown += 1;

      // Apply boundary
      if (!backfill && !inBoundary(p)) continue;

      const person_id = stints.get(p.worker_id) || null;
      rows.push({
        worker_id: p.worker_id,
        person_id,
        doc_id: ob.doc_id,
        obligation_key: ob.obligation_key,
        doc_version: ob.doc_version,
        est_minutes: ob.est_minutes,
        source: REQUIREMENT_SOURCE_ONBOARDING,
        cycle_id: null,
        // "Signed before the first shift" per AGR-001.
        due_date: p.start_date || launchDate,
      });
      if (p.is_salaried === true) boundaryByClass.salaried += 1;
      else if (p.is_salaried === false) boundaryByClass.hourly += 1;
      else boundaryByClass.unknown += 1;
    }
  }

  return {
    launchDate,
    rows,
    report: {
      obligations: obligationsAll.length,
      recommended: {
        peopleAffected: boundaryPeople.length,
        totalRequirements: rows.length,
        byClass: boundaryByClass,
      },
      backfillAlternative: {
        peopleAffected: people.length,
        totalRequirements: backfillWouldInsert,
        byClass: backfillByClass,
        note: "informational only - apply mode never uses this unless { backfill: true } is passed",
      },
      skippedByReason: Object.fromEntries(skippedByReason),
      roleWarnings,
      boundaryPeople: boundaryPeople.map((p) => ({
        worker_id: p.worker_id,
        display_name: p.display_name,
        status: p.status,
        start_date: p.start_date,
        is_salaried: p.is_salaried,
        account_key: p.account_key,
      })),
    },
  };
}


// ─── Trigger 3: rehire ─────────────────────────────────────────────
//
// A new stint for a person who already has one. Detection:
//   1. person_id in academy_person_stints has >1 worker_id
//   2. This worker_id has zero academy_requirements rows
//
// Behaviour is identical to onboarding, with source='rehire'. The
// prior stint's requirements are untouched (that separation is
// the whole reason attestations hang off the stint).
//
// Derive-drift handling: the nightly derive that keeps
// academy_person_stints current does not exist yet. Until it
// ships, a rehire's new stint has a `people` row but no stint
// row. That case is handled EXPLICITLY by reporting the drift in
// the plan output and producing zero rows for those stints - the
// alternative (creating a person_id on the fly here) would fork
// identity resolution across two writers, which the append-only
// discipline in this repo rejects.

export async function planRehire(supa, options = {}) {
  const db = supa || getServiceClient();

  const [stintsQ, reqsQ, obligationsQ, excluded, accountStates, people] = await Promise.all([
    db.from("academy_person_stints").select("worker_id, person_id"),
    db.from("academy_requirements").select("worker_id").eq("source", REQUIREMENT_SOURCE_ONBOARDING),
    db.from("academy_obligations").select("doc_id, obligation_key, doc_version, est_minutes, applies_to").eq("cadence", "on-hire"),
    loadExcludedWorkerIds(db),
    loadAccountStateMap(db),
    loadPeoplePool(db, { includeHired: true, includeActive: true }),
  ]);
  for (const q of [stintsQ, reqsQ, obligationsQ]) {
    if (q.error) throw new Error(`rehire plan load: ${q.error.message}`);
  }

  // Multi-stint persons.
  const stintsByPerson = new Map();
  for (const s of stintsQ.data || []) {
    if (!s.person_id) continue;
    const arr = stintsByPerson.get(s.person_id) || [];
    arr.push(s.worker_id);
    stintsByPerson.set(s.person_id, arr);
  }
  const multiStintPersonIds = new Set(
    [...stintsByPerson.entries()].filter(([, ws]) => ws.length > 1).map(([pid]) => pid)
  );

  const stintMap = new Map((stintsQ.data || []).map((s) => [s.worker_id, s.person_id]));
  const workersWithReqs = new Set((reqsQ.data || []).map((r) => r.worker_id));
  const peopleByWorker = new Map(people.map((p) => [p.worker_id, p]));

  // Rehire candidates: workers whose person_id has multiple stints
  // AND this worker has no onboarding requirements yet AND person
  // is currently on the roster (end_date IS NULL).
  const candidateWorkers = [];
  for (const p of people) {
    const pid = stintMap.get(p.worker_id);
    if (!pid) continue;
    if (!multiStintPersonIds.has(pid)) continue;
    if (workersWithReqs.has(p.worker_id)) continue;
    candidateWorkers.push(p);
  }

  // Derive drift: workers who exist in `people` (roster) with a
  // multi-stint sibling but no `academy_person_stints` row yet
  // (the nightly derive extension is not shipped). Report explicit.
  const driftCandidates = [];
  // Compute drift by inverting: any worker in `people` whose
  // person_id in stintMap is null is a potential drift row. We
  // can't tell if they'd be a rehire without a stint row - flag
  // both cases (no stint row at all).
  for (const p of people) {
    if (!stintMap.has(p.worker_id)) {
      driftCandidates.push({
        worker_id: p.worker_id,
        display_name: p.display_name,
        reason: "no academy_person_stints row (derive extension not yet shipped)",
      });
    }
  }

  const context = { excludedWorkerIds: excluded, accountStateMap: accountStates };
  const rows = [];
  const roleWarnings = [];
  const byClass = { salaried: 0, hourly: 0, unknown: 0 };
  for (const p of candidateWorkers) {
    for (const ob of obligationsQ.data || []) {
      const verdict = evaluateEligibility(p, ob, context);
      if (verdict.roleWarning) {
        roleWarnings.push({
          module: `${ob.doc_id}|${ob.obligation_key}`,
          worker_id: p.worker_id,
          reason: verdict.reason,
        });
      }
      if (!verdict.eligible) continue;
      rows.push({
        worker_id: p.worker_id,
        person_id: stintMap.get(p.worker_id),
        doc_id: ob.doc_id,
        obligation_key: ob.obligation_key,
        doc_version: ob.doc_version,
        est_minutes: ob.est_minutes,
        source: REQUIREMENT_SOURCE_REHIRE,
        cycle_id: null,
        due_date: p.start_date || null,
      });
      if (p.is_salaried === true) byClass.salaried += 1;
      else if (p.is_salaried === false) byClass.hourly += 1;
      else byClass.unknown += 1;
    }
  }

  return {
    rows,
    report: {
      obligations: (obligationsQ.data || []).length,
      candidateStints: candidateWorkers.length,
      totalRequirements: rows.length,
      byClass,
      roleWarnings,
      driftCandidates,
    },
  };
}


// ─── apply (non-cycle triggers) ────────────────────────────────────
//
// Onboarding and rehire share the same insert shape and route
// through the same RPC: insert_requirements_bulk (academy-5). That
// keeps the COALESCE(cycle_id, -1) ON CONFLICT expression in
// exactly one file rather than restated in JavaScript where a
// prior version subtly diverged from the index definition and
// would have failed at runtime.
//
// Routing all writes through RPCs also means academy_requirements
// is never touched by an app-code INSERT / .upsert / .from(...)
// .insert(...) - grep-verify: the only writer sites in src/ and
// scripts/ are RPC calls (publish_cycle_atomic + this function).
//
// Returns { inserted, skipped } (skipped = planned rows minus
// inserted, i.e., conflict-suppressed rows).

export async function applyRequirements(supa, plan, options = {}) {
  const db = supa || getServiceClient();
  if (!Array.isArray(plan?.rows) || plan.rows.length === 0) {
    return { inserted: 0, skipped: 0 };
  }

  // Enforce a single non-cycle source per call. insert_requirements_
  // bulk (academy-5) takes source as a top-level parameter so that
  // the COALESCE(cycle_id, -1) expression appears in exactly one
  // place per write path. A plan mixing sources would have to be
  // split before calling; refuse instead of guessing.
  const sources = new Set(plan.rows.map((r) => r.source));
  if (sources.has(REQUIREMENT_SOURCE_CYCLE)) {
    throw new Error(
      "applyRequirements refused: plan contains source='cycle' rows. Cycle requirements must go through publish_cycle_atomic to keep status flip + insert atomic."
    );
  }
  if (sources.size !== 1) {
    throw new Error(
      `applyRequirements refused: plan has mixed sources (${[...sources].join(",")}). insert_requirements_bulk takes a single source per call; split the plan by source and call once per group.`
    );
  }
  const source = [...sources][0];
  const issuedBy = options.issuedBy || "system";

  // Strip `source` from row payload; the RPC assigns it from the
  // top-level parameter. Same for cycle_id (fixed to NULL for the
  // non-cycle sources this RPC serves). issued_by is per-row so
  // future callers can attribute individual rows differently,
  // defaulting to the top-level issuedBy option.
  const stripped = plan.rows.map((r) => ({
    worker_id: r.worker_id,
    person_id: r.person_id,
    doc_id: r.doc_id,
    obligation_key: r.obligation_key,
    doc_version: r.doc_version,
    est_minutes: r.est_minutes,
    due_date: r.due_date,
    issued_by: issuedBy,
  }));

  // Route through the RPC. This is the ONLY app-code write into
  // academy_requirements outside publish_cycle_atomic; those two
  // RPCs together hold the COALESCE(cycle_id, -1) inference in the
  // one file so a future edit cannot fork the expression across
  // JavaScript and plpgsql.
  const q = await db.rpc("insert_requirements_bulk", {
    p_source: source,
    p_rows: stripped,
  });
  if (q.error) throw new Error(`insert_requirements_bulk: ${q.error.message}`);
  const inserted = typeof q.data === "number" ? q.data : Number(q.data);
  if (!Number.isFinite(inserted)) {
    throw new Error(
      `insert_requirements_bulk: non-numeric return value ${JSON.stringify(q.data)}`
    );
  }
  return { inserted, skipped: stripped.length - inserted };
}
