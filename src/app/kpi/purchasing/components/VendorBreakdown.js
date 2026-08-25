"use client";
// src/app/kpi/purchasing/components/VendorBreakdown.js
//
// Row 6b of the at-risk board (spec §6.5).
//
// One card, four columns: Vendor · Where it landed · Spend · vs prior.
//
// PR-2 R6 Part B - the route now ships `vendors` (per-vendor rollup,
// billcom-only, capped at 25 by spend desc). Each row carries a
// name (via billcom_ref_vendors), spend, line_count, gl_split
// {food, packaging, vehicle, other}, and prior_spend for the same-
// length window preceding the request range.
//
// UN-ROLLED-UP by design (Kevin ruling 2026-08-24). Bill.com carries
// per-site vendor records (`Sysco JUP` / `Sysco TBJ` / `Sysco TBR`)
// so a supplier fragments across N rows at aggregate scope. The
// route reports fragmentation in `vendors.fragmentation` (canonical
// name + variants) but this component does NOT collapse. Rendering
// the un-rolled-up truth is the correct default; a future roll-up
// is an owner decision, not a client-side heuristic.

import { fmt$ } from "../lib/board";
// PR 2 R8 Gap 1 - shared HelpPop portal-renders at document.body so it
// escapes the card's stacking context.
import HelpPop from "@/app/kpi/labor/components/HelpPop.js";
import { VENDOR_BODY } from "./PurchasingHelpPops";

function SplitBar({ split, spend }) {
  const total = Number(spend || 0);
  if (!(total > 0)) return null;
  const segments = [
    { key: "food",         value: Number(split?.food || 0),         color: "var(--kpi-p-food)" },
    { key: "packaging",    value: Number(split?.packaging || 0),    color: "var(--kpi-p-pkg)"  },
    { key: "vehicle",      value: Number(split?.vehicle || 0),      color: "var(--kpi-p-veh)"  },
    // PR 2 R9 P2-3 - reimbursable as its own segment. Prior state
    // dumped 13xx into "other" (grey), which at pass-through
    // accounts (STL - FL / STL - MO / CIN - OH) coloured every
    // vendor row's WHERE IT LANDED column all-grey - a dead column.
    { key: "reimbursable", value: Number(split?.reimbursable || 0), color: "var(--kpi-p-veh)"  },
    { key: "other",        value: Number(split?.other || 0),        color: "var(--n-300)"      },
  ].filter(s => s.value > 0);
  return (
    <span
      className="kpi-p-vbsplit"
      style={{
        display: "inline-flex",
        width: "100%",
        height: 8,
        borderRadius: 2,
        overflow: "hidden",
        background: "var(--n-100)",
      }}
      aria-hidden="true"
    >
      {segments.map(s => (
        <span
          key={s.key}
          title={`${s.key}: ${fmt$(s.value)}`}
          style={{
            width: `${(s.value / total) * 100}%`,
            background: s.color,
            display: "inline-block",
          }}
        />
      ))}
    </span>
  );
}

