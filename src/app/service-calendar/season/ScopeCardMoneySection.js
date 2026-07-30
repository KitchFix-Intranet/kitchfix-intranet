// M-4b (2026-07-30): shared card money + homestand list section
// rendered by both MonthCard and PeriodCard.
//
// Owner rulings 2026-07-30:
//   PeriodCard: budget figure from sc_labor_budgets, ties to P&L.
//   MonthCard: "Draws from Pn + Pn+1" label naming the periods,
//              no figure. A monthly total does not exist (28-day
//              periods never align with 30/31-day months) and pro-
//              rating manufactures a number that reconciles against
//              nothing.
//   Both: homestand list scoped to this month/period, straddlers
//         labelled "spans P6 + P7" (or "spans Jul + Aug") with the
//         scope-native game count. HS7 (Jun 12-17, 3+3) is the
//         case that ships.
//   Missing-vs-zero: a period with no budget shows its reason or
//         nothing. Never $0.

import {
  resolvePeriodBudget,
  resolveDrawsFromPeriods,
  resolveScopedHomestands,
  formatMonthSpan,
} from "./scopeCardDerivation";
import "./scopeCardMoneySection.css";

// scopeKind: "period" | "month"
// For period: periodNumber + periodRange required.
// For month: monthIndex + monthStart + monthEnd required.
export default function ScopeCardMoneySection({
  scopeKind,
  // period-scope inputs
  periodNumber,
  periodRange,
  // month-scope inputs
  monthIndex,
  monthStart,
  monthEnd,
  // shared inputs
  periodRanges,
  periodBudgets,
  homestands,
  yearData,
  todayDate,
  accountKey,
  onHomestandClick,
}) {
  const rangeStart = scopeKind === "period" ? periodRange?.start : monthStart;
  const rangeEnd   = scopeKind === "period" ? periodRange?.end   : monthEnd;

  const scopedHomestands = resolveScopedHomestands({
    yearData,
    todayDate,
    accountKey,
    rangeStart,
    rangeEnd,
    periodRanges,
    homestandsPayload: homestands,
  });

  // Period money line: own budget row or the missing-vs-zero
  // fallback. Month money line: "Draws from Pn + Pn+1" label
  // instead of a figure (owner ruling).
  let moneyLine = null;
  if (scopeKind === "period") {
    const { amount } = resolvePeriodBudget(periodBudgets, periodNumber);
    moneyLine = (
      <div className="sc-scope-money-row">
        <span className="sc-scope-money-label">Budget</span>
        {amount != null ? (
          <span className="sc-scope-money-value">{fmtCurrency(amount)}</span>
        ) : (
          <span className="sc-scope-money-value sc-scope-money-value--missing">
            not recorded
          </span>
        )}
      </div>
    );
  } else {
    const draws = resolveDrawsFromPeriods(periodRanges, monthStart, monthEnd);
    if (draws.length > 0) {
      moneyLine = (
        <div className="sc-scope-money-row">
          <span className="sc-scope-money-label">Draws from</span>
          <span className="sc-scope-money-value">
            {draws.map((p) => `P${p}`).join(" + ")}
          </span>
        </div>
      );
    }
  }

  if (!moneyLine && !scopedHomestands.length) return null;

  return (
    <div className="sc-scope-money">
      {moneyLine}
      {scopedHomestands.length > 0 && (
        <ul className="sc-scope-homestand-list" role="list">
          {scopedHomestands.map((hs) => (
            <HomestandRow
              key={hs.key}
              hs={hs}
              scopeKind={scopeKind}
              monthIndex={monthIndex}
              onClick={onHomestandClick}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function HomestandRow({ hs, scopeKind, monthIndex, onClick }) {
  const opponents = (hs.opponents && hs.opponents.length > 0)
    ? hs.opponents.join(" / ")
    : "TBD";
  const gameWord = hs.gameCount === 1 ? "game" : "games";
  const statusLabel = hs.payloadStatus
    ? hs.payloadStatus.replace(/-/g, " ")
    : hs.status || null;

  // Straddle label:
  // - Period scope: name every fiscal period the block touches when
  //   there's more than one - "spans P6 + P7"
  // - Month scope: name calendar months only when the block extends
  //   past the current month - "spans Jul + Aug"
  const spanLabel = scopeKind === "period"
    ? (hs.spansPeriods && hs.spansPeriods.length > 1
        ? `spans ${hs.spansPeriods.map((p) => `P${p}`).join(" + ")}`
        : null)
    : formatMonthSpan(hs, monthIndex);

  const interactive = typeof onClick === "function" && !!hs.key;
  const handleClick = interactive ? (e) => {
    e.stopPropagation();
    onClick(hs.key);
  } : undefined;
  const handleKey = interactive ? (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      onClick(hs.key);
    }
  } : undefined;

  const cls = [
    "sc-scope-hs-row",
    statusLabel && `sc-scope-hs-row--${(hs.payloadStatus || hs.status || "").toString()}`,
    interactive && "sc-scope-hs-row--interactive",
  ].filter(Boolean).join(" ");

  return (
    <li
      className={cls}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={handleKey}
    >
      <span className="sc-scope-hs-id">{hs.homestandId}</span>
      <span className="sc-scope-hs-opp">vs {opponents}</span>
      <span className="sc-scope-hs-count">
        {hs.gameCount} {gameWord}
      </span>
      {statusLabel && (
        <span className="sc-scope-hs-status">{statusLabel}</span>
      )}
      {spanLabel && (
        <span className="sc-scope-hs-span">{spanLabel}</span>
      )}
    </li>
  );
}

// Local currency formatter. Whole dollars for the card's compact
// display. Uses en-US grouping matching the rest of the SC surface.
function fmtCurrency(amount) {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}
