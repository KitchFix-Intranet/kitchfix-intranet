"use client";

// FullSeasonCard - sits in row 4 alongside P13, occupying the
// remaining 3 grid slots (spec section 4 + 7.8). Carries the
// year-level summary:
//
//   - Entered YTD (dollar amount for per-meal/MiLB; days for fee)
//   - Projected (per-meal/MiLB only)
//   - Days entered + total
//   - Needs-attention count
//   - Overdue count
//
// Computed from the SAME year-summary data the cards consume; no
// new fetch, no engine call. The card grid-spans 3 columns on
// desktop (4x3 + P13 in slot 13 = 3 slots free); the responsive
// CSS handles smaller viewports.

export default function FullSeasonCard({ yearData, yearBannerStats, isFeeAccount, hasHomestandSchedule }) {
  if (!yearData || !yearBannerStats) return null;

  const {
    daysRecorded = 0,
    totalDays = 0,
    needsEntry = 0,
    overdue = 0,
    mealsYTD = 0,
    gameDaysEntered = 0,
    totalGameDays = 0,
  } = yearBannerStats;

  // Revenue summary - per-meal / MiLB only; fee accounts get the
  // operational summary (no $).
  const actualRev = yearData.reduce((sum, m) => sum + (Number(m.actualRevenue) || 0), 0);
  const projRev   = yearData.reduce((sum, m) => sum + (Number(m.projectedRevenue) || 0), 0);

  const completionPct = totalDays > 0 ? Math.round(daysRecorded / totalDays * 100) : 0;
  const feePct = totalGameDays > 0 ? Math.round(gameDaysEntered / totalGameDays * 100) : 0;

  return (
    <article className="sc-season-fullseason-card" aria-label="Full season summary">
      <header className="sc-season-fullseason-card-header">
        <span className="sc-season-fullseason-card-eyebrow">Season summary</span>
        <span className="sc-season-fullseason-card-title">2026</span>
      </header>

      <div className="sc-season-fullseason-card-body">
        {hasHomestandSchedule ? (
          <FeeHomestandSummary
            gameDaysEntered={gameDaysEntered}
            totalGameDays={totalGameDays}
            mealsYTD={mealsYTD}
            feePct={feePct}
          />
        ) : isFeeAccount ? (
          <OperationalSummary
            daysRecorded={daysRecorded}
            totalDays={totalDays}
            mealsYTD={mealsYTD}
            needsEntry={needsEntry}
            overdue={overdue}
            completionPct={completionPct}
          />
        ) : (
          <PerMealSummary
            actualRev={actualRev}
            projRev={projRev}
            daysRecorded={daysRecorded}
            totalDays={totalDays}
            needsEntry={needsEntry}
            overdue={overdue}
            completionPct={completionPct}
          />
        )}
      </div>
    </article>
  );
}

function PerMealSummary({ actualRev, projRev, daysRecorded, totalDays, needsEntry, overdue, completionPct }) {
  return (
    <>
      <div className="sc-season-fullseason-row">
        <Stat label="Entered YTD" value={fmtK(actualRev)} tone="actual" hero />
        <Stat label="Projected"  value={fmtK(projRev)}    tone="muted" />
      </div>
      <div className="sc-season-fullseason-row">
        <Stat label="Days entered" value={`${daysRecorded} / ${totalDays}`} />
        <Stat label="Needs entry"  value={needsEntry.toLocaleString("en-US")} tone={needsEntry > 0 ? "warn" : "muted"} />
        <Stat label="Overdue"      value={overdue.toLocaleString("en-US")}    tone={overdue > 0 ? "alert" : "muted"} />
      </div>
      <ProgressBar pct={completionPct} />
    </>
  );
}

function OperationalSummary({ daysRecorded, totalDays, mealsYTD, needsEntry, overdue, completionPct }) {
  // STL-FL discipline: NO $ tokens. The card shows day-counts + meals
  // structurally; the $ slots are absent.
  return (
    <>
      <div className="sc-season-fullseason-row">
        <Stat label="Days entered" value={`${daysRecorded} / ${totalDays}`} hero />
        <Stat label="Meals YTD"   value={mealsYTD.toLocaleString("en-US")} />
      </div>
      <div className="sc-season-fullseason-row">
        <Stat label="Needs entry" value={needsEntry.toLocaleString("en-US")} tone={needsEntry > 0 ? "warn" : "muted"} />
        <Stat label="Overdue"     value={overdue.toLocaleString("en-US")}    tone={overdue > 0 ? "alert" : "muted"} />
      </div>
      <ProgressBar pct={completionPct} />
    </>
  );
}

function FeeHomestandSummary({ gameDaysEntered, totalGameDays, mealsYTD, feePct }) {
  return (
    <>
      <div className="sc-season-fullseason-row">
        <Stat label="Game days entered" value={`${gameDaysEntered} / ${totalGameDays}`} hero />
        <Stat label="Meals YTD"         value={mealsYTD.toLocaleString("en-US")} />
      </div>
      <ProgressBar pct={feePct} />
    </>
  );
}

function Stat({ label, value, tone, hero }) {
  const toneClass = tone ? `sc-season-fullseason-stat--${tone}` : "";
  const heroClass = hero ? "sc-season-fullseason-stat--hero" : "";
  return (
    <div className={`sc-season-fullseason-stat ${toneClass} ${heroClass}`}>
      <span className="sc-season-fullseason-stat-label">{label}</span>
      <span className="sc-season-fullseason-stat-value">{value}</span>
    </div>
  );
}

function ProgressBar({ pct }) {
  return (
    <div className="sc-season-fullseason-bar" aria-hidden="true">
      <div
        className={`sc-season-fullseason-bar-fill ${pct === 100 ? "sc-season-fullseason-bar-fill--complete" : ""}`}
        style={{ width: pct + "%" }}
      />
    </div>
  );
}

function fmtK(n) {
  if (n == null) return "$0";
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1_000_000) return "$" + (v / 1_000_000).toFixed(2).replace(/\.0+$/, "") + "M";
  if (Math.abs(v) >= 1_000)     return "$" + Math.round(v / 1_000) + "K";
  return "$" + Math.round(v);
}
