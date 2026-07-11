"use client";

// DaySquare - the universal day atom (Stage 0 of the SC redesign).
//
// ONE component, used at every level of the redesigned SC. Renders a
// single day's tile at a configured size. PRESENTATIONAL only: takes
// resolved props in, emits an onClick out. No data loading, no status
// resolution, no DayDetail wiring - those live upstream.
//
// Status states (one fill, never color-alone - badge icon is the
// redundant cue per Nielsen):
//   entered      teal-pastel
//   needs-entry  amber-pastel
//   overdue      brick-pastel
//   upcoming     whisper-green (visibly distinct from entered)
//   off          warm grey
//
// Overlays compose without collision (layered box-shadow tracks):
//   focused      thin teal inset (keyboard focus)
//   selected     teal outer ring (bulk-entry multi-select)
//   today        navy outer ring (always outermost)
//
// Sizes:
//   sm   year-grid context: ~28 squares in a card, minimal content
//   lg   workspace context: tap target, full polymorphic middle line
//
// Account polymorphism on the middle line ONLY:
//   per-meal       $X / N meals
//   mlb-fee        vs OPP / N meals (NO $)
//   milb           [day/night pill] / N meals
//   fee-no-dollar  N served (NO $, STL-FL discipline)

import "./DaySquare.css";
import { SunGlyph, MoonGlyph, MessageSquare, PlaneGlyph } from "./Icons";
import { fmt$K, fmtMeals } from "./season/format";

// Number formatting convention (Design Batch 1, audit P2-1).
//   - Revenue >= $1M: $1.2M
//   - Revenue >= $1K: $12K
//   - Revenue <  $1K: $987
//   - Meal counts: raw with thousands separator (1,234)
//   - Compact meal counts (sm tiles): 1.2k for values >= 1,000
// K/M compactor + meals formatter shared via season/format.js (C1a).

// Compact format for small-size tiles when the count gets long.
// 1,234 -> "1.2k" so the date isn't visually crowded out.
function fmtCompactMeals(n) {
  if (n == null) return "";
  if (n < 1000) return String(n);
  return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
}

// Status -> { className, icon } for the badge that carries the
// redundant non-color cue. Design Batch 1 decisions:
//   - "entered" carries NO glyph: the calm state relies on the
//     saturated green fill (widened tier, audit P0-3) + the sticky
//     legend. Action states retain glyphs (the redundant cue lives
//     where the rubric most cares about it: needs-entry, overdue).
//   - "loading" and "failed" exist as first-class atom states so a
//     fetch in flight or a fetch error never renders as a silent 0
//     (audit non-negotiable #2).
//   - "off-season" splits from generic "off" so "nothing scheduled"
//     reads distinctly from "upcoming." The CSS off-season fill carries
//     a diagonal hatch as the non-color cue.
// Bundle 1 (Section D4): off + off-season no longer render an em-dash
// glyph. The dash read as "nothing here / missing data" against the
// dense year-grid; the deliberate "off" tile fill (and the diagonal
// hatch on off-season) now carry the state alone. Action states
// (needs-entry, overdue) keep their glyphs - the rubric prioritizes
// the redundant cue where the operator has to act on it.
const STATUS_META = {
  entered:       { mod: "entered",       icon: "" },
  "needs-entry": { mod: "needs-entry",   icon: "✎" },
  overdue:       { mod: "overdue",       icon: "!" },
  upcoming:      { mod: "upcoming",      icon: "○" },
  off:           { mod: "off",           icon: "" },
  "off-season":  { mod: "off-season",    icon: "" },
  loading:       { mod: "loading",       icon: "" },
  failed:        { mod: "failed",        icon: "⚠" },
  // sc-12 (2026-07-10): exhibition (TXR Spring Training vs KC) - display
  // only, not clickable, excluded from X/30 counter. The copper "EXH"
  // corner ribbon carries the state signal (no top-right status badge);
  // the cream fill + sage opponent tag are the polymorphic content.
  exhibition:    { mod: "exhibition",    icon: "" },
  // sc-13 (2026-07-10): away (team on the road, no service to enter) -
  // display only, not clickable, excluded from X/30 counter. The plane
  // glyph top-right is the state signal (a shape, colorblind-safe);
  // the muted date + hollow @OPP tag + "no service" line are the
  // polymorphic content. No badge in the top-right slot (the plane
  // glyph lives there).
  away:          { mod: "away",          icon: "" },
};

