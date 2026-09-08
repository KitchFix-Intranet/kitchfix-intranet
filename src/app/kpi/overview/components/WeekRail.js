"use client";
// src/app/kpi/overview/components/WeekRail.js
//
// Kevin CC prompt 2026-09-08 item 4. Four-card rail below the three
// KPI cards on Current period. Each card shows the week's meals
// (confirmed or forecast) + prorated service fee + cost target vs
// landed + caveats for invoice + labor state.
//
// Render of record: docs/renders/current-period-hybrid.html.
//
// Payload contract (resolver.js emits `payload.week_rail`):
//   week_rail: {
//     period_no, running_week_no,
//     weeks: [{
//       week_no, week_start, week_end,
//       state,               // "closed" | "in_progress" | "not_started"
//       revenue_basis,       // "confirmed" | "forecast" | null
//       meal_revenue, fee_prorate, week_revenue,
//       cost_target, cost_landed, labor_landed, purchasing_landed,
//       unapproved_hours,
//     }],
//   } | null
//
// State label mapping (calendar-relative label on the tile):
//   state === "in_progress"                    -> "running"  (navy stripe)
//   state === "closed" && basis === "confirmed" -> "confirmed"(green stripe)
//   state === "closed" && basis !== "confirmed" -> "closed"   (grey)
//   state === "not_started"                    -> "forecast" (dashed grey)
//
// Kevin ruling: invoice state derives from week INDEX, not from a
// date string.
//   invoices_landed = (running_week_no - week_no) >= 2
// A week's invoices are "landed" once the current week is two or
// more weeks past it. Two-week rule holds at the boundary by
// construction.

function fmtMoney(n) {
  if (n == null || Number.isNaN(n)) return "—";
  const abs = Math.abs(Math.round(Number(n)));
  const s = "$" + abs.toLocaleString("en-US");
  return n < 0 ? "-" + s : s;
}

