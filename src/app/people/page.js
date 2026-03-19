"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import PeopleHero from "@/components/people/PeopleHero";
import PeopleNav from "@/components/people/PeopleNav";
import DashboardView from "@/components/people/DashboardView";
import ActionCenter from "@/components/people/ActionCenter";
import NewHireWizard from "@/components/people/NewHireWizard";
import PAFForm from "@/components/people/PAFForm";
import AdminQueue from "@/components/people/AdminQueue";
import ConfirmModal from "@/components/people/ConfirmModal";
import Toast from "@/components/people/Toast";
import "@/app/people/people.css";

// ═══════════════════════════════════════
// Draft persistence — server-backed with local memory cache
// ═══════════════════════════════════════
const _draftCache = {};
const _saveTimers = {};

const Drafts = {
  // Populate cache from bootstrap data (instant on page load)
  init(serverDrafts) {
    Object.entries(serverDrafts || {}).forEach(([key, json]) => {
      try { _draftCache[key] = typeof json === "string" ? JSON.parse(json) : json; } catch (e) {}
    });
  },

  // Instant read from memory cache
  load(key) { return _draftCache[key] || null; },

  // Write to cache immediately + debounced server save (2s)
  save(key, data) {
    _draftCache[key] = data;
    clearTimeout(_saveTimers[key]);
    _saveTimers[key] = setTimeout(() => {
      const email = typeof window !== "undefined" ? localStorage.getItem("kf_user_email") || "" : "";
      fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save-draft", email, module: key, payload: data }),
      }).catch(() => {});
    }, 2000);
  },

  // Clear from cache + server immediately
  clear(key) {
    delete _draftCache[key];
    clearTimeout(_saveTimers[key]);
    const email = typeof window !== "undefined" ? localStorage.getItem("kf_user_email") || "" : "";
    fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "delete-draft", email, module: key }),
    }).catch(() => {});
  },
};

// ═══════════════════════════════════════
// Formatter utilities
// ═══════════════════════════════════════
const Formatter = {
  toTitleCase(str) {
    if (!str) return "";
    return str.replace(/_/g, " ").replace(/([A-Z])/g, " $1").replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.substr(1).toLowerCase());
  },
  toMoney(val) {
    if (val === "" || val == null || isNaN(val)) return "-";
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(val);
  },
  toDate(val) {
    if (!val || val === "undefined") return "-";
    try {
      // Fix #5: For YYYY-MM-DD date strings, append T00:00:00 to prevent UTC timezone shift
      const safe = typeof val === "string" && /^\d{4}-\d{2}-\d{2}$/.test(val) ? val + "T00:00:00" : val;
      return new Date(safe).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    } catch (e) { return val; }
  },
};