export default function DaySquare({
  // identity + display
  date,                    // "YYYY-MM-DD" - used for ariaLabel default
  dateNumber,              // 1-31 - the number we actually render (caller may override)
  status = "off",          // resolved status string (one of STATUS_META keys)
  size = "lg",             // "sm" | "lg"

  // overlays - compose
  isToday = false,
  isSelected = false,
  isFocused = false,

  // polymorphic content
  kind = "per-meal",       // "per-meal" | "mlb-fee" | "milb" | "fee-no-dollar"
  content = null,          // optional bag: { meals?, revenue?, opponent?, milbPill?, served?, isEstimated? }

  // interaction
  onClick,
  ariaLabel,

  // Optional focus + role overrides. A grid parent using roving tabindex
  // (WAI-ARIA grid pattern) supplies role="gridcell" + tabIndex=-1 on all
  // but one cell so keyboard users tab into the grid ONCE and arrow-key
  // between cells. When absent, the atom keeps its current button-role
  // behavior (year-view MonthCard/PeriodCard callers - no regression).
  tabIndex,
  role,

  // F3 (N1 render): the save for this date is queued locally and the
  // driver is retrying it against the server. Overlays a SYNCING badge
  // on top of whatever status the tile is showing - the underlying
  // status stays TRUTHFUL until the server echoes; the badge tells the
  // in-flight story. Reduced-motion pair in DaySquare.css kills the
  // spinner animation.
  isSyncing = false,

  // P2 (item 3, R3, 2026-07-10): the day has at least one authored
  // NOTE entry (`day.noteEntries.length > 0` at the caller). Renders
  // a chat-bubble outline glyph in the top-right corner slot next to
  // the status badge; ~50% opacity so it reads as a content signal
  // without competing with the state signal. History/EDIT rows are
  // deliberately NOT counted here - the indicator is NOTES-only per
  // Kevin's Q-b ruling. aria-label picks up "· has notes".
  hasNote = false,
}) {
  const meta = STATUS_META[status] || STATUS_META.off;
  const day = dateNumber != null
    ? dateNumber
    : (date ? Number(date.slice(8, 10)) : "");

  // Derive the middle-line content per kind. Returns null when the
  // size or kind doesn't render a middle line (sm + kind that needs
  // multiple values gracefully degrades to nothing).
  const middleLine = renderMiddleLine(size, kind, content, status);

  // sc-12: exhibition is a display-only state - the tile never renders
  // as interactive even if a caller accidentally passes an onClick, and
  // the click handler below refuses activation. This keeps the "no
  // service to enter" contract tight regardless of the call-site.
  // sc-13: away shares the display-only contract - the team is on the
  // road and no service happens; the same non-interactive gate covers
  // both states.
  const isExhibition = status === "exhibition";
  const isAway = status === "away";
  const isDisplayOnly = isExhibition || isAway;

  // Compose the className chain. The order of overlay modifiers
  // doesn't matter to CSS (each draws its own box-shadow track) but
  // we list them deterministically for diff readability.
  const cls = [
    "sc-daysq",
    `sc-daysq--${size}`,
    `sc-daysq--${meta.mod}`,
    isToday && "sc-daysq--today",
    isSelected && "sc-daysq--selected",
    isFocused && "sc-daysq--focused",
    onClick && !isDisplayOnly && "sc-daysq--interactive",
  ].filter(Boolean).join(" ");

  const baseAriaLabel = ariaLabel || buildAriaLabel({ date, status, isToday, isSelected, content, kind });
  // P2 (item 3, R3): append "· has notes" when the day carries a
  // NOTE ledger entry so the aria-label mirrors the visual signal
  // whether the caller passes a custom label or falls back to the
  // built one.
  const computedAriaLabel = hasNote ? `${baseAriaLabel} · has notes` : baseAriaLabel;

  // sc-12: exhibition tiles absorb any click without firing the
  // caller's onClick, so DisplayContract holds even when a bulk-grid
  // caller wires the handler uniformly. sc-13 widens to away.
  const activeOnClick = isDisplayOnly ? undefined : onClick;
  const handleKeyDown = activeOnClick
    ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activeOnClick(e); } }
    : undefined;

  return (
    <div
      className={cls}
      role={role ?? (activeOnClick ? "button" : undefined)}
      tabIndex={tabIndex ?? (activeOnClick ? 0 : undefined)}
      aria-label={computedAriaLabel}
      aria-pressed={isSelected || undefined}
      onClick={activeOnClick}
      onKeyDown={handleKeyDown}
    >
      <div className="sc-daysq-top">
        <span className="sc-daysq-date">{day}</span>
        {/* P2 (item 3, R3): trailing cluster housing the note-indicator
            bubble + the status badge (or selection check) + the ghost
            day/night pill (rightmost, outboard of the status badge).
            Outer flex on .sc-daysq-top keeps the date on the left and
            this cluster on the right. Reading order left-to-right:
            [note bubble] [status badge] [pill] - pill outermost.

            Day/night pill (2026-07-11): replaces the earlier bare
            top-row glyph for both MiLB (SC-070) and MLB fee (sc-15).
            lg only - dropped on sm to match the sc-13 away plane
            gate. Renders `[glyph] [venue-local time]` for HOME
            games; AWAY / EXHIBITION carry null dayNight/pillTime and
            no pill renders. Coexists with the status badge (both
            visible side by side). */}
        {/* Sm overview cleanup (2026-07-11): sm tiles carry state by
            fill + border ONLY. All four status/note glyphs are gated
            off on sm - status circle (upcoming ○), status marks (! ⚠ ✎),
            selection check, and note bubble. Aria label still picks up
            "has notes" for screen-reader parity (screen readers need
            the signal even when the visual is hidden).
            DELIBERATE TRADEOFF: note presence is no longer visible on
            the overview - only on drill-down. Overview = scan color;
            drill-down = detail. Do NOT restore the sm note bubble as
            a "bugfix" - it is intentionally stripped. */}
        <span className="sc-daysq-top-right">
          {size !== "sm" && hasNote && <NoteBubble />}
          {size !== "sm" && (isSelected ? (
            <span className="sc-daysq-check" aria-hidden="true">✓</span>
          ) : meta.icon ? (
            <span className={`sc-daysq-badge sc-daysq-badge--${meta.mod}`} aria-hidden="true">
              {meta.icon}
            </span>
          ) : null)}
        </span>
      </div>
      {status !== "loading" && status !== "failed" && middleLine}
      {isToday && <span className="sc-daysq-today-pill" aria-hidden="true">TODAY</span>}
      {/* sc-12: copper "EXH" corner ribbon carries the exhibition state
          as a shape signal (colorblind-safe) alongside the cream fill.
          Rendered here as an absolute-positioned peer of the top row
          so it composes cleanly with the note bubble + today/selected
          rings without a badge-slot collision. The bottom-left rounded
          corner clips into the tile per the brief. */}
      {isExhibition && (
        <span className="sc-daysq-exh-ribbon" aria-hidden="true">EXH</span>
      )}
      {/* sc-13: plane glyph carries the AWAY state as a shape signal
          alongside the teal fill (colorblind-safe on lg tiles).
          Restyle 2026-07-10: gated to size !== "sm" per Kevin's ruling.
          The dense year-grid overview crowds at that size, so small
          tiles carry the state by teal fill alone (matches the
          `renderAway` !sm gate on the "no service" line). Full-size
          tiles keep the plane. Same top-right absolute-positioned
          slot as the EXH ribbon (mutually exclusive - no collision). */}
      {isAway && size !== "sm" && (
        <span className="sc-daysq-away-glyph" aria-hidden="true">
          <PlaneGlyph size={13} />
        </span>
      )}
      {isSyncing && (
        <span className="sc-daysq-syncing" aria-label="Save syncing">
          <span className="sc-daysq-syncing-spinner" aria-hidden="true" />
          <span className="sc-daysq-syncing-label">SYNCING</span>
        </span>
      )}
    </div>
  );
}

