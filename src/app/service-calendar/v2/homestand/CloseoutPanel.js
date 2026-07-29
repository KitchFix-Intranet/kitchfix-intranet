"use client";

// M-3 (2026-08-XX): homestand close-out surface.
//
// Owner scope C4 + C3.2 + H6. Two inputs, nobody types a count:
//   - Service confirmation: derived + chef marks exception days
//   - Labor actual: one figure with an attribution window explanation
//
// State-driven visibility (per C3.2, owner ruling 2026-07-29):
//   upcoming    - not rendered
//   in-progress - rendered but disabled ("opens after ...")
//   actuals-due - active confirm surface
//   closed-out  - summary + reopen button (or the reopen form when
//                 the chef has clicked reopen and is entering the
//                 new figure)
//
// Exception scope (Q7B ruling): game days inside
// [block.startDate, block.endDate] only. Not the attribution window,
// not prep days.
//
// Missing-projection rule enforced server-side. This surface never
// silently writes a zero on a missing-count day - the API refuses
// the confirm and returns { missingProjections: [...] } which the
// panel renders back to the chef.
//
// Atomicity: confirm posts sc-submit-closeout to the route, which
// calls the RPC. Either every write lands or none. The confirm
// button is disabled while the request is in flight (SQL Note 3;
// "server guard for correctness, client guard for dignity").

import { useCallback, useMemo, useState } from "react";
import { fmt$ } from "../../season/format";

