"use client";

// Records room. The ledger surface. Every row is a FACT with a
// source (an attestation, a waiver, or an outstanding requirement).
// Nothing here is computed status.
//
// View 1 - Mine (default, everyone). Three sections:
//   Signatures   one row per attestation, newest first
//   Waived       one row per waived requirement, with reason IN FULL
//                per spec 5.3
//   Outstanding  unsigned + not waived, presented as a record not
//                as work
//
// View 2 - Company (academy_admin only). Every attestation across
// the org, filterable by account + cycle. Names people who
// COMPLETED something. Never a "has not" list per spec 3.4.
//
// Toggle is HIDDEN when the viewer does not hold academy_admin -
// a control that exists but cannot be used is worse than absence.
//
// Every list ships skeleton + empty + error states.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Award,
  FileText,
  Ban,
  Clock,
  CheckCircle2,
  User,
  Users,
} from "lucide-react";

function formatDateShort(iso) {
  if (!iso) return null;
  const s = String(iso);
  const dateOnly = s.length >= 10 ? s.slice(0, 10) : s;
  try {
    const d = new Date(`${dateOnly}T00:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return null;
  }
}
function formatDateTime(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${date} at ${time}`;
  } catch {
    return null;
  }
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

// Skeleton mirrors the shape of a records section (header + 3 rows).
function RecordsSectionSkeleton() {
  return (
    <div className="opd-card opd-rec-sec opd-rec-sec--skel" aria-busy="true" aria-label="Loading records">
      <div className="opd-rec-sec-head">
        <span className="opd-skel opd-skel--bar opd-skel--w40" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="opd-rec-row opd-rec-row--skel">
          <span className="opd-skel opd-skel--chip" />
          <span className="opd-skel opd-skel--bar opd-skel--w60" />
          <span className="opd-skel opd-skel--bar opd-skel--w20" />
        </div>
      ))}
    </div>
  );
}

// One row in the Signatures section.
function SignatureRow({ sig }) {
  return (
    <div className="opd-rec-row opd-rec-row--sig" role="listitem">
      <span className="opd-rec-chip" title={`Document id ${sig.doc.id}`}>{sig.doc.id}</span>
      <div className="opd-rec-body">
        <div className="opd-rec-title-row">
          <span className="opd-rec-title">{sig.doc.title}</span>
          <span className="opd-rec-ver">v{sig.doc_version}</span>
        </div>
        <div className="opd-rec-sub">
          <span className="opd-rec-module">{sig.module.source_section || sig.module.key}</span>
        </div>
        <div className="opd-rec-meta">
          <span className="opd-rec-meta-item">
            <Clock size={11} strokeWidth={1.75} aria-hidden="true" />
            Signed {formatDateTime(sig.signed_at) || "-"}
          </span>
          {sig.certificate_serial ? (
            <span className="opd-rec-meta-item opd-rec-meta-mono" title={sig.certificate_serial}>
              {sig.certificate_serial}
            </span>
          ) : null}
          <span className="opd-rec-meta-item">
            Checks passed {sig.attempts_passed != null ? sig.attempts_passed : "-"}
            {sig.attempts_total != null && sig.attempts_total !== sig.attempts_passed
              ? ` of ${sig.attempts_total}`
              : ""}
          </span>
          <span className="opd-rec-meta-item">
            Attempts {sig.attempts_count ?? "-"}
          </span>
          <span className="opd-rec-meta-item">
            {sig.minutes} min on module
          </span>
        </div>
      </div>
      <div className="opd-rec-act">
        <a
          className="opd-rec-cert-link"
          href={sig.certificate_href}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Award size={12} strokeWidth={1.75} aria-hidden="true" />
          Certificate
        </a>
      </div>
    </div>
  );
}

