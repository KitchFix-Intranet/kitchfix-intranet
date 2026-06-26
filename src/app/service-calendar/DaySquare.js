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

// Number formatting convention (Design Batch 1, audit P2-1).
//   - Revenue >= $1M: $1.2M
//   - Revenue >= $1K: $12K
//   - Revenue <  $1K: $987
//   - Meal counts: raw with thousands separator (1,234)
//   - Compact meal counts (sm tiles): 1.2k for values >= 1,000
// One convention; one place. KPI/revenue uses K/M; raw counts stay raw.
const fmt$ = (n) => {
  const v = Math.round(Number(n) || 0);
  if (v >= 1_000_000) return "$" + (v / 1_000_000).toFixed(1).replace(/\.0$/, "") + "M";
  if (v >= 1_000)     return "$" + Math.round(v / 1_000) + "K";
  return "$" + v.toLocaleString("en-US");
};
const fmtMeals = (n) => n.toLocaleString("en-US");

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
const STATUS_META = {
  entered:       { mod: "entered",       icon: "" },
  "needs-entry": { mod: "needs-entry",   icon: "✎" },
  overdue:       { mod: "overdue",       icon: "!" },
  upcoming:      { mod: "upcoming",      icon: "○" },
  off:           { mod: "off",           icon: "—" },
  "off-season":  { mod: "off-season",    icon: "—" },
  loading:       { mod: "loading",       icon: "" },
  failed:        { mod: "failed",        icon: "⚠" },
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
}) {
  const meta = STATUS_META[status] || STATUS_META.off;
  const day = dateNumber != null
    ? dateNumber
    : (date ? Number(date.slice(8, 10)) : "");

  // Derive the middle-line content per kind. Returns null when the
  // size or kind doesn't render a middle line (sm + kind that needs
  // multiple values gracefully degrades to nothing).
  const middleLine = renderMiddleLine(size, kind, content, status);

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
    onClick && "sc-daysq--interactive",
  ].filter(Boolean).join(" ");

  const computedAriaLabel = ariaLabel || buildAriaLabel({ date, status, isToday, isSelected, content, kind });

  const handleKeyDown = onClick
    ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(e); } }
    : undefined;

  return (
    <div
      className={cls}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={computedAriaLabel}
      aria-pressed={isSelected || undefined}
      onClick={onClick}
      onKeyDown={handleKeyDown}
    >
      <div className="sc-daysq-top">
        <span className="sc-daysq-date">{day}</span>
        {meta.icon && (
          <span className={`sc-daysq-badge sc-daysq-badge--${meta.mod}`} aria-hidden="true">
            {meta.icon}
          </span>
        )}
      </div>
      {status !== "loading" && status !== "failed" && middleLine}
      {isToday && <span className="sc-daysq-today-pill" aria-hidden="true">TODAY</span>}
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

// Small-size content. Single line, prioritized for the grid context.
// per-meal:    "$1.2k" if revenue, else meal count
// mlb-fee:     opponent abbrev if present
// milb:        day/night pill (no number)
// fee-no-dollar: meals
function pickCompactSmall(kind, content, status) {
  if (kind === "mlb-fee" && content.opponent) {
    return <span className="sc-daysq-mid-opponent">{content.opponent}</span>;
  }
  if (kind === "milb" && content.milbPill) {
    return <MilbPill type={content.milbPill} />;
  }
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
  // Future days carry a "~" prefix on the $ to signal projection.
  // Past-unentered (amber) carry "est." prefix per the prototype.
  const revPrefix = status === "upcoming" ? "~" : (isEstimated ? "est. " : "");
  const revClass = "sc-daysq-mid-rev"
    + (status === "entered" ? " sc-daysq-mid-rev--actual" : " sc-daysq-mid-rev--projected");
  return (
    <div className="sc-daysq-mid">
      {hasRev && <span className={revClass}>{revPrefix}{fmt$(revenue)}</span>}
      {hasMeals && <span className="sc-daysq-mid-meals"> / {fmtMeals(meals)}</span>}
    </div>
  );
}

function renderMlbFee(content) {
  const { opponent, meals } = content;
  if (!opponent && meals == null) return null;
  return (
    <div className="sc-daysq-mid">
      {opponent && <span className="sc-daysq-mid-opponent">vs {opponent}</span>}
      {meals != null && <span className="sc-daysq-mid-meals"> / {fmtMeals(meals)}</span>}
    </div>
  );
}

function renderMilb(content, status) {
  // MiLB polymorphism (Stage 5 hardening): MiLB is per-meal financially
  // per docs/SC_BILLING_MODEL_AUDIT.md (CIN-KY: "Per-meal only, two-tier").
  // The two-axis model (spec section 6) composes operational shape
  // (day/night homestand pill) with the financial frame (per-meal $).
  // Render BOTH the pill AND the $/meals - the pill carries the
  // operational signal; $/meals carry the financial truth.
  const { milbPill, meals, revenue, isEstimated } = content;
  const hasRev = revenue != null;
  const hasMeals = meals != null;
  if (!milbPill && !hasRev && !hasMeals) return null;
  const revPrefix = status === "upcoming" ? "~" : (isEstimated ? "est. " : "");
  const revClass = "sc-daysq-mid-rev"
    + (status === "entered" ? " sc-daysq-mid-rev--actual" : " sc-daysq-mid-rev--projected");
  return (
    <div className="sc-daysq-mid">
      {milbPill && <MilbPill type={milbPill} />}
      {hasRev && <span className={revClass}>{revPrefix}{fmt$(revenue)}</span>}
      {hasMeals && <span className="sc-daysq-mid-meals"> / {fmtMeals(meals)}</span>}
    </div>
  );
}

function renderFeeNoDollar(content) {
  // STL-FL discipline: no $ tokens. Structural absence enforced by
  // never importing fmt$ into this branch's logic (we do import it
  // file-wide, but this function does not call it).
  const { served, meals } = content;
  const n = served != null ? served : meals;
  if (n == null) return null;
  return (
    <div className="sc-daysq-mid">
      <span className="sc-daysq-mid-meals">{fmtMeals(n)} served</span>
    </div>
  );
}

function MilbPill({ type }) {
  // "day" | "night" - amber dot for day, navy for night, matches the
  // existing .sc-mlb-pill convention.
  return (
    <span className={`sc-daysq-milb-pill sc-daysq-milb-pill--${type}`}>
      <span className="sc-daysq-milb-pill-dot" aria-hidden="true" />
      {type === "day" ? "Day" : "Night"}
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
    if (content.opponent) parts.push(`vs ${content.opponent}`);
    if (content.milbPill) parts.push(`${content.milbPill} game`);
    if (kind === "per-meal" && content.revenue != null) parts.push(fmt$(content.revenue));
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