export default function PeoplePage() {
  const [view, setView] = useState("dashboard");
  const [bootstrapData, setBootstrapData] = useState(null);
  const [bootstrapError, setBootstrapError] = useState(false);
  const [history, setHistory] = useState([]);
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [bannerVisible, setBannerVisible] = useState(false);

  const userEmail = useRef("");

  const bannerTimerRef = useRef(null);

  // ─── Bootstrap ───
  const loadBootstrap = useCallback(() => {
    setBootstrapError(false);
    const email = typeof window !== "undefined" ? localStorage.getItem("kf_user_email") || "" : "";
    userEmail.current = email;

    fetch(`/api/people?action=bootstrap&email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          Drafts.init(data.drafts || {});
          setBootstrapData(data);
          const dismissed = localStorage.getItem("kf_pp_banner_dismissed");
          if (!dismissed) setBannerVisible(true);
        } else {
          setBootstrapError(true);
        }
      })
      .catch(() => { setBootstrapError(true); });
  }, []);

  useEffect(() => { loadBootstrap(); }, [loadBootstrap]);

  // Fix #15: Banner auto-dismiss with proper timer cleanup
  useEffect(() => {
    if (bannerVisible) {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
      bannerTimerRef.current = setTimeout(() => {
        setBannerVisible(false);
        localStorage.setItem("kf_pp_banner_dismissed", "true");
      }, 15000);
    }
    return () => {
      if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    };
  }, [bannerVisible]);

  // ─── Load history ───
  const refreshHistory = useCallback(() => {
    const email = userEmail.current;
    fetch(`/api/people?action=history&email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((data) => { if (data.success) setHistory(data.history); });
  }, []);

  useEffect(() => { if (bootstrapData) refreshHistory(); }, [bootstrapData, refreshHistory]);

  // ─── Background polling (silent, non-disruptive) ───
  useEffect(() => {
    if (!bootstrapData) return;

    let intervalId = null;
    const POLL_MS = 30000; // 30 seconds

    const shouldPoll = () => {
      // Don't poll while user is filling out a form
      if (view === "newhire" || view === "paf") return false;
      // Don't poll while tab is hidden
      if (document.hidden) return false;
      return true;
    };

    const silentRefresh = () => {
      if (!shouldPoll()) return;
      const email = userEmail.current;
      fetch(`/api/people?action=history&email=${encodeURIComponent(email)}`)
        .then((r) => r.json())
        .then((data) => { if (data.success) setHistory(data.history); })
        .catch(() => {}); // Silently fail — no toast, no spinner
    };

    intervalId = setInterval(silentRefresh, POLL_MS);

    // Also refresh when tab becomes visible again
    const handleVisibility = () => {
      if (!document.hidden && shouldPoll()) silentRefresh();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [bootstrapData, view]);

  // Fix #6: Warn before browser tab close/refresh when editing a form with unsaved data
  useEffect(() => {
    const handler = (e) => {
      if ((view === "newhire" || view === "paf") && (Drafts.load("nh") || Drafts.load("paf"))) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [view]);

  // ─── Counts ───
  const counts = { paf: 0, newHire: 0, actionRequired: 0 };
  history.forEach((h) => {
    if (h.status === "Archived") return;
    if (/Rejected|Action/i.test(h.status)) counts.actionRequired++;
    else if (/Pending/i.test(h.status)) {
      if (h.module === "newhire") counts.newHire++;
      else counts.paf++;
    }
  });

  // ─── Toast helper ───
  const showToast = useCallback((msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // ─── Confirm helper ───
  const openConfirm = useCallback((title, text, confirmLabel, callback) => {
    setConfirm({ title, text, confirmLabel, callback });
  }, []);

  // ─── Router ───
  const navigate = useCallback((v) => {
    setView(v);
    if (v === "dashboard") {
      const dismissed = localStorage.getItem("kf_pp_banner_dismissed");
      if (!dismissed) setBannerVisible(true);
    } else {
      setBannerVisible(false);
    }
    // Refresh history when returning to dashboard or activity
    if (v === "dashboard" || v === "activity") refreshHistory();
    window.scrollTo(0, 0);
  }, [refreshHistory]);

  // ─── Resume edit from Action Center ───
  const resumeEdit = useCallback((item) => {
    let data = {};
    try { data = JSON.parse(item.payload); } catch (e) {}
    const isNewHire = item.module === "newhire";
    data.rowIndex = item.rowIndex;
    data.isEdit = true;
    Drafts.save(isNewHire ? "nh" : "paf", data);
    navigate(isNewHire ? "newhire" : "paf");
    showToast("📝 Loaded for Correction", "info");
  }, [navigate, showToast]);

  const [hasDraftNH, setHasDraftNH] = useState(false);
  const [hasDraftPAF, setHasDraftPAF] = useState(false);

  useEffect(() => {
    setHasDraftNH(!!Drafts.load("nh"));
    setHasDraftPAF(!!Drafts.load("paf"));
  }, [view, history]);

  return (
    <div className="pp-app">
      {/* Fix #7: Show loading skeleton or error state until bootstrap completes */}
      {!bootstrapData ? (
        <div className="pp-bound" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 16 }}>
          {bootstrapError ? (
            <>
              <div style={{ fontSize: 40, marginBottom: 4 }}>⚠️</div>
              <p style={{ color: "#64748b", fontSize: 14, fontWeight: 600 }}>Failed to load People Portal</p>
              <button className="pp-btn pp-btn--primary" onClick={loadBootstrap} style={{ marginTop: 8 }}>Try Again</button>
            </>
          ) : (
            <>
              <div style={{
                width: 32, height: 32, borderRadius: "50%",
                border: "3px solid #e9d5ff", borderTopColor: "#7c3aed",
                animation: "pp-spin 0.8s linear infinite",
              }} />
              <p style={{ color: "#94a3b8", fontSize: 14, fontWeight: 600 }}>Loading People Portal...</p>
            </>
          )}
        </div>
      ) : (
        <>
      {/* Hero */}
      <div className="pp-bound">
        <PeopleHero
          firstName={bootstrapData?.firstName || "Team"}
          heroImage={bootstrapData?.heroImage}
        />
      </div>

      {/* Nav */}
      <div className="pp-bound">
        <PeopleNav
          activeView={view}
          onNavigate={navigate}
          isAdmin={bootstrapData?.isAdmin}
        />
      </div>

      {/* Banner */}
      {bannerVisible && (
        <div className="pp-bound">
          <div className="pp-glass-banner">
            <div className="pp-banner-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2v8" /><path d="m4.93 10.93 1.41 1.41" /><path d="M2 18h2" /><path d="M20 18h2" /><path d="m19.07 10.93-1.41 1.41" /><path d="M22 22H2" /><path d="m8 22 4-10 4 10" /><path d="M12 18h.01" />
              </svg>
            </div>
            <div className="pp-banner-content">
              <h4>Welcome to the Beta</h4>
              <p>You are viewing the new HR & People Portal. The Action Center, New Hire wizard and Personnel Action form are live.</p>
            </div>
          </div>
        </div>
      )}

      {/* Views */}
      <div className="pp-bound">
        {view === "dashboard" && (
          <DashboardView
            counts={counts}
            hasDraftNH={!!hasDraftNH}
            hasDraftPAF={!!hasDraftPAF}
            isAdmin={bootstrapData?.isAdmin}
            onNavigate={navigate}
            onDiscardDraft={(key) => {
              openConfirm("Discard Draft?", "This will wipe your current progress.", "Yes, Discard", () => {
                Drafts.clear(key === "newhire" ? "nh" : "paf");
                showToast("🗑️ Draft Discarded");
                setHistory([...history]);
              });
            }}
          />
        )}

        {view === "activity" && (
<ActionCenter
            history={history}
            onResumeEdit={resumeEdit}
            onRefresh={refreshHistory}
            userEmail={userEmail.current}
            Formatter={Formatter}
            showToast={showToast}
          />
)}


        {view === "newhire" && (
          <NewHireWizard
            bootstrapData={bootstrapData}
            Drafts={Drafts}
            Formatter={Formatter}
            onNavigate={navigate}
            showToast={showToast}
            openConfirm={openConfirm}
            refreshHistory={refreshHistory}
          />
        )}

        {view === "paf" && (
          <PAFForm
            bootstrapData={bootstrapData}
            Drafts={Drafts}
            Formatter={Formatter}
            onNavigate={navigate}
            showToast={showToast}
            openConfirm={openConfirm}
            refreshHistory={refreshHistory}
          />
        )}

        {view === "admin" && bootstrapData?.isAdmin && (
          <AdminQueue
            bootstrapData={bootstrapData}
            Formatter={Formatter}
            showToast={showToast}
            openConfirm={openConfirm}
          />
        )}
      </div>

      {/* Modals */}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          text={confirm.text}
          confirmLabel={confirm.confirmLabel}
          onConfirm={() => { confirm.callback(); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {toast && <Toast msg={toast.msg} type={toast.type} />}
        </>
      )}
    </div>
  );
}