// One row in the Waived section. Reason renders IN FULL - never
// truncated or hidden behind a click.
function WaivedRow({ row }) {
  return (
    <div className="opd-rec-row opd-rec-row--waived" role="listitem">
      <span className="opd-rec-chip" title={`Document id ${row.doc.id}`}>{row.doc.id}</span>
      <div className="opd-rec-body">
        <div className="opd-rec-title-row">
          <span className="opd-rec-title">{row.doc.title}</span>
          <span className="opd-rec-ver">v{row.doc_version}</span>
        </div>
        <div className="opd-rec-sub">
          <span className="opd-rec-module">{row.module.source_section || row.module.key}</span>
          {row.cycle_label ? <span className="opd-rec-cycle">{row.cycle_label}</span> : null}
        </div>
        <p className="opd-rec-waive-reason">
          <span className="opd-rec-waive-lead">Reason:</span> {row.waive_reason}
        </p>
        <div className="opd-rec-meta">
          <span className="opd-rec-meta-item">
            Waived by {row.waived_by || "-"}
          </span>
          <span className="opd-rec-meta-item">
            {formatDateTime(row.waived_at) || "-"}
          </span>
        </div>
      </div>
    </div>
  );
}

// One row in the Outstanding section.
function OutstandingRow({ row }) {
  return (
    <div className="opd-rec-row opd-rec-row--out" role="listitem">
      <span className="opd-rec-chip" title={`Document id ${row.doc.id}`}>{row.doc.id}</span>
      <div className="opd-rec-body">
        <div className="opd-rec-title-row">
          <span className="opd-rec-title">{row.doc.title}</span>
          <span className="opd-rec-ver">v{row.doc_version}</span>
        </div>
        <div className="opd-rec-sub">
          <span className="opd-rec-module">{row.module.source_section || row.module.key}</span>
          {row.cycle_label ? <span className="opd-rec-cycle">{row.cycle_label}</span> : null}
        </div>
        <div className="opd-rec-meta">
          <span className="opd-rec-meta-item">
            Due {formatDateShort(row.due_date) || "-"}
          </span>
          <span className="opd-rec-meta-item">
            {row.est_minutes ? `${row.est_minutes} min estimated` : "estimate not set"}
          </span>
        </div>
      </div>
    </div>
  );
}

// Company signatures row - people-first (adds a person + account
// leader compared to SignatureRow).
function CompanySignatureRow({ sig }) {
  const person = sig.person || {};
  return (
    <div className="opd-rec-row opd-rec-row--sig" role="listitem">
      <span className="opd-rec-chip" title={`Document id ${sig.doc.id}`}>{sig.doc.id}</span>
      <div className="opd-rec-body">
        <div className="opd-rec-title-row">
          <span className="opd-rec-title">{person.display_name || "(unnamed)"}</span>
          <span className="opd-rec-cycle">{person.account_key || "-"}</span>
        </div>
        <div className="opd-rec-sub">
          <span className="opd-rec-module">
            {sig.doc.title} - {sig.module.source_section || sig.module.key}
          </span>
        </div>
        <div className="opd-rec-meta">
          <span className="opd-rec-meta-item">
            <Clock size={11} strokeWidth={1.75} aria-hidden="true" />
            Signed {formatDateTime(sig.signed_at) || "-"}
          </span>
          <span className="opd-rec-meta-item">v{sig.doc_version}</span>
          {sig.certificate_serial ? (
            <span className="opd-rec-meta-item opd-rec-meta-mono" title={sig.certificate_serial}>
              {sig.certificate_serial}
            </span>
          ) : null}
          {sig.cycle_label ? (
            <span className="opd-rec-meta-item">{sig.cycle_label}</span>
          ) : null}
        </div>
      </div>
      <div className="opd-rec-act">
        <a
          className="opd-rec-cert-link"
          href={sig.certificate_href}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Award size={12} strokeWidth={1.75} aria-hidden="true" />
          Certificate
        </a>
      </div>
    </div>
  );
}

