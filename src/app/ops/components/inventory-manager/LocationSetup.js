"use client";
import { useState, useEffect } from "react";

/**
 * LocationSetup.js — Storage Locations Manager
 * 
 * Props:
 *   locations    — current locations [{locationId, name, icon, sortOrder}]
 *   account      — account label
 *   catalogItems — for item counts per location
 *   onSave       — (locations) => Promise — save all locations
 *   onBack       — () => void
 *   showToast    — (msg, type) => void
 */

const I = ({ d, size = 16, color = "#64748b", sw = 2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
    style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0 }}>
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);
const ic = {
  chevUp: "M18 15l-6-6-6 6",
  chevDown: "M6 9l6 6 6-6",
  plus: "M12 5v14M5 12h14",
  x: "M18 6L6 18M6 6l12 12",
  edit: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z",
  check: "M20 6L9 17l-5-5",
  trash: ["M3 6h18", "M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2", "M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"],
  grip: "M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01",
  mapPin: ["M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z", "M12 13a3 3 0 100-6 3 3 0 000 6z"],
};

const SUGGESTED_LOCATIONS = [
  "Walk-in Cooler",
  "Walk-in Freezer",
  "Dry Storage",
  "Beverage Station",
  "Prep Area",
  "Hot Line",
  "Cold Line",
  "Bar",
  "Storage Room",
];

