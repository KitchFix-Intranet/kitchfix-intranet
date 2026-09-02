"use client";

// The Academy shell. Navy command bar as the LID of a single
// bordered container - bar + body share one border, one shadow,
// one 14px radius. Four tabs render; only Library resolves. The
// other three (Academy, Records, Admin) are visibly present but
// INERT: they show the product's shape without inventing content.
//
// Inert tab communication (no fake screen behind it):
//   1. Muted color + reduced weight so the eye reads them as
//      secondary.
//   2. aria-disabled="true" so screen readers announce them as
//      unavailable.
//   3. cursor: not-allowed on hover.
//   4. Clicking swaps the sbody to a small, explicit stub that
//      names the room, states it is not yet built, and points at
//      the PR ladder note. NOT a coming-soon splash - a labelled
//      placeholder that could not be mistaken for content.
//
// This preserves the product's shape ("there are four rooms") while
// making it impossible to mistake an inert tab for a real one.

import { useState } from "react";
import LibraryRoom from "./LibraryRoom";
import AcademyRoom from "./AcademyRoom";
import RecordsRoom from "./RecordsRoom";

const TABS = [
  { id: "academy",  label: "Academy", ready: true  },
  { id: "library",  label: "Library", ready: true  },
  { id: "records",  label: "Records", ready: true  },
  { id: "admin",    label: "Admin",   ready: false },
];

function InertRoom({ label }) {
  // A labelled placeholder, not a splash. Names the room, states
  // it is not built yet, points at where the work sits in the PR
  // ladder. Deliberately quiet: this surface is a scaffold, not a
  // teaser.
  return (
    <div className="opd-inert" role="status" aria-live="polite">
      <div className="opd-inert-card">
        <div className="opd-inert-eyebrow">{label} room</div>
        <p className="opd-inert-body">
          Not built in this PR. The rail-plus-content shape mirrors
          Library; the data behind it (requirements, cycles,
          attestations, admin worklist) lands in a later PR.
        </p>
        <p className="opd-inert-note">
          See <code>docs/opd/ACADEMY_MASTER_SPEC.md</code> Section
          15 for the PR ladder.
        </p>
      </div>
    </div>
  );
}

export default function OpdShell({ viewerEmail }) {
  const [tab, setTab] = useState("academy");
  const today = new Date();
  const monthDay = today.toLocaleString("en-US", { month: "short", day: "numeric" }).toUpperCase();

  return (
    <div className="opd-frame opd-app">
      <div className="opd-shell">

        {/* ── Command bar (the lid) ────────────────────────────── */}
        <div className="opd-cmd">
          <span className="opd-cmd-title">Operational Playbook</span>
          <span className="opd-cmd-sep" aria-hidden="true" />

          <div className="opd-tabs" role="tablist" aria-label="Playbook rooms">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-disabled={t.ready ? undefined : "true"}
                className={
                  "opd-tab" +
                  (tab === t.id ? " opd-tab--on" : "") +
                  (t.ready ? "" : " opd-tab--inert")
                }
                onClick={() => setTab(t.id)}
                title={t.ready ? undefined : `${t.label} is not built in this PR`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="opd-cmd-today" aria-label="Today's date and cycle context">
            <span className="opd-cmd-today-strong">TODAY {monthDay}</span>
          </div>
        </div>

        {/* ── Body ────────────────────────────────────────────────── */}
        <div className="opd-sbody">
          {tab === "library" ? (
            <LibraryRoom viewerEmail={viewerEmail} />
          ) : tab === "academy" ? (
            <AcademyRoom viewerEmail={viewerEmail} />
          ) : tab === "records" ? (
            <RecordsRoom viewerEmail={viewerEmail} />
          ) : (
            <InertRoom
              label={TABS.find((t) => t.id === tab)?.label || "This"}
            />
          )}
        </div>

      </div>
    </div>
  );
}
