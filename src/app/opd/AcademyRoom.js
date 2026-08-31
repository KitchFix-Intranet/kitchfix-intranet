"use client";

// Academy room. Rail (profile) + content (greet, queue, year track,
// company standing). One bundled fetch to /api/academy/room; local
// focus state opens the Focus view for a queue row without leaving
// the shell.
//
// Ships four states on every list (spec law - not optional):
//   skeleton   before the first fetch resolves
//   ready      queue + year + standing rendered against real data
//   empty      viewer has zero requirements: "Nothing needs you"
//              (this is a valid state, not an error - a person with
//              no cycle audience is legitimately clear)
//   error      dashed-brick pattern; never zero and never blank
//
// Discipline enforced by construction in this PR:
//   1. NO percentage anywhere. With zero attestations, a percentage
//      is technically 0% and rhetorically a lie of emphasis. Counts
//      plainly instead.
//   2. NO "Everything else is current" copy while queue has zero
//      completions. "Current" is only true once something is signed.
//   3. Year track: months without a cycle render NEUTRAL, never green.
//   4. Company standing: not-enrolled renders visually distinct from
//      current, with the legend mounted on the surface.
//   5. NO signature affordance anywhere. Queue rows open the Focus
//      view; that's the only interactive verb on any row.
//   6. Badge wall: every obligation the person owes shows as an
//      unearned/awaiting slot. No invented points.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AcademyFocus from "./AcademyFocus";

const EMPTY_ARR = Object.freeze([]);

