"use client";

// Academy room. Density-pass composition (spec 18.2 amended):
//   - TWO cards on one gutter: profile + lessons, side by side.
//   - A card holds BLOCKS; it is not divided into bands. Every set,
//     every rail section, and Completed are bordered blocks inset by
//     --gut. Full-bleed rules are reserved for a card's own header
//     and footer.
//   - No top greeting band. The count + minutes + due date live in
//     the rail once each; Continue lives in the lessons card header.
//   - Identity is horizontal (36px avatar beside the name, not
//     stacked above).
//   - The lessons list is CAPPED and scrolls internally. When content
//     is hidden three signals fire at once: a fade, a scrollbar, and
//     a counted pill ("N more below") that scrolls when clicked.
//   - One leading column (--lead: 44px) governs every row type so the
//     text column starts at ONE x. A single-part document is a set
//     header with no rows beneath it, not a part row wearing a header
//     icon.
//   - The due column is fixed-width and right-aligned. Due dates are
//     neutral until the last five days; amber then; red overdue.
//   - Descriptions come from card_line > obligation.description. If
//     both are empty, render nothing. NEVER source_section.
//   - No emoji, no obligation_key anywhere in operator copy.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileText,
  Check,
  Lock,
  Award,
  Flame,
  ArrowRight,
  ChevronRight,
  Users,
  Calendar,
  ChevronDown,
} from "lucide-react";
import AcademyFocus from "./AcademyFocus";

const EMPTY_ARR = Object.freeze([]);

// FY2026 season phases across twelve months. Kept in-file as a small
// display constant.
const YEAR_PHASES = [
  { key: "spring", label: "SPRING TRAINING", months: 3, color: "#D9892F" },
  { key: "ext",    label: "EXT",              months: 1, color: "#C8A96A" },
  { key: "season", label: "SEASON",           months: 4, color: "var(--opd-grn)" },
  { key: "instr",  label: "INSTRUCTIONAL",    months: 2, color: "var(--opd-pur)" },
  { key: "off",    label: "OFF-SEASON",       months: 2, color: "var(--opd-n400)" },
];
const MONTH_LETTERS = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

// Spec 18.10: five days is the honest threshold for due-date urgency.
const DUE_AMBER_DAYS = 5;

