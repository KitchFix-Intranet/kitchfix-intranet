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
// Overview Phase 4 (2026-08-31): the engine-gap-follow-up (PR #919)
// shipped `drill.purchasing.{spent_display, pct_of_revenue_display,
// target_pct_display}` on the payload; the purchasing drill now
// renders that three-field layout in parity with the labor drill,
// dropping the per-line "Food · Packaging" fallback that PR #916
// left behind. Both drills now show: Spent / Of revenue / Inside.
//
// R-5 drill wiring: the destination URL carries account + start + end
// (the Overview resolver ships explicit ISO dates on filters.range;
// labor + purchasing both read start/end natively so no shape
// translation is needed at the link boundary). Labor's URL also
// preserves ?salary=1 when the site-posture salary control is on.

import Link from "next/link";

// Build the drill destination URL. Both boards read `account` + `start`
// + `end` with identical semantics; carry them through unchanged.
// includeSalary is a labor-only flag (?salary=1 on the labor URL is
// the operator-facing name; ?include_salary=1 on the API). Overview
// site posture with the salary control on carries this into the
// labor drill so the two boards agree on which pool is counted.
function buildDrillHref(basePath, filters, opts = {}) {
  const p = new URLSearchParams();
  if (filters?.account) p.set("account", filters.account);
  if (filters?.range?.start) p.set("start", filters.range.start);
  if (filters?.range?.end) p.set("end", filters.range.end);
  if (opts.includeSalary) p.set("salary", "1");
  const qs = p.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

function fmtDateShort(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `${m}/${d}`;
}

function LaborDrill({ href, laborLever, throughDate, isSite }) {
  // R-32 site posture requirement: the drill button carries the
  // verdict - the gap-to-target beneath the actual percent. The
  // lever's variance_pct_display is the "5.4% under target" pattern
  // already computed server-side (cost axis: under=good, over=bad).
  // Corporate keeps its existing seven-column lever table, so it
  // doesn't need the tail here - render the variance ONLY on site
  // posture to keep corporate visually byte-identical.
  const variance = isSite ? (laborLever?.variance_pct_display || null) : null;
  const varClass = laborLever?.direction === "good"
    ? "kpi-ov-good"
    : laborLever?.direction === "bad" ? "kpi-ov-bad" : "kpi-ov-nb";
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
            {laborLever?.target_pct_display && <> <small>vs {laborLever.target_pct_display} target</small></>}
          </div>
          {variance && (
            <div className={`kpi-ov-dr-gap ${varClass}`} data-kpi-ov="drill-gap">{variance} target</div>
          )}
        </div>
        <div>
          <div className="kpi-ov-dr-k">Inside</div>
          <div className="kpi-ov-dr-v"><small>hours, overtime, approvals</small></div>
        </div>
      </div>
    </Link>
  );
}

function PurchasingDrill({ href, purchasingDrill, throughDate, isSite }) {
  // Renders the combined-purchasing summary shipped by the resolver
  // on payload.drill.purchasing (engine follow-up PR #919). Three
  // fields, same shape as the Labor drill:
  //   - spent_display                                (dollars)
  //   - pct_of_revenue_display + target_pct_display  (percent)
  //   - variance_pct_display + direction             (verdict, R-32)
  //   - Inside                                       (label only)
  // R-17b: the "Also tracked" band (5002.1 / 5002.5 / 5017.3) is
  // deliberately outside this measured figure - Kevin's ruling
  // 2026-08-31 on PR #919 resolver comment.
  // Corporate keeps its lever table; render the verdict tail ONLY
  // on site posture so corporate stays visually byte-identical.
  const variance = isSite ? (purchasingDrill?.variance_pct_display || null) : null;
  const varClass = purchasingDrill?.direction === "good"
    ? "kpi-ov-good"
    : purchasingDrill?.direction === "bad" ? "kpi-ov-bad" : "kpi-ov-nb";
  return (
    <Link href={href} className="kpi-ov-dr kpi-ov-dr-pur" data-kpi-ov="drill" data-kpi-ov-drill="purchasing">
      <div className="kpi-ov-dr-top">
        <span className="kpi-ov-dr-t1">Purchasing</span>
        <span className="kpi-ov-dr-go">→</span>
      </div>
      <div className="kpi-ov-dr-grid">
        <div>
          <div className="kpi-ov-dr-k">Spent</div>
          <div className="kpi-ov-dr-v kpi-ov-num">
            {purchasingDrill?.spent_display || "-"}{" "}
            {throughDate && <small>through {fmtDateShort(throughDate)}</small>}
          </div>
        </div>
        <div>
          <div className="kpi-ov-dr-k">Of revenue</div>
          <div className="kpi-ov-dr-v kpi-ov-num">
            {purchasingDrill?.pct_of_revenue_display || "-"}
            {purchasingDrill?.target_pct_display && (
              <> <small>vs {purchasingDrill.target_pct_display} target</small></>
            )}
          </div>
          {variance && (
            <div className={`kpi-ov-dr-gap ${varClass}`} data-kpi-ov="drill-gap">{variance} target</div>
          )}
        </div>
        <div>
          <div className="kpi-ov-dr-k">Inside</div>
          <div className="kpi-ov-dr-v"><small>food, packaging, vehicle</small></div>
        </div>
      </div>
    </Link>
  );
}

export default function DrillButtons({ payload, includeSalary = false }) {
  if (!payload || !payload.filters) return null;
  const filters = payload.filters;
  const laborLever = payload.levers?.find(l => l.line_code === "3100");
  const purchasingDrill = payload.drill?.purchasing || null;
  const isSite = payload.posture === "site_leader";

  return (
    <div className="kpi-ov-drills" data-kpi-ov="drills">
      <LaborDrill
        href={buildDrillHref("/kpi/labor", filters, { includeSalary })}
        laborLever={laborLever}
        throughDate={payload.sources?.labor?.through_date}
        isSite={isSite}
      />
      <PurchasingDrill
        href={buildDrillHref("/kpi/purchasing", filters)}
        purchasingDrill={purchasingDrill}
        throughDate={payload.sources?.purchases?.through_date}
        isSite={isSite}
      />
    </div>
  );
}
