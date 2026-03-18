"use client";
import { useState, useEffect, useCallback, useRef } from "react";
import PeopleHero from "@/components/people/PeopleHero";
import PeopleNav from "@/components/people/PeopleNav";
import DashboardView from "@/components/people/DashboardView";
import ActionCenter from "@/components/people/ActionCenter";
import NewHireWizard from "@/components/people/NewHireWizard";
import PAFForm from "@/components/people/PAFForm";
import AdminQueue from "@/components/people/AdminQueue";
import HelpModal from "@/components/people/HelpModal";
import ConfirmModal from "@/components/people/ConfirmModal";
import Toast from "@/components/people/Toast";
import "@/app/people/people.css";

// ═══════════════════════════════════════
// Draft persistence
// ═══════════════════════════════════════
const Drafts = {
  save(key, data) { try { localStorage.setItem("kf_" + key + "_draft", JSON.stringify(data)); } catch (e) {} },
  load(key) { try { const d = localStorage.getItem("kf_" + key + "_draft"); return d ? JSON.parse(d) : null; } catch (e) { return null; } },
  clear(key) { localStorage.removeItem("kf_" + key + "_draft"); },
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
    try { return new Date(val).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); } catch (e) { return val; }
  },
};

export default function PeoplePage() {
  const [view, setView] = useState("dashboard");
  const [bootstrapData, setBootstrapData] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [bannerVisible, setBannerVisible] = useState(false);

  const userEmail = useRef("");

  // ─── Bootstrap ───
  useEffect(() => {
    const email = typeof window !== "undefined" ? localStorage.getItem("kf_user_email") || "" : "";
    userEmail.current = email;

    fetch(`/api/people?action=bootstrap&email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setBootstrapData(data);
          // Show banner if not dismissed
          const dismissed = localStorage.getItem("kf_pp_banner_dismissed");
          if (!dismissed) {
            setBannerVisible(true);
            setTimeout(() => {
              setBannerVisible(false);
              localStorage.setItem("kf_pp_banner_dismissed", "true");
            }, 15000);
          }
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // ─── Load history ───
  const refreshHistory = useCallback(() => {
    const email = userEmail.current;
    fetch(`/api/people?action=history&email=${encodeURIComponent(email)}`)
      .then((r) => r.json())
      .then((data) => { if (data.success) setHistory(data.history); });
  }, []);

  useEffect(() => { if (bootstrapData) refreshHistory(); }, [bootstrapData, refreshHistory]);

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
    window.scrollTo(0, 0);
  }, []);

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

  // ─── Loader ───
  if (loading) {
    return (
      <div className="pp-loader">
        <div className="pp-loader-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div className="pp-loader-text">Syncing with HQ...</div>
      </div>
    );
  }

  const hasDraftNH = Drafts.load("nh");
  const hasDraftPAF = Drafts.load("paf");

  return (
    <div className="pp-app">
      {/* Hero */}
      <div className="pp-bound">
        <PeopleHero
          firstName={bootstrapData?.firstName || "Team"}
          heroImage={bootstrapData?.heroImage}
          onHelpClick={() => setHelpOpen(true)}
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
                // Force re-render
                setHistory([...history]);
              });
            }}
          />
        )}

        {view === "activity" && (
          <ActionCenter
            history={history}
            onResumeEdit={resumeEdit}
            Formatter={Formatter}
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

      {/* Help FAB */}
      <button className="pp-help-pill" onClick={() => setHelpOpen(true)}>
        <span>Need Ops Help?</span>
        <div className="pp-help-icon">?</div>
      </button>

      {/* Modals */}
      {helpOpen && (
        <HelpModal
          userEmail={userEmail.current}
          onClose={() => setHelpOpen(false)}
          showToast={showToast}
        />
      )}

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
    </div>
  );
}