// --- middle line rendering -------------------------------------------------
// The polymorphic content layer. The atom owns layout + truncation; the
// caller owns the data shape. At sm size we collapse the middle line to
// a minimal indicator so the date stays the hero. At lg size the full
// per-kind layout renders.

function renderMiddleLine(size, kind, content, status) {
  if (!content) return null;
  const sm = size === "sm";

  // sc-12: exhibition owns its own middle-line layout so the sage
  // opponent tag reads distinctly from the navy `mlb-fee` chip on
  // regular home games. Meals render only when a projection was
  // seeded (exhibition rows are typically un-projected today).
  if (status === "exhibition") {
    return renderExhibition(content, sm);
  }
  // sc-13: away owns its own middle-line layout - hollow `@ OPP` tag
  // (transparent fill, hairline border) reads distinct from the sage
  // filled EXH tag AND the navy filled home tag. `no service` muted
  // line beneath signals no actuals expected.
  if (status === "away") {
    return renderAway(content, sm);
  }

  // Small tiles: a single tight line (or nothing). The grid context
  // is dense; resist the urge to cram.
  if (sm) {
    const compact = pickCompactSmall(kind, content, status);
    if (!compact) return null;
    return <div className="sc-daysq-mid sc-daysq-mid--sm">{compact}</div>;
  }

  // Large tiles: full per-kind layout.
  switch (kind) {
    case "per-meal":
      return renderPerMeal(content, status);
    case "mlb-fee":
      return renderMlbFee(content);
    case "milb":
      return renderMilb(content, status);
    case "fee-no-dollar":
      return renderFeeNoDollar(content);
    default:
      return null;
  }
}

