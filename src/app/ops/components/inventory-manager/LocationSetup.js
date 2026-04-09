"use client";
import { useState, useEffect, useMemo, useRef, useCallback } from "react";

/**
 * LocationSetup.js - Stage 1: Storage Locations (v2)
 * Props: locations[], account, catalogItems[], onSave, onBack, onViewItems, showToast
 *
 * v2 changes:
 *   - Tap zone card to expand/collapse (1C)
 *   - Reorder mode toggle (2C)
 *   - Inline sub-zone rows with hover actions (3A)
 *   - Contained card wrapper (4)
 *   - Zone summary bar, hide blurb for returning, ghost add input,
 *     unsaved indicator, three-dot menu, picker preview, sticky footer,
 *     empty zone highlight, confirm on back, sub-zone quick-add
 */

const I = ({ d, size = 16, color = "#64748b", sw = 2, fill = "none", style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color}
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
    style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}>
    {(Array.isArray(d) ? d : [d]).map((p, i) => <path key={i} d={p} />)}
  </svg>
);

// -- Emoji icons (41) --
const ICONS = {
  // Cold storage
  snowflake:  { label: "Cooler", emoji: "\u2744\uFE0F" },
  ice:        { label: "Freezer", emoji: "\uD83E\uDDCA" },
  thermometer:{ label: "Temp", emoji: "\uD83C\uDF21\uFE0F" },
  // Proteins
  drumstick:  { label: "Meat", emoji: "\uD83C\uDF56" },
  fish:       { label: "Seafood", emoji: "\uD83D\uDC1F" },
  steak:      { label: "Steak", emoji: "\uD83E\uDD69" },
  shrimp:     { label: "Shrimp", emoji: "\uD83E\uDD90" },
  poultry:    { label: "Poultry", emoji: "\uD83C\uDF57" },
  egg:        { label: "Eggs", emoji: "\uD83E\uDD5A" },
  bacon:      { label: "Bacon", emoji: "\uD83E\uDD53" },
  // Produce
  carrot:     { label: "Veggie", emoji: "\uD83E\uDD55" },
  leaf:       { label: "Herbs", emoji: "\uD83C\uDF3F" },
  apple:      { label: "Fruit", emoji: "\uD83C\uDF4E" },
  greens:     { label: "Greens", emoji: "\uD83E\uDD6C" },
  tomato:     { label: "Tomato", emoji: "\uD83C\uDF45" },
  lemon:      { label: "Citrus", emoji: "\uD83C\uDF4B" },
  onion:      { label: "Onion", emoji: "\uD83E\uDDC5" },
  corn:       { label: "Corn", emoji: "\uD83C\uDF3D" },
  avocado:    { label: "Avocado", emoji: "\uD83E\uDD51" },
  pepper:     { label: "Pepper", emoji: "\uD83C\uDF36\uFE0F" },
  // Dairy & bakery
  cheese:     { label: "Cheese", emoji: "\uD83E\uDDC0" },
  butter:     { label: "Butter", emoji: "\uD83E\uDDC8" },
  milk:       { label: "Milk", emoji: "\uD83E\uDD5B" },
  bread:      { label: "Bread", emoji: "\uD83C\uDF5E" },
  // Beverages
  cup:        { label: "Coffee", emoji: "\u2615" },
  juice:      { label: "Juice", emoji: "\uD83E\uDDC3" },
  water:      { label: "Water", emoji: "\uD83D\uDCA7" },
  wine:       { label: "Wine", emoji: "\uD83C\uDF77" },
  // Snacks & prepared
  flame:      { label: "Hot Line", emoji: "\uD83D\uDD25" },
  plate:      { label: "Plating", emoji: "\uD83C\uDF7D\uFE0F" },
  cookie:     { label: "Snack", emoji: "\uD83C\uDF6A" },
  sandwich:   { label: "Sandwich", emoji: "\uD83E\uDD6A" },
  // Packaging & supplies
  box:        { label: "Storage", emoji: "\uD83D\uDCE6" },
  paper:      { label: "Paper", emoji: "\uD83D\uDCCB" },
  tag:        { label: "Tag", emoji: "\uD83C\uDFF7\uFE0F" },
  wrench:     { label: "Tools", emoji: "\uD83D\uDD27" },
  broom:      { label: "Cleaning", emoji: "\uD83E\uDDF9" },
  gloves:     { label: "Gloves", emoji: "\uD83E\uDDE4" },
  // General
  star:       { label: "Star", emoji: "\u2B50" },
  can:        { label: "Canned", emoji: "\uD83E\uDD6B" },
  salt:       { label: "Salt", emoji: "\uD83E\uDDC2" },
};
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
  { key: "orange", bg: "#fff7ed", fg: "#ea580c" },
  { key: "gold", bg: "#fefce8", fg: "#ca8a04" },
  { key: "brown", bg: "#fef3c7", fg: "#78350f" },
  { key: "cyan", bg: "#e0f2fe", fg: "#0891b2" },
  { key: "pink", bg: "#fce7f3", fg: "#db2777" },
  { key: "emerald", bg: "#d1fae5", fg: "#059669" },
];
const AUTO_RULES = [
  { p: ["cool", "fridge", "refrig", "reach-in"], icon: "snowflake", color: "blue" },
  { p: ["freez", "frost"], icon: "ice", color: "indigo" },
  { p: ["dry", "pantry", "shelf", "storage"], icon: "box", color: "amber" },
  { p: ["bev", "drink", "bar", "juice", "soda"], icon: "cup", color: "cyan" },
  { p: ["supply", "suppli", "clean", "chem", "sanit"], icon: "broom", color: "slate" },
  { p: ["prep", "line", "hot", "grill"], icon: "flame", color: "orange" },
  { p: ["spice", "herb", "season", "salt"], icon: "salt", color: "gold" },
  { p: ["protein", "meat", "butcher"], icon: "steak", color: "rose" },
  { p: ["produce", "veg", "fruit", "fresh"], icon: "carrot", color: "emerald" },
  { p: ["dairy", "milk", "cheese"], icon: "milk", color: "blue" },
  { p: ["bread", "bake", "pastry"], icon: "bread", color: "brown" },
  { p: ["snack", "chip", "candy", "cookie"], icon: "cookie", color: "purple" },
  { p: ["wine", "beer", "liquor", "alcohol"], icon: "wine", color: "pink" },
  { p: ["can", "canned", "preserve"], icon: "can", color: "slate" },
  { p: ["seafood", "fish", "shrimp"], icon: "shrimp", color: "teal" },
];
function autoIC(n) { const l = (n || "").toLowerCase(); for (const r of AUTO_RULES) { if (r.p.some((x) => l.includes(x))) return { icon: r.icon, color: r.color }; } return { icon: "box", color: "slate" }; }

