"use client";
// src/app/kpi/overview/components/WhatIsLeft.js
//
// Element 4b (R-34, 2026-09-01). "What is left" - the one operator
// number that converts to a decision today. Open period only, site
// posture only, single-period range only.
//
// Payload contract: renders when `payload.what_is_left` is a non-null
// object. Resolver returns null on corporate posture, on closed
// periods, and on FYTD (applying an open period's remaining days to
// a year is wrong arithmetic - explicit R-34 rule). Client only needs
// to check truthiness; the resolver has already gated.
//
// Three cells, same shape each, number first. All formatted strings
// arrive on the payload (§9B: server computes every dollar). No
// progress bar - it encoded two numbers stated in words directly
// above it (R-32 cut list).

import HelpPop from "@/app/kpi/labor/components/HelpPop";

export default function WhatIsLeft({ whatIsLeft }) {
  if (!whatIsLeft) return null;
  const { cell_1, cell_2, cell_3 } = whatIsLeft;
  if (!cell_1 || !cell_2 || !cell_3) return null;

  return (
    <div
      className="kpi-ov-pace"
      data-kpi-ov="what-is-left"
      data-kpi-ov-pace={whatIsLeft.pace || null}
    >
      <div className="kpi-ov-pace-top">
        <span className="kpi-ov-eb">What is left</span>
        <HelpPop
          id="overview-what-is-left"
          title="What is left"
          body={
            <p>
              What remains of the cost-of-goods budget for this period, and what
              that leaves you a day. This is the number that converts to a decision
              today.
            </p>
          }
        />
      </div>
      <div className="kpi-ov-pace-grid">
        <div className="kpi-ov-pace-cell" data-kpi-ov="what-is-left-cell-1">
          <div className="kpi-ov-pace-k">{cell_1.label}</div>
          <div className="kpi-ov-pace-v kpi-ov-num">{cell_1.value_display}</div>
          <div className="kpi-ov-pace-n">{cell_1.sub_line}</div>
        </div>
        <div className="kpi-ov-pace-cell" data-kpi-ov="what-is-left-cell-2">
          <div className="kpi-ov-pace-k">{cell_2.label}</div>
          <div className="kpi-ov-pace-v kpi-ov-num">
            {cell_2.value_display}
            {cell_2.value_suffix && (
              <span className="kpi-ov-pace-per"> {cell_2.value_suffix}</span>
            )}
          </div>
          {cell_2.sub_line && <div className="kpi-ov-pace-n">{cell_2.sub_line}</div>}
        </div>
        <div className="kpi-ov-pace-cell" data-kpi-ov="what-is-left-cell-3">
          <div className="kpi-ov-pace-k">{cell_3.label}</div>
          <div
            className={
              "kpi-ov-pace-v kpi-ov-num " +
              (cell_3.direction === "good"
                ? "kpi-ov-good"
                : cell_3.direction === "bad"
                  ? "kpi-ov-bad"
                  : "")
            }
          >
            {cell_3.value_display}
          </div>
          {(cell_3.sub_line_prefix || cell_3.verdict) && (
            <div className="kpi-ov-pace-n">
              {cell_3.sub_line_prefix}
              {cell_3.sub_line_prefix && cell_3.verdict ? " · " : ""}
              {cell_3.verdict && (
                <b
                  className={
                    cell_3.direction === "good"
                      ? "kpi-ov-good"
                      : cell_3.direction === "bad"
                        ? "kpi-ov-bad"
                        : ""
                  }
                >
                  {cell_3.verdict}
                </b>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
