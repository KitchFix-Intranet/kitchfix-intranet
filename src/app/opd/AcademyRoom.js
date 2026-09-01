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
function formatMonthDay(iso) {
  if (!iso) return null;
  try {
    const d = new Date(`${iso}T00:00:00`);
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
function PrimaryRail({ viewer, queueSummary, queue, cycleLabel, cycleEndISO, todayISO, streakCycles, onOpenRecord, onOpenLibrary }) {
  const displayName = viewer?.displayName || "";
  const role = viewer?.roleTitle || (viewer?.isCorp ? "Corporate" : (viewer?.isSiteLeader ? "Site leader" : ""));
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
          <s className="opd-stand-of">of {totalCount} signed</s>
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
                  <s>{c.serial ? `${c.serial} · ` : ""}{formatShortDate(c.signed_at) || ""}</s>
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
              <s className="opd-dnum-s">days left</s>
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
            <b>Next cycle</b>
            <s>Opens when this cycle closes</s>
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
        {started ? (
          <span className="opd-setprog" aria-hidden="true">
            <i style={{ width: `${progressPct}%` }} />
          </span>
        ) : (
          <span className="opd-setnone">NOT STARTED</span>
        )}
      </div>
      {set.parts.map((p) => {
        const isLocked = p._locked;
        const isNext = p._next;
        const cls = "opd-pr"
          + (isLocked ? " opd-pr--lk" : "")
          + (isNext ? " opd-pr--nx" : "");
        return (
          <button
            key={p.requirement_id}
            type="button"
            className={cls}
            onClick={() => { if (!isLocked) onOpen(p); }}
            disabled={isLocked}
          >
            <i className="opd-spine" aria-hidden="true" />
            <span className="opd-pnum" aria-hidden="true">
              {isLocked ? <Lock size={11} strokeWidth={1.75} /> : p.part_number}
            </span>
            <div className="opd-pb2">
              <h4>Part {p.part_number}{p.description ? ` · ${shortenTitle(p.description)}` : ""}</h4>
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

// Extract a short lead phrase from a description ("methods, sourcing,..." -> "Methods & sourcing").
// Kept minimal - one word capped, else the first N chars.
function shortenTitle(desc) {
  if (!desc) return "";
  const first = String(desc).split(/[,.·]/, 1)[0].trim();
  return first.length > 40 ? first.slice(0, 38) + "…" : first;
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
        <s className="opd-cmplh-s">
          {done.length} lesson{done.length === 1 ? "" : "s"} · {done.length} certificate{done.length === 1 ? "" : "s"}
        </s>
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
              {r.signed_at ? `Signed ${formatMonthDay(r.signed_at)}` : "Signed"}
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
        <s>one cycle per month</s>
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
function RecordCard({ record }) {
  return (
    <div className="opd-card2">
      <div className="opd-c2h">
        <Award size={14} strokeWidth={1.75} style={{ color: "var(--opd-navy)" }} />
        <span className="opd-c2h-k">Your record</span>
        <s>{record.since ? `since ${record.since}` : "all time"}</s>
      </div>
      <div className="opd-rgrid">
        <div className="opd-rq">
          <b className="num">{record.signedAllTime}</b>
          <s>SIGNED</s>
          <div className="opd-rq-sub">All time</div>
        </div>
        <div className="opd-rq">
          <b className="num">{record.onTimeCycles}</b>
          <s>ON-TIME CYCLES</s>
          <div className="opd-rq-sub">{record.missed > 0 ? `${record.missed} missed` : "Never missed"}</div>
        </div>
        <div className="opd-rq">
          <b className="num">{record.minutesRead}</b>
          <s>MINUTES READ</s>
          <div className="opd-rq-sub">This cycle</div>
        </div>
        <div className="opd-rq">
          <b className="num">{record.checksPassed}</b>
          <s>CHECKS PASSED</s>
          <div className="opd-rq-sub">{record.retries > 0 ? `${record.retries} retr${record.retries === 1 ? "y" : "ies"}` : "No retries"}</div>
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
        <s>{siteCount} site{siteCount === 1 ? "" : "s"} · {cycleLabel}</s>
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
                    <s>{p.is_salaried ? "Salaried" : "Hourly"}</s>
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
                    <s>Not in this cycle's audience</s>
                  </span>
                  <span className="opd-pp-st n">Not enrolled</span>
                </div>
              ) : null}
              {(a.people || []).length === 0 && (a.aggregateHourly ?? 0) === 0 ? (
                <div className="opd-pp">
                  <span className="opd-pp-av" aria-hidden="true">-</span>
                  <span className="opd-pp-pn">
                    <b>No named peers visible</b>
                    <s>Empty account in scope</s>
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

  // Record numbers (client-derived; no new endpoint). These are the
  // honest minimum from the current room payload.
  const record = {
    since: cycleLabel || null,
    signedAllTime: signedCount,
    onTimeCycles: 0,          // requires records endpoint; placeholder
    missed: 0,
    minutesRead: 0,           // TBD from progress rows
    checksPassed: 0,          // TBD from attempts rows
    retries: 0,
  };

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
            onOpenRecord={() => { /* future */ }}
            onOpenLibrary={() => { /* future */ }}
          />
          <div className="opd-pq">
            <div className="opd-grph">
              <span className="opd-grph-k">Lessons</span>
              <s className="opd-grph-s">
                {loading
                  ? "Loading"
                  : `${openCount} open · about ${openMinutes} min`}
              </s>
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
          <RecordCard record={record} />
        </div>
        <StandingCard standing={standing} />
      </div>
    </div>
  );
}