// SVG paths for UI chrome only
const ic = {
  plus: "M12 5v14M5 12h14", x: "M18 6L6 18M6 6l12 12",
  edit: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z",
  check: "M20 6L9 17l-5-5",
  trash: ["M3 6h18", "M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2", "M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"],
  arrowUp: ["M12 19V5", "M5 12l7-7 7 7"], arrowDown: ["M12 5v14", "M19 12l-7 7-7-7"],
  eye: ["M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z", "M12 15a3 3 0 100-6 3 3 0 000 6z"],
  dots: "M12 5v.01M12 12v.01M12 19v.01",
  chevDown: "M6 9l6 6 6-6", chevUp: "M18 15l-6-6-6 6",
};
const SUGGESTED = ["Walk-in Cooler", "Walk-in Freezer", "Dry Storage", "Beverage Station", "Prep Area", "Supply Closet", "Bar", "FOH Storage"];

export default function LocationSetup({ locations: initial = [], account, catalogItems = [], onSave, onBack, onViewItems, onDirtyChange, showToast }) {
  const [zones, setZones] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [newZoneName, setNewZoneName] = useState("");
  const [addingSubTo, setAddingSubTo] = useState(null);
  const [newSubName, setNewSubName] = useState("");
  const [iconPicker, setIconPicker] = useState(null);
  const [pIcon, setPIcon] = useState(null);
  const [pColor, setPColor] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [menuOpen, setMenuOpen] = useState(null);
  const menuRef = useRef(null);

  // Notify parent of dirty state (+ cleanup on unmount)
  useEffect(() => { onDirtyChange?.(hasChanges); }, [hasChanges]);
  useEffect(() => { return () => onDirtyChange?.(false); }, []);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(null); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => { document.removeEventListener("mousedown", handler); document.removeEventListener("touchstart", handler); };
  }, [menuOpen]);

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
  const totalSubs = useMemo(() => zones.reduce((t, z) => t + z.subZones.length, 0), [zones]);
  const mark = () => { setHasChanges(true); setJustSaved(false); };
  const gc = (k) => COLORS.find((c) => c.key === k) || COLORS[4];

  // -- Zone CRUD --
  const addZone = (n) => { if (!n.trim()) return; if (zones.some((z) => z.name.toLowerCase() === n.trim().toLowerCase())) { showToast?.("Zone already exists", "error"); return; } const a = autoIC(n.trim()); setZones((p) => [...p, { locationId: `loc_new_${Date.now()}`, name: n.trim(), icon: a.icon, color: a.color, sortOrder: p.length, subZones: [], isNew: true }]); setNewZoneName(""); mark(); };
  const addSub = (pid, n) => { if (!n.trim()) return; const a = autoIC(n.trim()); setZones((p) => p.map((z) => z.locationId !== pid ? z : { ...z, subZones: [...z.subZones, { locationId: `loc_new_${Date.now()}_s`, name: n.trim(), parentLocationId: pid, icon: a.icon, color: a.color, sortOrder: z.subZones.length, isNew: true }] })); setNewSubName(""); setAddingSubTo(null); mark(); setExpanded((p) => ({ ...p, [pid]: true })); };
  const startEdit = (id, n) => { setEditingId(id); setEditName(n); setMenuOpen(null); };
  const saveEdit = () => { if (!editName.trim()) return; setZones((p) => p.map((z) => { if (z.locationId === editingId) return { ...z, name: editName.trim() }; return { ...z, subZones: z.subZones.map((s) => s.locationId === editingId ? { ...s, name: editName.trim() } : s) }; })); setEditingId(null); mark(); };

  const reqDelZ = (id) => { setMenuOpen(null); const z = zones.find((x) => x.locationId === id); const c = zt(z); if (c > 0) { showToast?.(`Move ${c} item${c !== 1 ? "s" : ""} before deleting`, "error"); return; } setConfirmDelete({ type: "zone", zoneId: id, name: z.name, count: 0 }); };
  const reqDelS = (pid, sid) => { const z = zones.find((x) => x.locationId === pid); const s = z?.subZones.find((x) => x.locationId === sid); setConfirmDelete({ type: "sub", zoneId: pid, subId: sid, name: s?.name || "", count: itemCounts[sid] || 0 }); };
  const doDel = () => { if (!confirmDelete) return; if (confirmDelete.type === "zone") setZones((p) => p.filter((z) => z.locationId !== confirmDelete.zoneId)); else { setZones((p) => p.map((z) => z.locationId !== confirmDelete.zoneId ? z : { ...z, subZones: z.subZones.filter((s) => s.locationId !== confirmDelete.subId) })); if (confirmDelete.count > 0) showToast?.(`${confirmDelete.count} item${confirmDelete.count !== 1 ? "s" : ""} moved to parent zone`, "info"); } setConfirmDelete(null); mark(); };

  const moveZ = (i, d) => { const n = [...zones]; const t = i + d; if (t < 0 || t >= n.length) return; [n[i], n[t]] = [n[t], n[i]]; n.forEach((z, j) => { z.sortOrder = j; }); setZones(n); mark(); };
  const moveS = (pid, i, d) => { setZones((p) => p.map((z) => { if (z.locationId !== pid) return z; const s = [...z.subZones]; const t = i + d; if (t < 0 || t >= s.length) return z; [s[i], s[t]] = [s[t], s[i]]; s.forEach((x, j) => { x.sortOrder = j; }); return { ...z, subZones: s }; })); mark(); };

  const openPicker = (id, ci, cc) => { setIconPicker(id); setPIcon(ci); setPColor(cc); setMenuOpen(null); };
  const closePicker = () => { if (iconPicker && pIcon && pColor) { setZones((p) => p.map((z) => { if (z.locationId === iconPicker) return { ...z, icon: pIcon, color: pColor }; return { ...z, subZones: z.subZones.map((s) => s.locationId === iconPicker ? { ...s, icon: pIcon, color: pColor } : s) }; })); mark(); } setIconPicker(null); };

  const handleSave = async () => {
    setSaving(true);
    const flat = []; zones.forEach((z, i) => { flat.push({ locationId: z.isNew ? null : z.locationId, name: z.name, icon: z.icon, color: z.color, sortOrder: i, parentLocationId: null }); z.subZones.forEach((s, j) => { flat.push({ locationId: s.isNew ? null : s.locationId, name: s.name, icon: s.icon, color: s.color, sortOrder: j, parentLocationId: z.isNew ? null : z.locationId, parentName: z.name }); }); });
    try { await onSave?.(flat); setHasChanges(false); setJustSaved(true); } catch { showToast?.("Save failed", "error"); } finally { setSaving(false); }
  };

  // Back is guarded by parent via onDirtyChange + guardNav
  const handleBack = () => { onBack?.(); };

  const handleViewItems = () => { if (hasChanges) { showToast?.("Save your changes first", "error"); return; } onViewItems?.(); };

  const used = new Set(zones.map((z) => z.name.toLowerCase()));
  const sugg = SUGGESTED.filter((s) => !used.has(s.toLowerCase()));

  // -- Icon picker with live preview (5.7) --
  const renderPicker = (forId) => {
    const previewCol = gc(pColor);
    return (
      <div className="oh-inv-loc-picker">
        <div className="oh-inv-loc-picker-head">
          <span className="oh-inv-loc-picker-label">Choose icon & color</span>
          <button className="oh-inv-loc-picker-done" onClick={closePicker}>Done</button>
        </div>
        {/* 5.7: Live preview */}
        <div className="oh-inv-loc-picker-preview" style={{ borderLeftColor: previewCol.fg }}>
          <span className="oh-inv-loc-picker-preview-icon" style={{ background: previewCol.bg }}>{getIcon(pIcon).emoji}</span>
          <span className="oh-inv-loc-picker-preview-label">Preview</span>
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
  };

  // -- Three-dot menu (5.5) --
  const renderMenu = (zoneId, zoneName, zoneIcon, zoneColor, hasSubs, zIdx) => (
    <div className="oh-inv-loc-menu" ref={menuRef}>
      {zIdx > 0 && <button onClick={(e) => { e.stopPropagation(); moveZ(zIdx, -1); setMenuOpen(null); }}>Move up</button>}
      {zIdx < zones.length - 1 && <button onClick={(e) => { e.stopPropagation(); moveZ(zIdx, 1); setMenuOpen(null); }}>Move down</button>}
      <button onClick={(e) => { e.stopPropagation(); startEdit(zoneId, zoneName); }}>Rename</button>
      <button onClick={(e) => { e.stopPropagation(); openPicker(zoneId, zoneIcon, zoneColor); }}>Change icon</button>
      <button onClick={(e) => { e.stopPropagation(); setAddingSubTo(zoneId); setNewSubName(""); setMenuOpen(null); setExpanded((p) => ({ ...p, [zoneId]: true })); }}>Add sub-zone</button>
      <button className="oh-inv-loc-menu-danger" onClick={(e) => { e.stopPropagation(); reqDelZ(zoneId); }}>Delete</button>
    </div>
  );

  return (
    <div className="oh-inv-loc-setup">
      {/* Contained card wrapper (4) */}
      <div className="oh-inv-loc-card">
        {/* Header with summary bar (5.1) + unsaved indicator (5.4) */}
        <div className="oh-inv-loc-header">
          <div className="oh-inv-loc-header-left">
            <h3 className="oh-inv-loc-title">
              Storage Locations
              {hasChanges && <span className="oh-inv-loc-unsaved-dot" />}
            </h3>
            <p className="oh-inv-loc-summary">
              {account} {"\u00B7"} {zones.length} zone{zones.length !== 1 ? "s" : ""}
              {totalSubs > 0 ? ` \u00B7 ${totalSubs} sub-zone${totalSubs !== 1 ? "s" : ""}` : ""}
              {totalItems > 0 ? ` \u00B7 ${totalItems} item${totalItems !== 1 ? "s" : ""}` : ""}
            </p>
          </div>
        </div>

        {/* 5.2: Educational blurb only for empty state */}
        {zones.length === 0 && (
          <div className="oh-inv-loc-blurb">
            Define the storage areas in your kitchen. Add zones for each major area, then optionally create sub-zones for more detailed organization during counts.
          </div>
        )}

        {/* Zone list */}
        <div className="oh-inv-loc-zones">
          {zones.map((zone, zIdx) => {
            const isExp = expanded[zone.locationId];
            const col = gc(zone.color);
            const total = zt(zone);
            const isEdit = editingId === zone.locationId;
            const isEmpty = total === 0;
            const isMenuOpen = menuOpen === zone.locationId;

            return (
              <div key={zone.locationId} className="oh-inv-loc-zone">
                {/* Zone card - tap to expand (1C) */}
                <div
                  className={`oh-inv-loc-zone-card${isEmpty ? " oh-inv-loc-zone-card--empty" : ""}${isExp ? " oh-inv-loc-zone-card--expanded" : ""}`}
                  style={{ borderLeftColor: col.fg }}
                  onClick={() => { if (!isEdit) setExpanded((p) => ({ ...p, [zone.locationId]: !p[zone.locationId] })); }}
                >
                  <button className="oh-inv-loc-icon-btn" style={{ background: col.bg }}
                    onClick={(e) => { e.stopPropagation(); openPicker(zone.locationId, zone.icon, zone.color); }}>
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{getIcon(zone.icon).emoji}</span>
                  </button>

                  <div className="oh-inv-loc-zone-info">
                    {isEdit ? (
                      <div className="oh-inv-loc-edit-row" onClick={(e) => e.stopPropagation()}>
                        <input className="oh-inv-loc-edit-input" value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }} autoFocus />
                        <button className="oh-inv-loc-edit-ok" onClick={saveEdit}><I d={ic.check} size={13} color="#16a34a" /></button>
                        <button className="oh-inv-loc-edit-cancel" onClick={() => setEditingId(null)}><I d={ic.x} size={13} color="#94a3b8" /></button>
                      </div>
                    ) : (<>
                      <span className="oh-inv-loc-zone-name">{zone.name}</span>
                      <div className="oh-inv-loc-pills">
                        <span className="oh-inv-loc-pill" style={{ color: total > 0 ? col.fg : "#94a3b8" }}>{total} item{total !== 1 ? "s" : ""}</span>
                        {zone.subZones.length > 0 && <span className="oh-inv-loc-pill oh-inv-loc-pill--sub">{zone.subZones.length} sub-zone{zone.subZones.length !== 1 ? "s" : ""}</span>}
                      </div>
                    </>)}
                  </div>

                  {!isEdit && (
                    <div className="oh-inv-loc-zone-right" onClick={(e) => e.stopPropagation()}>
                      {/* Three-dot menu (5.5) */}
                      <button className="oh-inv-loc-dots-btn" onClick={() => setMenuOpen(isMenuOpen ? null : zone.locationId)}>
                        <I d={ic.dots} size={16} color="#94a3b8" sw={3} />
                      </button>
                      {isMenuOpen && renderMenu(zone.locationId, zone.name, zone.icon, zone.color, zone.subZones.length > 0, zIdx)}
                      {/* Chevron for expandable zones */}
                      <I d={isExp ? ic.chevUp : ic.chevDown} size={14} color="#94a3b8" style={{ marginLeft: 2 }} />
                    </div>
                  )}
                </div>

                {iconPicker === zone.locationId && renderPicker(zone.locationId)}

                {/* Sub-zones: inline rows (3A) */}
                {isExp && (
                  <div className="oh-inv-loc-subzones">
                    {zone.subZones.map((sub, sIdx) => {
                      const sc = gc(sub.color); const sC = itemCounts[sub.locationId] || 0; const sE = editingId === sub.locationId;
                      return (
                        <div key={sub.locationId} className="oh-inv-loc-sub-row">
                          <button className="oh-inv-loc-sub-icon" style={{ background: sc.bg }}
                            onClick={() => openPicker(sub.locationId, sub.icon, sub.color)}>
                            <span style={{ fontSize: 12, lineHeight: 1 }}>{getIcon(sub.icon).emoji}</span>
                          </button>
                          {sE ? (
                            <div className="oh-inv-loc-edit-row" style={{ flex: 1 }}>
                              <input className="oh-inv-loc-edit-input" value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditingId(null); }} autoFocus />
                              <button className="oh-inv-loc-edit-ok" onClick={saveEdit}><I d={ic.check} size={12} color="#16a34a" /></button>
                              <button className="oh-inv-loc-edit-cancel" onClick={() => setEditingId(null)}><I d={ic.x} size={12} color="#94a3b8" /></button>
                            </div>
                          ) : (<>
                            <span className="oh-inv-loc-sub-name">{sub.name}</span>
                            <span className="oh-inv-loc-sub-count" style={{ color: sC > 0 ? sc.fg : "#94a3b8" }}>{sC} item{sC !== 1 ? "s" : ""}</span>
                            <div className="oh-inv-loc-zone-right">
                              <button className="oh-inv-loc-dots-btn" onClick={() => setMenuOpen(menuOpen === sub.locationId ? null : sub.locationId)}>
                                <I d={ic.dots} size={14} color="#94a3b8" sw={3} />
                              </button>
                              {menuOpen === sub.locationId && (
                                <div className="oh-inv-loc-menu" ref={menuRef}>
                                  {sIdx > 0 && <button onClick={() => { moveS(zone.locationId, sIdx, -1); setMenuOpen(null); }}>Move up</button>}
                                  {sIdx < zone.subZones.length - 1 && <button onClick={() => { moveS(zone.locationId, sIdx, 1); setMenuOpen(null); }}>Move down</button>}
                                  <button onClick={() => startEdit(sub.locationId, sub.name)}>Rename</button>
                                  <button onClick={() => openPicker(sub.locationId, sub.icon, sub.color)}>Change icon</button>
                                  <button className="oh-inv-loc-menu-danger" onClick={() => reqDelS(zone.locationId, sub.locationId)}>Delete</button>
                                </div>
                              )}
                            </div>
                          </>)}
                          {iconPicker === sub.locationId && renderPicker(sub.locationId)}
                        </div>
                      );
                    })}
                    {/* 5.12: Sub-zone quick-add */}
                    {addingSubTo === zone.locationId ? (
                      <div className="oh-inv-loc-sub-add-row">
                        <input className="oh-inv-loc-sub-add-input" placeholder="Sub-zone name..." value={newSubName} onChange={(e) => setNewSubName(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") addSub(zone.locationId, newSubName); if (e.key === "Escape") { setAddingSubTo(null); setNewSubName(""); } }} autoFocus />
                        <button className="oh-inv-loc-sub-add-ok" onClick={() => addSub(zone.locationId, newSubName)} disabled={!newSubName.trim()}>Add</button>
                      </div>
                    ) : (
                      <button className="oh-inv-loc-sub-add-btn" onClick={() => { setAddingSubTo(zone.locationId); setNewSubName(""); }}>
                        <I d={ic.plus} size={11} color="#d97706" /> Add sub-zone
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Empty state */}
          {zones.length === 0 && (
            <div className="oh-inv-loc-empty">
              <span style={{ fontSize: 32 }}>{ICONS.box.emoji}</span>
              <p>No storage locations yet. Add your first zone below.</p>
            </div>
          )}
        </div>

        {/* 5.3: Ghost add-zone input (always visible) */}
        <div className="oh-inv-loc-add-ghost">
          <input
            className="oh-inv-loc-add-ghost-input"
            placeholder="+ Add a zone..."
            value={newZoneName}
            onChange={(e) => setNewZoneName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addZone(newZoneName); if (e.key === "Escape") setNewZoneName(""); }}
          />
          {newZoneName.trim() && (
            <button className="oh-inv-loc-add-ghost-btn" onClick={() => addZone(newZoneName)}>Add</button>
          )}
        </div>

        {/* Suggestions (show when few zones) */}
        {sugg.length > 0 && zones.length < 3 && (
          <div className="oh-inv-loc-suggest">
            <span className="oh-inv-loc-suggest-label">Common zones:</span>
            <div className="oh-inv-loc-suggest-chips">{sugg.slice(0, 5).map((s) => (<button key={s} className="oh-inv-loc-suggest-chip" onClick={() => addZone(s)}>+ {s}</button>))}</div>
          </div>
        )}

        {/* 5.8: Sticky save footer (sticky when hasChanges) */}
        <div className={`oh-inv-loc-footer${hasChanges ? " oh-inv-loc-footer--sticky" : ""}`}>
          <button className="oh-inv-loc-back" onClick={handleBack}>Back</button>
          <button className="oh-inv-loc-save" onClick={handleSave} disabled={saving || !hasChanges}>{saving ? "Saving..." : "Save Locations"}</button>
        </div>

        {/* Post-save feedback */}
        {justSaved && (
          <div className="oh-inv-loc-postsave">
            <I d={ic.check} size={14} color="#16a34a" sw={3} />
            <span className="oh-inv-loc-postsave-text">Locations saved successfully.</span>
            {onViewItems && <button className="oh-inv-loc-postsave-cta" onClick={handleViewItems}><I d={ic.eye} size={14} color="#fff" /> View & organize items</button>}
          </div>
        )}

        {/* View items link */}
        {!justSaved && totalItems > 0 && onViewItems && (
          <button className="oh-inv-loc-view-items" onClick={handleViewItems}>
            <I d={ic.eye} size={14} color="#d97706" /> View items in locations {hasChanges && <span className="oh-inv-loc-unsaved-text">(save first)</span>}
          </button>
        )}
      </div>

      {/* Delete confirmation overlay */}
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