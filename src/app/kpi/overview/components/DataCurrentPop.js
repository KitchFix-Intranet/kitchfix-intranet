"use client";
// src/app/kpi/overview/components/DataCurrentPop.js
//
// A2 (2026-09-01). The sources strip above the board was retired and
// its content moved into the "Data current" pill in the command bar.
// This component renders the popover body the pill opens - passed as
// the Shell's `freshnessPop` prop.
//
// Same shape as Labor + Purchasing's freshness popover (see
// src/app/kpi/purchasing/page.js:853 for the reference pattern):
// row list + trailing note in a .kpi-fresh-pop-body wrapper. Rows come
// from the payload's `sources` block (already carries per-source labels
// + period state), so the popover reads the same data the standalone
// strip did.

const STATE_COPY = {
  open:            "Open · live estimate",
  closed_awaiting: "Closed · awaiting finance",
  verified:        "Verified against P&L",
};

const NIGHTLY_NOTE =
  "All three sources sync nightly around 2 AM CT. Nothing is final until the period closes and is verified against the finance P&L.";

export default function DataCurrentPop({ sources }) {
  if (!sources) return null;
  const rows = [
    sources.labor?.label ? { k: "Labor", v: valueOnly(sources.labor.label, "Labor through") } : null,
    sources.purchases?.label ? { k: "Purchases · bills and cards", v: valueOnly(sources.purchases.label, "Purchases through") } : null,
    sources.sc_revenue?.label ? { k: "Revenue · Service Calendar", v: valueOnly(sources.sc_revenue.label, "Revenue from Service Calendar through") } : null,
  ].filter(Boolean);

  const stateCopy = sources.period_state_display
    || STATE_COPY[sources.period_state]
    || null;

  return (
    <div className="kpi-fresh-pop-body" data-kpi-ov="data-current-pop">
      {rows.map((r, i) => (
        <div key={i} className="kpi-fresh-pop-row">
          <span>{r.k}</span>
          <b>{r.v}</b>
        </div>
      ))}
      {stateCopy && (
        <>
          <div className="kpi-fresh-pop-sep" aria-hidden="true" />
          <div className="kpi-fresh-pop-row">
            <span>Period state</span>
            <b>{stateCopy}</b>
          </div>
        </>
      )}
      <div className="kpi-fresh-pop-sep" aria-hidden="true" />
      <div className="kpi-fresh-pop-contract">{NIGHTLY_NOTE}</div>
    </div>
  );
}

// The resolver ships "Labor through Sun 08/30" as a single label. In
// the popover the row already carries its own "Labor" key, so we strip
// the redundant prefix for the value cell. If the prefix isn't present
// (e.g. "Labor not yet reporting"), pass the whole string through.
function valueOnly(label, prefix) {
  if (typeof label !== "string") return label;
  if (label.startsWith(prefix + " ")) return label.slice(prefix.length + 1);
  return label;
}
