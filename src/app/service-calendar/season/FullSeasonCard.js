"use client";

// FullSeasonCard - the year-level summary card sitting alongside P13
// in the 4x3 period grid (spec section 4 + 7.8). Rebuilt for Design
// Batch 3 to address audit P1-8 (duplication + bg-clash):
//
//   - Clear white card with a visible border on the beige page (FIXES
//     the bg-clash where the card blended into the surface behind it).
//   - Revenue-forward arrangement (Kevin's approved arrangement A): a
//     KPI row leading with the financial state of the season.
//   - NO duplication of the top action band: needs-entry / overdue
//     do NOT live here anymore. They live in the InfoCard's action
//     band (Design Batch 2). One source of truth per metric.
//   - NO "ahead of pace" line (Kevin cut it during the mockup review).
//   - Billing-aware: fee accounts swap meals/days for contract +
//     homestand completion. If the contract value is not in the
//     payload, the card falls back to homestand completion only and
//     the FullSeasonCard flags the missing field with a calm caption.
//
// Computed from the SAME year-summary data the cards consume; no
// new fetch, no engine call.

export default function FullSeasonCard({
  yearData,
  yearBannerStats,
  isFeeAccount,
  hasHomestandSchedule,
}) {
  if (!yearData || !yearBannerStats) return null;

  const {
    daysRecorded = 0,
    totalDays = 0,
    mealsYTD = 0,
    gameDaysEntered = 0,
    totalGameDays = 0,
  } = yearBannerStats;

  // Revenue summary - per-meal / MiLB only; fee accounts get the
  // contract / homestand summary (no $ from the per-day revenue path).
  const actualRev = yearData.reduce((sum, m) => sum + (Number(m.actualRevenue) || 0), 0);
  const projRev   = yearData.reduce((sum, m) => sum + (Number(m.projectedRevenue) || 0), 0);

  const completionPct = totalDays > 0 ? Math.round((daysRecorded / totalDays) * 100) : 0;
  const feePct        = totalGameDays > 0 ? Math.round((gameDaysEntered / totalGameDays) * 100) : 0;

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
            completionPct={completionPct}
          />
        ) : (
          <PerMealSummary
            actualRev={actualRev}
            projRev={projRev}
            daysRecorded={daysRecorded}
            totalDays={totalDays}
            mealsYTD={mealsYTD}
            completionPct={completionPct}
          />
        )}
      </div>
    </article>
  );
}

// Per-meal: revenue-forward KPI row. Entered YTD + Projected (with
// the projection styled muted, the actual as the hero). Days entered
// + Meals YTD as the operational anchors. A completion bar caps it.
// Needs-entry / overdue intentionally OMITTED - those live in the
// action band (Batch 2). No "ahead of pace" line.
function PerMealSummary({ actualRev, projRev, daysRecorded, totalDays, mealsYTD, completionPct }) {
  return (
    <>
      <div className="sc-season-fullseason-row sc-season-fullseason-row--kpi">
        <Stat label="Entered YTD" value={fmtMoney(actualRev)} tone="actual" hero />
        <Stat label="Projected"  value={fmtMoney(projRev)}    tone="muted" />
        <Stat label="Days entered" value={`${daysRecorded} / ${totalDays}`} />
        <Stat label="Meals YTD" value={mealsYTD.toLocaleString("en-US")} />
      </div>
      <CompletionBar pct={completionPct} label={`${completionPct}% of season recorded`} />
    </>
  );
}

// STL-FL: per-meal mechanics with structural absence of $. The KPI
// row drops the revenue cells and leads with days + meals.
function OperationalSummary({ daysRecorded, totalDays, mealsYTD, completionPct }) {
  return (
    <>
      <div className="sc-season-fullseason-row sc-season-fullseason-row--kpi">
        <Stat label="Days entered" value={`${daysRecorded} / ${totalDays}`} hero />
        <Stat label="Meals YTD"    value={mealsYTD.toLocaleString("en-US")} />
      </div>
      <CompletionBar pct={completionPct} label={`${completionPct}% of season recorded`} />
    </>
  );
}

// Homestand-fee (CIN-OH / STL-MO / TXR-TX-H / TXR-TX-V): contract is
// the financial anchor. Contract value lives in sc_fee_schedule (the
// audit verified it has 5 baseline rows, one per fee account). It is
// NOT currently in the sc-year-summary payload - so this card cannot
// surface a specific dollar figure without an engine-side merge. The
// card falls back to homestand completion + meals YTD and FLAGS the
// missing field via a calm caption so a future engine extension can
// fill it in without a UI rebuild.
function FeeHomestandSummary({ gameDaysEntered, totalGameDays, mealsYTD, feePct }) {
  return (
    <>
      <div className="sc-season-fullseason-row sc-season-fullseason-row--kpi">
        <Stat label="Game days entered" value={`${gameDaysEntered} / ${totalGameDays}`} hero />
        <Stat label="Meals YTD"         value={mealsYTD.toLocaleString("en-US")} />
      </div>
      <CompletionBar pct={feePct} label={`${feePct}% of game days recorded`} />
      <p className="sc-season-fullseason-card-note">
        Contract value will surface here when the fee schedule is wired through.
      </p>
    </>
  );
}

function Stat({ label, value, tone, hero }) {
  const toneClass = tone ? `sc-season-fullseason-stat--${tone}` : "";
  const heroClass = hero ? "sc-season-fullseason-stat--hero" : "";
  return (
    <div className={`sc-season-fullseason-stat ${toneClass} ${heroClass}`.trim()}>
      <span className="sc-season-fullseason-stat-label">{label}</span>
      <span className="sc-season-fullseason-stat-value">{value}</span>
    </div>
  );
}

function CompletionBar({ pct, label }) {
  return (
    <div className="sc-season-fullseason-completion">
      <div
        className="sc-season-fullseason-bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`sc-season-fullseason-bar-fill ${pct === 100 ? "sc-season-fullseason-bar-fill--complete" : ""}`}
          style={{ width: pct + "%" }}
        />
      </div>
      <span className="sc-season-fullseason-completion-label">{label}</span>
    </div>
  );
}

// Number formatting (Batch 1 rule): revenue uses K/M, counts raw.
//   >= $1M -> "$1.2M"
//   >= $1K -> "$12K"
//   <  $1K -> "$987"
function fmtMoney(n) {
  const v = Math.round(Number(n) || 0);
  if (Math.abs(v) >= 1_000_000) return "$" + (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (Math.abs(v) >= 1_000)     return "$" + Math.round(v / 1_000) + "K";
  return "$" + v.toLocaleString("en-US");
}