function fmtMMDD(iso) {
  if (!iso) return "";
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)}`;
}

function tileVariant(state, revenue_basis) {
  if (state === "in_progress") return "run";
  if (state === "not_started") return "fc";
  if (state === "closed" && revenue_basis === "confirmed") return "conf";
  return "conf";
}

function tileStateLabel(state, revenue_basis) {
  if (state === "in_progress") return "running";
  if (state === "not_started") return "forecast";
  if (state === "closed" && revenue_basis === "confirmed") return "confirmed";
  return "closed";
}

function mealLabel(revenue_basis) {
  return revenue_basis === "confirmed" ? "Confirmed meals" : "Forecast meals";
}

export default function WeekRail({ weekRail }) {
  if (!weekRail || !Array.isArray(weekRail.weeks) || weekRail.weeks.length === 0) {
    return null;
  }
  const { period_no, running_week_no, weeks } = weekRail;
  const confirmedCount = weeks.filter(w => w.revenue_basis === "confirmed").length;
  const totalCount = weeks.length;

  return (
    <div
      className="kpi-ov-card kpi-ov-mt"
      data-kpi-ov="week-rail"
      data-kpi-ov-period={period_no}
    >
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">The period · week by week</span>
        <span className="kpi-ov-gl">meals plus the prorated service fee, week by week</span>
        <span
          className={`kpi-ov-pill ${confirmedCount === totalCount ? "kpi-ov-pill-good" : "kpi-ov-pill-neutral"}`}
          data-kpi-ov="week-rail-pill"
        >
          {confirmedCount} of {totalCount} weeks confirmed
        </span>
      </div>
      <div className="kpi-ov-cb">
        <div className="kpi-ov-rail" data-kpi-ov="week-rail-grid">
          {weeks.map(w => {
            const variant = tileVariant(w.state, w.revenue_basis);
            const stLabel = tileStateLabel(w.state, w.revenue_basis);
            const isForecast = w.state === "not_started";
            // Invoice landed rule: (running_week_no - week_no) >= 2.
            // Only renders on running or past weeks; forecast weeks
            // don't carry an invoice caveat.
            const invoicesLanded = (running_week_no - w.week_no) >= 2;
            const showInvoiceCaveat = !isForecast;
            const showLaborApprovedCaveat = !isForecast
              && (w.unapproved_hours || 0) === 0
              && Number(w.labor_landed || 0) > 0;
            const showLaborPendingCaveat = !isForecast
              && (w.unapproved_hours || 0) > 0;
            return (
              <div
                key={w.week_no}
                className={`kpi-ov-rail-tile kpi-ov-rail-tile-${variant}`}
                data-kpi-ov="week-rail-tile"
                data-kpi-ov-week={w.week_no}
                data-kpi-ov-state={w.state}
                data-kpi-ov-basis={w.revenue_basis || ""}
              >
                <div className="kpi-ov-rail-head">
                  <div className="kpi-ov-rail-title">
                    <span className="kpi-ov-rail-n">Wk {w.week_no}</span>
                    <span className="kpi-ov-rail-dt">
                      {fmtMMDD(w.week_start)} – {fmtMMDD(w.week_end)}
                    </span>
                  </div>
                  <span className="kpi-ov-rail-st">{stLabel}</span>
                </div>
                <div className="kpi-ov-rail-row">
                  <span className="kpi-ov-rail-k">{mealLabel(w.revenue_basis)}</span>
                  <span className="kpi-ov-rail-v kpi-ov-num">{fmtMoney(w.meal_revenue)}</span>
                </div>
                <div className="kpi-ov-rail-row">
                  <span className="kpi-ov-rail-k">Service fee</span>
                  <span className="kpi-ov-rail-v kpi-ov-num">{fmtMoney(w.fee_prorate)}</span>
                </div>
                <div className="kpi-ov-rail-row kpi-ov-rail-row-tot">
                  <span className="kpi-ov-rail-k">Week revenue</span>
                  <span className="kpi-ov-rail-v kpi-ov-num">{fmtMoney(w.week_revenue)}</span>
                </div>
                <div className="kpi-ov-rail-row">
                  <span className="kpi-ov-rail-k">Cost target</span>
                  <span className="kpi-ov-rail-v kpi-ov-num">{fmtMoney(w.cost_target)}</span>
                </div>
                <div className="kpi-ov-rail-row">
                  <span className="kpi-ov-rail-k">Cost landed</span>
                  <span className="kpi-ov-rail-v kpi-ov-num">
                    {isForecast ? "—" : fmtMoney(w.cost_landed)}
                  </span>
                </div>
                {!isForecast && (
                  <div className="kpi-ov-rail-vsline kpi-ov-num" data-kpi-ov="rail-vsline">
                    {fmtMoney(w.cost_landed)} of {fmtMoney(w.cost_target)}
                  </div>
                )}
                {isForecast && (
                  <div className="kpi-ov-rail-vsline kpi-ov-rail-vsline-plan kpi-ov-num" data-kpi-ov="rail-vsline">
                    plan to {fmtMoney(w.cost_target)}
                  </div>
                )}
                {showInvoiceCaveat && (
                  <div
                    className={`kpi-ov-rail-cav ${invoicesLanded ? "kpi-ov-rail-cav-ok" : "kpi-ov-rail-cav-warn"}`}
                    data-kpi-ov="rail-cav-invoice"
                  >
                    {invoicesLanded ? "Invoices landed" : "Invoices still arriving"}
                  </div>
                )}
                {showLaborPendingCaveat && (
                  <div className="kpi-ov-rail-cav kpi-ov-rail-cav-warn" data-kpi-ov="rail-cav-labor">
                    {Number(w.unapproved_hours).toFixed(2)} hrs pending approval
                  </div>
                )}
                {showLaborApprovedCaveat && (
                  <div className="kpi-ov-rail-cav kpi-ov-rail-cav-ok" data-kpi-ov="rail-cav-labor">
                    Labor approved
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