// sc-12: exhibition mid layout. Sage `vs KC` tag on top; `~N meals`
// muted beneath ONLY when a projection is present. At sm size the tag
// alone reads on the year-grid without the meals line.
function renderExhibition(content, sm) {
  const { opponent, meals } = content;
  if (!opponent && meals == null) return null;
  return (
    <div className="sc-daysq-mid sc-daysq-mid--exh">
      {opponent && (
        <span className="sc-daysq-mid-opponent sc-daysq-mid-opponent--exh">
          vs {opponent}
        </span>
      )}
      {!sm && meals != null && meals > 0 && (
        <span className="sc-daysq-mid-headcount sc-daysq-mid-headcount--exh">
          ~{fmtMeals(meals)}<span className="sc-daysq-mid-unit">{meals === 1 ? "meal" : "meals"}</span>
        </span>
      )}
    </div>
  );
}

// sc-13: away mid layout. Hollow `@ OPP` tag on top (transparent fill,
// hairline border - visually distinct from home's filled navy chip and
// EXH's filled sage chip). `no service` muted beneath, but only at lg
// size - on sm year-grid tiles the tag alone is enough context and the
// dense grid can't afford a second line.
function renderAway(content, sm) {
  const { opponent } = content;
  if (!opponent) return null;
  return (
    <div className="sc-daysq-mid sc-daysq-mid--away">
      <span className="sc-daysq-mid-opponent sc-daysq-mid-opponent--away">
        @ {opponent}
      </span>
      {!sm && (
        <span className="sc-daysq-mid-noservice sc-daysq-mid-noservice--away">
          no service
        </span>
      )}
    </div>
  );
}

// Small-size content. Single line, prioritized for the grid context.
// per-meal:    "$1.2k" if revenue, else meal count
// mlb-fee:     opponent abbrev if present
// milb:        day/night pill (no number)
// fee-no-dollar: meals
function pickCompactSmall(kind, content, status) {
  // sc-16 (2026-07-11): MiLB with schedule joins mlb-fee in showing the
  // opponent chip on sm year-grid tiles. Other MiLB accounts have no
  // opponent field and fall through to the meals/revenue branches.
  if ((kind === "mlb-fee" || kind === "milb") && content.opponent) {
    return <span className="sc-daysq-mid-opponent">{content.opponent}</span>;
  }
  // Day/night glyph on sm MiLB tiles retired 2026-07-11 as part of the
  // ghost-pill migration. Both MLB fee and MiLB drop the glyph at sm
  // (matches the sc-13 away-plane gate). If the mid slot has other
  // useful content it renders below; otherwise the tile is date-only.
  if (kind === "per-meal" && content.revenue != null) {
    return <span className="sc-daysq-mid-rev">{fmtCompactRevenue(content.revenue)}</span>;
  }
  if (content.meals != null || content.served != null) {
    const n = content.served != null ? content.served : content.meals;
    return <span className="sc-daysq-mid-meals">{fmtCompactMeals(n)}</span>;
  }
  return null;
}

