"use client";

// ════════════════════════════════════════════════════════════════════════════
// CycleReviewFill — sectioned long-form fill (self-assessment OR manager draft)
//
// Module: People Portal · Leadership Dugout
// Sprint: 2 (Chunk 5)
// CSS prefix: pp-ldug-
//
// Same shell, role-aware:
//   mode="self"    → Reviewed Party fills themes_self / composites_self
//   mode="manager" → Reviewer fills themes_manager / composites_manager / top3_strengths / top3_dev_areas
//
// Composites are filtered per role at render time (PB-001):
//   EC → all 3 composites; RDO → 2; Sous/HM/FieldChef → Financial Health only.
// ════════════════════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import ThemeRatingSelector from "@/components/people/leadership-dugout/ThemeRatingSelector";
import NarrativeField from "@/components/people/leadership-dugout/NarrativeField";
import RoleAnchorDrawer from "@/components/people/leadership-dugout/RoleAnchorDrawer";
import { THEMES, getCompositesForRole } from "@/lib/performanceSchema";

export default function CycleReviewFill({ mode, review, currentUserEmail, onSubmit, showToast }) {
  const header = review?.header || {};
  const body = review?.body || {};

  const themesKey = mode === "self" ? "themes_self" : "themes_manager";
  const compositesKey = mode === "self" ? "composites_self" : "composites_manager";

  const [themes, setThemes] = useState(() => normalizeThemes(body[themesKey]));
  const [composites, setComposites] = useState(() =>
    normalizeComposites(body[compositesKey], header.role)
  );
  const [strengths, setStrengths] = useState(() => normalizeTop3(body.top3_strengths, "item"));
  const [devAreas, setDevAreas] = useState(() => normalizeTop3(body.top3_dev_areas, "item"));
  const [submitting, setSubmitting] = useState(false);
  const [anchorDrawer, setAnchorDrawer] = useState(null); // { theme }

  const isManagerMode = mode === "manager";
  const showStrengthsDevAreas = isManagerMode;
  const applicableComposites = getCompositesForRole(header.role);

  useEffect(() => {
    setThemes(normalizeThemes(body[themesKey]));
    setComposites(normalizeComposites(body[compositesKey], header.role));
    setStrengths(normalizeTop3(body.top3_strengths, "item"));
    setDevAreas(normalizeTop3(body.top3_dev_areas, "item"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review?.header?.id, mode]);

  const saveSection = (sectionKey, value) =>
    fetch("/api/people/leadership-dugout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save-cycle-review-section",
        email: currentUserEmail,
        review_id: header.id,
        section_key: sectionKey,
        value,
      }),
    }).then((r) => r.json());

  const updateTheme = async (themeId, field, val) => {
    const next = themes.map((t) => (t.theme_id === themeId ? { ...t, [field]: val } : t));
    setThemes(next);
    const res = await saveSection(themesKey, next);
    if (!res?.ok) showToast?.({ msg: res?.error || "Save failed", type: "error" });
  };

  const updateComposite = async (compId, field, val) => {
    const next = composites.map((c) => (c.composite_id === compId ? { ...c, [field]: val } : c));
    setComposites(next);
    const res = await saveSection(compositesKey, next);
    if (!res?.ok) showToast?.({ msg: res?.error || "Save failed", type: "error" });
  };

  const updateTop3 = async (which, idx, val) => {
    const list = which === "strengths" ? strengths : devAreas;
    const next = list.map((x, i) => (i === idx ? { item: val } : x));
    if (which === "strengths") {
      setStrengths(next);
      await saveSection("top3_strengths", next);
    } else {
      setDevAreas(next);
      await saveSection("top3_dev_areas", next);
    }
  };

  const handleSubmit = async () => {
    // Light client-side validation (server enforces real authority)
    const incompleteThemes = themes.filter((t) => t.rating == null);
    if (incompleteThemes.length) {
      showToast?.({ msg: `Rate all 6 themes before submitting (${incompleteThemes.length} remaining).`, type: "error" });
      return;
    }
    const incompleteComposites = composites.filter((c) => c.rating == null);
    if (incompleteComposites.length) {
      showToast?.({ msg: `Rate all composites before submitting (${incompleteComposites.length} remaining).`, type: "error" });
      return;
    }
    if (isManagerMode) {
      const filledStrengths = strengths.filter((s) => s.item?.trim()).length;
      const filledDev = devAreas.filter((s) => s.item?.trim()).length;
      if (filledStrengths < 3 || filledDev < 3) {
        showToast?.({ msg: "Fill all 3 strengths and 3 development areas before submitting.", type: "error" });
        return;
      }
    }

    setSubmitting(true);
    const action = mode === "self" ? "submit-self-assessment" : "submit-manager-draft";
    try {
      const res = await fetch("/api/people/leadership-dugout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email: currentUserEmail, review_id: header.id }),
      }).then((r) => r.json());

      if (res?.ok) {
        showToast?.({
          msg: mode === "self"
            ? "Self-assessment submitted. Your Reviewer is up."
            : "Manager draft submitted. Oversight is up for calibration.",
          type: "success",
        });
        onSubmit?.();
      } else {
        showToast?.({ msg: res?.error || "Submit failed", type: "error" });
      }
    } catch (e) {
      showToast?.({ msg: e.message, type: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pp-ldug-cr-fill">
      <div className="pp-ldug-section-header">
        <h3 className="pp-ldug-section-title">
          {mode === "self" ? "Self-assessment" : "Manager draft"}
        </h3>
        <p className="pp-ldug-section-desc">
          {mode === "self"
            ? "Rate yourself across the Six Themes and applicable composites. Be candid — your Reviewer drafts independently and the two views meet at calibration."
            : `Drafting for ${header.leader_name}. Your draft goes to ${header.oversight_name || header.oversight_email} for calibration before delivery.`}
        </p>
      </div>

      {/* ── SIX THEMES ── */}
      <div className="pp-ldug-cr-section-group">
        <h4 className="pp-ldug-cr-group-title">Six Themes</h4>
        {THEMES.map((theme) => {
          const themeData = themes.find((t) => t.theme_id === theme.id) || {};
          return (
            <div key={theme.id} className="pp-ldug-cr-theme">
              <div className="pp-ldug-cr-theme-header">
                <h5 className="pp-ldug-cr-theme-title">{theme.label}</h5>
                <button
                  type="button"
                  className="pp-ldug-link"
                  onClick={() => setAnchorDrawer({ theme: theme.id })}
                >
                  View role anchor →
                </button>
              </div>
              <ThemeRatingSelector
                value={themeData.rating}
                onChange={(n) => updateTheme(theme.id, "rating", n)}
              />
              <div style={{ marginTop: 10 }}>
                <label className="pp-ldug-form-label">Narrative</label>
                <NarrativeField
                  value={themeData.narrative || ""}
                  onSave={(v) => updateTheme(theme.id, "narrative", v)}
                  placeholder={
                    mode === "self"
                      ? "What does success look like to me on this theme this cycle? Where did I miss the standard, and what did I do about it?"
                      : "What does this leader's performance on this theme look like this cycle? Cite specifics."
                  }
                  minHeight={70}
                />
              </div>
              <div style={{ marginTop: 8 }}>
                <label className="pp-ldug-form-label">Observable example</label>
                <NarrativeField
                  value={themeData.example || ""}
                  onSave={(v) => updateTheme(theme.id, "example", v)}
                  placeholder="A specific moment from this cycle that illustrates the rating."
                  minHeight={50}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── COMPOSITES (role-conditional) ── */}
      <div className="pp-ldug-cr-section-group">
        <h4 className="pp-ldug-cr-group-title">
          Composites
          <span className="pp-ldug-cr-group-meta">
            {applicableComposites.length} for {header.role}
          </span>
        </h4>
        {applicableComposites.map((comp) => {
          const compData = composites.find((c) => c.composite_id === comp.id) || {};
          return (
            <div key={comp.id} className="pp-ldug-cr-theme">
              <div className="pp-ldug-cr-theme-header">
                <h5 className="pp-ldug-cr-theme-title">{comp.label}</h5>
              </div>
              <ThemeRatingSelector
                value={compData.rating}
                onChange={(n) => updateComposite(comp.id, "rating", n)}
              />
              <div style={{ marginTop: 10 }}>
                <label className="pp-ldug-form-label">Narrative</label>
                <NarrativeField
                  value={compData.narrative || ""}
                  onSave={(v) => updateComposite(comp.id, "narrative", v)}
                  placeholder="Why this rating?"
                  minHeight={70}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* ── TOP 3 STRENGTHS + DEV AREAS (Manager mode only) ── */}
      {showStrengthsDevAreas && (
        <>
          <div className="pp-ldug-cr-section-group">
            <h4 className="pp-ldug-cr-group-title">Top 3 strengths</h4>
            {strengths.map((s, idx) => (
              <input
                key={idx}
                type="text"
                className="pp-ldug-form-input"
                style={{ marginBottom: 6 }}
                placeholder={`Strength ${idx + 1}`}
                value={s.item || ""}
                onChange={(e) => updateTop3("strengths", idx, e.target.value)}
              />
            ))}
          </div>
          <div className="pp-ldug-cr-section-group">
            <h4 className="pp-ldug-cr-group-title">Top 3 development areas</h4>
            {devAreas.map((s, idx) => (
              <input
                key={idx}
                type="text"
                className="pp-ldug-form-input"
                style={{ marginBottom: 6 }}
                placeholder={`Development area ${idx + 1}`}
                value={s.item || ""}
                onChange={(e) => updateTop3("devAreas", idx, e.target.value)}
              />
            ))}
          </div>
        </>
      )}

      {/* ── SUBMIT ── */}
      <div className="pp-ldug-form-actions">
        <button
          className="pp-card-cta pp-card-cta--primary"
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting
            ? "Submitting…"
            : mode === "self"
              ? "Submit self-assessment"
              : "Submit manager draft for calibration"}
        </button>
      </div>

      <RoleAnchorDrawer
        role={header.role}
        theme={anchorDrawer?.theme}
        open={!!anchorDrawer}
        onClose={() => setAnchorDrawer(null)}
      />
    </div>
  );
}

// ─── Helpers: normalize body data so missing fields don't crash render ───

function normalizeThemes(arr) {
  const safe = Array.isArray(arr) ? arr : [];
  return THEMES.map((t) => {
    const existing = safe.find((x) => x.theme_id === t.id);
    return existing || { theme_id: t.id, rating: null, narrative: "", example: "" };
  });
}

function normalizeComposites(arr, role) {
  const safe = Array.isArray(arr) ? arr : [];
  const applicable = getCompositesForRole(role);
  return applicable.map((c) => {
    const existing = safe.find((x) => x.composite_id === c.id);
    return existing || { composite_id: c.id, rating: null, narrative: "", example: "" };
  });
}

function normalizeTop3(arr) {
  const safe = Array.isArray(arr) ? arr : [];
  return [
    safe[0] || { item: "" },
    safe[1] || { item: "" },
    safe[2] || { item: "" },
  ];
}