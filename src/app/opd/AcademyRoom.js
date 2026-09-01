"use client";

// Academy room. One PRIMARY card (the person's work: header + progress
// rule + rail + lessons body) plus a SECONDARY row (Your Year, Your
// Record stacked left; Company Standing right at 1.15fr). Two tiers,
// not five cards. Built per OPD_Academy_Room_v5.html visual contract
// (spec 18.2/18.3 amended by the composition PR).
//
// Discipline enforced by construction:
//   1. NO emoji in operator copy. Lucide icons only.
//   2. NO obligation_key in operator copy - not in visible text, not
//      in aria-label, not in title attributes. Spec 18.3.
//   3. A document is a SET. Two parts of one doc render as one .opd-set
//      with numbered part rows on a connecting spine. Part 2 is locked
//      until Part 1 is signed - both display-locked here AND refused
//      by /api/academy/module (server enforces the same rule).
//   4. Single-part documents are ONE row, not a header + fake part.
//   5. Completed lessons leave their set and appear only under
//      "Completed this cycle" - the set header carries the aggregate
//      so nothing is lost and no lesson renders twice.
//   6. Peer visibility per spec 3.4: salaried people render named;
//      hourly people not in the cycle's audience appear as an
//      aggregate ("N hourly team members · Not in this cycle's
//      audience").

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  Check,
  Lock,
  Award,
  Flame,
  Clock,
  ArrowRight,
  ChevronRight,
  Users,
  Calendar,
} from "lucide-react";
import AcademyFocus from "./AcademyFocus";

const EMPTY_ARR = Object.freeze([]);

// FY2026 season phases across twelve months. Kept in-file as a small
// display constant; the phase strip is a visual anchor to Service
// Calendar's phase grammar.
const YEAR_PHASES = [
  { key: "spring", label: "SPRING TRAINING", months: 3, color: "#D9892F" },
  { key: "ext",    label: "EXT",              months: 1, color: "#C8A96A" },
  { key: "season", label: "SEASON",           months: 4, color: "var(--opd-grn)" },
  { key: "instr",  label: "INSTRUCTIONAL",    months: 2, color: "var(--opd-pur)" },
  { key: "off",    label: "OFF-SEASON",       months: 2, color: "var(--opd-n400)" },
];
const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

