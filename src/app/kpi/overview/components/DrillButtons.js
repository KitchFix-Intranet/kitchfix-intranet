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

// Compact inline drill for the site-leader posture (locked render).
// Left column: title, then "$spent · what's inside" sub-line.
// Right column (right-aligned): actual percent, then gap-to-target
// direction word beneath. Then the → arrow. Matches the locked
// render's .dr layout at docs/renders/overview-site-leader-LOCKED.html.
function SiteDrillInline({ href, drillKind, title, spend, actualPct, variance, direction, insideText, billedBack = false, dataAttrs }) {
  const varClass = direction === "good"
    ? "kpi-ov-good"
    : direction === "bad" ? "kpi-ov-bad" : "kpi-ov-nb";
  return (
    <Link
      href={href}
      className={`kpi-ov-dr kpi-ov-dr-inline kpi-ov-dr-${drillKind}`}
      data-kpi-ov="drill"
      data-kpi-ov-drill={drillKind}
      data-kpi-ov-billed-back={billedBack ? "1" : undefined}
      {...(dataAttrs || {})}
    >
      <div className="kpi-ov-dr-inline-left">
        <div className="kpi-ov-dr-inline-t1">{title}</div>
        <div className="kpi-ov-dr-inline-t2">
          <span className="kpi-ov-num">{spend || "-"}</span> · {insideText}
        </div>
      </div>
      <div className="kpi-ov-dr-inline-right">
        {billedBack ? (
          /* E16 (2026-09-01): pass-through drill button carries a
             billed-back tag and no percentage. Rendering "0.1% over
             target" on a line the client pays for was the specific
             defect Kevin flagged. */
          <span className="kpi-ov-chip-fixed" data-kpi-ov="drill-billed-back">billed back</span>
        ) : (
          <>
            <div className="kpi-ov-dr-inline-p kpi-ov-num">{actualPct || "-"}</div>
            {variance && (
              <div className={`kpi-ov-dr-inline-g ${varClass}`} data-kpi-ov="drill-gap">
                {variance} target
              </div>
            )}
          </>
        )}
      </div>
      <span className="kpi-ov-dr-go">→</span>
    </Link>
  );
}

// R-40: one drill layout everywhere. The verdict tail (gap-to-target)
// is always rendered - the lever's variance_pct_display is the "5.4%
// under target" pattern already computed server-side (cost axis:
// under=good, over=bad).
function LaborDrill({ href, laborLever }) {
  return (
    <SiteDrillInline
      href={href}
      drillKind="labor"
      title="Labor"
      spend={laborLever?.actual_display}
      actualPct={laborLever?.actual_pct_display}
      variance={laborLever?.variance_pct_display || null}
      direction={laborLever?.direction}
      insideText="hours, overtime, approvals"
    />
  );
}

// R-40: one drill layout everywhere. Payload.drill.purchasing already
// carries spent/pct/target/variance server-side (engine follow-up
// PR #919 + R-32 variance additions).
function PurchasingDrill({ href, purchasingDrill }) {
  return (
    <SiteDrillInline
      href={href}
      drillKind="purchasing"
      title="Purchasing"
      spend={purchasingDrill?.spent_display}
      actualPct={purchasingDrill?.pct_of_revenue_display}
      variance={purchasingDrill?.variance_pct_display || null}
      direction={purchasingDrill?.direction}
      insideText="food, packaging, every purchase"
      billedBack={purchasingDrill?.billed_back === true}
    />
  );
}

export default function DrillButtons({ payload, includeSalary = false }) {
  if (!payload || !payload.filters) return null;
  const filters = payload.filters;
  const laborLever = payload.levers?.find(l => l.line_code === "3100");
  const purchasingDrill = payload.drill?.purchasing || null;

  return (
    <div className="kpi-ov-drills" data-kpi-ov="drills">
      <LaborDrill
        href={buildDrillHref("/kpi/labor", filters, { includeSalary })}
        laborLever={laborLever}
      />
      <PurchasingDrill
        href={buildDrillHref("/kpi/purchasing", filters)}
        purchasingDrill={purchasingDrill}
      />
    </div>
  );
}
