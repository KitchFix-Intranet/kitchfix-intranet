// src/app/kpi/labor/lib/budgets.js
//
// K9 · illustrative labor budgets, one module. Every occurrence carries
// the "illustrative" label until real budgets replace these values in
// one place.
//
// Values are per-week dollar budgets per hourly account (D26 salaried
// accounts have no line here - CIN-KY / TBJ-NY excluded). Numbers are
// placeholders sized to match roughly the accounts' current spend
// pattern from labor_actuals; they will be replaced when a real
// budget source lands. Do NOT lift these into a decision without
// stripping the "illustrative" tag first.

const BUDGET_WK = {
  "CIN - OH":     3900,
  "STL - FL":     8200,
  "CIN - AZ":     3550,
  "STL - MO":     3200,
  "TBJ - FL":     5100,
  "TBR - FL":     5400,
  "TXR - AZ":     3300,
  "TXR - TX - H": 2650,
  "TXR - TX - V": 1950,
};

// budgetForRange - dollar budget for the given account across the given
// number of weeks. Returns 0 if account is not in the roster (salaried,
// unknown).
export function budgetForRange(accountKey, weekCount) {
  const perWeek = BUDGET_WK[accountKey] || 0;
  return perWeek * (weekCount || 0);
}

// elapsedPct - what % of the range window has already passed. Anchor
// for pace vs elapsed comparisons (spec §3.4 +b: pace warns when
// exceeds elapsed by > 2pts).
export function elapsedPct(startISO, endISO, todayISO) {
  const pd = (s) => new Date(s + "T00:00:00Z").getTime();
  const total = (pd(endISO) - pd(startISO)) / 86400000 + 1;
  const done  = Math.min(total, Math.max(0, (pd(todayISO) - pd(startISO)) / 86400000 + 1));
  return total > 0 ? (done / total) * 100 : 100;
}

// presetSuffix - human label for a resolved preset (F5).
export function presetSuffix(preset, startISO, endISO, currentPeriodNo) {
  switch (preset) {
    case "fytd":         return " · FY to date";
    case "this_period":  return currentPeriodNo != null ? ` · Period ${currentPeriodNo}` : " · this period";
    case "last_period":  return currentPeriodNo != null ? ` · Period ${currentPeriodNo - 1}` : " · last period";
    case "last_4wk":     return " · last 4 weeks";
    case "last_13wk":    return " · last 13 weeks";
    default: {
      const mdY = (iso) => {
        if (!iso) return "";
        const [y, m, d] = iso.slice(0, 10).split("-");
        return `${m}/${d}/${y.slice(2)}`;
      };
      return ` · ${mdY(startISO)}–${mdY(endISO)}`;
    }
  }
}
