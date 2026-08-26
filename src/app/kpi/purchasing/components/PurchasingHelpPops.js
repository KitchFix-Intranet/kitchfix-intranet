"use client";
// src/app/kpi/purchasing/components/PurchasingHelpPops.js
//
// PR 2 R8 - Gap 1 - purchasing help copy.
//
// Voice reference (labor SignalCards.js PACE_BODY / OVERTIME_BODY /
// HOURS_LEFT_BODY / PAYROLL_BODY): plain, second-person, one hard
// fact per body, one qualifier, one nuance line in the foot for the
// "read this when" moment. Never define a term the reader already
// knows.
//
// The shared HelpPop lives at src/app/kpi/labor/components/HelpPop.js
// and is portal-rendered at document.body so it escapes every card's
// `position: relative` stacking context - required because
// purchasing's card stripes create local stacking contexts of their
// own (see labor/HelpPop.js:8-25 for the diagnosis).
//
// Bodies are React nodes so the shared component can render them
// verbatim; they live at module scope so Playwright can grep the
// verbatim text.

// Two body-wide standing rules that any operator should hear once.
// Reused across the period card + at least one bucket. Kept as
// components so we can share the copy without duplicating strings.

// R13 P2-6 - one help trigger per screen (owner ruling 2026-08-26).
// PERIOD_BODY is now the single explainer for the whole board: it
// covers the card sub-rows (Bills is a floor; Cards; Pending), the
// weekly / period chart mechanic (target lines, adjusted line, the
// running unit), and the eight-day Rippling lag.  The `?` triggers
// on each bucket chart + the period chart legend were removed in
// the same PR - reader intent is that ONE popover explains the
// entire card family, not four.
export const PERIOD_BODY = (
  <>
    Everything the P&amp;L saw for this range, plus the card charges
    already coded to a P&amp;L line.
    <br /><br />
    <b>Bills is at least.</b> Sebastian is still entering invoices
    for the current week or two, so the bill total is a floor - it
    only goes up as more bills land.
    <br /><br />
    <b>Cards</b> below Bills are card charges already coded to a
    P&amp;L line. <b>Pending is card spend nobody has coded yet</b> -
    it sits at the card level and does not land in a bucket. Coding
    in Rippling moves a charge from Pending onto Cards on the right
    P&amp;L line.
    <br /><br />
    <b>The weekly / period chart</b> on the right: each bar is what
    got spent in that unit; the <b>dashed line</b> is what an even
    pace would put there. The adjusted line (blue) divides the money
    that is left across the weeks that are left, so a week that ran
    hot raises the target on every week after it. Green bars are
    under target; red bars are over. The running unit fills to what
    was spent so far; if the period is at least a quarter through,
    a dashed outline extends to the on-pace projection.
    <span className="kpi-hs-pop-foot"><b>Cards run roughly 8 days behind.</b> Rippling does not
      expose a card line item until its parent charge is about 8
      days old, so the current period will always look light for
      the last week or so.</span>
  </>
);

export const FOOD_BODY = (
  <>
    Everything landed on the food P&amp;L lines (3200s) - bills from
    bill.com plus card charges already coded to food. The two
    numbers below break the split.
    <br /><br />
    Bills are what Sebastian entered. Cards are what Rippling saw
    and someone tagged as food.
    <span className="kpi-hs-pop-foot">The board records what was <b>spent</b>. The P&amp;L records
      what was <b>decided</b>. Accounting reclassifies a few times
      a year, so the two never tie exactly - that is normal.</span>
  </>
);

export const PACKAGING_BODY = (
  <>
    Packaging, supplies, and linen - the 3400 lines on the P&amp;L.
    Same split as food: bills plus coded cards.
    <br /><br />
    Card-heavy at the sites that reorder small runs of clamshells
    and portion cups directly rather than routing through a bill.
    <span className="kpi-hs-pop-foot">Bills are what Sebastian entered. Cards are what Rippling
      saw and someone tagged to a 3400 line. Two sources, one
      number.</span>
  </>
);