// ─── Mine view ─────────────────────────────────────────────────
function MineView({ data }) {
  const { signatures, waived, outstanding } = data;
  const nothingAtAll =
    signatures.length === 0 && waived.length === 0 && outstanding.length === 0;

  if (nothingAtAll) {
    return (
      <div className="opd-empty opd-rec-empty" role="status">
        <p>
          <b>Nothing recorded yet.</b>
        </p>
        <p>
          Signatures appear here when you sign an Academy module. Waived
          requirements land here with the reason. Outstanding work you
          have been issued appears here with its due date.
        </p>
      </div>
    );
  }

  return (
    <>
      <section className="opd-card opd-rec-sec" aria-labelledby="opd-rec-sig-h">
        <div className="opd-rec-sec-head">
          <h2 id="opd-rec-sig-h" className="opd-rec-sec-title">
            <CheckCircle2 size={13} strokeWidth={1.75} aria-hidden="true" />
            Signatures
          </h2>
          <span className="opd-rec-sec-count">
            {signatures.length} record{signatures.length === 1 ? "" : "s"}
          </span>
        </div>
        {signatures.length === 0 ? (
          <div className="opd-rec-row opd-rec-row--empty">
            No signatures yet. Sign an Academy module and it will appear here.
          </div>
        ) : (
          signatures.map((s) => <SignatureRow key={s.attestation_id} sig={s} />)
        )}
      </section>

      <section className="opd-card opd-rec-sec opd-rec-sec--waived" aria-labelledby="opd-rec-wav-h">
        <div className="opd-rec-sec-head">
          <h2 id="opd-rec-wav-h" className="opd-rec-sec-title">
            <Ban size={13} strokeWidth={1.75} aria-hidden="true" />
            Waived
          </h2>
          <span className="opd-rec-sec-count">
            {waived.length} record{waived.length === 1 ? "" : "s"}
          </span>
        </div>
        {waived.length === 0 ? (
          <div className="opd-rec-row opd-rec-row--empty">
            Nothing waived. Requirements that are removed with a reason will land here.
          </div>
        ) : (
          waived.map((r) => <WaivedRow key={r.requirement_id} row={r} />)
        )}
      </section>

      <section className="opd-card opd-rec-sec" aria-labelledby="opd-rec-out-h">
        <div className="opd-rec-sec-head">
          <h2 id="opd-rec-out-h" className="opd-rec-sec-title">
            <FileText size={13} strokeWidth={1.75} aria-hidden="true" />
            Outstanding
          </h2>
          <span className="opd-rec-sec-count">
            {outstanding.length} record{outstanding.length === 1 ? "" : "s"}
          </span>
        </div>
        {outstanding.length === 0 ? (
          <div className="opd-rec-row opd-rec-row--empty">
            Nothing outstanding. Every requirement issued to you has been signed or waived.
          </div>
        ) : (
          outstanding.map((r) => <OutstandingRow key={r.requirement_id} row={r} />)
        )}
      </section>
    </>
  );
}

