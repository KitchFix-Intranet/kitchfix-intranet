"use client";

// ════════════════════════════════════════════════════════════════════════════
// Library — performance system docs viewer (Drive embeds)
//
// Module: People Portal · Leadership Dugout
// Sprint: 1 (functional)
// Spec: /docs/LEADERSHIP_DUGOUT_BUILD_PLAN.md
// CSS prefix: pp-ldug-
// Sibling pattern: src/components/people/IncidentLibrary.js
//
// Reads from HUB sheet "ldug_library_manifest" tab (same column structure
// as existing library_manifest). Each row points to a Drive file ID.
// Click → opens Drive viewer in a new tab (matches IncidentLibrary pattern).
// ════════════════════════════════════════════════════════════════════════════

import { useEffect, useState } from "react";

const CATEGORY_LABELS = {
  pb: "Playbooks",
  sop: "Standard Operating Procedures",
  tpl: "Templates",
  std: "Standards",
  agr: "Agreements",
  other: "Other",
};

const CATEGORY_ORDER = ["pb", "sop", "tpl", "std", "agr", "other"];

export default function Library({ showToast }) {
  const [docs, setDocs] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const email = typeof window !== "undefined" ? localStorage.getItem("kf_user_email") || "" : "";
    fetch("/api/people/leadership-dugout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "library-list", email }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.ok) setDocs(data.documents || []);
        else setError(true);
      })
      .catch(() => setError(true));
  }, []);

  const openDoc = (doc) => {
    if (!doc.view_url) {
      showToast?.({ msg: "Document link not available", type: "error" });
      return;
    }
    window.open(doc.view_url, "_blank", "noopener,noreferrer");
  };

  // ─── Group by category ───
  const grouped = (docs || []).reduce((acc, d) => {
    const cat = d.category || "other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(d);
    return acc;
  }, {});

  return (
    <div className="pp-ldug-library">
      <div className="pp-ldug-section-header">
        <h2 className="pp-ldug-section-title">Library</h2>
        <p className="pp-ldug-section-desc">
          The performance system playbook — PB-001 Leadership OS Handbook,
          SOP-001 Performance System, blank templates, standards, and agreements.
        </p>
      </div>

      {error && (
        <div className="pp-ldug-empty-state">
          <h3 className="pp-ldug-empty-title">Couldn't load the library</h3>
          <p className="pp-ldug-empty-desc">Try refreshing. If the issue persists, ping Kevin.</p>
        </div>
      )}

      {!error && docs === null && (
        <div className="pp-ldug-loading">Loading documents…</div>
      )}

      {!error && docs && docs.length === 0 && (
        <div className="pp-ldug-empty-state">
          <h3 className="pp-ldug-empty-title">Library not yet seeded</h3>
          <p className="pp-ldug-empty-desc">
            Add an <code className="pp-ldug-inline-code">ldug_library_manifest</code> tab
            in HUB with rows for each document. Columns mirror the existing
            <code className="pp-ldug-inline-code">library_manifest</code> tab pattern.
          </p>
        </div>
      )}

      {!error && docs && docs.length > 0 && (
        <div className="pp-ldug-library-groups">
          {CATEGORY_ORDER.filter((cat) => grouped[cat]?.length).map((cat) => (
            <section key={cat} className="pp-ldug-library-group">
              <h3 className="pp-ldug-library-group-title">
                {CATEGORY_LABELS[cat] || cat.toUpperCase()}
                <span className="pp-ldug-library-group-count">{grouped[cat].length}</span>
              </h3>
              <div className="pp-ldug-library-grid">
                {grouped[cat].map((doc) => (
                  <button
                    key={doc.id}
                    className="pp-ldug-library-card"
                    onClick={() => openDoc(doc)}
                  >
                    {doc.pinned && <span className="pp-ldug-library-pin">★ Pinned</span>}
                    <h4 className="pp-ldug-library-card-title">{doc.title}</h4>
                    {doc.version && (
                      <span className="pp-ldug-library-version">{doc.version}</span>
                    )}
                    {doc.description && (
                      <p className="pp-ldug-library-desc">{doc.description}</p>
                    )}
                    {doc.updated_at && (
                      <span className="pp-ldug-library-updated">
                        Updated {doc.updated_at}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}