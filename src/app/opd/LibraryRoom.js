"use client";

// Library room. Rail (filter card) + content (shelf cards). Data
// comes from /api/academy/library which returns shelves grouped in
// the canonical six-value order (see route file).
//
// Ships three states in this PR (spec law - not optional):
//   - skeleton  before the first fetch resolves
//   - empty     shelves exist but have zero docs (defensive; not
//               reachable today with 113 active docs, but must exist)
//   - error     dashed-brick pattern, never zero and never blank
//
// The trains-you marker is the ONE personal signal this PR can
// honestly show: it says a document carries training that applies
// to the viewer. Nothing stronger, because nothing stronger is
// true yet (no cycles, no requirements, no attestations).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const EMPTY_SHELVES = Object.freeze([]);

function formatShortDate(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" }).toUpperCase();
  } catch {
    return null;
  }
}

function ShelfSkeleton() {
  return (
    <div className="opd-shelf opd-shelf--skel" aria-busy="true" aria-label="Loading shelf">
      <div className="opd-shelf-head">
        <span className="opd-skel opd-skel--bar opd-skel--w40" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="opd-doc-row opd-doc-row--skel">
          <span className="opd-skel opd-skel--chip" />
          <span className="opd-skel opd-skel--bar opd-skel--w60" />
          <span className="opd-skel opd-skel--bar opd-skel--w20" />
        </div>
      ))}
    </div>
  );
}