function formatMonthDay(iso) {
  if (!iso) return null;
  try {
    const d = new Date(`${iso}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return null; }
}

// Compact obligation-key -> badge label. Everything is a "lock" state
// in PR 8 (nothing is signed), so the label is a mnemonic hint at what
// the credential will be, not a claim of achievement.
function badgeLabelFor(key) {
  if (!key) return "?";
  const parts = String(key).split("-");
  // Prefer first two words' initials so "culture-os-standard-annual"
  // becomes "CS" and "big-rules-onboarding" becomes "BR".
  const letters = parts.slice(0, 2).map((p) => p[0] ? p[0].toUpperCase() : "");
  const compact = letters.join("");
  if (compact.length >= 2) return compact;
  // Fallback: first 3 chars of the key.
  return String(key).slice(0, 3).toUpperCase();
}

function DashedBrick({ scope, message, onRetry }) {
  return (
    <div className="opd-brick" role="alert">
      <div className="opd-brick-title">Could not load {scope}</div>
      <p className="opd-brick-body">{message || "Refresh the page or try again in a moment."}</p>
      {onRetry ? (
        <button type="button" className="opd-brick-retry" onClick={onRetry}>Retry</button>
      ) : null}
    </div>
  );
}

// ── Rail (Profile) ────────────────────────────────────────────────
function ProfileRail({ viewer, queueSummary, queueLength, loading }) {
  const scopeLabel = viewer?.isCorp
    ? "CORP · ALL REGIONS"
    : viewer?.accountKey && viewer?.region
      ? `${viewer.accountKey} · ${viewer.region}`
      : viewer?.accountKey || "";
  const initial = (viewer?.displayName || "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "?";

  return (
    <div className="opd-card opd-profile">
      <div className="opd-profile-id">
        <div className="opd-profile-avatar" aria-hidden="true">{initial}</div>
        <h2 className="opd-profile-name">{viewer?.displayName || "Loading"}</h2>
        {scopeLabel ? <div className="opd-profile-loc">{scopeLabel}</div> : null}
      </div>

      {/* Standing block. Counts plainly - no percentage, no meter.
          Rule: no percentage until there is history. */}
      <div className="opd-profile-sec" data-block="standing">
        <span className="opd-k">Standing · September 2026</span>
        {loading ? (
          <div className="opd-standing-loading" aria-busy="true">
            <span className="opd-skel opd-skel--bar opd-skel--w40" />
          </div>
        ) : queueLength === 0 ? (
          <div className="opd-standing-empty">
            <p className="opd-standing-empty-line">Nothing needs you right now.</p>
            <p className="opd-standing-empty-sub">No requirements have been issued to your queue.</p>
          </div>
        ) : (
          <div className="opd-standing-body">
            <div className="opd-standing-top">
              <span className="opd-standing-count num">{queueLength}</span>
              <span className="opd-standing-noun">{queueLength === 1 ? "item" : "items"}</span>
            </div>
            <div className="opd-standing-sub">
              <span className="num">{queueSummary?.totalMinutes || 0}</span> min · due Sep 30
            </div>
            <p className="opd-standing-help">
              Percentages appear once you have signed history. Nothing has been
              signed yet.
            </p>
          </div>
        )}
      </div>

      {/* Badge wall. One slot per obligation the person owes, all in
          the unearned state so the wall shows what is ahead rather
          than an empty box. Legend below matches the label copy. */}
      <div className="opd-profile-sec" data-block="badges">
        <span className="opd-k">Credentials · {queueLength} awaiting</span>
        {loading ? (
          <div className="opd-bwall" aria-busy="true">
            {[0,1,2,3].map((i) => (
              <div key={i} className="opd-bdge opd-bdge--skel" />
            ))}
          </div>
        ) : queueLength === 0 ? (
          <p className="opd-badges-empty">No credentials in your queue.</p>
        ) : (
          <div className="opd-bwall" role="list" aria-label="Credentials in your queue (none earned yet)">
            {(queueSummary?.badges || []).map((b) => (
              <div
                key={b.key}
                className="opd-bdge opd-bdge--awaiting"
                role="listitem"
                title={`${b.docId} · ${b.obligationKey} · awaiting signature (not built in PR 8)`}
              >
                <span className="opd-bdge-glyph" aria-hidden="true">&#128274;</span>
                <span className="opd-bdge-label">{b.label}</span>
              </div>
            ))}
          </div>
        )}
        <div className="opd-bwall-legend">
          <span><span className="opd-bwall-swatch opd-bwall-swatch--awaiting" aria-hidden="true" /> Awaiting</span>
          <span>{queueLength} available</span>
        </div>
      </div>

      {/* Reserved slot - carried from the v4 render. Communicates that
          the profile grows to hold KPI accountabilities + service
          assignments once those tabs land. */}
      <div className="opd-profile-reserved">
        <div className="opd-profile-reserved-line">
          RESERVED · SERVICE ASSIGNMENTS
        </div>
        <div className="opd-profile-reserved-line">
          KPI ACCOUNTABILITIES · DIRECTORY
        </div>
      </div>
    </div>
  );
}

// ── Content: Greeting + Queue ─────────────────────────────────────
function Greeting({ viewer, queueSummary, queueLength }) {
  const first = (viewer?.displayName || "").split(" ")[0] || "";
  if (queueLength === 0) {
    return (
      <div className="opd-card opd-greet">
        <div className="opd-greet-body">
          <span className="opd-k">Academy · September 2026</span>
          <h1 className="opd-greet-h1">
            {first ? `Nothing needs you right now, ${first}.` : "Nothing needs you right now."}
          </h1>
          <p className="opd-greet-p">
            Your queue is empty. When the next cycle publishes, requirements
            appear here with a due date.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="opd-card opd-greet">
      <div className="opd-greet-body">
        <span className="opd-k">Academy · September 2026</span>
        <h1 className="opd-greet-h1">
          {first ? `Your September queue is ready, ${first}.` : "Your September queue is ready."}
        </h1>
        <p className="opd-greet-p">
          <b className="num">{queueLength}</b> {queueLength === 1 ? "item" : "items"}{" "}
          &middot; about <b className="num">{queueSummary?.totalMinutes || 0}</b> minutes
          &middot; opens Sep 1, due Sep 30.
        </p>
      </div>
    </div>
  );
}

function QueueCard({ queue, loading, onOpen }) {
  if (loading) {
    return (
      <div className="opd-card opd-queue" aria-busy="true">
        <div className="opd-queue-head">
          <span className="opd-queue-title">Ahead of you</span>
          <span className="opd-queue-count">loading</span>
        </div>
        {[0,1,2].map((i) => (
          <div key={i} className="opd-queue-row opd-queue-row--skel">
            <span className="opd-skel opd-skel--dot" />
            <span className="opd-skel opd-skel--bar opd-skel--w60" />
            <span className="opd-skel opd-skel--bar opd-skel--w20" />
          </div>
        ))}
      </div>
    );
  }
  if (queue.length === 0) {
    // The empty state - a person with no requirements is a real and
    // correct state, not an error. Reads as "nothing needs you", not
    // as a failure.
    return (
      <div className="opd-card opd-queue opd-queue--empty">
        <div className="opd-queue-head">
          <span className="opd-queue-title">Ahead of you</span>
          <span className="opd-queue-count">0 items</span>
        </div>
        <div className="opd-queue-empty-body">
          <p>
            You have no open requirements. The Academy tracks nothing else about
            what you have or have not done today.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="opd-card opd-queue">
      <div className="opd-queue-head">
        <span className="opd-queue-title">Ahead of you</span>
        <span className="opd-queue-count">{queue.length} {queue.length === 1 ? "item" : "items"}</span>
      </div>
      {queue.map((r) => (
        <button
          key={r.requirement_id}
          type="button"
          className="opd-queue-row"
          onClick={() => onOpen(r)}
          aria-label={`Open ${r.doc_title} - ${r.obligation_key}`}
        >
          <span
            className={"opd-queue-dot opd-queue-dot--" + (r.waived ? "waived" : "open")}
            aria-hidden="true"
          />
          <div className="opd-queue-body">
            <div className="opd-queue-kick">
              {(r.doc_class || "Document")} &middot; {r.doc_id}
              {r.cadence ? ` · ${r.cadence}` : ""}
            </div>
            <div className="opd-queue-title-line">{r.doc_title}</div>
            {r.source_section ? (
              <div className="opd-queue-why">
                Applies to <b>&sect;{r.source_section}</b>
                {r.cycle_label ? ` · ${r.cycle_label} cycle` : ""}
              </div>
            ) : (
              <div className="opd-queue-why">
                {r.cycle_label ? `${r.cycle_label} cycle` : "Issued to your queue"}
              </div>
            )}
          </div>
          <div className="opd-queue-meta">
            <div className="opd-queue-due">Due {formatMonthDay(r.due_date) || r.due_date}</div>
            <div className="opd-queue-est">~{r.est_minutes || 0} MIN</div>
          </div>
          <span className="opd-queue-cta">Open</span>
        </button>
      ))}
    </div>
  );
}

// ── Content: Year Track ───────────────────────────────────────────
function YearTrack({ yearTrack, loading }) {
  if (loading || !yearTrack || yearTrack.length === 0) {
    return (
      <div className="opd-card opd-year" aria-busy="true">
        <div className="opd-year-head">
          <span className="opd-year-title">FY2026</span>
          <span className="opd-year-sub">one cycle per month</span>
        </div>
        <div className="opd-year-track">
          {[...Array(12)].map((_, i) => (
            <div key={i} className="opd-year-seg opd-year-seg--skel" />
          ))}
        </div>
      </div>
    );
  }
  const withCycle = yearTrack.filter((c) => c.hasCycle);
  return (
    <div className="opd-card opd-year">
      <div className="opd-year-head">
        <span className="opd-year-title">FY2026</span>
        <span className="opd-year-sub">one cycle per month</span>
      </div>
      <div className="opd-year-track" role="list" aria-label="Cycle year track">
        {yearTrack.map((c) => {
          const state = c.hasCycle
            ? (c.cycleStatus === "published" ? "open" : c.cycleStatus === "closed" ? "closed" : "draft")
            : "empty";
          const label = c.hasCycle
            ? `${c.monthName} · ${c.cycleLabel || "cycle"} (${c.cycleStatus})`
            : `${c.monthName} · no cycle`;
          return (
            <div
              key={c.month}
              className={"opd-year-seg opd-year-seg--" + state + (c.isCurrentMonth ? " opd-year-seg--now" : "")}
              role="listitem"
              aria-label={label}
              title={label}
            >
              {c.hasCycle ? <span className="opd-year-seg-mark" aria-hidden="true">&bull;</span> : null}
            </div>
          );
        })}
      </div>
      <div className="opd-year-labels" aria-hidden="true">
        {yearTrack.map((c) => (
          <span
            key={c.month}
            className={c.isCurrentMonth ? "opd-year-label opd-year-label--now" : "opd-year-label"}
          >
            {c.label}
          </span>
        ))}
      </div>
      {/* Legend mounted on the surface. Only states the pilot actually
          produces are shown - "current" is deliberately absent. */}
      <div className="opd-year-legend">
        <span className="opd-year-legend-item">
          <span className="opd-year-legend-swatch opd-year-legend-swatch--open" aria-hidden="true" /> Open
        </span>
        <span className="opd-year-legend-item">
          <span className="opd-year-legend-swatch opd-year-legend-swatch--empty" aria-hidden="true" /> No cycle
        </span>
      </div>
      {withCycle.length > 0 ? (
        <p className="opd-year-note">
          {withCycle.length === 1
            ? `One cycle live: ${withCycle[0].cycleLabel}. The other eleven months have no cycle.`
            : `${withCycle.length} cycles live.`}
        </p>
      ) : (
        <p className="opd-year-note">No cycles published yet.</p>
      )}
    </div>
  );
}

// ── Content: Company Standing ─────────────────────────────────────
function CompanyStanding({ standing, loading }) {
  if (loading) {
    return (
      <div className="opd-card opd-comp" aria-busy="true">
        <div className="opd-comp-head">
          <span className="opd-comp-title">Company standing</span>
          <span className="opd-comp-sub">loading</span>
        </div>
        {[0,1,2].map((i) => (
          <div key={i} className="opd-comp-row opd-comp-row--skel" />
        ))}
      </div>
    );
  }
  if (!standing || !standing.accounts || standing.accounts.length === 0) {
    return (
      <div className="opd-card opd-comp">
        <div className="opd-comp-head">
          <span className="opd-comp-title">Company standing</span>
          <span className="opd-comp-sub">no accounts in scope</span>
        </div>
        <div className="opd-comp-empty">
          <p>You do not have scope to see other people's standing.</p>
        </div>
      </div>
    );
  }
  const cycle = standing.currentCycle;
  return (
    <div className="opd-card opd-comp">
      <div className="opd-comp-head">
        <span className="opd-comp-title">Company standing</span>
        <span className="opd-comp-sub">
          {standing.totals?.accounts || 0} {standing.totals?.accounts === 1 ? "site" : "sites"}
          {cycle ? ` · ${cycle.label}` : ""}
        </span>
      </div>

      {/* Legend mounted on the surface per spec. Names every state the
          pilot can render; the not-enrolled state reads as distinct
          from anything current-shaped. */}
      <div className="opd-comp-legend">
        <span className="opd-comp-legend-item">
          <span className="opd-comp-legend-swatch opd-comp-legend-swatch--inprog" aria-hidden="true" />
          In progress
        </span>
        <span className="opd-comp-legend-item">
          <span className="opd-comp-legend-swatch opd-comp-legend-swatch--nenrol" aria-hidden="true" />
          Not enrolled
        </span>
        <span className="opd-comp-legend-item">
          <span className="opd-comp-legend-swatch opd-comp-legend-swatch--unstaff" aria-hidden="true" />
          Unstaffed
        </span>
      </div>

      <ul className="opd-comp-list">
        {standing.accounts.map((a) => {
          const tone = a.standing || "not_enrolled";
          const toneLabel = tone === "in_progress"
            ? "In progress"
            : tone === "unstaffed"
              ? "Unstaffed"
              : "Not enrolled";
          return (
            <li key={a.team_key} className={"opd-comp-row opd-comp-row--" + tone}>
              <span className="opd-comp-region" aria-label={`Region ${a.region || "unknown"}`}>
                {a.region || "-"}
              </span>
              <span className="opd-comp-key">{a.team_key}</span>
              <span className="opd-comp-tone">
                <span className={"opd-comp-tone-dot opd-comp-tone-dot--" + tone} aria-hidden="true" />
                {toneLabel}
              </span>
              <span className="opd-comp-counts">
                <span className="num">{a.enrolled}</span>
                <span className="opd-comp-counts-sep">of</span>
                <span className="num">{a.eligible}</span>
                <span className="opd-comp-counts-noun">enrolled</span>
              </span>
            </li>
          );
        })}
      </ul>
      <p className="opd-comp-note">
        <b>Not enrolled</b> means a person is on the roster but was not in this
        cycle's audience. It is a different fact from being current.
      </p>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────
export default function AcademyRoom({ viewerEmail }) {
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [focus, setFocus] = useState(null); // { requirementId, docId, docTitle } | null
  const isFirstLoadRef = useRef(true);

  const load = useCallback(async function load() {
    if (!isFirstLoadRef.current) {
      setState({ status: "loading", data: null, error: null });
    }
    isFirstLoadRef.current = false;
    try {
      const res = await fetch("/api/academy/room", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        let bodyText = "";
        try {
          const body = await res.json();
          bodyText = body?.detail || body?.error || "";
        } catch {}
        setState({
          status: "error",
          data: null,
          error: `HTTP ${res.status}${bodyText ? ` - ${bodyText}` : ""}`,
        });
        return;
      }
      const data = await res.json();
      if (!data || !data.ok) {
        setState({ status: "error", data: null, error: data?.error || "unknown response" });
        return;
      }
      setState({ status: "ready", data, error: null });
    } catch (err) {
      setState({ status: "error", data: null, error: err?.message || String(err) });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) load(); });
    return () => { cancelled = true; };
  }, [load]);

  const viewer = state.data?.viewer || null;
  const queue = state.data?.queue || EMPTY_ARR;
  const yearTrack = state.data?.yearTrack || EMPTY_ARR;
  const companyStanding = state.data?.companyStanding || null;
  const queueSummary = useMemo(() => {
    if (!state.data?.queueSummary) return { count: 0, totalMinutes: 0, badges: [] };
    return {
      ...state.data.queueSummary,
      badges: queue.map((q) => ({
        key: `${q.doc_id}|${q.obligation_key}`,
        docId: q.doc_id,
        obligationKey: q.obligation_key,
        label: badgeLabelFor(q.obligation_key),
      })),
    };
  }, [state.data, queue]);

  const loading = state.status === "loading";
  const isReady = state.status === "ready";

  // Focus mode: same shell, replaced content.
  if (focus && isReady) {
    return (
      <AcademyFocus
        requirementId={focus.requirementId}
        docId={focus.docId}
        docTitle={focus.docTitle}
        docShelf={focus.docShelf}
        onBack={() => setFocus(null)}
      />
    );
  }

  return (
    <div className="opd-room" data-room="academy">
      <aside className="opd-rail" aria-label="Your profile">
        <ProfileRail
          viewer={viewer}
          queueSummary={queueSummary}
          queueLength={queue.length}
          loading={loading}
        />
      </aside>

      <div className="opd-content">
        {state.status === "error" ? (
          <DashedBrick
            scope="the Academy"
            message={state.error}
            onRetry={() => load()}
          />
        ) : (
          <>
            <Greeting viewer={viewer} queueSummary={queueSummary} queueLength={queue.length} />
            <QueueCard
              queue={queue}
              loading={loading}
              onOpen={(r) => setFocus({
                requirementId: r.requirement_id,
                docId: r.doc_id,
                docTitle: r.doc_title,
                docShelf: r.doc_shelf,
              })}
            />
            <div className="opd-twoup">
              <YearTrack yearTrack={yearTrack} loading={loading} />
              <CompanyStanding standing={companyStanding} loading={loading} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