export default function LocationSetup({
  locations: initialLocations = [],
  account,
  catalogItems = [],
  onSave,
  onBack,
  showToast,
}) {
  const [locations, setLocations] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize from props
  useEffect(() => {
    setLocations(initialLocations.map((loc, i) => ({
      ...loc,
      sortOrder: loc.sortOrder ?? i,
      active: true,
    })));
  }, [initialLocations]);

  // Item counts per location
  const itemCountByLocation = {};
  catalogItems.forEach((item) => {
    const lid = item.locationId || "_unassigned";
    itemCountByLocation[lid] = (itemCountByLocation[lid] || 0) + 1;
  });

  // ── Actions ──
  const moveUp = (idx) => {
    if (idx <= 0) return;
    const next = [...locations];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    next.forEach((loc, i) => { loc.sortOrder = i; });
    setLocations(next);
    setHasChanges(true);
  };

  const moveDown = (idx) => {
    if (idx >= locations.length - 1) return;
    const next = [...locations];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    next.forEach((loc, i) => { loc.sortOrder = i; });
    setLocations(next);
    setHasChanges(true);
  };

  const startEdit = (loc) => {
    setEditingId(loc.locationId);
    setEditName(loc.name);
  };

  const saveEdit = () => {
    if (!editName.trim()) return;
    setLocations((prev) =>
      prev.map((loc) =>
        loc.locationId === editingId ? { ...loc, name: editName.trim() } : loc
      )
    );
    setEditingId(null);
    setEditName("");
    setHasChanges(true);
  };

  const removeLocation = (locationId) => {
    setLocations((prev) => prev.filter((loc) => loc.locationId !== locationId));
    setHasChanges(true);
  };

  const addLocation = (name) => {
    if (!name.trim()) return;
    // Check for duplicate
    if (locations.some((loc) => loc.name.toLowerCase() === name.trim().toLowerCase())) {
      showToast?.("Location already exists", "error");
      return;
    }
    const newLoc = {
      locationId: `loc_new_${Date.now()}`,
      name: name.trim(),
      icon: "box",
      sortOrder: locations.length,
      active: true,
      isNew: true,
    };
    setLocations((prev) => [...prev, newLoc]);
    setNewName("");
    setShowAdd(false);
    setHasChanges(true);
  };

  // ── Save ──
  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = locations.map((loc, i) => ({
        locationId: loc.isNew ? null : loc.locationId,
        name: loc.name,
        sortOrder: i,
        active: true,
      }));
      await onSave?.(payload);
      setHasChanges(false);
      showToast?.(`${locations.length} locations saved`, "success");
    } catch {
      showToast?.("Failed to save locations", "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Suggestions (exclude already added) ──
  const existingNames = new Set(locations.map((l) => l.name.toLowerCase()));
  const suggestions = SUGGESTED_LOCATIONS.filter((s) => !existingNames.has(s.toLowerCase()));

  return (
    <div className="oh-inv-mgmt-loc-setup">
      {/* Header */}
      <div className="oh-inv-mgmt-loc-header">
        <div>
          <h3 className="oh-inv-mgmt-loc-title">Storage Locations</h3>
          <p className="oh-inv-mgmt-loc-sub">{account} · {locations.length} location{locations.length !== 1 ? "s" : ""}</p>
        </div>
      </div>

      {/* Location list */}
      <div className="oh-inv-mgmt-loc-list">
        {locations.map((loc, idx) => {
          const itemCount = itemCountByLocation[loc.locationId] || 0;
          const isEditing = editingId === loc.locationId;

          return (
            <div key={loc.locationId} className="oh-inv-mgmt-loc-card">
              {/* Grip dots */}
              <div className="oh-inv-mgmt-loc-grip">
                <I d={ic.grip} size={14} color="#cbd5e1" />
              </div>

              {/* Content */}
              <div className="oh-inv-mgmt-loc-content">
                {isEditing ? (
                  <div className="oh-inv-mgmt-loc-edit-row">
                    <input
                      className="oh-inv-mgmt-loc-edit-input"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }}
                      autoFocus
                    />
                    <button className="oh-inv-mgmt-loc-edit-save" onClick={saveEdit}>
                      <I d={ic.check} size={14} color="#16A34A" />
                    </button>
                    <button className="oh-inv-mgmt-loc-edit-cancel" onClick={() => setEditingId(null)}>
                      <I d={ic.x} size={14} color="#94a3b8" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="oh-inv-mgmt-loc-name-row">
                      <I d={ic.mapPin} size={14} color="#d97706" />
                      <span className="oh-inv-mgmt-loc-name">{loc.name}</span>
                      <span className="oh-inv-mgmt-loc-count">{itemCount} item{itemCount !== 1 ? "s" : ""}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Actions */}
              {!isEditing && (
                <div className="oh-inv-mgmt-loc-actions">
                  <button className="oh-inv-mgmt-loc-action-btn" onClick={() => moveUp(idx)} disabled={idx === 0}>
                    <I d={ic.chevUp} size={14} color={idx === 0 ? "#e2e8f0" : "#64748b"} />
                  </button>
                  <button className="oh-inv-mgmt-loc-action-btn" onClick={() => moveDown(idx)} disabled={idx === locations.length - 1}>
                    <I d={ic.chevDown} size={14} color={idx === locations.length - 1 ? "#e2e8f0" : "#64748b"} />
                  </button>
                  <button className="oh-inv-mgmt-loc-action-btn" onClick={() => startEdit(loc)}>
                    <I d={ic.edit} size={13} color="#64748b" />
                  </button>
                  <button className="oh-inv-mgmt-loc-action-btn" onClick={() => removeLocation(loc.locationId)}>
                    <I d={ic.trash} size={13} color="#94a3b8" />
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {locations.length === 0 && (
          <div className="oh-inv-mgmt-loc-empty">
            <I d={ic.mapPin} size={32} color="#e2e8f0" />
            <p>No locations yet. Add your first storage location below.</p>
          </div>
        )}
      </div>

      {/* Add location */}
      {showAdd ? (
        <div className="oh-inv-mgmt-loc-add-form">
          <input
            className="oh-inv-mgmt-loc-add-input"
            placeholder="Location name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addLocation(newName); if (e.key === "Escape") { setShowAdd(false); setNewName(""); } }}
            autoFocus
          />
          <button className="oh-inv-mgmt-loc-add-confirm" onClick={() => addLocation(newName)} disabled={!newName.trim()}>
            Add
          </button>
          <button className="oh-inv-mgmt-loc-add-cancel" onClick={() => { setShowAdd(false); setNewName(""); }}>
            Cancel
          </button>
        </div>
      ) : (
        <button className="oh-inv-mgmt-loc-add-btn" onClick={() => setShowAdd(true)}>
          <I d={ic.plus} size={14} color="#d97706" /> Add Location
        </button>
      )}

      {/* Quick suggestions */}
      {suggestions.length > 0 && locations.length < 3 && (
        <div className="oh-inv-mgmt-loc-suggestions">
          <span className="oh-inv-mgmt-loc-suggest-label">Common locations:</span>
          <div className="oh-inv-mgmt-loc-suggest-chips">
            {suggestions.slice(0, 5).map((s) => (
              <button key={s} className="oh-inv-mgmt-loc-suggest-chip" onClick={() => addLocation(s)}>
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Bottom actions */}
      <div className="oh-inv-mgmt-loc-footer">
        <button className="oh-inv-mgmt-loc-back" onClick={onBack}>Back</button>
        <button
          className="oh-inv-mgmt-loc-save"
          onClick={handleSave}
          disabled={saving || !hasChanges}
        >
          {saving ? "Saving..." : "Save Locations"}
        </button>
      </div>
    </div>
  );
}