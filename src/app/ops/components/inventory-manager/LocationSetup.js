"use client";
import { useState, useEffect, useMemo } from "react";

/**
 * LocationSetup.js - Stage 1: Storage Locations (Polished)
 * Props: locations[], account, catalogItems[], onSave, onBack, onViewItems, showToast
 */

const I = ({ d, size = 16, color = "#64748b", sw = 2, fill = "none", style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color}
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
    style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}>
    {(Array.isArray(d) ? d : [d]).map((p, i) => <path key={i} d={p} />)}
  </svg>
);

// -- 16 food-service emoji icons --
const ICONS = {
  snowflake: { label: "Cooler", emoji: "\u2744\uFE0F" },
  ice:       { label: "Freezer", emoji: "\uD83E\uDDCA" },
  drumstick: { label: "Meat", emoji: "\uD83C\uDF56" },
  carrot:    { label: "Veggie", emoji: "\uD83E\uDD55" },
  leaf:      { label: "Herbs", emoji: "\uD83C\uDF3F" },
  cup:       { label: "Beverage", emoji: "\u2615" },
  tag:       { label: "Tag", emoji: "\uD83C\uDFF7\uFE0F" },
  box:       { label: "Storage", emoji: "\uD83D\uDCE6" },
  paper:     { label: "Paper", emoji: "\uD83D\uDCCB" },
  star:      { label: "Star", emoji: "\u2B50" },
  apple:     { label: "Produce", emoji: "\uD83C\uDF4E" },
  flame:     { label: "Hot Line", emoji: "\uD83D\uDD25" },
  plate:     { label: "Plating", emoji: "\uD83C\uDF7D\uFE0F" },
  fish:      { label: "Seafood", emoji: "\uD83D\uDC1F" },
  wrench:    { label: "Tools", emoji: "\uD83D\uDD27" },
  broom:     { label: "Cleaning", emoji: "\uD83E\uDDF9" },
};
// Backward compat for old spreadsheet data
const ICON_FALLBACK = { mapPin: "box", grid: "broom" };
function getIcon(key) { return ICONS[key] || ICONS[ICON_FALLBACK[key]] || ICONS.box; }
const ICON_KEYS = Object.keys(ICONS);

const COLORS = [
  { key: "blue", bg: "#dbeafe", fg: "#2563eb" },
  { key: "indigo", bg: "#e0e7ff", fg: "#4f46e5" },
  { key: "amber", bg: "#fef3c7", fg: "#d97706" },
  { key: "teal", bg: "#ccfbf1", fg: "#0d9488" },
  { key: "slate", bg: "#e2e8f0", fg: "#475569" },
  { key: "green", bg: "#dcfce7", fg: "#16a34a" },
  { key: "rose", bg: "#ffe4e6", fg: "#e11d48" },
  { key: "purple", bg: "#ede9fe", fg: "#7c3aed" },
];
const AUTO_RULES = [
  { p: ["cool", "fridge", "refrig", "reach-in"], icon: "snowflake", color: "blue" },
  { p: ["freez", "frost"], icon: "ice", color: "indigo" },
  { p: ["dry", "pantry", "shelf", "storage"], icon: "box", color: "amber" },
  { p: ["bev", "drink", "bar"], icon: "cup", color: "teal" },
  { p: ["supply", "suppli", "clean", "chem"], icon: "broom", color: "slate" },
  { p: ["prep", "line", "hot"], icon: "flame", color: "amber" },
  { p: ["spice", "herb", "season"], icon: "leaf", color: "green" },
  { p: ["protein", "meat"], icon: "drumstick", color: "rose" },
  { p: ["produce", "veg", "fruit"], icon: "carrot", color: "green" },
];
function autoIC(n) { const l = (n || "").toLowerCase(); for (const r of AUTO_RULES) { if (r.p.some((x) => l.includes(x))) return { icon: r.icon, color: r.color }; } return { icon: "box", color: "slate" }; }

const ic = {
  plus: "M12 5v14M5 12h14", x: "M18 6L6 18M6 6l12 12",
  edit: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z",
  check: "M20 6L9 17l-5-5",
  trash: ["M3 6h18", "M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2", "M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"],
  arrowUp: ["M12 19V5", "M5 12l7-7 7 7"], arrowDown: ["M12 5v14", "M19 12l-7 7-7-7"],
  eye: ["M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z", "M12 15a3 3 0 100-6 3 3 0 000 6z"],
};
const SUGGESTED = ["Walk-in Cooler", "Walk-in Freezer", "Dry Storage", "Beverage Station", "Prep Area", "Supply Closet", "Bar", "FOH Storage"];

