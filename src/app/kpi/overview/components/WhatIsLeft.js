"use client";
// src/app/kpi/overview/components/WhatIsLeft.js
//
// R-34, redesigned for PR 2 (2026-09-01). "What is left" - the one
// operator number that converts to a decision today.
//
// PR 2 changes (B8 + B9): the three-cell strip becomes two cards
// side-by-side. "Which is" retired - it was left ÷ days, a restatement
// of the card beside it wearing a metric's clothes. The per-day figure
// moves onto Left to spend where it belongs.
//
// Both cards use the .split layout (headline left, two labelled stats
// right-aligned), sharing the eyebrow / ? / pill / hero structure of
// the three cards above so the type scale is identical.
//
// Payload contract: renders when `payload.what_is_left` is a non-null
// object carrying `left_card` and `used_card`. Resolver returns null
// on portfolio scope, on closed periods, and on FYTD (applying an
// open period's remaining days to a year is wrong arithmetic).

import HelpPop from "@/app/kpi/labor/components/HelpPop";

const PILL_TONE = {
  good: "kpi-ov-pill-good",
  bad: "kpi-ov-pill-bad",
  neutral: "kpi-ov-pill-neutral",
};

function StatCell({ stat }) {
  return (
    <span className="kpi-ov-split-stat">
      <span className="kpi-ov-split-k">{stat.label}</span>
      <span className="kpi-ov-split-v kpi-ov-num">
        {stat.value_display || "-"}
        {stat.value_suffix && <span className="kpi-ov-split-suffix"> {stat.value_suffix}</span>}
      </span>
    </span>
  );
}

function LeftToSpendCard({ leftCard }) {
  if (!leftCard) return null;
  return (
    <div className="kpi-ov-card kpi-ov-card-cogs" data-kpi-ov="what-is-left-left">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">Left to spend</span>
        <HelpPop
          id="overview-left-to-spend"
          title="Left to spend"
          body={
            <p>
              Your cost-of-goods budget for this period minus what you have
              spent, and what that leaves you per day against what you have
              actually been spending.
            </p>
          }
        />
        {leftCard.days_left_pill && (
          <span className="kpi-ov-pill kpi-ov-pill-neutral" data-kpi-ov="days-left-pill">
            {leftCard.days_left_pill}
          </span>
        )}
      </div>
      <div className="kpi-ov-cb">
        <div className="kpi-ov-split">
          <span className="kpi-ov-split-lead kpi-ov-hero kpi-ov-num">
            {leftCard.hero_display || "-"}
          </span>
          <span className="kpi-ov-split-stats">
            {(leftCard.stats || []).map((s, i) => (
              <StatCell key={i} stat={s} />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

function BudgetUsedCard({ usedCard }) {
  if (!usedCard) return null;
  const tone = PILL_TONE[usedCard.pace_direction] || "kpi-ov-pill-neutral";
  const heroColor = usedCard.pace_direction === "good"
    ? "kpi-ov-good"
    : usedCard.pace_direction === "bad" ? "kpi-ov-bad" : "";
  return (
    <div className="kpi-ov-card kpi-ov-card-cogs" data-kpi-ov="what-is-left-used">
      <div className="kpi-ov-ch">
        <span className="kpi-ov-eb">Budget used</span>
        <HelpPop
          id="overview-budget-used"
          title="Budget used"
          body={
            <p>
              How much of the period budget is gone against how much of the
              period is gone. Behind the clock is good.
            </p>
          }
        />
        {usedCard.pace_pill && (
          <span
            className={`kpi-ov-pill ${tone}`}
            data-kpi-ov="pace-pill"
            data-kpi-ov-tone={usedCard.pace_direction}
          >
            {usedCard.pace_pill}
          </span>
        )}
      </div>
      <div className="kpi-ov-cb">
        <div className="kpi-ov-split">
          <span className={`kpi-ov-split-lead kpi-ov-hero kpi-ov-num ${heroColor}`}>
            {usedCard.hero_display || "-"}
          </span>
          <span className="kpi-ov-split-stats">
            {(usedCard.stats || []).map((s, i) => (
              <StatCell key={i} stat={s} />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function WhatIsLeft({ whatIsLeft }) {
  if (!whatIsLeft) return null;
  const { left_card, used_card } = whatIsLeft;
  if (!left_card && !used_card) return null;

  return (
    <div
      className="kpi-ov-wil"
      data-kpi-ov="what-is-left"
      data-kpi-ov-pace={whatIsLeft.pace || null}
    >
      <LeftToSpendCard leftCard={left_card} />
      <BudgetUsedCard usedCard={used_card} />
    </div>
  );
}
