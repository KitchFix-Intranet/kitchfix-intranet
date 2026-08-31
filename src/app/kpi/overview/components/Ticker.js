"use client";
// src/app/kpi/overview/components/Ticker.js
//
// Element 3. Rules-based, deterministic. Every claim traces to a
// payload field per §5.7. The RESOLVER computes state, biggest lever,
// offsetting, notes. The client only renders.

const STATE_CLASS = {
  ahead: "kpi-ov-ticker-ahead",
  on_track_above: "kpi-ov-ticker-ontrack",
  on_track_below: "kpi-ov-ticker-ontrack",
  behind: "kpi-ov-ticker-behind",
  critical: "kpi-ov-ticker-critical",
};

function fmtPct(n) {
  if (n == null || Number.isNaN(n)) return null;
  return Number(n).toFixed(1) + "%";
}

// Render the "0.4% ahead" / "1.7% under" tail on the ticker. Server
// vocabulary is preserved (ahead/behind for margin, under/over for
// cost). The direction is derived from the delta sign, not computed.
function directionWord(deltaPct, axis) {
  if (deltaPct == null) return "";
  const d = Number(deltaPct);
  const abs = Math.abs(d).toFixed(1);
  if (axis === "margin") return `${abs}% ${d >= 0 ? "ahead" : "behind"}`;
  if (axis === "cost")   return `${abs}% ${d <= 0 ? "under"  : "over"}`;
  return `${abs}%`;
}

function directionClass(deltaPct, axis) {
  if (deltaPct == null) return "kpi-ov-nb";
  const d = Number(deltaPct);
  if (axis === "margin") return d >= 0 ? "kpi-ov-good" : "kpi-ov-bad";
  if (axis === "cost")   return d <= 0 ? "kpi-ov-good" : "kpi-ov-bad";
  return "kpi-ov-nb";
}

export default function Ticker({ ticker }) {
  if (!ticker || !ticker.state) return null;
  const stateClass = STATE_CLASS[ticker.state] || "kpi-ov-ticker-ontrack";

  return (
    <div
      className={`kpi-ov-ticker ${stateClass}`}
      data-kpi-ov="ticker"
      data-kpi-ov-state={ticker.state}
    >
      <span className="kpi-ov-ticker-st" data-kpi-ov="ticker-state">
        {ticker.state_copy}
      </span>

      {/* Gross margin segment - always present when gm % is available */}
      {ticker.gm_pct_actual != null && ticker.gm_pct_target != null && (
        <span className="kpi-ov-ticker-tk" data-kpi-ov="ticker-gm">
          <span className="kpi-ov-ticker-tk-k">Gross margin</span>
          <span className="kpi-ov-ticker-tk-v kpi-ov-num">
            {fmtPct(ticker.gm_pct_actual)}
            <span className="kpi-ov-nb" style={{ fontWeight: 600, marginLeft: 6 }}>
              vs {fmtPct(ticker.gm_pct_target)} target
            </span>
            {ticker.gm_delta_pct != null && (
              <em className={directionClass(ticker.gm_delta_pct, "margin")}>
                {directionWord(ticker.gm_delta_pct, "margin")}
              </em>
            )}
          </span>
        </span>
      )}

      {/* Biggest lever */}
      {ticker.biggest_lever && (
        <span className="kpi-ov-ticker-tk" data-kpi-ov="ticker-biggest">
          <span className="kpi-ov-ticker-tk-k">Biggest lever</span>
          <span className="kpi-ov-ticker-tk-v">
            {ticker.biggest_lever.label}
            <em className={directionClass(ticker.biggest_lever.dev_pct, "cost")}>
              {directionWord(ticker.biggest_lever.dev_pct, "cost")}
            </em>
          </span>
        </span>
      )}

      {/* Offsetting */}
      {ticker.offsetting_lever && (
        <span className="kpi-ov-ticker-tk" data-kpi-ov="ticker-offsetting">
          <span className="kpi-ov-ticker-tk-k">Offsetting</span>
          <span className="kpi-ov-ticker-tk-v">
            {ticker.offsetting_lever.label}
            <em className={directionClass(ticker.offsetting_lever.dev_pct, "cost")}>
              {directionWord(ticker.offsetting_lever.dev_pct, "cost")}
            </em>
          </span>
        </span>
      )}

      {/* Through / closed segment */}
      {ticker.through_segment && (
        <span className="kpi-ov-ticker-tk" data-kpi-ov="ticker-through">
          <span className="kpi-ov-ticker-tk-k">{ticker.through_segment.label}</span>
          <span className="kpi-ov-ticker-tk-v">{ticker.through_segment.value}</span>
        </span>
      )}

      {/* Amber notes (fee, pass_through, planned, sc_test_data) */}
      {(ticker.notes || []).map((note, i) => (
        <span
          key={`${note.kind}-${i}`}
          className="kpi-ov-ticker-tk kpi-ov-ticker-tk-note"
          data-kpi-ov="ticker-note"
          data-kpi-ov-note-kind={note.kind}
        >
          <span className="kpi-ov-ticker-tk-k">{note.label}</span>
          <span className="kpi-ov-ticker-tk-v">{note.value}</span>
        </span>
      ))}
    </div>
  );
}