export const VEHICLE_BODY = (
  <>
    Vehicle spend - lease, fuel, insurance, and repair - the 3500
    lines. Bills plus coded cards.
    <br /><br />
    Fuel is the swing here. A homestand week runs hot; a road-trip
    week runs cold. Read the running-week hatch on the strip before
    you conclude anything about pace.
    <span className="kpi-hs-pop-foot">Vehicle R&amp;M sits inside this bucket, not in Repair &amp;
      maintenance. The 5002.1 card below is buildings and
      equipment, not trucks.</span>
  </>
);

export const EQUIPMENT_BODY = (
  <>
    Equipment purchases - the 5002.5 line on the P&amp;L. This is
    an SG&amp;A line, not a bucket you are held to as a bonus
    number.
    <br /><br />
    Shown here as a <b>review talking point</b>: what did the site
    buy, when, from whom. Every row is one bill.
    <span className="kpi-hs-pop-foot">A cluster of small-dollar rows in one week is usually a
      remodel or an opening; a single large row is a fridge or
      a mixer. Read the vendor and the date, not the total.</span>
  </>
);

export const REPAIR_BODY = (
  <>
    Repair and maintenance on buildings and non-vehicle equipment -
    the 5002.1 line. Another SG&amp;A talking-point card, not a
    bonus number.
    <br /><br />
    <b>Vehicle R&amp;M does not land here.</b> Truck repair lives
    inside Vehicle (3500). This card is refrigeration techs, plumbers,
    HVAC.
    <span className="kpi-hs-pop-foot">Reading habit: two visits from the same vendor a month
      apart on the same asset is a chronic-issue signal. Worth
      knowing before the third visit.</span>
  </>
);

export const REIMBURSABLE_BODY = (
  <>
    Spend the site made <b>on behalf of the client</b> - the 13xx
    lines. Uniforms for a stadium crew, one-off supplies a client
    asked for, and so on.
    <br /><br />
    <b>Billed back to the client 1:1.</b> There is no budget and no
    over/under verdict here - the site is not measured on it.
    <span className="kpi-hs-pop-foot">This card confirms what you spent so Sebastian invoices
      the client for the matching amount. If a row here looks
      wrong, that is what to check.</span>
  </>
);

export const CARD_PURCHASES_BODY = (
  <>
    Card charges Rippling saw but nobody coded to a P&amp;L line
    yet. Until they are coded, they carry no bucket - the board
    counts them as Pending on the period card.
    <br /><br />
    <b>Coding a charge moves it.</b> Open Rippling, pick the
    right P&amp;L line and a location, and the number leaves this
    card. If a charge shows an amber flag, the operator missed a
    category or a merchant.
    <span className="kpi-hs-pop-foot"><b>Cards run roughly 8 days behind.</b> A charge from
      last Tuesday will not appear here until roughly the middle
      of this week. The list stays short by design; the total on
      the left is the honest count.</span>
  </>
);

export const VENDOR_BODY = (
  <>
    One row per vendor Sebastian entered a bill for in this range,
    biggest first.
    <br /><br />
    <b>"Where it landed" splits one vendor across P&amp;L lines.</b>
    A Sysco bill can carry food, packaging, and small non-food
    supplies in one document; the split shows how much went to
    which bucket.
    <span className="kpi-hs-pop-foot"><b>vs prior</b> compares this range to the same length of
      time immediately before it. A vendor that reads new was
      not in that prior window at all - worth glancing at.</span>
  </>
);

export const WEEK_STRIP_BODY = (
  <>
    Every fiscal week in the range. Each bar is what got spent in
    that week; the <b>dashed target</b> is what an even pace would
    put there.
    <br /><br />
    <b>Adjusted moves as weeks close.</b> The original target is
    just budget over four; the adjusted line divides the money
    that is left across the weeks that are left. A week that ran
    hot raises the target on every week after it.
    <span className="kpi-hs-pop-foot">The <b>hatched bar is the running week</b> - work in
      progress, not a state. Green bars are under target; red
      bars are over. The pattern says "still counting"; the
      colour says over or under.</span>
  </>
);