export default function LocationSetup({ locations: initial = [], account, catalogItems = [], onSave, onBack, onViewItems, showToast }) {
  const [zones, setZones] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [showAddZone, setShowAddZone] = useState(false);
  const [addingSubTo, setAddingSubTo] = useState(null);
  const [newName, setNewName] = useState("");
  const [iconPicker, setIconPicker] = useState(null);
  const [pIcon, setPIcon] = useState(null);
  const [pColor, setPColor] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    const top = initial.filter((l) => !l.parentLocationId).map((l, i) => ({ ...l, sortOrder: l.sortOrder ?? i, icon: l.icon || autoIC(l.name).icon, color: l.color || autoIC(l.name).color }));
    const subs = initial.filter((l) => l.parentLocationId);
    const wk = top.map((z) => ({ ...z, subZones: subs.filter((s) => s.parentLocationId === z.locationId).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0)).map((s) => ({ ...s, icon: s.icon || autoIC(s.name).icon, color: s.color || autoIC(s.name).color })) }));
    setZones(wk);
    const exp = {}; wk.forEach((z) => { if (z.subZones.length > 0) exp[z.locationId] = true; }); setExpanded(exp);
  }, [initial]);

  const itemCounts = useMemo(() => { const c = {}; catalogItems.forEach((i) => { const l = i.locationId || "_u"; c[l] = (c[l] || 0) + 1; }); return c; }, [catalogItems]);
  const zt = (z) => { let t = itemCounts[z.locationId] || 0; (z.subZones || []).forEach((s) => { t += itemCounts[s.locationId] || 0; }); return t; };
  const totalItems = useMemo(() => { let t = 0; zones.forEach((z) => { t += zt(z); }); return t; }, [zones, itemCounts]);
  const mark = () => { setHasChanges(true); setJustSaved(false); };
  const gc = (k) => COLORS.find((c) => c.key === k) || COLORS[4];

  const addZone = (n) => { if (!n.trim()) return; if (zones.some((z) => z.name.toLowerCase() === n.trim().toLowerCase())) { showToast?.("Zone already exists", "error"); return; } const a = autoIC(n.trim()); setZones((p) => [...p, { locationId: `loc_new_${Date.now()}`, name: n.trim(), icon: a.icon, color: a.color, sortOrder: p.length, subZones: [], isNew: true }]); setNewName(""); setShowAddZone(false); mark(); };
  const addSub = (pid, n) => { if (!n.trim()) return; const a = autoIC(n.trim()); setZones((p) => p.map((z) => z.locationId !== pid ? z : { ...z, subZones: [...z.subZones, { locationId: `loc_new_${Date.now()}_s`, name: n.trim(), parentLocationId: pid, icon: a.icon, color: a.color, sortOrder: z.subZones.length, isNew: true }] })); setNewName(""); setAddingSubTo(null); mark(); setExpanded((p) => ({ ...p, [pid]: true })); };
  const startEdit = (id, n) => { setEditingId(id); setEditName(n); };
  const saveEdit = () => { if (!editName.trim()) return; setZones((p) => p.map((z) => { if (z.locationId === editingId) return { ...z, name: editName.trim() }; return { ...z, subZones: z.subZones.map((s) => s.locationId === editingId ? { ...s, name: editName.trim() } : s) }; })); setEditingId(null); mark(); };

  const reqDelZ = (id) => { const z = zones.find((x) => x.locationId === id); const c = zt(z); if (c > 0) { showToast?.(`Move ${c} item${c !== 1 ? "s" : ""} before deleting`, "error"); return; } setConfirmDelete({ type: "zone", zoneId: id, name: z.name, count: 0 }); };
  const reqDelS = (pid, sid) => { const z = zones.find((x) => x.locationId === pid); const s = z?.subZones.find((x) => x.locationId === sid); setConfirmDelete({ type: "sub", zoneId: pid, subId: sid, name: s?.name || "", count: itemCounts[sid] || 0 }); };
  const doDel = () => { if (!confirmDelete) return; if (confirmDelete.type === "zone") setZones((p) => p.filter((z) => z.locationId !== confirmDelete.zoneId)); else { setZones((p) => p.map((z) => z.locationId !== confirmDelete.zoneId ? z : { ...z, subZones: z.subZones.filter((s) => s.locationId !== confirmDelete.subId) })); if (confirmDelete.count > 0) showToast?.(`${confirmDelete.count} item${confirmDelete.count !== 1 ? "s" : ""} moved to parent zone`, "info"); } setConfirmDelete(null); mark(); };

  const moveZ = (i, d) => { const n = [...zones]; const t = i + d; if (t < 0 || t >= n.length) return; [n[i], n[t]] = [n[t], n[i]]; n.forEach((z, j) => { z.sortOrder = j; }); setZones(n); mark(); };
  const moveS = (pid, i, d) => { setZones((p) => p.map((z) => { if (z.locationId !== pid) return z; const s = [...z.subZones]; const t = i + d; if (t < 0 || t >= s.length) return z; [s[i], s[t]] = [s[t], s[i]]; s.forEach((x, j) => { x.sortOrder = j; }); return { ...z, subZones: s }; })); mark(); };

  const openPicker = (id, ci, cc) => { setIconPicker(id); setPIcon(ci); setPColor(cc); };
  const closePicker = () => { if (iconPicker && pIcon && pColor) { setZones((p) => p.map((z) => { if (z.locationId === iconPicker) return { ...z, icon: pIcon, color: pColor }; return { ...z, subZones: z.subZones.map((s) => s.locationId === iconPicker ? { ...s, icon: pIcon, color: pColor } : s) }; })); mark(); } setIconPicker(null); };

  const handleSave = async () => {
    setSaving(true);
    const flat = []; zones.forEach((z, i) => { flat.push({ locationId: z.isNew ? null : z.locationId, name: z.name, icon: z.icon, color: z.color, sortOrder: i, parentLocationId: null }); z.subZones.forEach((s, j) => { flat.push({ locationId: s.isNew ? null : s.locationId, name: s.name, icon: s.icon, color: s.color, sortOrder: j, parentLocationId: z.isNew ? null : z.locationId, parentName: z.name }); }); });
    try { await onSave?.(flat); setHasChanges(false); setJustSaved(true); } catch { showToast?.("Save failed", "error"); } finally { setSaving(false); }
  };
  const handleViewItems = () => { if (hasChanges) { showToast?.("Save your changes first", "error"); return; } onViewItems?.(); };

  const used = new Set(zones.map((z) => z.name.toLowerCase()));
  const sugg = SUGGESTED.filter((s) => !used.has(s.toLowerCase()));

  const renderPicker = () => (
    <div className="oh-inv-loc-picker">
      <div className="oh-inv-loc-picker-head">
        <span className="oh-inv-loc-picker-label">Choose icon & color</span>
        <button className="oh-inv-loc-picker-done" onClick={closePicker}>Done</button>
      </div>
      <div className="oh-inv-loc-picker-icons">
        {ICON_KEYS.map((ik) => (
          <button key={ik} className={`oh-inv-loc-picker-icon${pIcon === ik ? " active" : ""}`} title={ICONS[ik].label} onClick={() => setPIcon(ik)}>
            <span style={{ fontSize: 18 }}>{ICONS[ik].emoji}</span>
          </button>
        ))}
      </div>
      <div className="oh-inv-loc-picker-colors">
        {COLORS.map((c) => (
          <button key={c.key} className={`oh-inv-loc-picker-color${pColor === c.key ? " active" : ""}`} style={{ background: c.fg }} onClick={() => setPColor(c.key)} />
        ))}
      </div>
    </div>
  );

  return (
    <div className="oh-inv-loc-setup">
      <div className="oh-inv-loc-head">
        <h3 className="oh-inv-loc-title">Storage Locations</h3>
        <p className="oh-inv-loc-sub">{account} {"\u00B7"} {zones.length} zone{zones.length !== 1 ? "s" : ""}</p>
      </div>
      <div className="oh-inv-loc-blurb">
        Define the storage areas in your kitchen. Add zones for each major area, then optionally create sub-zones for more detailed organization during counts.
      </div>

      <div className="oh-inv-loc-zones">
        {zones.map((zone, zIdx) => {
          const isExp = expanded[zone.locationId]; const col = gc(zone.color); const total = zt(zone); const isEdit = editingId === zone.locationId;
          return (
            <div key={zone.locationId} className="oh-inv-loc-zone">
              <div className="oh-inv-loc-zone-card" style={{ borderLeftColor: col.fg }}>
                <button className="oh-inv-loc-icon-btn" style={{ background: col.bg }} onClick={() => openPicker(zone.locationId, zone.icon, zone.color)}>
                  <span style={{ fontSize: 18, lineHeight: 1 }}>{getIcon(zone.icon).emoji}</span>
                </button>
                <div className="oh-inv-loc-zone-info">
                  {isEdit ? (
                    <div className="oh-inv-loc-edit-row">
                      <input className="oh-inv-loc-edit-input" value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }} autoFocus />
                      <button className="oh-inv-loc-edit-ok" onClick={saveEdit}><I d={ic.check} size={13} color="#16a34a" /></button>
                      <button className="oh-inv-loc-edit-cancel" onClick={() => setEditingId(null)}><I d={ic.x} size={13} color="#94a3b8" /></button>
                    </div>
                  ) : (<>
                    <span className="oh-inv-loc-zone-name">{zone.name}</span>
                    <div className="oh-inv-loc-pills">
                      <span className="oh-inv-loc-pill">{total} item{total !== 1 ? "s" : ""}</span>
                      {zone.subZones.length > 0 && <span className="oh-inv-loc-pill oh-inv-loc-pill--sub">{zone.subZones.length} sub-zone{zone.subZones.length !== 1 ? "s" : ""}</span>}
                    </div>
                  </>)}
                </div>
                {!isEdit && (
                  <div className="oh-inv-loc-actions">
                    <button className="oh-inv-loc-move" onClick={() => moveZ(zIdx, -1)} disabled={zIdx === 0} title="Move up"><I d={ic.arrowUp} size={12} color={zIdx === 0 ? "#e2e8f0" : "#0f3057"} sw={2.5} /></button>
                    <button className="oh-inv-loc-move" onClick={() => moveZ(zIdx, 1)} disabled={zIdx === zones.length - 1} title="Move down"><I d={ic.arrowDown} size={12} color={zIdx === zones.length - 1 ? "#e2e8f0" : "#0f3057"} sw={2.5} /></button>
                    <button className="oh-inv-loc-act" onClick={() => startEdit(zone.locationId, zone.name)} title="Rename"><I d={ic.edit} size={12} color="#64748b" /></button>
                    <button className="oh-inv-loc-act" onClick={() => reqDelZ(zone.locationId)} title="Delete"><I d={ic.trash} size={12} color="#94a3b8" /></button>
                    <button className="oh-inv-loc-expand-btn" onClick={() => setExpanded((p) => ({ ...p, [zone.locationId]: !p[zone.locationId] }))}>{isExp ? "Hide" : "Show"}</button>
                  </div>
                )}
              </div>
              {iconPicker === zone.locationId && renderPicker()}
              {isExp && (
                <div className="oh-inv-loc-subzones">
                  {zone.subZones.map((sub, sIdx) => {
                    const sc = gc(sub.color); const sC = itemCounts[sub.locationId] || 0; const sE = editingId === sub.locationId;
                    return (
                      <div key={sub.locationId} className="oh-inv-loc-sub-card">
                        <button className="oh-inv-loc-icon-btn oh-inv-loc-icon-btn--sm" style={{ background: sc.bg }} onClick={() => openPicker(sub.locationId, sub.icon, sub.color)}>
                          <span style={{ fontSize: 14, lineHeight: 1 }}>{getIcon(sub.icon).emoji}</span>
                        </button>
                        <div className="oh-inv-loc-zone-info">
                          {sE ? (
                            <div className="oh-inv-loc-edit-row">
                              <input className="oh-inv-loc-edit-input" value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }} autoFocus />
                              <button className="oh-inv-loc-edit-ok" onClick={saveEdit}><I d={ic.check} size={12} color="#16a34a" /></button>
                              <button className="oh-inv-loc-edit-cancel" onClick={() => setEditingId(null)}><I d={ic.x} size={12} color="#94a3b8" /></button>
                            </div>
                          ) : (<>
                            <span className="oh-inv-loc-sub-name">{sub.name}</span>
                            <span className="oh-inv-loc-pill oh-inv-loc-pill--sm">{sC} item{sC !== 1 ? "s" : ""}</span>
                          </>)}
                        </div>
                        {!sE && (
                          <div className="oh-inv-loc-actions">
                            <button className="oh-inv-loc-move oh-inv-loc-move--sm" onClick={() => moveS(zone.locationId, sIdx, -1)} disabled={sIdx === 0}><I d={ic.arrowUp} size={10} color={sIdx === 0 ? "#e2e8f0" : "#0f3057"} sw={2.5} /></button>
                            <button className="oh-inv-loc-move oh-inv-loc-move--sm" onClick={() => moveS(zone.locationId, sIdx, 1)} disabled={sIdx === zone.subZones.length - 1}><I d={ic.arrowDown} size={10} color={sIdx === zone.subZones.length - 1 ? "#e2e8f0" : "#0f3057"} sw={2.5} /></button>
                            <button className="oh-inv-loc-act" onClick={() => startEdit(sub.locationId, sub.name)}><I d={ic.edit} size={11} color="#64748b" /></button>
                            <button className="oh-inv-loc-act" onClick={() => reqDelS(zone.locationId, sub.locationId)}><I d={ic.trash} size={11} color="#94a3b8" /></button>
                          </div>
                        )}
                        {iconPicker === sub.locationId && renderPicker()}
                      </div>
                    );
                  })}
                  {addingSubTo === zone.locationId ? (
                    <div className="oh-inv-loc-add-inline">
                      <input className="oh-inv-loc-add-input" placeholder="Sub-zone name..." value={newName} onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter") addSub(zone.locationId, newName); if (e.key === "Escape") { setAddingSubTo(null); setNewName(""); } }} autoFocus />
                      <button className="oh-inv-loc-add-ok" onClick={() => addSub(zone.locationId, newName)} disabled={!newName.trim()}>Add</button>
                      <button className="oh-inv-loc-add-cancel" onClick={() => { setAddingSubTo(null); setNewName(""); }}>Cancel</button>
                    </div>
                  ) : (
                    <button className="oh-inv-loc-add-sub-btn" onClick={() => { setAddingSubTo(zone.locationId); setNewName(""); }}>
                      <I d={ic.plus} size={12} color="#d97706" /> Add Sub-Zone
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {zones.length === 0 && <div className="oh-inv-loc-empty"><span style={{ fontSize: 32 }}>{ICONS.box.emoji}</span><p>No storage locations yet. Add your first zone below.</p></div>}
      </div>

      {showAddZone ? (
        <div className="oh-inv-loc-add-inline oh-inv-loc-add-zone">
          <input className="oh-inv-loc-add-input" placeholder="Zone name (e.g. Walk-in Cooler)..." value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addZone(newName); if (e.key === "Escape") { setShowAddZone(false); setNewName(""); } }} autoFocus />
          <button className="oh-inv-loc-add-ok" onClick={() => addZone(newName)} disabled={!newName.trim()}>Add</button>
          <button className="oh-inv-loc-add-cancel" onClick={() => { setShowAddZone(false); setNewName(""); }}>Cancel</button>
        </div>
      ) : (
        <button className="oh-inv-loc-add-zone-btn" onClick={() => { setShowAddZone(true); setNewName(""); }}><I d={ic.plus} size={14} color="#d97706" /> Add Zone</button>
      )}

      {sugg.length > 0 && zones.length < 3 && (
        <div className="oh-inv-loc-suggest"><span className="oh-inv-loc-suggest-label">Common zones:</span>
          <div className="oh-inv-loc-suggest-chips">{sugg.slice(0, 5).map((s) => (<button key={s} className="oh-inv-loc-suggest-chip" onClick={() => addZone(s)}>+ {s}</button>))}</div>
        </div>
      )}

      <div className="oh-inv-loc-footer">
        <button className="oh-inv-loc-back" onClick={onBack}>Back</button>
        <button className="oh-inv-loc-save" onClick={handleSave} disabled={saving || !hasChanges}>{saving ? "Saving..." : "Save Locations"}</button>
      </div>

      {justSaved && (
        <div className="oh-inv-loc-postsave">
          <I d={ic.check} size={14} color="#16a34a" sw={3} />
          <span className="oh-inv-loc-postsave-text">Locations saved successfully.</span>
          {onViewItems && <button className="oh-inv-loc-postsave-cta" onClick={handleViewItems}><I d={ic.eye} size={14} color="#fff" /> View & Organize Items</button>}
        </div>
      )}

      {!justSaved && totalItems > 0 && onViewItems && (
        <button className="oh-inv-loc-view-items" onClick={handleViewItems}>
          <I d={ic.eye} size={14} color="#d97706" /> View Items in Locations {hasChanges && <span className="oh-inv-loc-unsaved">(save first)</span>}
        </button>
      )}

      {confirmDelete && (
        <div className="oh-inv-loc-confirm-overlay"><div className="oh-inv-loc-confirm-card">
          <h4 className="oh-inv-loc-confirm-title">Delete &quot;{confirmDelete.name}&quot;?</h4>
          <p className="oh-inv-loc-confirm-desc">{confirmDelete.type === "sub" && confirmDelete.count > 0 ? `${confirmDelete.count} item${confirmDelete.count !== 1 ? "s" : ""} in this sub-zone will move to the parent zone.` : "This action cannot be undone."}</p>
          <div className="oh-inv-loc-confirm-btns">
            <button className="oh-inv-loc-confirm-cancel" onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button className="oh-inv-loc-confirm-delete" onClick={doDel}>Delete</button>
          </div>
        </div></div>
      )}
    </div>
  );
}