const MON_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDayLabel(iso) {
  const d = new Date(iso + "T12:00:00");
  return `${MON_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function fmtRangeCaption(startIso, endIso) {
  if (!startIso || !endIso) return "";
  const s = new Date(startIso + "T12:00:00");
  const e = new Date(endIso + "T12:00:00");
  const startLabel = `${MON_SHORT[s.getMonth()]} ${s.getDate()}`;
  const endLabel = e.getMonth() === s.getMonth()
    ? `${e.getDate()}`
    : `${MON_SHORT[e.getMonth()]} ${e.getDate()}`;
  return `${startLabel} - ${endLabel}`;
}

// M-3 Defect 5 fix (2026-08-XX live-gate bounce): variance display.
// The over case labels itself ("over budget, carries to season
// total"); the under case renders a naked negative number in green
// and a chef has to stop and decode the mixed signal. Match the two
// shapes: absolute figure + word.
//
// Signed convention: variance = actual - budget.
//   > 0 => over budget  (bad, red)
//   < 0 => under budget (good, green)
//   = 0 => on budget
// Displayed absolute so the sign doesn't fight the word.
// Exported so the homestand rail (§5.5) can reuse the same vocabulary
// once a live close-out exists. One truth for over/under/on-budget copy.
export function VarianceCell({ variance, showCarryToSeason }) {
  const isOver = variance > 0;
  const isUnder = variance < 0;
  const abs = Math.abs(variance);
  const label = isOver
    ? (showCarryToSeason ? " over budget, carries to season total" : " over budget")
    : isUnder
      ? " under budget"
      : " on budget";
  return (
    <>
      {isOver ? "+" : ""}{fmt$(abs)}
      <span className="sc-closeout-variance-note">{label}</span>
    </>
  );
}

export function varianceClass(variance) {
  if (variance > 0) return "sc-closeout-variance--over";
  if (variance < 0) return "sc-closeout-variance--under";
  return "sc-closeout-variance--on";
}

// Day-strip domain intersected with game-only dates: iterate the
// dayMap keyed on dates inside [startDate, endDate] and pick the
// ones that carry dayType === "GAME". Same source of truth the
// homestand payload used, so the count matches block.gameCount.
function gameDaysFromDayMap(dayMap, startDate, endDate) {
  if (!dayMap || !startDate || !endDate) return [];
  const out = [];
  for (const [iso, d] of dayMap.entries()) {
    if (iso < startDate || iso > endDate) continue;
    if (d && d.dayType === "GAME") {
      out.push({
        date: iso,
        opponent: d.opponent || "",
        status: d.status || null,
      });
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export default function CloseoutPanel({
  account,
  block,          // one homestand from year-summary.homestands[]
  dayMap,         // Map<isoDate, dayEntry> from yearData
  todayIso,
  onSaved,        // called after a successful confirm; triggers refetch
  showToast,
}) {
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [missingProjections, setMissingProjections] = useState([]);
  const [exceptionSet, setExceptionSet] = useState(() => new Set());
  const [laborActualInput, setLaborActualInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [reopenMode, setReopenMode] = useState(false);
  const [reopenReasonInput, setReopenReasonInput] = useState("");
  // M-3 Defect 1 fix (2026-08-XX owner ruling): mid-block archive
  // skips are shown to the chef post-confirm so nothing gets
  // discovered in the data later. Clears on the next render (the
  // reload refetches the payload and remounts the summary).
  const [skippedByArchive, setSkippedByArchive] = useState([]);

  const gameDays = useMemo(
    () => gameDaysFromDayMap(dayMap, block?.startDate, block?.endDate),
    [dayMap, block?.startDate, block?.endDate]
  );

  const toggleException = useCallback((iso) => {
    setExceptionSet((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso); else next.add(iso);
      return next;
    });
  }, []);

  // Post the confirm. Returns void; caller inspects saveError /
  // missingProjections in state after the await.
  const submitConfirm = useCallback(async () => {
    if (saving) return;                    // client-side dignity guard
    setSaving(true);
    setSaveError(null);
    setMissingProjections([]);
    setSkippedByArchive([]);

    // M-3 Defect 3 fix (2026-08-XX): presence check before coerce.
    // See the validLabor comment below - "" is missing, not zero.
    const trimmed = laborActualInput.trim();
    if (trimmed.length === 0) {
      setSaveError("Enter the labor actual before confirming.");
      setSaving(false);
      return;
    }
    const laborActual = Number(trimmed);
    if (!Number.isFinite(laborActual) || laborActual < 0) {
      setSaveError("Enter a non-negative labor actual.");
      setSaving(false);
      return;
    }
    if (reopenMode && !reopenReasonInput.trim()) {
      setSaveError("Reopen reason is required.");
      setSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/service-calendar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sc-submit-closeout",
          accountKey: account?.key,
          homestandKey: String(block.key),
          exceptions: Array.from(exceptionSet),
          laborActual,
          laborSource: "manual",
          notes: notesInput.trim() || null,
          reopenReason: reopenMode ? reopenReasonInput.trim() : null,
          clientToday: todayIso,
        }),
      });
      const result = await res.json();
      if (!result.success) {
        setSaveError(result.error || "Confirm failed.");
        if (Array.isArray(result.missingProjections)) {
          setMissingProjections(result.missingProjections);
        }
        setSaving(false);
        return;
      }
      const skips = Array.isArray(result.skippedByArchive) ? result.skippedByArchive : [];
      setSkippedByArchive(skips);
      if (showToast) {
        const skipNote = skips.length > 0 ? `; ${skips.length} archived-service skip${skips.length === 1 ? "" : "s"}` : "";
        showToast(
          (reopenMode ? "Homestand reopened + reconfirmed" : "Homestand closed out") + skipNote,
          "success"
        );
      }
      // Reset inputs; parent refetches the payload.
      setLaborActualInput("");
      setNotesInput("");
      setReopenMode(false);
      setReopenReasonInput("");
      setExceptionSet(new Set());
      if (onSaved) onSaved(result);
    } catch (e) {
      setSaveError(`Network error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }, [saving, laborActualInput, reopenMode, reopenReasonInput, account, block, exceptionSet, notesInput, todayIso, onSaved, showToast]);

  if (!block) return null;

  // upcoming: nothing rendered.
  if (block.status === "upcoming") return null;

  // in-progress: disabled placeholder until the last game.
  if (block.status === "in-progress") {
    return (
      <section
        className="sc-closeout sc-closeout--in-progress"
        aria-labelledby="sc-closeout-head"
      >
        <h2 id="sc-closeout-head" className="sc-closeout-title">Close-out</h2>
        <p className="sc-closeout-locked-note">
          Opens after the last game on {fmtDayLabel(block.endDate)}.
        </p>
      </section>
    );
  }

  // closed-out (not-yet-reopening): summary + reopen button.
  if (block.status === "closed-out" && !reopenMode) {
    const laborActual = block.laborActual;
    const budgetSnap = block.budgetSnapshotAtCloseout;
    const variance = (laborActual != null && budgetSnap != null)
      ? laborActual - budgetSnap
      : null;
    return (
      <section
        className="sc-closeout sc-closeout--closed"
        aria-labelledby="sc-closeout-head"
      >
        <h2 id="sc-closeout-head" className="sc-closeout-title">Close-out</h2>
        <dl className="sc-closeout-summary">
          <div className="sc-closeout-summary-row">
            <dt>Labor actual</dt>
            <dd>{laborActual != null ? fmt$(laborActual) : "not set"}</dd>
          </div>
          <div className="sc-closeout-summary-row">
            <dt>Budget snapshot</dt>
            <dd>{budgetSnap != null ? fmt$(budgetSnap) : (block.budgetReason || "no budget at close-out")}</dd>
          </div>
          {variance != null && (
            <div className={`sc-closeout-summary-row sc-closeout-variance ${varianceClass(variance)}`}>
              <dt>Variance</dt>
              <dd>
                <VarianceCell variance={variance} showCarryToSeason={false} />
              </dd>
            </div>
          )}
          <div className="sc-closeout-summary-row sc-closeout-summary-provenance">
            <dt>Source</dt>
            <dd>{block.laborSource === "rippling_import" ? "Rippling import" : "Manual entry"}</dd>
          </div>
        </dl>
        <button
          type="button"
          className="sc-closeout-btn sc-closeout-btn--secondary"
          onClick={() => {
            setReopenMode(true);
            setLaborActualInput(String(laborActual ?? ""));
          }}
        >
          Reopen
        </button>
      </section>
    );
  }

  // actuals-due (first confirm) OR closed-out with reopenMode true.
  const enteredCount = gameDays.length - exceptionSet.size;

  // M-3 Defect 3 fix (2026-08-XX live-gate bounce): guard on the
  // RAW STRING BEING PRESENT before coercing to a number. Number("")
  // is 0, which passes every downstream shape check (isFinite, >= 0,
  // schema CHECK). An empty labor field is missing, not zero -
  // clicking Confirm without typing would permanently record $0 on
  // a write path where it becomes permanent data. The whole missing-
  // vs-zero rule exists to stop exactly this. Server also refuses
  // laborActual==null (see sc-submit-closeout route) but the client
  // gate is the primary defense.
  //
  // A chef who explicitly types "0" (all-salaried homestand, chef
  // worked zero hourly) is a legitimate entry. String "0" is present
  // and passes; empty string does not.
  const laborInputTrimmed = laborActualInput.trim();
  const laborInputPresent = laborInputTrimmed.length > 0;
  const laborActualNum = laborInputPresent ? Number(laborInputTrimmed) : NaN;
  const validLabor = laborInputPresent
    && Number.isFinite(laborActualNum)
    && laborActualNum >= 0;
  const budgetForVariance = block.budget?.amount ?? null;
  const varianceLive = (validLabor && budgetForVariance != null)
    ? laborActualNum - budgetForVariance
    : null;

  return (
    <section
      className="sc-closeout sc-closeout--active"
      aria-labelledby="sc-closeout-head"
    >
      <h2 id="sc-closeout-head" className="sc-closeout-title">
        {reopenMode ? "Reopen close-out" : "Close-out"}
      </h2>

      {reopenMode && (
        <div className="sc-closeout-reopen-context" role="note">
          <p>
            Prior close-out: {block.laborActual != null ? fmt$(block.laborActual) : "not set"}
            {block.laborSource === "rippling_import" ? " (Rippling import)" : " (manual entry)"}.
            Prior budget snapshot: {block.budgetSnapshotAtCloseout != null ? fmt$(block.budgetSnapshotAtCloseout) : (block.budgetReason || "no budget at close-out")}.
          </p>
        </div>
      )}

      {/* Service confirmation table. Game days only, span-only per Q7B. */}
      <div className="sc-closeout-section">
        <h3 className="sc-closeout-section-title">Service confirmation</h3>
        <p className="sc-closeout-section-caption">
          {gameDays.length} game days.
          {" "}
          Mark any day that did not run.
        </p>
        <ul className="sc-closeout-daylist" role="list">
          {gameDays.map((g) => {
            const isEx = exceptionSet.has(g.date);
            return (
              <li key={g.date} className="sc-closeout-daylist-item">
                <label className="sc-closeout-daylist-label">
                  <input
                    type="checkbox"
                    checked={isEx}
                    onChange={() => toggleException(g.date)}
                    disabled={saving}
                  />
                  <span className="sc-closeout-daylist-date">{fmtDayLabel(g.date)}</span>
                  {g.opponent && (
                    <span className="sc-closeout-daylist-opp">vs {g.opponent}</span>
                  )}
                  {isEx && <span className="sc-closeout-daylist-flag">exception</span>}
                </label>
              </li>
            );
          })}
        </ul>
        <p className="sc-closeout-section-caption">
          {enteredCount} game days served, {exceptionSet.size} exception{exceptionSet.size === 1 ? "" : "s"}.
        </p>
      </div>

      {/* Labor actual + attribution window. */}
      <div className="sc-closeout-section">
        <h3 className="sc-closeout-section-title">Labor actual</h3>
        <p className="sc-closeout-section-caption">
          Covers {fmtRangeCaption(block.windowStart, block.windowEnd)}, including days between homestands.
        </p>
        <div className="sc-closeout-labor-row">
          <label className="sc-closeout-labor-input">
            <span className="sc-closeout-labor-input-dollar" aria-hidden="true">$</span>
            <input
              type="text"
              inputMode="decimal"
              value={laborActualInput}
              onChange={(e) => setLaborActualInput(e.target.value.replace(/[^0-9.]/g, ""))}
              placeholder="0.00"
              disabled={saving}
              aria-label="Labor actual in dollars"
            />
          </label>
          <button
            type="button"
            className="sc-closeout-btn sc-closeout-btn--rippling"
            disabled
            title="Rippling import lands here at M-6."
          >
            Rippling import
          </button>
        </div>
      </div>

      {/* Reopen reason input (reopen mode only). */}
      {reopenMode && (
        <div className="sc-closeout-section">
          <h3 className="sc-closeout-section-title">Reopen reason</h3>
          <input
            type="text"
            className="sc-closeout-reason-input"
            value={reopenReasonInput}
            onChange={(e) => setReopenReasonInput(e.target.value)}
            placeholder="Why are you reopening this close-out?"
            maxLength={280}
            disabled={saving}
            aria-label="Reopen reason"
          />
        </div>
      )}

      {/* Optional notes. */}
      <div className="sc-closeout-section">
        <h3 className="sc-closeout-section-title">Notes (optional)</h3>
        <textarea
          className="sc-closeout-notes-input"
          value={notesInput}
          onChange={(e) => setNotesInput(e.target.value)}
          placeholder="Anything about this close-out to record."
          maxLength={500}
          rows={2}
          disabled={saving}
          aria-label="Optional notes"
        />
      </div>

      {/* Live budget vs actual vs variance summary. */}
      <dl className="sc-closeout-summary">
        <div className="sc-closeout-summary-row">
          <dt>Budget</dt>
          <dd>{budgetForVariance != null ? fmt$(budgetForVariance) : (block.budgetReason || "no budget")}</dd>
        </div>
        <div className="sc-closeout-summary-row">
          <dt>Actual</dt>
          {/* M-3 Defect 4 fix (2026-08-XX): "not entered" is not
              "$0.00." Renders the honest empty state until a value
              is present - matches the standing missing-vs-zero rule
              the rest of the system already holds
              (laborBudgetDerivation null-with-reason, admin panel
              "not set"). Muted to distinguish from real figures. */}
          <dd className={!validLabor ? "sc-closeout-actual-empty" : undefined}>
            {validLabor ? fmt$(laborActualNum) : "not entered"}
          </dd>
        </div>
        {/* Variance row hides until an actual is present. Owner
            ruling: nothing to compare, nothing to display. */}
        {varianceLive != null && (
          <div className={`sc-closeout-summary-row sc-closeout-variance ${varianceClass(varianceLive)}`}>
            <dt>Variance</dt>
            <dd>
              <VarianceCell variance={varianceLive} showCarryToSeason={true} />
            </dd>
          </div>
        )}
      </dl>

      {/* Missing-projection surface: server refuses when any non-
          exception game day has no projection. Render the list so
          the chef can either mark those days as exceptions or ask
          admin to add the projection. */}
      {missingProjections.length > 0 && (
        <div className="sc-closeout-missing" role="alert">
          <strong>Cannot confirm:</strong> {missingProjections.length} game day{missingProjections.length === 1 ? "" : "s"} with no projection.
          Mark them as exceptions or ask admin to add the projection.
          <ul>
            {missingProjections.map((m, i) => (
              <li key={`${m.service_date}-${m.service_id}-${i}`}>
                {fmtDayLabel(m.service_date)} - {m.service_name}
              </li>
            ))}
          </ul>
        </div>
      )}

      {saveError && !missingProjections.length && (
        <div className="sc-closeout-error" role="alert">{saveError}</div>
      )}

      {/* Post-confirm archive-skip surface (M-3 Defect 1 fix).
          Cleared on the next mount when the reload refetches the
          payload. */}
      {skippedByArchive.length > 0 && (
        <div className="sc-closeout-archive-skip" role="status">
          <strong>{skippedByArchive.length} archived-service skip{skippedByArchive.length === 1 ? "" : "s"}:</strong>
          <ul>
            {skippedByArchive.slice(0, 8).map((s, i) => (
              <li key={`${s.service_date}-${s.service_id}-${i}`}>
                {fmtDayLabel(s.service_date)} - {s.service_name} (archived {String(s.active_until).slice(0, 10)})
              </li>
            ))}
            {skippedByArchive.length > 8 && (
              <li>… and {skippedByArchive.length - 8} more</li>
            )}
          </ul>
        </div>
      )}

      <div className="sc-closeout-actions">
        {reopenMode && (
          <button
            type="button"
            className="sc-closeout-btn sc-closeout-btn--secondary"
            onClick={() => {
              setReopenMode(false);
              setSaveError(null);
              setMissingProjections([]);
            }}
            disabled={saving}
          >
            Cancel reopen
          </button>
        )}
        <button
          type="button"
          className="sc-closeout-btn sc-closeout-btn--primary"
          onClick={submitConfirm}
          disabled={saving || !validLabor || (reopenMode && !reopenReasonInput.trim())}
        >
          {saving
            ? "Saving..."
            : reopenMode
              ? "Confirm reopen"
              : "Confirm close-out"}
        </button>
      </div>
    </section>
  );
}
