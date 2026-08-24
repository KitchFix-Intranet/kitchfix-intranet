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

function SplitBar({ split, spend }) {
  const total = Number(spend || 0);
  if (!(total > 0)) return null;
  const segments = [
    { key: "food",      value: Number(split?.food || 0),      color: "var(--kpi-p-food)" },
    { key: "packaging", value: Number(split?.packaging || 0), color: "var(--kpi-p-pkg)"  },
    { key: "vehicle",   value: Number(split?.vehicle || 0),   color: "var(--kpi-p-veh)"  },
    { key: "other",     value: Number(split?.other || 0),     color: "var(--n-300)"      },
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
  isAggregate,
}) {
  const hasRows = Array.isArray(rows) && rows.length > 0;
  return (
    <div className="kpi-p-card" data-card="vendor-breakdown">
      <div className="kpi-p-lh">
        <span className="kpi-p-cardtitle">Vendor breakdown</span>
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
          {rows.map((r, i) => {
            const prior = Number(r.prior_spend || 0);
            const cur = Number(r.spend || 0);
            const movementPct = prior > 0
              ? ((cur - prior) / prior)
              : null;
            const isNewSpender = prior === 0 && cur > 0;
            const displayName = r.resolved
              ? (r.name || "—")
              : (r.vendor_id ? `Unresolved vendor` : "Unresolved");
            return (
              <div key={`${r.vendor_id || "u"}-${i}`} className="kpi-p-vbrow">
                <span className="kpi-p-k">
                  {displayName}
                  <small>
                    {r.line_count || 0} lines
                    {!r.resolved ? " · id not in vendor snapshot" : ""}
                  </small>
                </span>
                <SplitBar split={r.gl_split} spend={r.spend} />
                <span className="kpi-p-v num">{fmt$(r.spend)}</span>
                {isNewSpender ? (
                  <span className="kpi-p-ch" style={{ color: "var(--n-500)" }}>new</span>
                ) : movementPct == null ? (
                  <span className="kpi-p-ch" style={{ color: "var(--n-500)" }}>—</span>
                ) : (
                  <span className={`kpi-p-ch ${movementPct > 0 ? "r" : "g"}`}>
                    {movementPct > 0 ? "▲ " : "▼ "}
                    {Math.abs(movementPct * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            );
          })}
          <div className="kpi-p-vblegend">
            <span><i style={{ background: "var(--kpi-p-food)" }} />Food</span>
            <span><i style={{ background: "var(--kpi-p-pkg)" }} />Packaging</span>
            <span><i style={{ background: "var(--kpi-p-veh)" }} />Vehicle</span>
            <span><i style={{ background: "var(--n-300)" }} />Other</span>
          </div>
          {totalCount != null && (
            <div style={{
              padding: "var(--kpi-sp-2) 0 0",
              textAlign: "right",
              fontSize: "var(--kpi-t-meta)",
              color: "var(--n-500)",
              fontWeight: 500,
            }}>
              {totalCount > (cap || 0)
                ? `Showing ${cap} of ${totalCount} vendors · ${fmt$(totalAmount)} total`
                : `${totalCount} vendor${totalCount === 1 ? "" : "s"} · ${fmt$(totalAmount)} total`}
              {unresolvedCount > 0 && (
                <> · <span style={{ color: "var(--amber-600)" }}>{unresolvedCount} unresolved id{unresolvedCount === 1 ? "" : "s"}</span></>
              )}
              {fragmentation && isAggregate && fragmentation.distinct_names > fragmentation.suppliers_if_suffix_stripped && (
                <div style={{ marginTop: 2, fontSize: "var(--kpi-t-label)", color: "var(--n-500)" }}>
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