// ─── Company view ──────────────────────────────────────────────
function CompanyView({ data }) {
  const { signatures, accounts, cycles, currentCycle, enrolledInCurrent } = data;
  const [accountKey, setAccountKey] = useState("all");
  const [cycleId, setCycleId] = useState("all");

  const filtered = useMemo(() => {
    let s = signatures;
    if (accountKey !== "all") s = s.filter((x) => x.person.account_key === accountKey);
    if (cycleId !== "all") {
      const cid = Number(cycleId);
      s = s.filter((x) => x.cycle_id === cid);
    }
    return s;
  }, [signatures, accountKey, cycleId]);

  return (
    <>
      <section className="opd-card opd-rec-filterbar" aria-label="Company records filters">
        <div className="opd-rec-fb-group">
          <label className="opd-rec-fb-label" htmlFor="opd-rec-acct">Account</label>
          <select
            id="opd-rec-acct"
            className="opd-rec-fb-select"
            value={accountKey}
            onChange={(e) => setAccountKey(e.target.value)}
          >
            <option value="all">All accounts</option>
            {accounts.map((a) => (
              <option key={a.team_key} value={a.team_key}>
                {a.team_key}{a.region ? ` - ${a.region}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="opd-rec-fb-group">
          <label className="opd-rec-fb-label" htmlFor="opd-rec-cyc">Cycle</label>
          <select
            id="opd-rec-cyc"
            className="opd-rec-fb-select"
            value={cycleId}
            onChange={(e) => setCycleId(e.target.value)}
          >
            <option value="all">All cycles</option>
            {cycles.map((c) => (
              <option key={c.cycle_id} value={String(c.cycle_id)}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="opd-rec-fb-count">
          {filtered.length} record{filtered.length === 1 ? "" : "s"}
        </div>
      </section>

      <section className="opd-card opd-rec-sec" aria-labelledby="opd-rec-co-h">
        <div className="opd-rec-sec-head">
          <h2 id="opd-rec-co-h" className="opd-rec-sec-title">
            <Users size={13} strokeWidth={1.75} aria-hidden="true" />
            Completed across the company
          </h2>
          <span className="opd-rec-sec-count">
            {filtered.length} record{filtered.length === 1 ? "" : "s"}
          </span>
        </div>
        {signatures.length === 0 ? (
          <div className="opd-empty opd-rec-empty" role="status">
            <p>
              <b>System waiting for data.</b>
            </p>
            <p>
              No signatures have landed yet.{" "}
              {currentCycle
                ? `The ${currentCycle.label} cycle has ${enrolledInCurrent} enrolled requirement${enrolledInCurrent === 1 ? "" : "s"}; when someone signs their first module, this ledger begins to populate.`
                : "When a cycle publishes and enrolled people begin to sign, this ledger will populate."}
            </p>
            <p>
              Records only names people who COMPLETED something. Outstanding work sits in the Academy room&apos;s Company Standing card.
            </p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="opd-rec-row opd-rec-row--empty">
            No signatures match the current filter.
          </div>
        ) : (
          filtered.map((s) => <CompanySignatureRow key={s.attestation_id} sig={s} />)
        )}
      </section>
    </>
  );
}

// ─── Room shell ────────────────────────────────────────────────
export default function RecordsRoom({ viewerEmail }) {
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [scope, setScope] = useState("mine"); // 'mine' | 'company'
  const isFirstLoadRef = useRef(true);

  const load = useCallback(async function load() {
    if (!isFirstLoadRef.current) {
      setState({ status: "loading", data: null, error: null });
    }
    isFirstLoadRef.current = false;
    try {
      const res = await fetch("/api/academy/records", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setState({
          status: "error",
          data: null,
          error: `HTTP ${res.status}${text ? ` - ${text.slice(0, 160)}` : ""}`,
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
    queueMicrotask(() => {
      if (!cancelled) load();
    });
    return () => { cancelled = true; };
  }, [load]);

  const isAdmin = !!state.data?.viewer?.isAcademyAdmin;
  const currentScope = isAdmin ? scope : "mine";

  return (
    <div className="opd-room opd-room--v5" data-room="records">
      <div className="opd-rec-head">
        <div className="opd-rec-head-title">
          <User size={13} strokeWidth={1.75} aria-hidden="true" />
          Records
        </div>
        {/* Scope toggle: HIDDEN for non-admins. A control that
            exists but cannot be used is worse than absence. */}
        {isAdmin ? (
          <div className="opd-rec-scope" role="tablist" aria-label="Records scope">
            <button
              type="button"
              role="tab"
              aria-selected={currentScope === "mine"}
              className={"opd-rec-scope-tab" + (currentScope === "mine" ? " opd-rec-scope-tab--on" : "")}
              onClick={() => setScope("mine")}
            >
              Mine
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={currentScope === "company"}
              className={"opd-rec-scope-tab" + (currentScope === "company" ? " opd-rec-scope-tab--on" : "")}
              onClick={() => setScope("company")}
            >
              Company
            </button>
          </div>
        ) : null}
      </div>

      <div className="opd-content opd-rec-content">
        {state.status === "loading" ? (
          <>
            <RecordsSectionSkeleton />
            <RecordsSectionSkeleton />
          </>
        ) : state.status === "error" ? (
          <DashedBrick scope="Records" message={state.error} onRetry={() => load()} />
        ) : currentScope === "mine" ? (
          <MineView data={state.data.mine} />
        ) : (
          <CompanyView data={state.data.company} />
        )}
      </div>
    </div>
  );
}