// ─── Helpers ────────────────────────────────────────────────────
function initials(name) {
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
// Company Standing name column. The code (team_key) is already shown
// in column 1, so the name column must never repeat it. CORP's region
// value is literally "CORP", which duped the row pre-fix. Map CORP to
// its display name; for any other row whose region value equals its
// code, render nothing rather than repeat.
function accountDisplayName(teamKey, region) {
  if (teamKey === "CORP") return "Corporate";
  const r = (region || "").trim();
  if (!r) return "";
  if (r === teamKey) return "";
  return r;
}
function daysUntilISO(isoDate, todayISO) {
  if (!isoDate) return null;
  const dateOnly = String(isoDate).length >= 10 ? String(isoDate).slice(0, 10) : String(isoDate);
  const then = new Date(`${dateOnly}T00:00:00Z`);
  const today = new Date(`${todayISO}T00:00:00Z`);
  if (Number.isNaN(then.getTime()) || Number.isNaN(today.getTime())) return null;
  return Math.round((then.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}
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
function formatMonthDayUpper(iso) {
  const s = formatMonthDay(iso);
  return s ? s.toUpperCase() : null;
}
// Due-date urgency (spec 18.10): amber inside 5 days, red overdue,
// neutral otherwise. Returns a class suffix ("", "urg", "over").
function dueUrgencyClass(dueISO, todayISO) {
  const d = daysUntilISO(dueISO, todayISO);
  if (d == null) return "";
  if (d < 0) return "opd-pm-a--over";
  if (d <= DUE_AMBER_DAYS) return "opd-pm-a--urg";
  return "";
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

// Lessons card loading state. Header bar + three set-block placeholders,
// each with an icon chip and two bars. Mirrors LibraryRoom's shelf
// skeleton pattern (spec law - never render an empty card during load).
// Reuses existing .opd-skel* classes and the opd-skel-shine keyframe;
// no new skeleton CSS.
function LessonsSkeleton() {
  return (
    <div className="opd-card opd-lcard opd-lcard--skel" aria-busy="true" aria-label="Loading lessons">
      <div className="opd-lh">
        <span className="opd-skel opd-skel--bar opd-skel--w40" />
      </div>
      <div className="opd-lbody">
        {[0, 1, 2].map((i) => (
          <div key={i} className="opd-set opd-set--skel">
            <div className="opd-seth">
              <span className="opd-lead" aria-hidden="true">
                <span className="opd-skel opd-skel--chip" />
              </span>
              <div className="opd-seth-tx">
                <span className="opd-skel opd-skel--bar opd-skel--w60" />
                <span className="opd-skel opd-skel--bar opd-skel--w40" style={{ marginTop: 6 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Doc-class -> chip family tint.
function docClassFamily(docClass) {
  const c = String(docClass || "").toUpperCase();
  if (c === "PB") return "proc";
  if (c === "AGR") return "gov";
  if (c === "SOP" || c === "POL") return "tool";
  return "gov";
}

// Two description flavours - owner ruling 2026-09-01 follow-up:
//
// setHeaderDescription() is for a set HEADER (solo case; multi-part
// set headers use status text instead). Prefer card_line (which
// describes the whole document) then fall back to the obligation
// description.
//
// partRowDescription() is for a PART row and returns the obligation's
// description ONLY. card_line is a document-level line - printing it
// on every part of a multi-part doc renders identical text on every
// row. When the obligation description is empty, render nothing -
// the fix for the empty state is authored content, not code
// substituting a document-level string.
function setHeaderDescription(row) {
  return String(row.card_line || row.description || "").trim() || null;
}
function partRowDescription(row) {
  return String(row.description || "").trim() || null;
}
// Certificate serials (KFA-YYYY-NNNNNN, 15 chars) wrap to two lines
// in the fixed 96px .opd-pm column of the Completed row - the browser
// breaks on the hyphens and each of the three chunks becomes its own
// line. Elide the middle year so it renders as "KFA-...000004" and
// fits on one line. Full string sits on the row's title attribute.
// Owner ruling 2026-09-01 follow-up.
function elideSerial(serial) {
  const s = String(serial || "").trim();
  if (!s) return "";
  if (s.length <= 12) return s;
  return `${s.slice(0, 4)}…${s.slice(-6)}`;
}

// ─── Sets: group queue rows by doc ─────────────────────────────
// Owner ruling 2026-09-02: signed parts stay inside their document
// set (rendered in the signed state - green spine, check bubble,
// serial, view-cert). A prior fix moved signed rows OUT of the set
// to prevent duplicate renders; the correct fix is to remove the
// duplication, not to break the packet. A document that is FULLY
// signed (every part) moves down as one unit into "Completed this
// cycle" - see the fullyCompletedDocs derivation below.
function buildSets(queue) {
  const byDoc = new Map();
  for (const r of queue || []) {
    if (!byDoc.has(r.doc_id)) byDoc.set(r.doc_id, []);
    byDoc.get(r.doc_id).push(r);
  }
  const sets = [];
  for (const [docId, rows] of byDoc) {
    rows.sort((a, b) => (a.part_number || 1) - (b.part_number || 1));
    const totalParts = rows[0]?.total_parts || rows.length;
    const allSigned = rows.length > 0 && rows.every((r) => r.signed);
    // A fully-signed document is not a set - it belongs in
    // "Completed this cycle" as one unit.
    if (allSigned) continue;
    // Signed parts are visible in their set; unsigned parts stack
    // beneath in order. Locking gates the next UNSIGNED part on the
    // completion of the prior part.
    let firstUnsignedIndex = -1;
    const parts = rows.map((r, i) => {
      const signed = !!r.signed;
      if (!signed && firstUnsignedIndex < 0) firstUnsignedIndex = i;
      // A signed row is never locked; an unsigned row is locked if
      // any earlier part is unsigned (except the first unsigned,
      // which is the next-open row).
      const locked = signed
        ? false
        : (firstUnsignedIndex >= 0 && i > firstUnsignedIndex);
      return {
        ...r,
        _signed: signed,
        _locked: locked,
      };
    });
    if (firstUnsignedIndex >= 0) parts[firstUnsignedIndex]._next = true;
    const completedPriorCount = parts.filter((p) => p._signed).length;
    const openParts = parts.filter((p) => !p._signed);
    const minutesLeft = openParts.reduce((acc, r) => acc + (r.est_minutes || 0), 0);
    sets.push({
      doc_id: docId,
      doc_title: rows[0].doc_title,
      doc_class: rows[0].doc_class,
      totalParts,
      completedPriorCount,
      openPartsCount: openParts.length,
      minutesLeft,
      parts,
    });
  }
  return sets;
}

// A "fully-completed document" is one where every part is signed.
// This is what "Completed this cycle" surfaces - a document as one
// unit, with a certificate row per signed part.
function buildFullyCompletedDocs(queue) {
  const byDoc = new Map();
  for (const r of queue || []) {
    if (!byDoc.has(r.doc_id)) byDoc.set(r.doc_id, []);
    byDoc.get(r.doc_id).push(r);
  }
  const docs = [];
  for (const [docId, rows] of byDoc) {
    if (rows.length === 0) continue;
    if (!rows.every((r) => r.signed)) continue;
    rows.sort((a, b) => (a.part_number || 1) - (b.part_number || 1));
    docs.push({
      doc_id: docId,
      doc_title: rows[0].doc_title,
      doc_class: rows[0].doc_class,
      totalParts: rows[0].total_parts || rows.length,
      parts: rows,
    });
  }
  return docs;
}

// ─── Profile rail (block grammar) ──────────────────────────────
function PrimaryRail({ viewer, queue, cycleLabel, cycleEndISO, todayISO, streakCycles, nextCycle }) {
  const displayName = viewer?.displayName || "";
  const role = viewer?.roleTitle || "";
  const signedCount = (queue || []).filter((r) => r.signed).length;
  const totalCount = (queue || []).length;
  const openCount = totalCount - signedCount;
  const openMinutes = (queue || []).filter((r) => !r.signed).reduce((a, r) => a + (r.est_minutes || 0), 0);
  const meterPct = totalCount === 0 ? 0 : Math.round((signedCount / totalCount) * 100);
  const daysLeft = daysUntilISO(cycleEndISO, todayISO);
  const dueDateLabel = cycleEndISO ? formatMonthDayUpper(cycleEndISO) : null;
  const certs = (queue || [])
    .filter((r) => r.signed)
    .map((r) => ({
      doc_id: r.doc_id,
      doc_title: r.doc_title,
      serial: r.certificate_serial,
      signed_at: r.signed_at,
    }));

  return (
    <aside className="opd-card opd-prail" aria-label="Your profile">
      {/* Identity strip = card header (full-bleed bottom border earned) */}
      <div className="opd-pid">
        <div className="opd-pid-av" aria-hidden="true">{initials(displayName)}</div>
        <div className="opd-pid-who">
          <h2>{displayName || " "}</h2>
          {role ? <div className="opd-pid-r">{role}</div> : null}
        </div>
      </div>

      {/* Everything below is a block inside the card. */}
      <div className="opd-pbody">
        {streakCycles > 0 ? (
          <div className="opd-psec opd-psec--tint opd-psec--row">
            <span className="opd-psec-k">Streak</span>
            <span className="opd-strk">
              <Flame size={11} strokeWidth={1.75} />
              {streakCycles} cycles on time
            </span>
          </div>
        ) : null}

        <div className="opd-psec">
          <span className="opd-psec-k">This cycle</span>
          <div className="opd-cyc">
            <b className="opd-cyc-num num">{signedCount}</b>
            <span className="opd-cyc-of">of {totalCount} signed</span>
            <em className="opd-cyc-min num">{openMinutes} MIN</em>
          </div>
          <div className="opd-meter" aria-hidden="true">
            <i style={{ width: `${meterPct}%` }} />
          </div>
          <div className="opd-mlab">
            <span>{openCount} TO GO</span>
            <span>{cycleLabel ? cycleLabel.toUpperCase() : ""}</span>
          </div>
        </div>

        {daysLeft != null ? (
          <div className="opd-psec">
            <span className="opd-psec-k">Due</span>
            <div className="opd-duel">
              <b className="opd-duel-b num">{Math.max(0, daysLeft)}</b>
              <span className="opd-duel-s">days left</span>
              <em className="opd-duel-w">{dueDateLabel}</em>
            </div>
          </div>
        ) : null}

        <div className="opd-psec">
          <span className="opd-psec-k">Your certificates</span>
          {certs.length === 0 ? (
            <div className="opd-certfoot" style={{ marginTop: 6, borderTop: "none", paddingTop: 0 }}>
              No signatures yet this cycle
            </div>
          ) : (
            <div style={{ marginTop: 7 }}>
              {certs.map((c) => (
                <div key={c.doc_id} className="opd-sg">
                  <span className="opd-sg-ic" aria-hidden="true">
                    <Award size={12} strokeWidth={1.75} />
                  </span>
                  <div>
                    <b>{c.doc_title}</b>
                    <span className="opd-sg-serial">{c.serial ? `${c.serial} · ` : ""}{formatMonthDayUpper(c.signed_at) || ""}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="opd-psec opd-psec--tint">
          <span className="opd-psec-k">Coming up</span>
          <div className="opd-nx1">
            <Calendar size={13} strokeWidth={1.75} />
            {nextCycle?.label ? (
              <div>
                <b>{nextCycle.label}</b> · opens {formatMonthDay(nextCycle.period_start) || "next cycle"}
              </div>
            ) : (
              <div>
                <b>Next cycle</b> · no cycle scheduled yet
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Card footer (full-bleed tinted). */}
      <div className="opd-plinks">
        <button type="button" className="opd-plink">
          My full record
          <ChevronRight size={14} strokeWidth={2} />
        </button>
        <button type="button" className="opd-plink">
          Browse the Library
          <ChevronRight size={14} strokeWidth={2} />
        </button>
      </div>
    </aside>
  );
}

// ─── Lessons list wrapper (capped, cued) ───────────────────────
function LessonsCard({ sets, completedDocs, openCount, openMinutes, cycleEndDate, onOpen, todayISO, nextOpenPart }) {
  const wrapRef = useRef(null);
  const bodyRef = useRef(null);
  const [belowCount, setBelowCount] = useState(0);

  const recompute = useCallback(() => {
    const wrap = wrapRef.current;
    const body = bodyRef.current;
    if (!wrap || !body) return;
    const more = body.scrollHeight > body.clientHeight + 8
      && (body.scrollHeight - body.clientHeight - body.scrollTop) > 26;
    wrap.classList.toggle("opd-lwrap--more", more);
    if (more) {
      const bb = body.getBoundingClientRect();
      const blocks = [
        ...body.querySelectorAll(":scope > .opd-set"),
        ...body.querySelectorAll(":scope > .opd-cmpl"),
      ];
      const hidden = blocks.filter((el) => el.getBoundingClientRect().top > bb.bottom - 40).length;
      setBelowCount(hidden);
    } else {
      setBelowCount(0);
    }
  }, []);
  useEffect(() => {
    recompute();
    const body = bodyRef.current;
    if (!body) return;
    body.addEventListener("scroll", recompute, { passive: true });
    window.addEventListener("resize", recompute);
    return () => {
      body.removeEventListener("scroll", recompute);
      window.removeEventListener("resize", recompute);
    };
  }, [recompute, sets, completedDocs]);

  const scrollDown = () => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollBy({ top: 260, behavior: "smooth" });
  };

  return (
    <div className="opd-card opd-lcard">
      <div className="opd-lh">
        <span className="opd-lh-k">Lessons</span>
        <span className="opd-lh-meta">
          {openCount} open · about {openMinutes} min
          {cycleEndDate ? ` · due ${cycleEndDate}` : ""}
        </span>
        {nextOpenPart ? (
          <button
            type="button"
            className="opd-lh-cta"
            onClick={() => onOpen(nextOpenPart)}
          >
            Continue
            <ArrowRight size={14} strokeWidth={2} />
          </button>
        ) : null}
      </div>
      <div className="opd-lwrap" ref={wrapRef}>
        <div className="opd-lbody" ref={bodyRef}>
          {sets.map((s) => (
            <SetBlock key={s.doc_id} set={s} onOpen={onOpen} todayISO={todayISO} />
          ))}
          {sets.length === 0 && completedDocs.length === 0 ? (
            <div className="opd-set" style={{ padding: 22, textAlign: "center" }}>
              <div className="opd-lh-meta">Nothing needs you this cycle.</div>
            </div>
          ) : null}
          {completedDocs.length > 0 ? (
            <CompletedBlock docs={completedDocs} onOpen={onOpen} />
          ) : null}
        </div>
        <div className="opd-lfade" aria-hidden="true" />
        {belowCount > 0 ? (
          <button
            type="button"
            className="opd-lcue"
            onClick={scrollDown}
            aria-label={`${belowCount} more below - scroll`}
          >
            <span>{belowCount} more below</span>
            <ChevronDown size={12} strokeWidth={2} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ─── SetBlock ──────────────────────────────────────────────────
function SetBlock({ set, onOpen, todayISO }) {
  const family = docClassFamily(set.doc_class);
  const isSolo = set.parts.length === 1 && set.totalParts === 1;

  if (isSolo) {
    // Solo = set header only. No fake part row wearing a header icon.
    // Structure MATCHES the multi-part .opd-pr grammar: direct
    // children are .opd-lead + .opd-pb + .opd-pm + .opd-go. Same
    // shape means the right column aligns pixel-for-pixel with the
    // multi-part rows (owner ruling 2026-09-01 - the .opd-sright
    // flex-gap wrapper on solo was the 10px due-column artifact).
    const p = set.parts[0];
    // Solo IS a set header - card_line preferred, description fallback.
    const desc = setHeaderDescription(p);
    const dueClass = dueUrgencyClass(p.due_date, todayISO);
    return (
      <button
        type="button"
        className="opd-set opd-set--solo"
        onClick={() => onOpen(p)}
      >
        <span className="opd-lead" aria-hidden="true">
          <span className={"opd-seti opd-seti--" + family}>
            <FileText size={15} strokeWidth={1.75} />
          </span>
        </span>
        <div className="opd-pb">
          <h4>{set.doc_title}</h4>
          {desc ? <div className="opd-pb-d">{desc}</div> : null}
        </div>
        <div className="opd-pm">
          <div className={"opd-pm-a " + dueClass}>{p.due_date ? `Due ${formatMonthDay(p.due_date)}` : ""}</div>
          <div className="opd-pm-b num">{p.est_minutes} MIN</div>
        </div>
        <span className="opd-go" aria-hidden="true">Start <ArrowRight size={12} strokeWidth={2} /></span>
      </button>
    );
  }

  // Multi-part set: header + numbered part rows on a connecting spine.
  const completedSetParts = set.completedPriorCount;
  const openPartsCount = set.openPartsCount ?? (set.parts.length - completedSetParts);
  const progressPct = set.totalParts === 0 ? 0 : Math.round((completedSetParts / set.totalParts) * 100);
  const started = completedSetParts > 0;

  return (
    <div className="opd-set">
      <div className="opd-seth">
        <span className="opd-lead" aria-hidden="true">
          <span className={"opd-seti opd-seti--" + family}>
            <FileText size={15} strokeWidth={1.75} />
          </span>
        </span>
        <div className="opd-seth-tx">
          <h3>{set.doc_title}</h3>
          <div className="opd-seth-mt">
            {started
              ? `Part ${completedSetParts} complete · ${openPartsCount} part${openPartsCount === 1 ? "" : "s"} left · ${set.minutesLeft} min`
              : `${set.totalParts} parts, in order · ${set.minutesLeft} min`}
          </div>
        </div>
        <div className="opd-sright">
          <span className="opd-sprog" aria-hidden="true">
            <i style={{ width: `${progressPct}%` }} />
          </span>
          <span className="opd-sstat">
            {started ? `${completedSetParts} OF ${set.totalParts}` : "NOT STARTED"}
          </span>
        </div>
      </div>
      {set.parts.map((p) => {
        const isSigned = p._signed;
        const isLocked = p._locked;
        const isNext = p._next;
        // Signed rows reuse the same signed state the Completed
        // block renders - .opd-pr--dn - so a signed part inside a
        // packet is visually the same as a signed part inside the
        // Completed block (green spine, check bubble, serial +
        // "CERTIFICATE" in the meta column, "View" go). The class
        // + row content already exist; the difference is only
        // WHERE the row renders.
        const cls = "opd-pr"
          + (isSigned ? " opd-pr--dn" : "")
          + (isLocked ? " opd-pr--lk" : "")
          + (isNext ? " opd-pr--nx" : "");
        // Part rows use obligation.description ONLY - never card_line.
        // When description is empty the row's second line renders
        // nothing, and the fix is authoring content (not code
        // substituting a document-level line).
        const desc = partRowDescription(p);
        const shortTitle = partShortTitle(p.source_section);
        const dueClass = dueUrgencyClass(p.due_date, todayISO);
        if (isSigned) {
          const md = formatMonthDay(p.signed_at);
          return (
            <button
              key={p.requirement_id}
              type="button"
              className={cls}
              onClick={() => onOpen(p)}
              title={p.source_section || undefined}
            >
              <i className="opd-spine" aria-hidden="true" />
              <span className="opd-lead" aria-hidden="true">
                <span className="opd-pnum">
                  <Check size={11} strokeWidth={2.25} />
                </span>
              </span>
              <div className="opd-pb">
                <h4>Part {p.part_number}{shortTitle ? ` · ${shortTitle}` : ""}</h4>
                <div className="opd-pb-d">
                  {md ? `Signed ${md}` : "Signed"}
                  {p.doc_version ? ` · version ${p.doc_version}` : ""}
                </div>
              </div>
              <div className="opd-pm">
                <div className="opd-pm-a" title={p.certificate_serial || undefined}>
                  {elideSerial(p.certificate_serial)}
                </div>
                <div className="opd-pm-b">CERTIFICATE</div>
              </div>
              <span className="opd-go" aria-hidden="true">View</span>
            </button>
          );
        }
        return (
          <button
            key={p.requirement_id}
            type="button"
            className={cls}
            onClick={() => { if (!isLocked) onOpen(p); }}
            disabled={isLocked}
            title={p.source_section || undefined}
          >
            <i className="opd-spine" aria-hidden="true" />
            <span className="opd-lead" aria-hidden="true">
              <span className="opd-pnum">
                {isLocked ? <Lock size={10} strokeWidth={1.75} /> : p.part_number}
              </span>
            </span>
            <div className="opd-pb">
              <h4>Part {p.part_number}{shortTitle ? ` · ${shortTitle}` : ""}</h4>
              {desc ? <div className="opd-pb-d">{desc}</div> : null}
              {isLocked ? (
                <span className="opd-lkn">
                  <Lock size={10} strokeWidth={1.75} />
                  Opens when you finish Part {p.part_number - 1}
                </span>
              ) : null}
            </div>
            <div className="opd-pm">
              <div className={"opd-pm-a " + (isLocked ? "" : dueClass)}
                style={isLocked ? { color: "var(--opd-n500)" } : undefined}>
                {p.due_date ? `Due ${formatMonthDay(p.due_date)}` : ""}
              </div>
              <div className="opd-pm-b num">{p.est_minutes} MIN</div>
            </div>
            <span
              className={"opd-go" + (isLocked ? " opd-go--q" : "")}
              aria-hidden="true"
            >
              {isLocked ? "Locked" : (<>Start <ArrowRight size={12} strokeWidth={2} /></>)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// First section from source_section, truncated to ~40 chars at a word
// boundary. Used as an internal navigation aid ("Part 2 · Culinary
// Defined"), NOT as the description.
function partShortTitle(sourceSection) {
  const src = String(sourceSection || "").trim();
  if (!src) return "";
  const first = src.split(/;/, 1)[0].trim();
  if (!first) return "";
  const MAX = 40;
  if (first.length <= MAX) return first;
  const cut = first.slice(0, MAX);
  const lastSp = cut.lastIndexOf(" ");
  return (lastSp > 20 ? cut.slice(0, lastSp) : cut).replace(/[\s,.·-]+$/, "") + "…";
}

// ─── Completed block ───────────────────────────────────────────
// Owner ruling 2026-09-02: "Completed this cycle" surfaces fully
// completed DOCUMENTS only. A doc is fully complete when every part
// is signed - at that point the whole packet moves down as one unit
// with its certificates. Partially-signed docs stay in Lessons with
// the signed parts inline in their set. If nothing is fully
// complete, this block does not render (see the render gate at the
// callsite).
function CompletedBlock({ docs, onOpen }) {
  const partCount = docs.reduce((acc, d) => acc + d.parts.length, 0);
  return (
    <div className="opd-cmpl">
      <div className="opd-cmplh">
        <Check size={13} strokeWidth={2.25} style={{ color: "var(--opd-grnfg)" }} />
        <span className="opd-cmplh-k">Completed this cycle</span>
        <span className="opd-cmplh-s">
          {docs.length} document{docs.length === 1 ? "" : "s"} · {partCount} certificate{partCount === 1 ? "" : "s"}
        </span>
      </div>
      {docs.map((d) => (
        d.parts.map((r) => {
          const md = formatMonthDay(r.signed_at);
          return (
            <button
              key={r.requirement_id}
              type="button"
              className="opd-pr opd-pr--dn"
              onClick={() => onOpen(r)}
            >
              <i className="opd-spine" aria-hidden="true" />
              <span className="opd-lead" aria-hidden="true">
                <span className="opd-pnum">
                  <Check size={11} strokeWidth={2.25} />
                </span>
              </span>
              <div className="opd-pb">
                <h4>{r.doc_title}{r.total_parts > 1 ? ` · Part ${r.part_number}` : ""}</h4>
                <div className="opd-pb-d">
                  {md ? `Signed ${md}` : "Signed"}
                  {r.doc_version ? ` · version ${r.doc_version}` : ""}
                </div>
              </div>
              <div className="opd-pm">
                <div className="opd-pm-a" title={r.certificate_serial || undefined}>
                  {elideSerial(r.certificate_serial)}
                </div>
                <div className="opd-pm-b">CERTIFICATE</div>
              </div>
              <span className="opd-go" aria-hidden="true">View</span>
            </button>
          );
        })
      ))}
    </div>
  );
}

// ─── Year track (unchanged behaviour, class names align to render) ──
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
    <div className="opd-c2">
      <div className="opd-c2h">
        <Calendar size={13} strokeWidth={1.75} style={{ color: "var(--opd-navy)" }} />
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
          <><b>{currentCycleLabel} is your first live cycle.</b></>
        ) : "No cycle is open at the moment."}
      </div>
    </div>
  );
}

// ─── Record card ───────────────────────────────────────────────
function RecordCard({ record, cycleLabel }) {
  const r = record || {
    signedAllTime: 0, minutesReadThisCycle: 0, checksPassed: 0,
    retries: 0, cyclesClosedCount: 0, firstRun: true,
  };
  return (
    <div className="opd-c2">
      <div className="opd-c2h">
        <Award size={13} strokeWidth={1.75} style={{ color: "var(--opd-navy)" }} />
        <span className="opd-c2h-k">Your record</span>
        <span className="opd-lb">{cycleLabel ? `since ${cycleLabel}` : "all time"}</span>
      </div>
      <div className="opd-rg">
        <div className="opd-rq">
          <b className="num">{r.signedAllTime}</b>
          <span className="opd-lb">SIGNED</span>
          <em className="opd-rq-sub">All time</em>
        </div>
        <div className="opd-rq">
          {r.firstRun ? (
            <>
              <div className="opd-rq-fr">Starts now</div>
              <span className="opd-lb" style={{ marginTop: 6 }}>ON-TIME CYCLES</span>
              <em className="opd-rq-sub">No cycle has closed yet</em>
            </>
          ) : (
            <>
              <b className="num">{r.cyclesClosedCount}</b>
              <span className="opd-lb">ON-TIME CYCLES</span>
              <em className="opd-rq-sub">of {r.cyclesClosedCount} closed</em>
            </>
          )}
        </div>
        <div className="opd-rq">
          <b className="num">{r.minutesReadThisCycle}</b>
          <span className="opd-lb">MINUTES READ</span>
          <em className="opd-rq-sub">This cycle</em>
        </div>
        <div className="opd-rq">
          <b className="num">{r.checksPassed}</b>
          <span className="opd-lb">CHECKS PASSED</span>
          <em className="opd-rq-sub">{r.retries > 0 ? `${r.retries} retr${r.retries === 1 ? "y" : "ies"}` : "First try each"}</em>
        </div>
      </div>
      <div className="opd-rfoot">
        Permanent and version-bound. If a document is materially revised the signature expires. <b>Nothing is ever deleted.</b>
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
    <div className="opd-c2 opd-cs">
      <div className="opd-c2h">
        <Users size={13} strokeWidth={1.75} style={{ color: "var(--opd-navy)" }} />
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
              <ChevronRight size={13} strokeWidth={2} className="opd-cr-chv" />
              <span className="opd-cr-kk">{a.team_key}</span>
              <span className="opd-cr-nm">{accountDisplayName(a.team_key, a.region)}</span>
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
                    <b>{p.display_name || " "}</b>
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

  // Background refresh - does NOT flip status to "loading" and does
  // NOT clear data. Used after sign so the room's data (queue,
  // certificate list, record counters) refreshes silently BEHIND the
  // completion screen already rendered inside AcademyFocus. The
  // completion screen must not be unmounted by a parent state churn
  // (owner ruling 2026-09-02: skeleton flash between sign and cert
  // was the room re-rendering, which unmounted AcademyFocus, which
  // remounted with its own loading skeleton before the completion
  // cert came back).
  const refreshSilent = useCallback(async function refreshSilent() {
    try {
      const res = await fetch("/api/academy/room", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data || !data.ok) return;
      setState((prev) => ({ status: "ready", data, error: null }));
    } catch { /* best-effort - the visible surface is the completion cert */ }
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
  const cycleEndDate = cycleEndISO ? formatMonthDay(cycleEndISO) : null;

  const sets = useMemo(() => buildSets(queue), [queue]);
  // "Completed this cycle" = fully-signed DOCUMENTS only. A doc with
  // one signed part and one unsigned part stays in Lessons; the
  // signed part renders inside its set in the signed state.
  const completedDocs = useMemo(() => buildFullyCompletedDocs(queue), [queue]);
  const openCount = queue.filter((r) => !r.signed).length;
  const openMinutes = queue.filter((r) => !r.signed).reduce((a, r) => a + (r.est_minutes || 0), 0);

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
        onSigned={() => { refreshSilent(); }}
      />
    );
  }

  if (state.status === "error") {
    return (
      <DashedBrick scope="the Academy" message={state.error} onRetry={() => load()} />
    );
  }

  // Next open = the flagged _next part in the first set that has one.
  // Signed parts inside a set are visible in the signed state; they
  // are never "next-open".
  const nextOpenPart = sets.find((s) => s.parts.some((p) => p._next))?.parts.find((p) => p._next) || null;

  return (
    <div className="opd-room opd-room--dense" data-room="academy">
      {/* Two cards on one gutter, stretched to equal height. */}
      <div className="opd-pgrid">
        <PrimaryRail
          viewer={viewer}
          queue={queue}
          cycleLabel={cycleLabel}
          cycleEndISO={cycleEndISO}
          todayISO={todayISO}
          streakCycles={0}
          nextCycle={nextCycle}
        />
        {loading ? (
          <LessonsSkeleton />
        ) : (
          <LessonsCard
            sets={sets}
            completedDocs={completedDocs}
            openCount={openCount}
            openMinutes={openMinutes}
            cycleEndDate={cycleEndDate}
            onOpen={onOpen}
            todayISO={todayISO}
            nextOpenPart={nextOpenPart}
          />
        )}
      </div>

      {/* Secondary row (unchanged from prior PR): Year + Record stacked
          left, Company Standing right. */}
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