// ─── Helpers ────────────────────────────────────────────────────
function initials(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function daysUntilISO(isoDate, todayISO) {
  if (!isoDate) return null;
  const then = new Date(`${isoDate}T00:00:00Z`);
  const today = new Date(`${todayISO}T00:00:00Z`);
  if (Number.isNaN(then.getTime()) || Number.isNaN(today.getTime())) return null;
  return Math.round((then.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}
// Accept EITHER a bare date ("2026-09-01") OR a full ISO timestamp
// ("2026-09-01T16:37:26+00:00"). The "Signed null" bug on the
// completed row (owner walk, 2026-09-01) was this function appending
// T00:00:00 to a value that already carried a time, producing an
// invalid parse. Slice to the date portion when a "T" is present.
function formatMonthDay(iso) {
  if (!iso) return null;
  const s = String(iso);
  const dateOnly = s.length >= 10 ? s.slice(0, 10) : s;
  try {
    const d = new Date(`${dateOnly}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch { return null; }
}
function formatShortDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  } catch { return null; }
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

// Doc-class -> chip family tint (matches the render's .seti--{gov,proc,tool}).
// Kept small; unknown classes fall through to gov.
function docClassFamily(docClass) {
  const c = String(docClass || "").toUpperCase();
  if (c === "PB") return "proc";  // Playbook = green family
  if (c === "AGR") return "gov";  // Agreement = navy family
  if (c === "SOP" || c === "POL") return "tool"; // Procedures = amber family
  return "gov";
}

// ─── Sets: group queue rows by doc ─────────────────────────────
// Each set represents one document. Rows are ordered by part_number.
// A row is "locked" when it's a later part whose prior part is not
// yet signed. The server enforces the same rule at /api/academy/module.
function buildSets(queue) {
  const byDoc = new Map();
  for (const r of queue || []) {
    if (r.signed) continue; // completed lessons leave their set
    if (!byDoc.has(r.doc_id)) byDoc.set(r.doc_id, []);
    byDoc.get(r.doc_id).push(r);
  }
  const sets = [];
  for (const [docId, rows] of byDoc) {
    rows.sort((a, b) => (a.part_number || 1) - (b.part_number || 1));
    // Priors: any queued rows for this doc that are signed.
    const priorSignedNums = new Set(
      (queue || [])
        .filter((r) => r.doc_id === docId && r.signed)
        .map((r) => r.part_number)
    );
    const totalParts = rows[0]?.total_parts || rows.length;
    const parts = rows.map((r, i) => {
      // A later part is locked when any earlier part number is
      // neither signed nor present-as-open in the rows list. In this
      // build every part is issued upfront, so "locked" = there's an
      // earlier part_number in the queue that is NOT yet signed.
      const priorInQueue = rows.slice(0, i);
      const hasUnsignedPrior = priorInQueue.length > 0;
      return {
        ...r,
        _locked: hasUnsignedPrior,
      };
    });
    // Set aggregate: how many parts are complete, total minutes left,
    // "next" part index (first non-locked, non-signed).
    const completedPriorCount = totalParts - rows.length;
    const minutesLeft = rows.reduce((acc, r) => acc + (r.est_minutes || 0), 0);
    const nextIdx = parts.findIndex((r) => !r._locked);
    if (nextIdx >= 0) parts[nextIdx]._next = true;
    sets.push({
      doc_id: docId,
      doc_title: rows[0].doc_title,
      doc_class: rows[0].doc_class,
      totalParts,
      completedPriorCount,
      minutesLeft,
      parts,
    });
  }
  return sets;
}

// ─── Rail sections ─────────────────────────────────────────────
function PrimaryRail({ viewer, queueSummary, queue, cycleLabel, cycleEndISO, todayISO, streakCycles, nextCycle, onOpenRecord, onOpenLibrary }) {
  const displayName = viewer?.displayName || "";
  // Rail role = people.title only. Owner walk 2026-09-01 forbids
  // substituting account_key or isCorp/isSiteLeader as a title -
  // those are scope facts, not roles. Empty when title is missing.
  const role = viewer?.roleTitle || "";
  const signedCount = (queue || []).filter((r) => r.signed).length;
  const totalCount = (queue || []).length;
  const openCount = totalCount - signedCount;
  const openMinutes = (queue || []).filter((r) => !r.signed).reduce((a, r) => a + (r.est_minutes || 0), 0);
  const meterPct = totalCount === 0 ? 0 : Math.round((signedCount / totalCount) * 100);
  const daysLeft = daysUntilISO(cycleEndISO, todayISO);
  const dueDateLabel = cycleEndISO ? formatMonthDay(cycleEndISO) : null;

  // Signed certificates list (replaces the tile wall + badgeLabelFor).
  const certs = (queue || [])
    .filter((r) => r.signed)
    .map((r) => ({
      doc_id: r.doc_id,
      doc_title: r.doc_title,
      serial: r.certificate_serial,
      signed_at: r.signed_at,
    }));
  const certsToEarn = openCount;

  return (
    <aside className="opd-prail" aria-label="Your profile">
      <div className="opd-prail-id">
        <div className="opd-prail-av" aria-hidden="true">{initials(displayName)}</div>
        <h2>{displayName || " "}</h2>
        {role ? <div className="opd-prail-id-role">{role}</div> : null}
        {streakCycles > 0 ? (
          <div className="opd-streak">
            <Flame size={12} strokeWidth={1.75} />
            {streakCycles} cycles on time
          </div>
        ) : null}
      </div>

      <div className="opd-psec">
        <span className="opd-psec-k">This cycle</span>
        <div className="opd-stand">
          <b className="opd-stand-num num">{signedCount}</b>
          <span className="opd-stand-of">of {totalCount} signed</span>
        </div>
        <div className="opd-meter" aria-hidden="true">
          <i style={{ width: `${meterPct}%` }} />
        </div>
        <div className="opd-mlab">
          <span><b className="num">{openCount}</b> TO GO</span>
          <span className="num">{openMinutes} MIN</span>
        </div>
      </div>

      <div className="opd-psec">
        <span className="opd-psec-k">Your certificates</span>
        <div style={{ marginTop: 10 }}>
          {certs.length === 0 ? (
            <div className="opd-certfoot" style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
              No signatures yet this cycle
            </div>
          ) : (
            certs.map((c) => (
              <div key={c.doc_id} className="opd-sg">
                <span className="opd-sg-ic" aria-hidden="true">
                  <Award size={14} strokeWidth={1.75} />
                </span>
                <span className="opd-sg-tx">
                  <b>{c.doc_title}</b>
                  <span className="opd-lb">{c.serial ? `${c.serial} · ` : ""}{formatShortDate(c.signed_at) || ""}</span>
                </span>
              </div>
            ))
          )}
        </div>
        {certsToEarn > 0 ? (
          <div className="opd-certfoot">{certsToEarn} more to earn this cycle</div>
        ) : null}
      </div>

      {daysLeft != null ? (
        <div className="opd-psec">
          <span className="opd-psec-k">Due</span>
          <div className="opd-duebox">
            <div>
              <b className="opd-dnum-b num">{Math.max(0, daysLeft)}</b>
              <span className="opd-dnum-s">days left</span>
            </div>
            <div className="opd-dwhen">
              {dueDateLabel}
              <br /><em>Cycle closes</em>
            </div>
          </div>
        </div>
      ) : null}

      <div className="opd-psec">
        <span className="opd-psec-k">Coming up</span>
        <div className="opd-nextline">
          <Calendar size={13} strokeWidth={1.75} />
          <div>
            {nextCycle?.label ? (
              <>
                <b>{nextCycle.label}</b>
                <span className="opd-lb">
                  opens {formatMonthDay(nextCycle.period_start) || "next cycle"}
                </span>
              </>
            ) : (
              <>
                <b>Next cycle</b>
                <span className="opd-lb">No cycle scheduled yet</span>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="opd-plinks">
        <button type="button" className="opd-plink" onClick={onOpenRecord}>
          My full record
          <ChevronRight size={15} strokeWidth={2} />
        </button>
        <button type="button" className="opd-plink" onClick={onOpenLibrary}>
          Browse the Library
          <ChevronRight size={15} strokeWidth={2} />
        </button>
      </div>
    </aside>
  );
}

// ─── Sets + parts (the lessons area) ───────────────────────────
function SetBlock({ set, onOpen, onOpenCompleted }) {
  const family = docClassFamily(set.doc_class);
  const isSolo = set.parts.length === 1 && set.totalParts === 1;

  if (isSolo) {
    // Single-part document: one row, no set header, no fake part.
    const p = set.parts[0];
    return (
      <div className="opd-set opd-set--solo">
        <button
          type="button"
          className={"opd-pr opd-pr--nx"}
          onClick={() => onOpen(p)}
          style={{ padding: "14px 15px 14px 17px" }}
        >
          <i className="opd-spine" aria-hidden="true" />
          <span className={"opd-seti opd-seti--" + family} aria-hidden="true" style={{ width: 34, height: 34 }}>
            <FileText size={17} strokeWidth={1.75} />
          </span>
          <div className="opd-pb2" style={{ marginLeft: 2 }}>
            <h4 style={{ fontSize: "var(--opd-t-row)", fontWeight: 750 }}>{set.doc_title}</h4>
            {p.description ? <div className="opd-pb2-d">{p.description}</div> : null}
          </div>
          <div className="opd-pm">
            <div className="opd-pm-a">{p.due_date ? `Due ${formatMonthDay(p.due_date)}` : ""}</div>
            <div className="opd-pm-b num">{p.est_minutes} MIN</div>
          </div>
          <span className="opd-go" aria-hidden="true">Start <ArrowRight size={13} strokeWidth={2} /></span>
        </button>
      </div>
    );
  }

  // Multi-part set: header + numbered part rows on a connecting spine.
  const completedSetParts = set.completedPriorCount;
  const progressPct = set.totalParts === 0 ? 0 : Math.round((completedSetParts / set.totalParts) * 100);
  const started = completedSetParts > 0;

  return (
    <div className="opd-set">
      <div className="opd-seth">
        <span className={"opd-seti opd-seti--" + family} aria-hidden="true">
          <FileText size={17} strokeWidth={1.75} />
        </span>
        <div>
          <h3>{set.doc_title}</h3>
          <div className="opd-seth-mt">
            {started
              ? `Part ${completedSetParts} complete · ${set.parts.length} part${set.parts.length === 1 ? "" : "s"} left · ${set.minutesLeft} min`
              : `${set.totalParts} parts, in order · ${set.minutesLeft} min`}
          </div>
        </div>
        {/* Owner walk 2026-09-01: unify the right edge. Every
            multi-part set shows a progress bar; the zero state is
            an empty track PLUS a muted "Not started" label beneath,
            not INSTEAD of the bar. Three treatments in the same
            column position read as broken. Single-part sets have
            nothing here (they have no progress to show; the solo
            branch above handles that). */}
        <div className="opd-setend" aria-hidden="true">
          <span className="opd-setprog">
            <i style={{ width: `${progressPct}%` }} />
          </span>
          {!started ? <span className="opd-setend-lbl">Not started</span> : null}
        </div>
      </div>
      {set.parts.map((p) => {
        const isLocked = p._locked;
        const isNext = p._next;
        const cls = "opd-pr"
          + (isLocked ? " opd-pr--lk" : "")
          + (isNext ? " opd-pr--nx" : "");
        const rowTitle = partRowTitle(p.source_section, p.description);
        const rowTitleFull = String(p.source_section || p.description || "").trim();
        return (
          <button
            key={p.requirement_id}
            type="button"
            className={cls}
            onClick={() => { if (!isLocked) onOpen(p); }}
            disabled={isLocked}
            title={rowTitleFull || undefined}
          >
            <i className="opd-spine" aria-hidden="true" />
            <span className="opd-pnum" aria-hidden="true">
              {isLocked ? <Lock size={11} strokeWidth={1.75} /> : p.part_number}
            </span>
            <div className="opd-pb2">
              <h4>Part {p.part_number}{rowTitle ? ` · ${rowTitle}` : ""}</h4>
              {p.description ? <div className="opd-pb2-d">{p.description}</div> : null}
              {isLocked ? (
                <span className="opd-lkn">
                  <Lock size={11} strokeWidth={1.75} />
                  Opens when you finish Part {p.part_number - 1}
                </span>
              ) : null}
            </div>
            <div className="opd-pm">
              <div
                className="opd-pm-a"
                style={isLocked ? { color: "var(--opd-n500)" } : undefined}
              >
                {p.due_date ? `Due ${formatMonthDay(p.due_date)}` : ""}
              </div>
              <div className="opd-pm-b num">{p.est_minutes} MIN</div>
            </div>
            <span
              className={"opd-go" + (isLocked ? " opd-go--q" : "")}
              aria-hidden="true"
            >
              {isLocked ? "Locked" : (<>Start <ArrowRight size={13} strokeWidth={2} /></>)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// Part-row title from the source_section, which the obligations
// table stores as a semicolon-joined list of headings from the
// document. Take the first heading only; drop the rest. If the
// remaining string exceeds ~40 chars, truncate at a word boundary
// with an ellipsis. Caller puts the full string on the row's
// `title` attribute so hover reveals the whole list.
//
// Falls back to description when source_section is empty (e.g. the
// single-part solo path where source_section may not be set) - and
// in that fallback we truncate on the same rule to avoid the row
// title running long.
const TITLE_MAX_CHARS = 40;
function partRowTitle(sourceSection, description) {
  const src = String(sourceSection || "").trim();
  const first = src ? src.split(/;/, 1)[0].trim() : "";
  const raw = first || String(description || "").trim();
  if (!raw) return "";
  if (raw.length <= TITLE_MAX_CHARS) return raw;
  const cut = raw.slice(0, TITLE_MAX_CHARS);
  const lastSp = cut.lastIndexOf(" ");
  const truncated = (lastSp > 20 ? cut.slice(0, lastSp) : cut).replace(/[\s,.·-]+$/, "");
  return truncated + "…";
}

// ─── Completed section (leaves the set) ────────────────────────
function CompletedSection({ queue, onOpen }) {
  const done = (queue || []).filter((r) => r.signed);
  if (done.length === 0) return null;
  return (
    <div className="opd-cmpl">
      <div className="opd-cmplh">
        <Check size={14} strokeWidth={2.25} style={{ color: "var(--opd-grnfg)" }} />
        <span className="opd-cmplh-k">Completed this cycle</span>
        <span className="opd-cmplh-s">
          {done.length} lesson{done.length === 1 ? "" : "s"} · {done.length} certificate{done.length === 1 ? "" : "s"}
        </span>
      </div>
      {done.map((r) => (
        <button
          key={r.requirement_id}
          type="button"
          className="opd-pr opd-pr--dn"
          onClick={() => onOpen(r)}
          style={{ border: "none" }}
        >
          <i className="opd-spine" aria-hidden="true" />
          <span className="opd-pnum" aria-hidden="true">
            <Check size={12} strokeWidth={2.25} />
          </span>
          <div className="opd-pb2">
            <h4>{r.doc_title}{r.total_parts > 1 ? ` · Part ${r.part_number}` : ""}</h4>
            <div className="opd-pb2-d">
              {(() => {
                const md = formatMonthDay(r.signed_at);
                return md ? `Signed ${md}` : "Signed";
              })()}
              {r.doc_version ? ` · version ${r.doc_version}` : ""}
            </div>
          </div>
          <div className="opd-pm">
            <div className="opd-pm-a">{r.certificate_serial || ""}</div>
            <div className="opd-pm-b">CERTIFICATE</div>
          </div>
          <span className="opd-go" aria-hidden="true">View</span>
        </button>
      ))}
    </div>
  );
}

// ─── Year track ────────────────────────────────────────────────
function YearCard({ yearTrack, currentCycleLabel }) {
  const cells = Array.from({ length: 12 }, (_, i) => {
    const cell = (yearTrack || [])[i] || null;
    return {
      hasCycle: !!(cell && cell.hasCycle),
      isCurrentMonth: !!(cell && cell.isCurrentMonth),
      cycleStatus: cell?.cycleStatus || null,
    };
  });
  return (
    <div className="opd-card2">
      <div className="opd-c2h">
        <Calendar size={14} strokeWidth={1.75} style={{ color: "var(--opd-navy)" }} />
        <span className="opd-c2h-k">Your year</span>
        <span className="opd-lb">one cycle per month</span>
      </div>
      <div className="opd-yr" role="list" aria-label="Year track">
        {cells.map((c, i) => (
          <div
            key={i}
            className={"opd-ys" + (c.isCurrentMonth ? " opd-ys--op" : "")}
            role="listitem"
            aria-label={`${MONTH_LETTERS[i]}${c.isCurrentMonth ? " (current)" : ""}`}
          >
            {c.isCurrentMonth ? <i /> : null}
          </div>
        ))}
      </div>
      <div className="opd-ylb" aria-hidden="true">
        {MONTH_LETTERS.map((m, i) => (
          <span key={i} className={cells[i].isCurrentMonth ? "opd-ylb--nw" : undefined}>{m}</span>
        ))}
      </div>
      <div className="opd-yph" aria-hidden="true">
        {YEAR_PHASES.map((p) => (
          <i key={p.key} style={{ flex: p.months, background: p.color }} />
        ))}
      </div>
      <div className="opd-yphl" aria-hidden="true">
        {YEAR_PHASES.map((p, i) => (
          <span key={p.key} style={{ flex: p.months, textAlign: i === 0 ? "left" : (i === YEAR_PHASES.length - 1 ? "right" : "center") }}>
            {p.label}
          </span>
        ))}
      </div>
      <div className="opd-ynx">
        {currentCycleLabel ? (
          <><b>{currentCycleLabel} is your first live cycle.</b> Next cycle opens when this one closes.</>
        ) : "No cycle is open at the moment."}
      </div>
    </div>
  );
}

// ─── Record card ───────────────────────────────────────────────
function RecordCard({ record, cycleLabel }) {
  // record is now the server-side viewer.record (see api/academy/room:
  // { signedAllTime, minutesReadThisCycle, checksPassed, retries,
  //   cyclesClosedCount, firstRun }).
  // Owner walk 2026-09-01: the tiles were four zeros, which is
  // technically true but reads as broken. Three of the four now have
  // real data. The "on-time cycles" tile has no honest number until
  // at least one published cycle has closed, so we render a first-run
  // state ("Record starts now") instead of "0 · Never missed".
  const r = record || {
    signedAllTime: 0, minutesReadThisCycle: 0, checksPassed: 0,
    retries: 0, cyclesClosedCount: 0, firstRun: true,
  };
  return (
    <div className="opd-card2">
      <div className="opd-c2h">
        <Award size={14} strokeWidth={1.75} style={{ color: "var(--opd-navy)" }} />
        <span className="opd-c2h-k">Your record</span>
        <span className="opd-lb">{cycleLabel ? `since ${cycleLabel}` : "all time"}</span>
      </div>
      <div className="opd-rgrid">
        <div className="opd-rq">
          <b className="num">{r.signedAllTime}</b>
          <span className="opd-lb">SIGNED</span>
          <div className="opd-rq-sub">All time</div>
        </div>
        <div className="opd-rq">
          {r.firstRun ? (
            <>
              <b className="opd-rq-firstrun">Starts now</b>
              <span className="opd-lb">ON-TIME CYCLES</span>
              <div className="opd-rq-sub">No cycle has closed yet</div>
            </>
          ) : (
            <>
              <b className="num">{r.cyclesClosedCount - 0}</b>
              <span className="opd-lb">ON-TIME CYCLES</span>
              <div className="opd-rq-sub">of {r.cyclesClosedCount} closed</div>
            </>
          )}
        </div>
        <div className="opd-rq">
          <b className="num">{r.minutesReadThisCycle}</b>
          <span className="opd-lb">MINUTES READ</span>
          <div className="opd-rq-sub">This cycle</div>
        </div>
        <div className="opd-rq">
          <b className="num">{r.checksPassed}</b>
          <span className="opd-lb">CHECKS PASSED</span>
          <div className="opd-rq-sub">
            {r.retries > 0 ? `${r.retries} retr${r.retries === 1 ? "y" : "ies"}` : "First try each"}
          </div>
        </div>
      </div>
      <div className="opd-rfoot">
        Your record is permanent and version-bound. If a document is materially revised, the signature expires and you are asked to sign the new version. <b>Nothing is ever deleted.</b>
      </div>
    </div>
  );
}

// ─── Company standing (expandable) ─────────────────────────────
function StandingCard({ standing }) {
  const [expanded, setExpanded] = useState(() => new Set());
  const toggle = (key) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  if (!standing || !Array.isArray(standing.accounts) || standing.accounts.length === 0) {
    return null;
  }
  const accounts = standing.accounts;
  const cycleLabel = standing.currentCycle?.label || "This cycle";
  const siteCount = standing.totals?.accounts ?? accounts.length;

  return (
    <div className="opd-card2 opd-cs">
      <div className="opd-c2h">
        <Users size={14} strokeWidth={1.75} style={{ color: "var(--opd-navy)" }} />
        <span className="opd-c2h-k">Company standing</span>
        <span className="opd-lb">{siteCount} site{siteCount === 1 ? "" : "s"} · {cycleLabel}</span>
      </div>
      <div className="opd-leg">
        <span><i style={{ background: "var(--opd-amb)" }} />In progress</span>
        <span><i style={{ border: "1.5px dashed var(--opd-n400)" }} />Not enrolled</span>
        <span className="opd-leg-hint">Click a site to see its people</span>
      </div>
      {accounts.map((a) => {
        const isOpen = expanded.has(a.team_key);
        const tone = a.standing === "in_progress" ? "opd-tone--pg"
          : a.standing === "not_enrolled" ? "opd-tone--ne"
          : "opd-tone--ne";
        const toneLabel = a.standing === "in_progress" ? "In progress"
          : a.standing === "not_enrolled" ? "Not enrolled"
          : "Not staffed";
        return (
          <div key={a.team_key}>
            <button
              type="button"
              className={"opd-cr" + (isOpen ? " opd-cr--op" : "")}
              onClick={() => toggle(a.team_key)}
              aria-expanded={isOpen}
              aria-controls={`opd-exp-${a.team_key}`}
            >
              <ChevronRight size={14} strokeWidth={2} className="opd-cr-chv" />
              <span className="opd-cr-kk">{a.team_key}</span>
              <span className="opd-cr-nm">{a.region || a.team_key}</span>
              <span className={"opd-tone " + tone}>
                <i />
                {toneLabel}
              </span>
              <span className="opd-cr-ct num">
                {a.enrolled > 0 ? <b>{a.enrolled}</b> : "0"} OF {a.eligible}
              </span>
            </button>
            <div
              id={`opd-exp-${a.team_key}`}
              className={"opd-exp" + (isOpen ? " opd-exp--on" : "")}
            >
              {(a.people || []).map((p) => (
                <div key={p.worker_id} className="opd-pp">
                  <span className="opd-pp-av" aria-hidden="true">{initials(p.display_name)}</span>
                  <span className="opd-pp-pn">
                    <b>{p.display_name || " "}</b>
                    <span className="opd-lb">{p.is_salaried ? "Salaried" : "Hourly"}</span>
                  </span>
                  <span className={"opd-pp-st " + (
                    p.status === "signed" ? "d" : (p.status === "in_progress" ? "p" : "n")
                  )}>
                    {p.status === "signed" ? "Signed"
                      : p.status === "in_progress" ? "In progress"
                      : "Not enrolled"}
                  </span>
                </div>
              ))}
              {(a.aggregateHourly ?? 0) > 0 ? (
                <div className="opd-pp" style={{ color: "var(--opd-n500)" }}>
                  <span
                    className="opd-pp-av"
                    style={{ background: "var(--opd-n100)", color: "var(--opd-n500)" }}
                    aria-hidden="true"
                  >
                    +{a.aggregateHourly}
                  </span>
                  <span className="opd-pp-pn">
                    <b style={{ color: "var(--opd-n600)" }}>
                      {a.aggregateHourly} hourly team member{a.aggregateHourly === 1 ? "" : "s"}
                    </b>
                    <span className="opd-lb">Not in this cycle's audience</span>
                  </span>
                  <span className="opd-pp-st n">Not enrolled</span>
                </div>
              ) : null}
              {(a.people || []).length === 0 && (a.aggregateHourly ?? 0) === 0 ? (
                <div className="opd-pp">
                  <span className="opd-pp-av" aria-hidden="true">-</span>
                  <span className="opd-pp-pn">
                    <b>No named peers visible</b>
                    <span className="opd-lb">Empty account in scope</span>
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
      <div className="opd-cs-foot2">
        <b>Not enrolled</b> means a person is on the roster but was not in this cycle's audience. It is a different fact from being current.
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Main AcademyRoom
// ═══════════════════════════════════════════════════════════════════
export default function AcademyRoom({ viewerEmail }) {
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [focus, setFocus] = useState(null);
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
        try { const body = await res.json(); bodyText = body?.detail || body?.error || ""; } catch {}
        setState({ status: "error", data: null, error: `HTTP ${res.status}${bodyText ? ` - ${bodyText}` : ""}` });
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
  const standing = state.data?.companyStanding || null;
  const nextCycle = state.data?.nextCycle || null;
  const viewerRecord = state.data?.viewer?.record || null;
  const todayISO = state.data?.today || new Date().toISOString().slice(0, 10);

  const cycleLabel = queue.find((r) => r.cycle_label)?.cycle_label || null;
  const cycleEndISO = queue.reduce((acc, r) => {
    if (!r.due_date) return acc;
    if (!acc || r.due_date > acc) return r.due_date;
    return acc;
  }, null);

  const sets = useMemo(() => buildSets(queue), [queue]);
  const openCount = queue.filter((r) => !r.signed).length;
  const openMinutes = queue.filter((r) => !r.signed).reduce((a, r) => a + (r.est_minutes || 0), 0);
  const signedCount = queue.filter((r) => r.signed).length;
  const totalCount = queue.length;
  const meterPct = totalCount === 0 ? 0 : Math.round((signedCount / totalCount) * 100);

  const onOpen = useCallback((r) => setFocus({
    requirementId: r.requirement_id,
    docId: r.doc_id,
    docTitle: r.doc_title,
    docShelf: r.doc_shelf,
    partNumber: r.part_number,
    totalParts: r.total_parts,
  }), []);

  const loading = state.status === "loading";
  const isReady = state.status === "ready";

  if (focus && isReady) {
    return (
      <AcademyFocus
        requirementId={focus.requirementId}
        docId={focus.docId}
        docTitle={focus.docTitle}
        docShelf={focus.docShelf}
        partNumber={focus.partNumber}
        totalParts={focus.totalParts}
        onBack={() => { setFocus(null); load(); }}
        onSigned={() => { load(); }}
      />
    );
  }

  if (state.status === "error") {
    return (
      <DashedBrick scope="the Academy" message={state.error} onRetry={() => load()} />
    );
  }

  // Aggregate greeting numbers
  const nextOpenPart = sets.find((s) => s.parts.some((p) => !p._locked))?.parts.find((p) => !p._locked) || null;

  return (
    <div className="opd-room opd-room--v5" data-room="academy">
      {/* ── PRIMARY ── */}
      <section className="opd-prim">
        <header className="opd-phead">
          <div>
            <div className="opd-phead-kk">
              {cycleLabel ? `${cycleLabel} · opens today` : "This cycle"}
            </div>
            <h1>
              {openCount === 0
                ? (totalCount > 0 ? "You are current." : "Nothing needs you right now.")
                : `${openCount} lesson${openCount === 1 ? "" : "s"} to go, ${(viewer?.displayName || "").split(/\s+/)[0] || "you"}.`}
            </h1>
            {openCount > 0 ? (
              <div className="opd-phead-sb">
                <Clock size={14} strokeWidth={1.75} />
                <b>{openMinutes} minutes</b> left this cycle
                {cycleEndISO ? ` · due ${formatMonthDay(cycleEndISO)}` : ""}
              </div>
            ) : null}
          </div>
          {nextOpenPart ? (
            <button
              type="button"
              className="opd-cta"
              onClick={() => onOpen(nextOpenPart)}
            >
              Continue
              <ArrowRight size={15} strokeWidth={2} />
            </button>
          ) : null}
        </header>
        <div className="opd-pbar" aria-hidden="true">
          <i style={{ width: `${meterPct}%` }} />
        </div>
        <div className="opd-pbody">
          <PrimaryRail
            viewer={viewer}
            queue={queue}
            cycleLabel={cycleLabel}
            cycleEndISO={cycleEndISO}
            todayISO={todayISO}
            streakCycles={0}
            nextCycle={nextCycle}
            onOpenRecord={() => { /* future */ }}
            onOpenLibrary={() => { /* future */ }}
          />
          <div className="opd-pq">
            <div className="opd-grph">
              <span className="opd-grph-k">Lessons</span>
              <span className="opd-grph-s">
                {loading
                  ? "Loading"
                  : `${openCount} open · about ${openMinutes} min`}
              </span>
            </div>
            {loading ? (
              <div className="opd-set" style={{ padding: 22 }}>
                <span className="opd-skel opd-skel--bar opd-skel--w40" />
              </div>
            ) : (
              <>
                {sets.map((s) => (
                  <SetBlock
                    key={s.doc_id}
                    set={s}
                    onOpen={onOpen}
                  />
                ))}
                {sets.length === 0 && signedCount === 0 ? (
                  <div className="opd-set" style={{ padding: 22, textAlign: "center" }}>
                    <div className="opd-grph-s">Nothing needs you this cycle.</div>
                  </div>
                ) : null}
                <CompletedSection queue={queue} onOpen={onOpen} />
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── SECONDARY ROW ── */}
      <div className="opd-srow">
        <div className="opd-scol">
          <YearCard yearTrack={yearTrack} currentCycleLabel={cycleLabel} />
          <RecordCard record={viewerRecord} cycleLabel={cycleLabel} />
        </div>
        <StandingCard standing={standing} />
      </div>
    </div>
  );
}
