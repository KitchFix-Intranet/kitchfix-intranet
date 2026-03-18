"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import VendorList from "./VendorList";
import VendorAdminView from "./VendorAdminView";
import VendorSetup from "../invoice/VendorSetup";

function ChevronIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function AccountDropdown({ accounts, value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const selected = accounts.find((a) => a.key === value);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="oh-vp-acct-dropdown" ref={ref}>
      <button
        type="button"
        className={`oh-vp-acct-dropdown-trigger${!value ? " oh-vp-acct-dropdown-trigger--placeholder" : ""}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{selected ? (selected.label || selected.key) : "Select Account…"}</span>
        <span className={`oh-vp-acct-dropdown-chevron${open ? " oh-vp-acct-dropdown-chevron--open" : ""}`}>
          <ChevronIcon />
        </span>
      </button>
      {open && (
        <div className="oh-vp-acct-dropdown-menu">
          {accounts.map((a) => (
            <button
              key={a.key}
              type="button"
              className={`oh-vp-acct-dropdown-item${value === a.key ? " oh-vp-acct-dropdown-item--active" : ""}`}
              onClick={() => { onChange(a.key); setOpen(false); }}
            >
              {a.label || a.key}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VendorPortal({ config, showToast, openConfirm }) {
  const isAdmin   = config?.isAdmin  || false;
  const userEmail = config?.email    || "";
  const accounts  = useMemo(() => config?.accounts || [], [config?.accounts]); // eslint-disable-line react-hooks/exhaustive-deps

  const [subView, setSubView]                 = useState("directory");
  const [selectedAccount, setSelectedAccount] = useState("");
  const [showAddModal, setShowAddModal]       = useState(false);
  const [listKey, setListKey]                 = useState(0);

  const accountName = accounts.find((a) => a.key === selectedAccount)?.name || "";

  return (
    <div className="oh-view" style={{ animation: "oh-slideUp 0.4s ease" }}>
    <div className="oh-card oh-vp-portal" style={{ padding: 0, overflow: "hidden" }}>

      {/* Header */}
      <div className="oh-vp-header">
        <div className="oh-vp-header-left">
          <h2 className="oh-vp-title">Vendors</h2>
          {accounts.length > 0 && (
            <AccountDropdown
              accounts={accounts}
              value={selectedAccount}
              onChange={(key) => { setSelectedAccount(key); setSubView("directory"); }}
            />
          )}
        </div>
        <div className="oh-vp-header-right">
          {selectedAccount && subView === "directory" && (
            <button className="oh-btn oh-btn--mustard" onClick={() => setShowAddModal(true)}>
              + Add Vendor
            </button>
          )}
        </div>
      </div>

      {/* Sub-nav */}
      <div className="oh-vp-subnav">
        <button
          className={`oh-vp-subnav-btn${subView === "directory" ? " oh-vp-subnav-btn--active" : ""}`}
          onClick={() => setSubView("directory")}
        >
          Directory
        </button>
        {isAdmin && (
          <button
            className={`oh-vp-subnav-btn${subView === "admin" ? " oh-vp-subnav-btn--active" : ""}`}
            onClick={() => setSubView("admin")}
          >
            Admin
          </button>
        )}
      </div>

      {/* Content */}
      {subView === "admin" ? (
        <VendorAdminView isAdmin={isAdmin} showToast={showToast} openConfirm={openConfirm} />
      ) : !selectedAccount ? (
        <div className="oh-vp-landing">
          <div className="oh-vp-landing-icon">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
          </div>
          <h3 className="oh-vp-landing-title">Vendor Directory</h3>
          <p className="oh-vp-landing-desc">
            Contact info, delivery schedules, ordering portals, and site notes — organized by account.
          </p>
          <p className="oh-vp-landing-nudge">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
            Select an account above to get started
          </p>
        </div>
      ) : (
        <VendorList
          key={`${selectedAccount}-${listKey}`}
          accountKey={selectedAccount}
          accountName={accountName}
          isAdmin={isAdmin}
          userEmail={userEmail}
          showToast={showToast}
          openConfirm={openConfirm}
          onAddVendor={() => setShowAddModal(true)}
        />
      )}

      {/* Add Vendor Modal */}
      {showAddModal && (
        <VendorSetup
          account={selectedAccount}
          accountName={accountName}
          userEmail={userEmail}
          showToast={showToast}
          onClose={() => setShowAddModal(false)}
          onCreated={() => {
            setShowAddModal(false);
            setListKey((k) => k + 1);
            showToast(`Vendor added to ${accountName}`);
          }}
        />
      )}
    </div>
    </div>
  );
}