// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/data/scOrientation.js
// SousAI data tool B5: homestand + period + PDC-phase orientation.
//
// "What homestand is CIN-OH on? What period are we in?"
//
// Reads three views:
//   v_current_homestand_by_account   - the current homestand for MLB/MiLB accounts
//   v_current_period_by_account      - the current P1-P13 period for service accounts
//   v_current_pdc_phase_by_account   - the current PDC phase for the 5 PDC accounts
//
// Period is COMPANY-WIDE (Kevin ruling 2026-07-29): all 11 service accounts
// return identical period boundaries. Homestand and PDC phase remain
// per-account. Callers can therefore ask for the period WITHOUT an
// accountKey - `scOrientation({ scope: 'period' })` returns "Period 8" for
// everyone.
//
// Returns whichever dimensions the account actually has, NAMING the ones it
// does not. Missing dimensions are answers, not gaps:
//   - PDC accounts have no homestand: "no homestand schedule - this is a PDC facility."
//   - MLB accounts have no PDC phase: "PDC phase does not apply to this account."
//   - CORP has none: "CORP has no service calendar dimensions."
//
// Period label discipline: the raw sc_day_metadata.period is an unconstrained
// TEXT column that stores '8', not 'P8'. sc_labor_budgets stores 'P8' via
// CHECK constraint. This tool normalizes on the "Period N" form for the
// human-facing label, keeps the raw as period_raw for machine consumers,
// and exposes 'P8' as period_short.
//
// Day math: instead of days_elapsed / days_remaining (which sum to 27 for a
// 28-day period because today counts in neither), the output also carries
// `day_number` (1-indexed, so today = 17 in a 28-day period) and
// `total_days` for the more natural "Day N of T" phrasing.
// ─────────────────────────────────────────────────────────────────────────────

import { getSupabase } from "../_client.js";
import { pgLiveNow } from "../_freshness.js";
import { KNOWN_TEAM_KEYS, PDC_TEAM_KEYS } from "./_constants.js";

const VALID_SCOPES = ["homestand", "period", "phase", "both", "all"];

// Convert raw period value ('8' or 'P8') to a normalized shape.
function normalizePeriod(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  const numMatch = s.match(/^P?(\d{1,2})$/);
  if (!numMatch) return { period_raw: s, period_short: s, period_label: s };
  const n = numMatch[1];
  return {
    period_raw: s,
    period_short: `P${n}`,
    period_label: `Period ${n}`,
  };
}

/**
 * @param {object} args
 * @param {string} [args.accountKey] - e.g. "CIN - OH". Optional when scope='period' (period is company-wide).
 * @param {string} [args.date] - accepted but currently CURRENT_DATE-only via views (future extension)
 * @param {"homestand"|"period"|"phase"|"both"|"all"} [args.scope="all"]
 * @returns {Promise<object>}
 */
