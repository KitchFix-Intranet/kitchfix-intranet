"use client";
// src/app/kpi/overview/components/DrillButtons.js
//
// Element 7. Two drill buttons - Labor and Purchasing. Each carries
// the current account + the current range (R-5) into the destination.
//
// The scope §5.4 anatomy 7 says: "spent through date, % of revenue vs
// target, what's inside." Kevin's rule: "The client renders. It never
// computes a dollar, a percent, or a direction word. If the board
// needs a number the payload does not carry, that is an engine gap -
// report it, do not compute it locally."
//
// The payload ships `levers[]` with per-line pct-of-revenue for 3100
// (labor) directly. For purchasing, the drill needs COMBINED
// purchasing pct-of-revenue (3200+3400+3500 / revenue). The payload
// does NOT carry that combined figure today - it ships per-line pcts
// on levers[], and the COGS card's aggregate pct-of-revenue is
// labor+food+packaging+vehicle combined, not purchasing-only.
//
// **Engine gap for Phase 4:** add a `drill.purchasing` block on the
// payload with { spent_display, pct_of_revenue_display, target_pct_
// display } - the same shape as the labor lever. Until then this card
// shows the payload's per-line breakdown as the "Inside" description
// and omits the summed pct field.
//
// The Labor drill DOES have its full metrics on `levers[]` line_code
// 3100 - hero display, actual_pct, target_pct - so that card renders
// with the full three-field layout.

import Link from "next/link";

function buildDrillHref(basePath, filters) {
  const p = new URLSearchParams();
  if (filters?.account) p.set("account", filters.account);
  if (filters?.range?.start) p.set("start", filters.range.start);
  if (filters?.range?.end) p.set("end", filters.range.end);
  const qs = p.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function fmtDateShort(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}`;
}

function LaborDrill({ href, laborLever, throughDate }) {
  return (
    <Link href={href} className="kpi-ov-dr kpi-ov-dr-lab" data-kpi-ov="drill" data-kpi-ov-drill="labor">
      <div className="kpi-ov-dr-top">
        <span className="kpi-ov-dr-t1">Labor</span>
        <span className="kpi-ov-dr-go">→</span>
      </div>
      <div className="kpi-ov-dr-grid">
        <div>
          <div className="kpi-ov-dr-k">Spent</div>
          <div className="kpi-ov-dr-v kpi-ov-num">
            {laborLever?.actual_display || "-"}{" "}
            {throughDate && <small>through {fmtDateShort(throughDate)}</small>}
          </div>
        </div>
        <div>
          <div className="kpi-ov-dr-k">Of revenue</div>
          <div className="kpi-ov-dr-v kpi-ov-num">
            {laborLever?.actual_pct_display || "-"}
            {laborLever?.target_pct_display && <> <small>target {laborLever.target_pct_display}</small></>}
          </div>
        </div>
        <div>
          <div className="kpi-ov-dr-k">Inside</div>
          <div className="kpi-ov-dr-v"><small>hours, overtime, approvals</small></div>
        </div>
      </div>
    </Link>
  );
}

function PurchasingDrill({ href, purchasingLevers, throughDate }) {
  // Render per-line breakdown so the operator sees what the drill
  // covers WITHOUT the client computing a combined figure. When the
  // engine gap closes, wire the summed spent + pct fields into the
  // grid the same shape as the Labor drill.
  return (
    <Link href={href} className="kpi-ov-dr kpi-ov-dr-pur" data-kpi-ov="drill" data-kpi-ov-drill="purchasing">
      <div className="kpi-ov-dr-top">
        <span className="kpi-ov-dr-t1">Purchasing</span>
        <span className="kpi-ov-dr-go">→</span>
      </div>
      <div className="kpi-ov-dr-grid">
        <div>
          <div className="kpi-ov-dr-k">Food</div>
          <div className="kpi-ov-dr-v kpi-ov-num">
            {purchasingLevers.find(l => l.line_code === "3200")?.actual_display || "-"}
          </div>
        </div>
        <div>
          <div className="kpi-ov-dr-k">Packaging</div>
          <div className="kpi-ov-dr-v kpi-ov-num">
            {purchasingLevers.find(l => l.line_code === "3400")?.actual_display || "-"}
          </div>
        </div>
        <div>
          <div className="kpi-ov-dr-k">Inside</div>
          <div className="kpi-ov-dr-v">
            <small>
              bills, cards, every purchase
              {throughDate && <> · through {fmtDateShort(throughDate)}</>}
            </small>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default function DrillButtons({ payload }) {
  if (!payload || !payload.filters) return null;
  const filters = payload.filters;
  const laborLever = payload.levers?.find(l => l.line_code === "3100");
  const purchasingLevers = payload.levers?.filter(l => ["3200", "3400", "3500"].includes(l.line_code)) || [];

  return (
    <div className="kpi-ov-drills" data-kpi-ov="drills">
      <LaborDrill
        href={buildDrillHref("/kpi/labor", filters)}
        laborLever={laborLever}
        throughDate={payload.sources?.labor?.through_date}
      />
      <PurchasingDrill
        href={buildDrillHref("/kpi/purchasing", filters)}
        purchasingLevers={purchasingLevers}
        throughDate={payload.sources?.purchases?.through_date}
      />
    </div>
  );
}