export function VendorBreakdown({
  account,
  rows,               // [{ name, vendor_id?, resolved, spend, line_count, gl_split{...}, prior_spend }]
  totalCount,
  totalAmount,
  cap,
  unresolvedCount,    // count of unresolved billcom vendor_ids (never invented)
  fragmentation,      // { distinct_names, suppliers_if_suffix_stripped, collapsed[] }
  // PR 2 R7 Fix 2 - the route's answer to "did the prior window contain
  // any billcom data at all". When false (FYTD on FY2026, our first
  // year), no vendor has a prior period to compare against and the
  // column reads `no prior period` for every row - never a false `new`.
  // When true, the per-row logic still fires ("new" when prior=0 on that
  // specific vendor, "▲/▼ %" otherwise).
  priorHasData,       // boolean | undefined
  priorRange,         // { start, end } | undefined - echoed for auditability
  isAggregate,
  // PR 2 R9 P1-1 - LIKE-FOR-LIKE mid-period comparison.
  //
  // When the request range is a SINGLE IN-PROGRESS period, `prior_spend`
  // covers a FULL prior period. Comparing part-current vs whole-prior
  // structurally guarantees a large negative percentage on every
  // vendor - at STL - FL P9 (57% elapsed) every row read ▼80..97%.
  // Scaling `prior_spend` by the elapsed fraction restores a meaningful
  // comparison (approximation: assumes uniform daily spend in the prior
  // period, which is not always true - a big-day-near-period-end vendor
  // can still shift the number by a few points, but the mid-period
  // catastrophic-decrease artefact is gone).
  //
  // NULL when the range is closed, multi-period, or not a period at all
  // - the fallback in every non-mid-period case is the unscaled prior,
  // which is already like-for-like. Never applied to FYTD or LAST 4 wk.
  midPeriodElapsedFrac,  // number | null
}) {
  const hasRows = Array.isArray(rows) && rows.length > 0;
  return (
    <div className="kpi-p-card" data-card="vendor-breakdown">
      <div className="kpi-p-lh">
        <span className="kpi-p-cardtitle">
          Vendor breakdown
          {" "}<HelpPop id="qPurchVendor" title="Vendor breakdown" body={VENDOR_BODY} />
        </span>
        <span className="kpi-p-cardsub">where each vendor's spend landed</span>
      </div>

      {hasRows ? (
        <div className="kpi-p-vb">
          <div className="kpi-p-vbhead">
            <span>Vendor</span>
            <span>Where it landed</span>
            <span>Spend</span>
            <span>vs prior</span>
          </div>
          {/* PR-2 R11 item 1 - bounded scroll region matching the
              ledger cards' 220px max-height (purchasing.css:592).
              Prior state let the card grow to 1500+px at ALL FYTD
              (25 rows) while Equipment beside it capped at ~440px.
              Head, legend and footer stay OUTSIDE this scroll so
              the honest "Showing N of M · $X total" line always
              remains visible below the fold. */}
          <div className="kpi-p-vbrows">
          {rows.map((r, i) => {
            const priorRaw = Number(r.prior_spend || 0);
            const cur = Number(r.spend || 0);
            // PR 2 R9 P1-1 - like-for-like scaling. When we're mid a
            // single in-progress period, scale prior_spend to the same
            // fraction of the prior period that has elapsed here.
            // Otherwise, prior stays raw (already a full-vs-full compare
            // for FYTD, LAST 4 wk, and closed single-periods).
            const scale = Number(midPeriodElapsedFrac);
            const prior = Number.isFinite(scale) && scale > 0 && scale < 1
              ? priorRaw * scale
              : priorRaw;
            const movementPct = prior > 0
              ? ((cur - prior) / prior)
              : null;
            // PR 2 R7 Fix 2 - `isNewSpender` is a claim, and it MUST be
            // true only when a prior window actually exists to compare
            // against. `priorHasData` gates the claim at the block level;
            // when the compared window has NO billcom data (FYTD on the
            // first year of data), no vendor is "new" - the column reads
            // `no prior period` for every row instead.
            const isNewSpender = priorHasData === true && priorRaw === 0 && cur > 0;
            const displayName = r.resolved
              ? (r.name || "—")
              : (r.vendor_id ? `Unresolved vendor` : "Unresolved");
            const nameIsNil = r.resolved && !r.name;
            return (
              <div key={`${r.vendor_id || "u"}-${i}`} className="kpi-p-vbrow">
                <span className={`kpi-p-k${nameIsNil ? " kpi-p-nil" : ""}`}>
                  {displayName}
                  <small>
                    {r.line_count || 0} lines
                    {!r.resolved ? " · id not in vendor snapshot" : ""}
                  </small>
                </span>
                <SplitBar split={r.gl_split} spend={r.spend} />
                <span className="kpi-p-v num">{fmt$(r.spend)}</span>
                {priorHasData === false ? (
                  /* PR 2 R7 Fix 2 - no prior window has data; render
                     `no prior` on every row (never a false `new`). */
                  <span
                    className="kpi-p-ch kpi-p-nil"
                    style={{ color: "var(--n-600)", fontWeight: 600 }}
                    title="no prior period on record"
                  >
                    no prior
                  </span>
                ) : isNewSpender ? (
                  <span className="kpi-p-ch" style={{ color: "var(--n-600)" }}>new</span>
                ) : movementPct == null ? (
                  <span className="kpi-p-ch kpi-p-nil" style={{ color: "var(--n-600)" }}>—</span>
                ) : Math.abs(movementPct) < 0.005 ? (
                  /* PR 2 R9 P1-1 - "no change" is NEUTRAL, not an
                     improvement. Rounds movements smaller than half a
                     percent to `no change` and renders in the muted
                     tone; no arrow, no green/red. Prior code showed
                     `▼ 0%` in green for exact zeros. */
                  <span className="kpi-p-ch kpi-p-nil" style={{ color: "var(--n-600)", fontWeight: 600 }}>no change</span>
                ) : (
                  <span className={`kpi-p-ch ${movementPct > 0 ? "r" : "g"}`}>
                    {movementPct > 0 ? "▲ " : "▼ "}
                    {Math.abs(movementPct * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            );
          })}
          </div>
          <div className="kpi-p-vblegend">
            <span><i style={{ background: "var(--kpi-p-food)" }} />Food</span>
            <span><i style={{ background: "var(--kpi-p-pkg)" }} />Packaging</span>
            <span><i style={{ background: "var(--kpi-p-veh)" }} />Vehicle · Reimbursable</span>
            <span><i style={{ background: "var(--n-300)" }} />Other</span>
          </div>
          {totalCount != null && (
            <div style={{
              padding: "var(--kpi-sp-2) 0 0",
              textAlign: "right",
              fontSize: "var(--kpi-t-meta)",
              color: "var(--n-600)",
              fontWeight: 500,
            }}>
              {totalCount > (cap || 0)
                ? `Showing ${cap} of ${totalCount} vendors · ${fmt$(totalAmount)} total`
                : `${totalCount} vendor${totalCount === 1 ? "" : "s"} · ${fmt$(totalAmount)} total`}
              {unresolvedCount > 0 && (
                <> · <span style={{ color: "var(--amber-600)" }}>{unresolvedCount} unresolved id{unresolvedCount === 1 ? "" : "s"}</span></>
              )}
              {fragmentation && isAggregate && fragmentation.distinct_names > fragmentation.suppliers_if_suffix_stripped && (
                <div style={{ marginTop: 2, fontSize: "var(--kpi-t-label)", color: "var(--n-600)" }}>
                  Fragmented: {fragmentation.distinct_names} names would collapse
                  to {fragmentation.suppliers_if_suffix_stripped} suppliers if the
                  site suffix were stripped. Un-rolled-up here by design.
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="kpi-p-emptybucket">
          No vendor spend in this range.
        </div>
      )}
    </div>
  );
}
