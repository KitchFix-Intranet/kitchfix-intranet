"use client";
// src/app/kpi/labor/components/Sentence.js
//
// V8-6/V8-7 sentence row: verdict pill + plain-language sentence + ? help.
// The verdict class comes from board.verdict (single source of truth per
// V8-7); no local threshold decisions.

import { useEffect, useRef, useState } from "react";
import { buildSentence, verdictDisplay } from "../lib/boardCopy.js";
import { fmt$ } from "../lib/formatting.js";

function Help({ id, children }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <span className="kpi-help-anchor" ref={rootRef}>
      <button
        type="button"
        className="kpi-help"
        aria-haspopup="dialog"
        aria-expanded={open ? "true" : "false"}
        aria-label="Show explanation"
        onClick={() => setOpen(o => !o)}
      >?</button>
      {open && (
        <div className="kpi-help-pop" id={id} role="dialog">
          {children}
        </div>
      )}
    </span>
  );
}

export function Sentence({ board, account, rangeLabel }) {
  const s = buildSentence({ board, account, rangeLabel });
  const vd = board?.applies ? verdictDisplay(board?.verdict) : null;
  return (
    <div className="kpi-sentence">
      {vd && (
        <span className={`kpi-vpill kpi-vpill-${vd.cls}`}>
          <span className="kpi-vpill-dot" aria-hidden="true" />
          {vd.label}
        </span>
      )}
      <span className="kpi-sentence-body">
        {s.pre}
        {s.verdictBold && <b>{s.verdictBold}</b>}
        {s.mid}
        {s.fractionBold && <b>{s.fractionBold}</b>}
        {s.post}
      </span>
      <span className="kpi-sentence-spacer" aria-hidden="true" />
      {s.hasVerdict && board && (
        <Help id="kpi-verdict-help">
          <h5>HOW THE VERDICT IS DECIDED</h5>
          Spend is compared with time elapsed in the period.
          <div className="kpi-help-calc">
            <b>On track</b> within ±2% · <b>Watch</b> 2-5% ahead · <b>Over</b> more than 5% ahead
          </div>
          Right now: <b>{board.pace_pct != null ? `${board.pace_pct}%` : "—"}</b> of budget spent
          at <b>{board.elapsed_pct != null ? `${board.elapsed_pct}%` : "—"}</b> of the period.
          {board.variance != null && (
            <>
              {" "}Variance from pace: <b>{board.variance < 0 ? "-" : "+"}{fmt$(Math.abs(board.variance))}</b>.
            </>
          )}
        </Help>
      )}
    </div>
  );
}
