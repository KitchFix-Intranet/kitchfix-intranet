"use client";

// Dev-only state gallery for the DaySquare atom (Stage 0).
// Routed at /service-calendar/atom-gallery. NOT linked from production
// navigation. Exists so Kevin can eyeball every variant of the atom
// before any layout consumes it.
//
// Renders every variant side-by-side, labeled:
//   1. All 6 statuses x both sizes (sm + lg)
//   2. Today ring over each status (sm + lg)
//   3. Selected ring; today+selected; today+selected+focused (the
//      three-ring composition test the pre-mortem flagged)
//   4. Polymorphic content layer at lg: per-meal / mlb-fee / milb /
//      fee-no-dollar
//   5. Small + without middle line
//   6. Edge cases: 4-digit meal count; off-season; estimated amber

import DaySquare from "../DaySquare";
import "./gallery.css";

const STATUSES = ["entered", "needs-entry", "overdue", "upcoming", "off"];

const STATUS_SAMPLE = {
  entered:       { meals: 250, revenue: 6420 },
  "needs-entry": { meals: 240, revenue: 5840, isEstimated: true },
  overdue:       { meals: 220, revenue: 5280 },
  upcoming:      { meals: 200, revenue: 4800 },
  off:           null,
};

export default function AtomGallery() {
  return (
    <div className="gallery-root" data-density="comfortable">
      <header className="gallery-header">
        <h1>DaySquare atom - state gallery</h1>
        <p>
          Stage 0 deliverable. The atom is the SINGLE source of day rendering
          for the redesigned SC. Every variant lives here so Kevin can verify
          the contract before any Stage 1+ layout consumes it.
        </p>
        <p className="gallery-note">
          Route: <code>/service-calendar/atom-gallery</code> (dev-only, not
          linked from production nav). Delete after Stage 5 polymorphism
          hardening if not needed.
        </p>
      </header>

      {/* 1. All statuses x both sizes ─────────────────────────────────── */}
      <Section title="1. Status states - lg" hint="The full atom at workspace size. Per-meal content shown.">
        <Row>
          {STATUSES.map((status) => (
            <Cell key={status} label={status}>
              <DaySquare
                date="2026-06-15"
                status={status}
                size="lg"
                kind="per-meal"
                content={STATUS_SAMPLE[status]}
                onClick={() => {}}
              />
            </Cell>
          ))}
        </Row>
      </Section>

      <Section title="1b. Status states - sm" hint="The atom at year-grid size. Content collapses to compact form.">
        <Row tight>
          {STATUSES.map((status) => (
            <Cell key={status} label={status}>
              <DaySquare
                date="2026-06-15"
                status={status}
                size="sm"
                kind="per-meal"
                content={STATUS_SAMPLE[status]}
                onClick={() => {}}
              />
            </Cell>
          ))}
        </Row>
      </Section>

      {/* 2. Today ring over each status ───────────────────────────────── */}
      <Section title="2. Today ring over each status" hint="The today signal is a ring layered ON TOP of the status fill. Today is never color-alone.">
        <Row>
          {STATUSES.map((status) => (
            <Cell key={status} label={`${status} + today`}>
              <DaySquare
                date="2026-06-15"
                status={status}
                size="lg"
                kind="per-meal"
                content={STATUS_SAMPLE[status]}
                isToday
                onClick={() => {}}
              />
            </Cell>
          ))}
        </Row>
        <Row tight>
          {STATUSES.map((status) => (
            <Cell key={status} label={`${status} + today (sm)`}>
              <DaySquare
                date="2026-06-15"
                status={status}
                size="sm"
                kind="per-meal"
                content={STATUS_SAMPLE[status]}
                isToday
                onClick={() => {}}
              />
            </Cell>
          ))}
        </Row>
      </Section>

      {/* 3. Selected, today+selected, today+selected+focused ─────────── */}
      <Section
        title="3. Overlay-ring composition (the three-ring test)"
        hint="Focused (keyboard) + selected (bulk-pick) + today (date) must compose without visual collision. The pre-mortem flagged this; the rings live on distinct outset/inset offsets."
      >
        <Row>
          <Cell label="selected only">
            <DaySquare date="2026-06-15" status="entered" size="lg" kind="per-meal"
              content={STATUS_SAMPLE.entered} isSelected onClick={() => {}} />
          </Cell>
          <Cell label="focused only">
            <DaySquare date="2026-06-15" status="entered" size="lg" kind="per-meal"
              content={STATUS_SAMPLE.entered} isFocused onClick={() => {}} />
          </Cell>
          <Cell label="today + selected">
            <DaySquare date="2026-06-15" status="entered" size="lg" kind="per-meal"
              content={STATUS_SAMPLE.entered} isToday isSelected onClick={() => {}} />
          </Cell>
          <Cell label="today + focused">
            <DaySquare date="2026-06-15" status="entered" size="lg" kind="per-meal"
              content={STATUS_SAMPLE.entered} isToday isFocused onClick={() => {}} />
          </Cell>
          <Cell label="focused + selected">
            <DaySquare date="2026-06-15" status="entered" size="lg" kind="per-meal"
              content={STATUS_SAMPLE.entered} isFocused isSelected onClick={() => {}} />
          </Cell>
          <Cell label="ALL THREE">
            <DaySquare date="2026-06-15" status="entered" size="lg" kind="per-meal"
              content={STATUS_SAMPLE.entered} isToday isSelected isFocused onClick={() => {}} />
          </Cell>
        </Row>
        <p className="gallery-fineprint">
          Verify: today's navy ring (outermost) survives even with selected's
          teal ring around it; focused's inner inset survives without
          colliding with either outer ring. If any pair eats another, the
          stacking offsets need adjustment.
        </p>
      </Section>

      {/* 4. Polymorphic content layer at lg ──────────────────────────── */}
      <Section
        title="4. Polymorphic content (lg)"
        hint="Same atom; the middle line forks by account kind. STL-FL discipline: fee-no-dollar renders ZERO $ tokens structurally."
      >
        <Row>
          <Cell label="per-meal (CIN-AZ)">
            <DaySquare date="2026-06-15" status="entered" size="lg" kind="per-meal"
              content={{ revenue: 6420, meals: 250 }} onClick={() => {}} />
          </Cell>
          <Cell label="mlb-fee (STL-MO)">
            <DaySquare date="2026-06-15" status="entered" size="lg" kind="mlb-fee"
              content={{ opponent: "NYM", meals: 320 }} onClick={() => {}} />
          </Cell>
          <Cell label="milb day (CIN-KY)">
            <DaySquare date="2026-06-15" status="entered" size="lg" kind="milb"
              content={{ milbPill: "day", meals: 180 }} onClick={() => {}} />
          </Cell>
          <Cell label="milb night">
            <DaySquare date="2026-06-15" status="entered" size="lg" kind="milb"
              content={{ milbPill: "night", meals: 195 }} onClick={() => {}} />
          </Cell>
          <Cell label="fee-no-dollar (STL-FL)">
            <DaySquare date="2026-06-15" status="entered" size="lg" kind="fee-no-dollar"
              content={{ served: 145 }} onClick={() => {}} />
          </Cell>
        </Row>
      </Section>

      {/* 5. Small + without middle line ───────────────────────────────── */}
      <Section title="5. Small size variations" hint="Compact form in dense grids. Middle line collapses gracefully; on the smallest densities it can be hidden entirely.">
        <Row tight>
          <Cell label="sm + content">
            <DaySquare date="2026-06-15" status="entered" size="sm" kind="per-meal"
              content={{ revenue: 6420, meals: 250 }} onClick={() => {}} />
          </Cell>
          <Cell label="sm + no content">
            <DaySquare date="2026-06-15" status="entered" size="sm" kind="per-meal"
              content={null} onClick={() => {}} />
          </Cell>
          <Cell label="sm + mlb-fee">
            <DaySquare date="2026-06-15" status="entered" size="sm" kind="mlb-fee"
              content={{ opponent: "NYM" }} onClick={() => {}} />
          </Cell>
          <Cell label="sm + milb day">
            <DaySquare date="2026-06-15" status="entered" size="sm" kind="milb"
              content={{ milbPill: "day" }} onClick={() => {}} />
          </Cell>
        </Row>
      </Section>

      {/* 6. Edge cases ─────────────────────────────────────────────── */}
      <Section title="6. Edge cases" hint="The realities the brief flagged: 4-digit meal counts, off-season, estimated amber.">
        <Row>
          <Cell label="4-digit meals (lg)">
            <DaySquare date="2026-06-15" status="entered" size="lg" kind="per-meal"
              content={{ revenue: 28400, meals: 1240 }} onClick={() => {}} />
          </Cell>
          <Cell label="4-digit meals (sm) - compact">
            <DaySquare date="2026-06-15" status="entered" size="sm" kind="per-meal"
              content={{ revenue: 28400, meals: 1240 }} onClick={() => {}} />
          </Cell>
          <Cell label="off-season (lg)">
            <DaySquare date="2026-12-25" status="off" size="lg" kind="per-meal"
              content={null} onClick={() => {}} />
          </Cell>
          <Cell label="estimated amber (est. prefix)">
            <DaySquare date="2026-06-10" status="needs-entry" size="lg" kind="per-meal"
              content={{ revenue: 5840, meals: 240, isEstimated: true }} onClick={() => {}} />
          </Cell>
          <Cell label="non-interactive (no onClick)">
            <DaySquare date="2026-06-15" status="entered" size="lg" kind="per-meal"
              content={{ revenue: 6420, meals: 250 }} />
          </Cell>
        </Row>
      </Section>

      {/* 7. Mini calendar (sm in a 7-wide grid, the year-card preview) ── */}
      <Section title="7. Mini calendar - a 7x4 grid (year-card preview)" hint="What 28 sm squares look like in a card-shaped container. The Stage 1 month-card and Stage 2 period-card will render this shape.">
        <div className="gallery-mini-card">
          <div className="gallery-mini-grid">
            {Array.from({ length: 28 }).map((_, i) => {
              const dayNum = i + 1;
              const status = pickDemoStatus(i);
              const isToday = dayNum === 15;
              return (
                <DaySquare
                  key={i}
                  dateNumber={dayNum}
                  status={status}
                  size="sm"
                  kind="per-meal"
                  content={status === "off" ? null : { revenue: 4000 + i * 100, meals: 200 + i * 5 }}
                  isToday={isToday}
                  onClick={() => {}}
                />
              );
            })}
          </div>
        </div>
      </Section>

      <footer className="gallery-footer">
        Gallery only. Status logic, data loading, DayDetail wiring all live
        upstream. The atom takes resolved props and renders. That is the
        entire contract.
      </footer>
    </div>
  );
}

// ────────── small layout helpers (gallery scaffolding only) ──────────

function Section({ title, hint, children }) {
  return (
    <section className="gallery-section">
      <h2 className="gallery-section-title">{title}</h2>
      {hint && <p className="gallery-section-hint">{hint}</p>}
      {children}
    </section>
  );
}

function Row({ children, tight }) {
  return <div className={`gallery-row ${tight ? "gallery-row--tight" : ""}`}>{children}</div>;
}

function Cell({ label, children }) {
  return (
    <div className="gallery-cell">
      <div className="gallery-cell-frame">{children}</div>
      <div className="gallery-cell-label">{label}</div>
    </div>
  );
}

function pickDemoStatus(i) {
  // A demo distribution that puts visible variety in the mini calendar.
  if (i % 7 === 6) return "off"; // Sundays
  if (i < 10) return "entered";
  if (i < 14) return "needs-entry";
  if (i === 14) return "overdue";
  return "upcoming";
}