function DashedBrick({ scope, message, onRetry }) {
  // Screen-level or row-level error surface. Dashed border on brick
  // background so the failure reads as a failure, never as an empty
  // list that might be trusted (spec law).
  return (
    <div className="opd-brick" role="alert">
      <div className="opd-brick-title">Could not load {scope}</div>
      <p className="opd-brick-body">{message || "Refresh the page or try again in a moment."}</p>
      {onRetry ? (
        <button type="button" className="opd-brick-retry" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

export default function LibraryRoom({ viewerEmail }) {
  // Initial state is "loading" so the first mount does NOT need to
  // setState synchronously inside useEffect (linter rule
  // react-hooks/set-state-in-effect). Only an explicit retry resets
  // to loading.
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [activeShelf, setActiveShelf] = useState(null); // null = all shelves
  const [trainsYouOnly, setTrainsYouOnly] = useState(false);
  const isFirstLoadRef = useRef(true);

  const load = useCallback(async function load() {
    // Skip the "back to loading" reset on the first call - initial
    // state already covers it. Subsequent calls (retry button) do
    // reset so the brick disappears while the retry is in flight.
    if (!isFirstLoadRef.current) {
      setState({ status: "loading", data: null, error: null });
    }
    isFirstLoadRef.current = false;
    try {
      const res = await fetch("/api/academy/library", {
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
    // Mount-once. viewerEmail cannot change without a fresh page
    // load, so an empty dep array is the correct wire. Deferred one
    // microtask so setState never fires synchronously inside the
    // effect body (react-hooks/set-state-in-effect).
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) load();
    });
    return () => { cancelled = true; };
  }, [load]);

  // Derived views on the loaded data. `shelves` is memoised so
  // useMemo below sees a stable reference frame-to-frame.
  const shelves = useMemo(
    () => state.data?.shelves || EMPTY_SHELVES,
    [state.data]
  );
  const totalDocs = state.data?.totalDocs || 0;
  const totalTrainsYou = state.data?.totalTrainsYou || 0;
  const viewer = state.data?.viewer || null;

  const visibleShelves = useMemo(() => {
    let s = shelves;
    if (activeShelf) s = s.filter((x) => x.name === activeShelf);
    if (trainsYouOnly) {
      s = s
        .map((x) => ({ ...x, docs: x.docs.filter((d) => d.trains_you) }))
        .filter((x) => x.docs.length > 0);
    }
    return s;
  }, [shelves, activeShelf, trainsYouOnly]);

  return (
    <div className="opd-room" data-room="library">

      {/* ── Rail (sticky filter card) ──────────────────────────── */}
      <aside className="opd-rail" aria-label="Library filters">
        <div className="opd-card opd-railcard">
          <div className="opd-rail-title">Shelves</div>
          <button
            type="button"
            className={"opd-rail-item" + (activeShelf === null ? " opd-rail-item--on" : "")}
            onClick={() => setActiveShelf(null)}
          >
            <span>All shelves</span>
            <span className="opd-rail-count">{totalDocs || (state.status === "loading" ? "-" : 0)}</span>
          </button>
          {state.status === "loading" && shelves.length === 0
            ? [0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="opd-rail-item opd-rail-item--skel">
                  <span className="opd-skel opd-skel--bar opd-skel--w60" />
                  <span className="opd-skel opd-skel--bar opd-skel--w10" />
                </div>
              ))
            : shelves.map((s) => (
                <button
                  key={s.name}
                  type="button"
                  className={"opd-rail-item" + (activeShelf === s.name ? " opd-rail-item--on" : "")}
                  onClick={() => setActiveShelf(s.name === activeShelf ? null : s.name)}
                >
                  <span className="opd-rail-item-label">{s.name}</span>
                  <span className="opd-rail-count">{s.count}</span>
                </button>
              ))}
        </div>

        {viewer?.onRoster ? (
          <div className="opd-card opd-railcard opd-railcard--filter">
            <div className="opd-rail-title">For you</div>
            <label className="opd-rail-toggle">
              <input
                type="checkbox"
                checked={trainsYouOnly}
                onChange={(e) => setTrainsYouOnly(e.target.checked)}
                aria-describedby="opd-trains-you-help"
              />
              <span>Trains you only</span>
              <span className="opd-rail-count">{totalTrainsYou}</span>
            </label>
            <p id="opd-trains-you-help" className="opd-rail-help">
              Documents whose training applies to you today.
            </p>
          </div>
        ) : null}
      </aside>

      {/* ── Content ─────────────────────────────────────────────── */}
      <div className="opd-content">

        {/* Top bar - search affordance is a Kevin-only placeholder
            for now; wiring the shelf search is out of scope. Rendered
            here to preserve product shape (matches render). */}
        <div className="opd-libbar">
          <div className="opd-libbar-search" role="search" aria-label="Search the library (not yet wired)">
            <span aria-hidden="true">&#9906;</span>
            <span className="opd-libbar-search-placeholder">Search titles, sections, and full text</span>
            <kbd className="opd-kbd">&#8984;K</kbd>
          </div>
          <div className="opd-libbar-context">
            {state.status === "ready" ? (
              <span className="opd-libbar-count">
                {totalDocs} document{totalDocs === 1 ? "" : "s"}
                {totalTrainsYou > 0 ? ` · ${totalTrainsYou} train${totalTrainsYou === 1 ? "s" : ""} you` : ""}
              </span>
            ) : null}
          </div>
        </div>

        {state.status === "loading" ? (
          [0, 1].map((i) => <ShelfSkeleton key={i} />)
        ) : state.status === "error" ? (
          <DashedBrick
            scope="the Library"
            message={state.error}
            onRetry={() => load()}
          />
        ) : visibleShelves.length === 0 ? (
          // Empty state (defensive; not reachable today with 113
          // docs unless a filter zeros the list).
          <div className="opd-empty">
            <p>
              {trainsYouOnly
                ? "Nothing trains you inside the current filter."
                : activeShelf
                  ? "This shelf is empty."
                  : "The Library has no visible documents. This should not happen."}
            </p>
          </div>
        ) : (
          visibleShelves.map((shelf) => (
            <section key={shelf.name} className="opd-card opd-shelf">
              <div className="opd-shelf-head">
                <h2 className="opd-shelf-title">{shelf.name}</h2>
                <span className="opd-shelf-count">
                  {shelf.count} document{shelf.count === 1 ? "" : "s"}
                  {shelf.trains_you_count > 0
                    ? ` · ${shelf.trains_you_count} train${shelf.trains_you_count === 1 ? "s" : ""} you`
                    : ""}
                </span>
              </div>
              {shelf.docs.length === 0 ? (
                <div className="opd-doc-row opd-doc-row--empty">
                  <span className="opd-doc-empty">No documents on this shelf</span>
                </div>
              ) : (
                shelf.docs.map((doc) => (
                  <div key={doc.id} className="opd-doc-row" role="listitem">
                    <span className="opd-doc-chip" aria-label={`Document id ${doc.id}`}>
                      {doc.id}
                    </span>
                    <div className="opd-doc-body">
                      <div className="opd-doc-title-row">
                        <span className="opd-doc-title">{doc.title}</span>
                        {doc.trains_you ? (
                          <span
                            className="opd-doc-trains"
                            title="This document carries training that applies to you"
                          >
                            Trains you
                          </span>
                        ) : null}
                      </div>
                      {doc.card_line ? (
                        <span className="opd-doc-cardline">{doc.card_line}</span>
                      ) : null}
                    </div>
                    <span className="opd-doc-meta">
                      {doc.version ? <span>v{doc.version}</span> : null}
                      {doc.updated_at ? (
                        <span className="opd-doc-meta-sep">{formatShortDate(doc.updated_at)}</span>
                      ) : null}
                    </span>
                  </div>
                ))
              )}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