function renderPerMeal(content, status) {
  const { revenue, meals, isEstimated } = content;
  const hasRev = revenue != null;
  const hasMeals = meals != null;
  if (!hasRev && !hasMeals) return null;
  // Off / no-service days (meals null OR zero): a single quiet "No service"
  // line, replacing the prior dead-air "$0". Kept in the middle slot so the
  // atom's date + status glyph read the same as elsewhere.
  if (!meals) {
    return (
      <div className="sc-daysq-mid sc-daysq-mid--off">
        <span className="sc-daysq-mid-noservice">No service</span>
      </div>
    );
  }
  // Meals-first stacked block (Kevin's Option C). Meal count leads with a
  // small "meals" unit; revenue sits quietly below with the existing
  // prefix logic ("~" upcoming, "est. " past-unentered, none entered).
  const revPrefix = status === "upcoming" ? "~" : (isEstimated ? "est. " : "");
  const revClass = "sc-daysq-mid-rev"
    + (status === "entered" ? " sc-daysq-mid-rev--actual" : " sc-daysq-mid-rev--projected");
  return (
    <div className="sc-daysq-mid sc-daysq-mid--stack">
      <span className="sc-daysq-mid-meals">
        {fmtMeals(meals)}
        {/* SC-045: pluralize meal/meals on the exact-1 case. */}
        <span className="sc-daysq-mid-meals-unit">{meals === 1 ? "meal" : "meals"}</span>
      </span>
      {hasRev && <span className={revClass}>{revPrefix}{fmt$K(revenue)}</span>}
    </div>
  );
}

function renderMlbFee(content) {
  const { opponent, meals, isEstimated, dayNight, pillTime, isDoubleheader } = content;
  if (!opponent && meals == null && !dayNight) return null;
  // Stacked layout (option A): opponent reads as a navy chip on its own
  // line; the headcount sits beneath as "N meals" with the count as hero
  // and unit as trailing muted small. The old inline "vs OPP / N meals"
  // dropped both surfaces into one line - hard to scan on the grid.
  //
  // 2026-07-11 layout move: day/night pill moved OUT of the top-right
  // corner cluster and INTO the mid-content stack, directly below the
  // opponent chip. Reads top-to-bottom: [vs OPP] / [pill] / [N meals].
  // Left-aligned under the opponent chip via flex-start on the container.
  //
  // SC-042: unentered days prefix the meals with "~" so the projection
  // reads as schedule intent, not recorded actuals. Entered days render
  // bare - "0 meals" is honest on an entered zero. Same tilde language
  // as everywhere else (schedule-view, not urgency).
  // SC-045 + SC-050: pluralize meal/meals; unit was already present here.
  const mealsPrefix = isEstimated ? "~" : "";
  return (
    <div className="sc-daysq-mid sc-daysq-mid--mlb">
      {opponent && (
        <span className="sc-daysq-mid-opponent">
          vs {opponent}{isDoubleheader ? " · DH" : ""}
        </span>
      )}
      {dayNight && (
        <DayNightPill type={dayNight} timeText={pillTime} />
      )}
      {meals != null && (
        <span className="sc-daysq-mid-headcount">
          {mealsPrefix}{fmtMeals(meals)}<span className="sc-daysq-mid-unit">{meals === 1 ? "meal" : "meals"}</span>
        </span>
      )}
    </div>
  );
}