export async function scOrientation({ accountKey, date, scope = "all" } = {}) {
  if (!VALID_SCOPES.includes(scope)) {
    return errorPayload(`scope must be one of ${VALID_SCOPES.join(", ")}`);
  }

  // Bare period query (no accountKey): allowed because period is
  // company-wide. Homestand and phase require an accountKey - decline the
  // account-shaped dimensions if the caller didn't scope to just period.
  if (!accountKey || (typeof accountKey === "string" && accountKey.trim() === "")) {
    if (scope !== "period") {
      return errorPayload(
        `accountKey is required for scope='${scope}' (homestand and PDC phase are per-account). Period is company-wide - re-call with scope='period' if that's what you want, or supply an accountKey. Known team_keys: ${KNOWN_TEAM_KEYS.join(", ")}`
      );
    }
    return await companyWidePeriod();
  }

  const trimmedKey = accountKey.trim();
  if (!KNOWN_TEAM_KEYS.includes(trimmedKey)) {
    return {
      source: "v_current_homestand_by_account, v_current_period_by_account, v_current_pdc_phase_by_account",
      scope: "current-season Service Calendar orientation",
      loaded: pgLiveNow(),
      parameters: { accountKey: trimmedKey, date: date || null, scope },
      note: `no account with team_key='${trimmedKey}' in the current-season list. Known team_keys: ${KNOWN_TEAM_KEYS.join(", ")}. If the account was active in a prior season, the corpus (REC docs) may still describe it.`,
    };
  }

  const sb = getSupabase();
  const wantHomestand = scope === "all" || scope === "both" || scope === "homestand";
  const wantPeriod = scope === "all" || scope === "both" || scope === "period";
  const wantPhase = scope === "all" || scope === "phase";

  const [hsRes, pdRes, phRes] = await Promise.all([
    wantHomestand
      ? sb.from("v_current_homestand_by_account").select("*").eq("account_key", trimmedKey).maybeSingle()
      : Promise.resolve({ data: null }),
    wantPeriod
      ? sb.from("v_current_period_by_account").select("*").eq("account_key", trimmedKey).maybeSingle()
      : Promise.resolve({ data: null }),
    wantPhase && PDC_TEAM_KEYS.includes(trimmedKey)
      ? sb.from("v_current_pdc_phase_by_account").select("*").eq("account_key", trimmedKey).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const isPDC = PDC_TEAM_KEYS.includes(trimmedKey);
  const isCorp = trimmedKey === "CORP";

  // Homestand dimension. PDC facilities and CORP structurally lack homestands.
  let homestand;
  if (!wantHomestand) {
    homestand = null;
  } else if (isCorp) {
    homestand = { applicable: false, reason: "CORP has no service calendar." };
  } else if (isPDC) {
    homestand = { applicable: false, reason: "no homestand schedule - this is a PDC facility (Player Development Complex)." };
  } else if (hsRes.data) {
    homestand = {
      applicable: true,
      homestand_id: hsRes.data.homestand_id,
      start_date: hsRes.data.start_date,
      end_date: hsRes.data.end_date,
      days_elapsed: hsRes.data.days_elapsed,
      days_remaining: hsRes.data.days_remaining,
    };
  } else {
    homestand = { applicable: true, current: false, reason: `no active homestand for ${trimmedKey} today. Try scHomestandDetail with homestandRef='previous' or 'next'.` };
  }

  // Period dimension. CORP structurally lacks a P-period concept. Period is
  // company-wide (Kevin ruling 2026-07-29) - the account_key lookup here is
  // for consistency with the account-shaped call; the values will be
  // identical to what the bare-period path returns.
  let period;
  if (!wantPeriod) {
    period = null;
  } else if (isCorp) {
    period = { applicable: false, reason: "CORP is not a service account and has no P-period." };
  } else if (pdRes.data) {
    const norm = normalizePeriod(pdRes.data.period);
    const totalDays = (new Date(pdRes.data.end_date) - new Date(pdRes.data.start_date)) / 86400000 + 1;
    const dayNumber = pdRes.data.days_elapsed + 1;
    period = {
      applicable: true,
      company_wide: true,
      period_label: norm?.period_label ?? null,
      period_short: norm?.period_short ?? null,
      period_raw: norm?.period_raw ?? null,
      start_date: pdRes.data.start_date,
      end_date: pdRes.data.end_date,
      total_days: totalDays,
      day_number: dayNumber,
      days_elapsed: pdRes.data.days_elapsed,
      days_remaining: pdRes.data.days_remaining,
      week_label: pdRes.data.week_label ?? null,
      event_label: pdRes.data.event_label ?? null,
    };
  } else {
    period = { applicable: true, current: false, reason: `no active period for ${trimmedKey} today (may be outside the season window)` };
  }

  // Phase dimension. Only 5 PDC accounts carry it.
  let phase;
  if (!wantPhase) {
    phase = null;
  } else if (!isPDC) {
    phase = { applicable: false, reason: "PDC phase does not apply to this account - phases are a Player Development Complex concept." };
  } else if (phRes.data) {
    phase = {
      applicable: true,
      phase: phRes.data.phase,
      start_date: phRes.data.start_date,
      end_date: phRes.data.end_date,
      days_elapsed: phRes.data.days_elapsed,
      days_remaining: phRes.data.days_remaining,
    };
  } else {
    phase = { applicable: true, current: false, reason: `no active PDC phase for ${trimmedKey} today` };
  }

  return {
    source: "v_current_homestand_by_account, v_current_period_by_account, v_current_pdc_phase_by_account",
    scope: "current-season Service Calendar orientation",
    loaded: pgLiveNow(),
    parameters: { accountKey: trimmedKey, date: date || "today (view resolves on CURRENT_DATE)", scope },
    account_shape: {
      is_pdc: isPDC,
      is_corp: isCorp,
      dimensions_available: [
        !isCorp && !isPDC ? "homestand" : null,
        !isCorp ? "period" : null,
        isPDC ? "phase" : null,
      ].filter(Boolean),
    },
    homestand,
    period,
    phase,
  };
}

function errorPayload(msg) {
  return {
    source: "v_current_homestand_by_account, v_current_period_by_account, v_current_pdc_phase_by_account",
    scope: "current-season Service Calendar orientation",
    loaded: pgLiveNow(),
    error: msg,
  };
}

// Company-wide period lookup (no accountKey needed). Pulls from any one
// service account since all 11 return identical boundaries; falls back
// gracefully if the account we pick happens to have no active period.
async function companyWidePeriod() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("v_current_period_by_account")
    .select("*")
    .limit(1);
  if (error) throw new Error(`scOrientation.companyWidePeriod: query failed: ${error.code || "?"} ${error.message}`);
  if (!data || data.length === 0) {
    return {
      source: "v_current_period_by_account",
      scope: "current-season Service Calendar orientation - company-wide period",
      loaded: pgLiveNow(),
      parameters: { accountKey: null, scope: "period" },
      period: { applicable: true, current: false, reason: "no active period across any account today - the season may be outside its window" },
    };
  }
  const row = data[0];
  const norm = normalizePeriod(row.period);
  const totalDays = (new Date(row.end_date) - new Date(row.start_date)) / 86400000 + 1;
  const dayNumber = row.days_elapsed + 1;
  return {
    source: "v_current_period_by_account",
    scope: "current-season Service Calendar orientation - company-wide period",
    loaded: pgLiveNow(),
    parameters: { accountKey: null, scope: "period" },
    period: {
      applicable: true,
      company_wide: true,
      period_label: norm?.period_label ?? null,
      period_short: norm?.period_short ?? null,
      period_raw: norm?.period_raw ?? null,
      start_date: row.start_date,
      end_date: row.end_date,
      total_days: totalDays,
      day_number: dayNumber,
      days_elapsed: row.days_elapsed,
      days_remaining: row.days_remaining,
      week_label: row.week_label ?? null,
      event_label: row.event_label ?? null,
    },
    note: "Period is company-wide - all 11 service accounts share these boundaries. CORP has no service calendar.",
  };
}
