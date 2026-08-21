"use client";
// src/app/kpi/purchasing/components/VendorBreakdown.js
//
// Row 6b of the at-risk board (spec §6.5).
//
// One card, four columns: Vendor · Where it landed · Spend · vs prior.
//
// Vendor names land with G6 (§9.7). Until then, the route ships bills
// grouped by (account_key, gl_line_code, week_start) via v_purchasing_by_site_week
// and coverage.lines_uncoded - it does NOT ship a per-vendor rollup
// in PR 1's response shape. This PR renders an honest placeholder
// stating vendor names will populate with G6 rather than showing a
// fabricated list. The card structure and header row are wired so PR
// 3+ can drop the real rows into `rows` without CSS churn.
//
// (Same approach the v22 render uses in production - "By vendor" was
// an honest placeholder until G6.)

export function VendorBreakdown({
  account,
  rows,           // [{ name, account_key?, lines, amount, split, movement }] - null until vendor sync lands
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
          {rows.map((r, i) => (
            <div key={`${r.name || "?"}-${i}`} className="kpi-p-vbrow">
              <span className="kpi-p-k">
                {r.name || "—"}
                <small>
                  {r.account_key ? `${r.account_key} · ` : ""}
                  {r.lines || 0} lines
                </small>
              </span>
              <span aria-hidden="true" />
              <span className="kpi-p-v num">{r.amount}</span>
              <span
                className={`kpi-p-ch ${Number(r.movement || 0) > 0 ? "r" : "g"}`}
              >
                {Number(r.movement || 0) > 0 ? "▲ " : "▼ "}
                {Math.abs(Number(r.movement || 0) * 100).toFixed(0)}%
              </span>
            </div>
          ))}
          <div className="kpi-p-vblegend">
            <span><i style={{ background: "var(--kpi-p-food)" }} />Food</span>
            <span><i style={{ background: "var(--kpi-p-pkg)" }} />Packaging</span>
            <span><i style={{ background: "var(--kpi-p-veh)" }} />Vehicle</span>
            <span><i style={{ background: "var(--n-300)" }} />Other</span>
          </div>
        </div>
      ) : (
        <div className="kpi-p-emptybucket">
          Vendor names land with the bill.com vendor sync (G6). Amounts
          are correct today; the label per row arrives when the sync
          runs.
        </div>
      )}
    </div>
  );
}