function renderMilb(content, status) {
  // MiLB polymorphism (Stage 5 hardening): MiLB is per-meal financially
  // per docs/SC_BILLING_MODEL_AUDIT.md (CIN-KY: "Per-meal only, two-tier").
  // The two-axis model (spec section 6) composes operational shape
  // (day/night pill) with the financial frame (per-meal $).
  //
  // 2026-07-11 layout move: the day/night glyph, then pill, then now
  // full ghost pill was in the top-right; it now lives in the mid
  // stack at the top slot (MiLB has no opponent chip - the pill takes
  // the top spot before the meals hero). MLB fee's stack reads
  // [opp] [pill] [meals]; MiLB's reads [pill] [meals] [rev] - one
  // language, adapted to each kind's existing slots.
  const { opponent, meals, revenue, isEstimated, dayNight, pillTime, isDoubleheader } = content;
  const hasRev = revenue != null;
  const hasMeals = meals != null;
  if (!opponent && !hasRev && !hasMeals && !dayNight) return null;
  // SC-039: no-service short-circuit matching renderPerMeal:235-241. A
  // MiLB day with meals null OR zero is a no-service day; renders the
  // quiet "No service" line instead of the misleading est. $0 / ~$0.
  // Pill is intentionally NOT rendered on a no-service tile (the
  // "we're not serving" signal wins over the day/night context).
  //
  // sc-16 (2026-07-11): guard the short-circuit on !opponent. MiLB with
  // schedule (Louisville/Buffalo) on a future GAME day may have
  // meals=null before projections are entered - the schedule already
  // says "game day"; "No service" would misread. Show the opponent +
  // pill instead, and omit the meals + revenue lines below.
  if (!meals && !opponent) {
    return (
      <div className="sc-daysq-mid sc-daysq-mid--off">
        <span className="sc-daysq-mid-noservice">No service</span>
      </div>
    );
  }
  const revPrefix = status === "upcoming" ? "~" : (isEstimated ? "est. " : "");
  const revClass = "sc-daysq-mid-rev"
    + (status === "entered" ? " sc-daysq-mid-rev--actual" : " sc-daysq-mid-rev--projected");
  return (
    <div className="sc-daysq-mid sc-daysq-mid--milb">
      {/* sc-16 (2026-07-11): MiLB with schedule (Louisville/Buffalo) picks
          up the opponent chip on lg GAME tiles, ordered above the pill
          per the MLB-fee stack. Other MiLB accounts have no opponent set
          on the day bag and this row disappears. Same DH affix as
          renderMlbFee when the schedule row flags a doubleheader. */}
      {opponent && (
        <span className="sc-daysq-mid-opponent">
          vs {opponent}{isDoubleheader ? " · DH" : ""}
        </span>
      )}
      {dayNight && (
        <DayNightPill type={dayNight} timeText={pillTime} />
      )}
      {/* Meals hero - same typography classes per-meal uses so the two
          per-meal-financial variants read as one family. */}
      {hasMeals && (
        <span className="sc-daysq-mid-meals sc-daysq-mid-meals--hero">
          {fmtMeals(meals)}{" "}
          <span className="sc-daysq-mid-meals-unit">{meals === 1 ? "meal" : "meals"}</span>
        </span>
      )}
      {/* Muted revenue beneath. est./~/bare prefix encoding preserved
          verbatim from the pre-SC-070 line above; it just moves to the
          subordinate slot. */}
      {hasRev && <span className={revClass}>{revPrefix}{fmt$K(revenue)}</span>}
    </div>
  );
}

function renderFeeNoDollar(content) {
  // STL-FL discipline: no $ tokens. Structural absence enforced by
  // never calling fmt$K into this branch's logic (fmt$K is imported
  // file-wide via ./season/format, but this function does not call it).
  const { served, meals } = content;
  const n = served != null ? served : meals;
  if (n == null) return null;
  return (
    <div className="sc-daysq-mid">
      <span className="sc-daysq-mid-meals">{fmtMeals(n)} served</span>
    </div>
  );
}

// P2 (item 3, R3): the DaySquare note indicator. 11px chat-bubble
// outline glyph from the SC icon set. Kept aria-hidden - the parent's
// aria-label already picks up the "· has notes" suffix so the signal
// is announced once, not twice. Opacity handled via CSS.
function NoteBubble() {
  return (
    <span className="sc-daysq-notebubble" aria-hidden="true">
      <MessageSquare size="11px" />
    </span>
  );
}

function MilbPill({ type }) {
  // Day/night reads as a glyph: amber sun for day, navy moon for night.
  // Replaces the prior "Day"/"Night" text pill so the mid-line can carry
  // the meal count without competing for width. Colored via CSS on the
  // .sc-daysq-milb-glyph--{type} scope.
  //
  // Retired from tile-render on 2026-07-11 (see DayNightPill below).
  // Component retained because the StateLegend + LegendInfoPopup swatches
  // still render the bare glyph inline (legend doesn't need the time).
  const isDay = type === "day";
  return (
    <span
      className={`sc-daysq-milb-glyph sc-daysq-milb-glyph--${type}`}
      role="img"
      aria-label={isDay ? "Day game" : "Night game"}
    >
      {isDay ? <SunGlyph size={12} /> : <MoonGlyph size={12} />}
    </span>
  );
}

// Ghost day/night pill (2026-07-11): replaces the bare sun/moon glyph
// on lg tiles for both MLB fee and MiLB. Renders `[glyph] [time]` with
// a hairline colored border and transparent fill (Option B - restrained
// so it doesn't compete with the game-day green border or the opponent
// chip). Amber for day, indigo for night. Time comes pre-formatted from
// gameTimeFormat.js (venue-local, no am/pm, "ET"/"CT" abbrev on MLB).
// Time is optional - when absent, renders glyph alone (defensive:
// scheduled games whose time hasn't been backfilled still surface a
// day/night cue without an empty pill).
function DayNightPill({ type, timeText }) {
  const isDay = type === "day";
  const label = timeText
    ? `${isDay ? "Day" : "Night"} game, ${timeText}`
    : `${isDay ? "Day" : "Night"} game`;
  return (
    <span
      className={`sc-daysq-dn-pill sc-daysq-dn-pill--${type}`}
      role="img"
      aria-label={label}
    >
      <span className="sc-daysq-dn-pill-glyph" aria-hidden="true">
        {isDay ? <SunGlyph size={11} /> : <MoonGlyph size={11} />}
      </span>
      {timeText && (
        <span className="sc-daysq-dn-pill-time">{timeText}</span>
      )}
    </span>
  );
}

function fmtCompactRevenue(n) {
  if (n == null) return "";
  if (n < 1000) return "$" + Math.round(n);
  return "$" + (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
}

function buildAriaLabel({ date, status, isToday, isSelected, content, kind }) {
  // Builds a human-readable label that doesn't depend on hue.
  // Order: date, [today], [selected], status phrase, content details.
  // The status phrase prefers a verb-led reading ("needs entry") over
  // an enum slug ("needs-entry"). Loading/failed states surface as the
  // last word so a screen reader hears the actionable signal first.
  const dateLabel = date ? formatDateForAria(date) : "";
  const parts = [dateLabel];
  if (isToday) parts.push("today");
  if (isSelected) parts.push("selected");
  parts.push(statusPhrase(status));
  if (content) {
    // sc-13: away days read as "@ OPP" (matches the visual hollow tag);
    // all other states use the "vs OPP" home-context reading.
    if (content.opponent) parts.push(status === "away" ? `at ${content.opponent}` : `vs ${content.opponent}`);
    // Ghost pill (2026-07-11): unified day/night reading. content.dayNight
    // is set on both MLB fee (from sc_homestand_schedule.day_night) and
    // MiLB (from gameType substring). Fall back to content.milbPill if
    // dayNight isn't set (defensive - some codepaths still emit milbPill
    // only). If pillTime is present, append the venue-local time for
    // screen-reader parity with the visible pill.
    const dn = content.dayNight || content.milbPill;
    if (dn) {
      parts.push(content.pillTime ? `${dn} game, ${content.pillTime}` : `${dn} game`);
    }
    if (kind === "per-meal" && content.revenue != null) parts.push(fmt$K(content.revenue));
    const mealCount = content.served != null ? content.served : content.meals;
    if (mealCount != null) parts.push(`${mealCount} meals`);
  }
  return parts.filter(Boolean).join(", ");
}

function statusPhrase(status) {
  switch (status) {
    case "entered":      return "entered";
    case "needs-entry":  return "needs entry";
    case "overdue":      return "overdue";
    case "upcoming":     return "upcoming";
    case "off-season":   return "off-season";
    case "off":          return "off";
    case "loading":      return "loading";
    case "failed":       return "failed to load";
    case "exhibition":   return "exhibition, no service to enter";
    case "away":         return "away game, no service to enter";
    default:             return status.replace("-", " ");
  }
}

function formatDateForAria(dateStr) {
  // "2026-06-15" -> "Mon Jun 15"
  const d = new Date(dateStr + "T12:00:00");
  const dow = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
  const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()];
  return `${dow} ${mon} ${d.getDate()}`;
}
