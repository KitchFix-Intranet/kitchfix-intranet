"use client";
import { useState, useEffect, useMemo } from "react";

/**
 * LocationSetup.js — Stage 1: Storage Locations (Polished)
 * Props: locations[], account, catalogItems[], onSave, onBack, onViewItems, showToast
 */

const I = ({ d, size = 16, color = "#64748b", sw = 2, fill = "none", style = {} }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={color}
    strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
    style={{ display: "inline-block", verticalAlign: "middle", flexShrink: 0, ...style }}>
    {(Array.isArray(d) ? d : [d]).map((p, i) => <path key={i} d={p} />)}
  </svg>
);

// ── 16 food-service icons ──
const ICONS = {
  snowflake: { label: "Snowflake", d: ["M12 2v20M2 12h20M4.93 4.93l14.14 14.14M19.07 4.93L4.93 19.07"] },
  drumstick: { label: "Meat", d: ["M15.5 2.5a4.24 4.24 0 016 6L12 18l-1.5-1.5L4 23l-1-1 6.5-6.5L8 14l9.5-9.5z", "M18 7l.5.5"] },
  carrot: { label: "Veggie", d: ["M2 22L16 8", "M15.24 2.77a3.18 3.18 0 014.24 0 3.18 3.18 0 010 4.24L6.07 20.38a1 1 0 01-1.42 0l-1-1a1 1 0 010-1.42L15.24 2.77z"] },
  leaf: { label: "Leaf", d: ["M11 20A7 7 0 019.8 6.9C15.5 4.9 20 4 20 4s-1 4.5-3 10.1A7 7 0 0111 20z", "M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"] },
  cup: { label: "Cup", d: ["M17 8h1a4 4 0 010 8h-1", "M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8z", "M6 2v4M10 2v4M14 2v4"] },
  tag: { label: "Tag", d: ["M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z", "M7 7h.01"] },
  box: { label: "Box", d: ["M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"] },
  mapPin: { label: "Location", d: ["M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z", "M12 13a3 3 0 100-6 3 3 0 000 6z"] },
  paper: { label: "Paper", d: ["M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z", "M14 2v6h6", "M16 13H8M16 17H8M10 9H8"] },
  star: { label: "Star", d: ["M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"] },
  apple: { label: "Apple", d: ["M12 2c-1.5 0-3 .5-3 2", "M9 22c-2 0-5-2-5-6 0-3 1.5-5.5 4-7.5a8 8 0 018 0c2.5 2 4 4.5 4 7.5 0 4-3 6-5 6"] },
  flame: { label: "Fire", d: ["M8.5 14.5A2.5 2.5 0 0011 12c0-1.38-.5-2-1-3-1.07-2.14 0-5.5 3.5-7.5C13 5 12.19 8 14 9.5c3.5 3 .5 6.5.5 6.5a5 5 0 01-5-1.5"] },
  plate: { label: "Plate", d: ["M12 22c5.52 0 10-2.69 10-6H2c0 3.31 4.48 6 10 6z", "M12 2v4M8 6c0-2 1.79-4 4-4s4 2 4 4"] },
  fish: { label: "Fish", d: ["M6.5 12c3-5 9.5-6 14-3-4.5 3-11 2-14-3z", "M3 12s2-2.5 3.5-2.5", "M18 8l-2 4 2 4"] },
  wrench: { label: "Tools", d: ["M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"] },
  grid: { label: "Grid", d: ["M3 3h7v7H3z", "M14 3h7v7h-7z", "M14 14h7v7h-7z", "M3 14h7v7H3z"] },
};
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
  { p: ["freez", "frost"], icon: "snowflake", color: "indigo" },
  { p: ["dry", "pantry", "shelf", "storage"], icon: "box", color: "amber" },
  { p: ["bev", "drink", "bar"], icon: "cup", color: "teal" },
  { p: ["supply", "suppli", "clean", "chem"], icon: "wrench", color: "slate" },
  { p: ["prep", "line", "hot"], icon: "flame", color: "amber" },
  { p: ["spice", "herb", "season"], icon: "leaf", color: "green" },
  { p: ["protein", "meat"], icon: "drumstick", color: "rose" },
  { p: ["produce", "veg", "fruit"], icon: "carrot", color: "green" },
];
function autoIC(n) { const l = (n||"").toLowerCase(); for (const r of AUTO_RULES) { if (r.p.some((x) => l.includes(x))) return { icon: r.icon, color: r.color }; } return { icon: "mapPin", color: "slate" }; }

const ic = {
  plus: "M12 5v14M5 12h14", x: "M18 6L6 18M6 6l12 12",
  edit: "M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z",
  check: "M20 6L9 17l-5-5",
  trash: ["M3 6h18", "M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2", "M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"],
  arrowUp: ["M12 19V5", "M5 12l7-7 7 7"], arrowDown: ["M12 5v14", "M19 12l-7 7-7-7"],
  eye: ["M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z", "M12 15a3 3 0 100-6 3 3 0 000 6z"],
};
const SUGGESTED = ["Walk-in Cooler","Walk-in Freezer","Dry Storage","Beverage Station","Prep Area","Supply Closet","Bar","FOH Storage"];

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
    const wk = top.map((z) => ({ ...z, subZones: subs.filter((s) => s.parentLocationId === z.locationId).sort((a, b) => (a.sortOrder||0) - (b.sortOrder||0)).map((s) => ({ ...s, icon: s.icon || autoIC(s.name).icon, color: s.color || autoIC(s.name).color })) }));
    setZones(wk);
    const exp = {}; wk.forEach((z) => { if (z.subZones.length > 0) exp[z.locationId] = true; }); setExpanded(exp);
  }, [initial]);

  const itemCounts = useMemo(() => { const c = {}; catalogItems.forEach((i) => { const l = i.locationId || "_u"; c[l] = (c[l]||0) + 1; }); return c; }, [catalogItems]);
  const zt = (z) => { let t = itemCounts[z.locationId]||0; (z.subZones||[]).forEach((s) => { t += itemCounts[s.locationId]||0; }); return t; };
  const totalItems = useMemo(() => { let t = 0; zones.forEach((z) => { t += zt(z); }); return t; }, [zones, itemCounts]);
  const mark = () => { setHasChanges(true); setJustSaved(false); };
  const gc = (k) => COLORS.find((c) => c.key === k) || COLORS[4];

  const addZone = (n) => { if (!n.trim()) return; if (zones.some((z) => z.name.toLowerCase() === n.trim().toLowerCase())) { showToast?.("Zone already exists","error"); return; } const a = autoIC(n.trim()); setZones((p) => [...p, { locationId: `loc_new_${Date.now()}`, name: n.trim(), icon: a.icon, color: a.color, sortOrder: p.length, subZones: [], isNew: true }]); setNewName(""); setShowAddZone(false); mark(); };
  const addSub = (pid, n) => { if (!n.trim()) return; const a = autoIC(n.trim()); setZones((p) => p.map((z) => z.locationId !== pid ? z : { ...z, subZones: [...z.subZones, { locationId: `loc_new_${Date.now()}_s`, name: n.trim(), parentLocationId: pid, icon: a.icon, color: a.color, sortOrder: z.subZones.length, isNew: true }] })); setNewName(""); setAddingSubTo(null); mark(); setExpanded((p) => ({ ...p, [pid]: true })); };
  const startEdit = (id, n) => { setEditingId(id); setEditName(n); };
  const saveEdit = () => { if (!editName.trim()) return; setZones((p) => p.map((z) => { if (z.locationId === editingId) return { ...z, name: editName.trim() }; return { ...z, subZones: z.subZones.map((s) => s.locationId === editingId ? { ...s, name: editName.trim() } : s) }; })); setEditingId(null); mark(); };

  const reqDelZ = (id) => { const z = zones.find((x) => x.locationId === id); const c = zt(z); if (c > 0) { showToast?.(`Move ${c} item${c!==1?"s":""} before deleting`,"error"); return; } setConfirmDelete({ type:"zone", zoneId:id, name:z.name, count:0 }); };
  const reqDelS = (pid, sid) => { const z = zones.find((x) => x.locationId === pid); const s = z?.subZones.find((x) => x.locationId === sid); setConfirmDelete({ type:"sub", zoneId:pid, subId:sid, name:s?.name||"", count:itemCounts[sid]||0 }); };
  const doDel = () => { if (!confirmDelete) return; if (confirmDelete.type === "zone") setZones((p) => p.filter((z) => z.locationId !== confirmDelete.zoneId)); else { setZones((p) => p.map((z) => z.locationId !== confirmDelete.zoneId ? z : { ...z, subZones: z.subZones.filter((s) => s.locationId !== confirmDelete.subId) })); if (confirmDelete.count > 0) showToast?.(`${confirmDelete.count} item${confirmDelete.count!==1?"s":""} moved to parent zone`,"info"); } setConfirmDelete(null); mark(); };

  const moveZ = (i, d) => { const n = [...zones]; const t = i+d; if (t<0||t>=n.length) return; [n[i],n[t]]=[n[t],n[i]]; n.forEach((z,j) => { z.sortOrder=j; }); setZones(n); mark(); };
  const moveS = (pid, i, d) => { setZones((p) => p.map((z) => { if (z.locationId !== pid) return z; const s=[...z.subZones]; const t=i+d; if (t<0||t>=s.length) return z; [s[i],s[t]]=[s[t],s[i]]; s.forEach((x,j) => { x.sortOrder=j; }); return { ...z, subZones: s }; })); mark(); };

  const openPicker = (id, ci, cc) => { setIconPicker(id); setPIcon(ci); setPColor(cc); };
  const closePicker = () => { if (iconPicker && pIcon && pColor) { setZones((p) => p.map((z) => { if (z.locationId === iconPicker) return { ...z, icon: pIcon, color: pColor }; return { ...z, subZones: z.subZones.map((s) => s.locationId === iconPicker ? { ...s, icon: pIcon, color: pColor } : s) }; })); mark(); } setIconPicker(null); };

  const handleSave = async () => {
    setSaving(true);
    const flat = []; zones.forEach((z, i) => { flat.push({ locationId: z.isNew ? null : z.locationId, name: z.name, icon: z.icon, color: z.color, sortOrder: i, parentLocationId: null }); z.subZones.forEach((s, j) => { flat.push({ locationId: s.isNew ? null : s.locationId, name: s.name, icon: s.icon, color: s.color, sortOrder: j, parentLocationId: z.isNew ? null : z.locationId, parentName: z.name }); }); });
    try { await onSave?.(flat); setHasChanges(false); setJustSaved(true); } catch { showToast?.("Save failed","error"); } finally { setSaving(false); }
  };
  const handleViewItems = () => { if (hasChanges) { showToast?.("Save your changes first","error"); return; } onViewItems?.(); };

  const used = new Set(zones.map((z) => z.name.toLowerCase()));
  const sugg = SUGGESTED.filter((s) => !used.has(s.toLowerCase()));

  const renderPicker = (locId, curIcon, curColor) => (
    <div className="oh-inv-loc-picker">
      <div className="oh-inv-loc-picker-head">
        <span className="oh-inv-loc-picker-label">Choose icon & color</span>
        <button className="oh-inv-loc-picker-done" onClick={closePicker}>Done</button>
      </div>
      <div className="oh-inv-loc-picker-icons">
        {ICON_KEYS.map((ik) => (
          <button key={ik} className={`oh-inv-loc-picker-icon${pIcon === ik ? " active" : ""}`} title={ICONS[ik].label} onClick={() => setPIcon(ik)}>
            <I d={ICONS[ik].d} size={16} color={pIcon === ik ? gc(pColor).fg : "#64748b"} sw={1.5} />
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
        <p className="oh-inv-loc-sub">{account} · {zones.length} zone{zones.length !== 1 ? "s" : ""}</p>
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
                  <I d={ICONS[zone.icon]?.d || ICONS.mapPin.d} size={16} color={col.fg} sw={1.8} />
                </button>
                <div className="oh-inv-loc-zone-info">
                  {isEdit ? (
                    <div className="oh-inv-loc-edit-row">
                      <input className="oh-inv-loc-edit-input" value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key==="Enter") saveEdit(); if (e.key==="Escape") setEditingId(null); }} autoFocus />
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
                    <button className="oh-inv-loc-move" onClick={() => moveZ(zIdx,-1)} disabled={zIdx===0} title="Move up"><I d={ic.arrowUp} size={12} color={zIdx===0?"#e2e8f0":"#0f3057"} sw={2.5} /></button>
                    <button className="oh-inv-loc-move" onClick={() => moveZ(zIdx,1)} disabled={zIdx===zones.length-1} title="Move down"><I d={ic.arrowDown} size={12} color={zIdx===zones.length-1?"#e2e8f0":"#0f3057"} sw={2.5} /></button>
                    <button className="oh-inv-loc-act" onClick={() => startEdit(zone.locationId, zone.name)} title="Rename"><I d={ic.edit} size={12} color="#64748b" /></button>
                    <button className="oh-inv-loc-act" onClick={() => reqDelZ(zone.locationId)} title="Delete"><I d={ic.trash} size={12} color="#94a3b8" /></button>
                    <button className="oh-inv-loc-expand-btn" onClick={() => setExpanded((p) => ({ ...p, [zone.locationId]: !p[zone.locationId] }))}>{isExp ? "Hide" : "Show"}</button>
                  </div>
                )}
              </div>
              {iconPicker === zone.locationId && renderPicker(zone.locationId, zone.icon, zone.color)}
              {isExp && (
                <div className="oh-inv-loc-subzones">
                  {zone.subZones.map((sub, sIdx) => {
                    const sc = gc(sub.color); const sC = itemCounts[sub.locationId]||0; const sE = editingId === sub.locationId;
                    return (
                      <div key={sub.locationId} className="oh-inv-loc-sub-card">
                        <button className="oh-inv-loc-icon-btn oh-inv-loc-icon-btn--sm" style={{ background: sc.bg }} onClick={() => openPicker(sub.locationId, sub.icon, sub.color)}>
                          <I d={ICONS[sub.icon]?.d || ICONS.mapPin.d} size={12} color={sc.fg} sw={1.8} />
                        </button>
                        <div className="oh-inv-loc-zone-info">
                          {sE ? (
                            <div className="oh-inv-loc-edit-row">
                              <input className="oh-inv-loc-edit-input" value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => { if (e.key==="Enter") saveEdit(); if (e.key==="Escape") setEditingId(null); }} autoFocus />
                              <button className="oh-inv-loc-edit-ok" onClick={saveEdit}><I d={ic.check} size={12} color="#16a34a" /></button>
                              <button className="oh-inv-loc-edit-cancel" onClick={() => setEditingId(null)}><I d={ic.x} size={12} color="#94a3b8" /></button>
                            </div>
                          ) : (<>
                            <span className="oh-inv-loc-sub-name">{sub.name}</span>
                            <span className="oh-inv-loc-pill oh-inv-loc-pill--sm">{sC} item{sC!==1?"s":""}</span>
                          </>)}
                        </div>
                        {!sE && (
                          <div className="oh-inv-loc-actions">
                            <button className="oh-inv-loc-move oh-inv-loc-move--sm" onClick={() => moveS(zone.locationId,sIdx,-1)} disabled={sIdx===0}><I d={ic.arrowUp} size={10} color={sIdx===0?"#e2e8f0":"#0f3057"} sw={2.5} /></button>
                            <button className="oh-inv-loc-move oh-inv-loc-move--sm" onClick={() => moveS(zone.locationId,sIdx,1)} disabled={sIdx===zone.subZones.length-1}><I d={ic.arrowDown} size={10} color={sIdx===zone.subZones.length-1?"#e2e8f0":"#0f3057"} sw={2.5} /></button>
                            <button className="oh-inv-loc-act" onClick={() => startEdit(sub.locationId, sub.name)}><I d={ic.edit} size={11} color="#64748b" /></button>
                            <button className="oh-inv-loc-act" onClick={() => reqDelS(zone.locationId, sub.locationId)}><I d={ic.trash} size={11} color="#94a3b8" /></button>
                          </div>
                        )}
                        {iconPicker === sub.locationId && renderPicker(sub.locationId, sub.icon, sub.color)}
                      </div>
                    );
                  })}
                  {addingSubTo === zone.locationId ? (
                    <div className="oh-inv-loc-add-inline">
                      <input className="oh-inv-loc-add-input" placeholder="Sub-zone name..." value={newName} onChange={(e) => setNewName(e.target.value)}
                        onKeyDown={(e) => { if (e.key==="Enter") addSub(zone.locationId, newName); if (e.key==="Escape") { setAddingSubTo(null); setNewName(""); } }} autoFocus />
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
        {zones.length === 0 && <div className="oh-inv-loc-empty"><I d={ICONS.mapPin.d} size={32} color="#e2e8f0" sw={1.5} /><p>No storage locations yet. Add your first zone below.</p></div>}
      </div>

      {showAddZone ? (
        <div className="oh-inv-loc-add-inline oh-inv-loc-add-zone">
          <input className="oh-inv-loc-add-input" placeholder="Zone name (e.g. Walk-in Cooler)..." value={newName} onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => { if (e.key==="Enter") addZone(newName); if (e.key==="Escape") { setShowAddZone(false); setNewName(""); } }} autoFocus />
          <button className="oh-inv-loc-add-ok" onClick={() => addZone(newName)} disabled={!newName.trim()}>Add</button>
          <button className="oh-inv-loc-add-cancel" onClick={() => { setShowAddZone(false); setNewName(""); }}>Cancel</button>
        </div>
      ) : (
        <button className="oh-inv-loc-add-zone-btn" onClick={() => { setShowAddZone(true); setNewName(""); }}><I d={ic.plus} size={14} color="#d97706" /> Add Zone</button>
      )}

      {sugg.length > 0 && zones.length < 3 && (
        <div className="oh-inv-loc-suggest"><span className="oh-inv-loc-suggest-label">Common zones:</span>
          <div className="oh-inv-loc-suggest-chips">{sugg.slice(0,5).map((s) => (<button key={s} className="oh-inv-loc-suggest-chip" onClick={() => addZone(s)}>+ {s}</button>))}</div>
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
          <h4 className="oh-inv-loc-confirm-title">Delete "{confirmDelete.name}"?</h4>
          <p className="oh-inv-loc-confirm-desc">{confirmDelete.type === "sub" && confirmDelete.count > 0 ? `${confirmDelete.count} item${confirmDelete.count!==1?"s":""} in this sub-zone will move to the parent zone.` : "This action cannot be undone."}</p>
          <div className="oh-inv-loc-confirm-btns">
            <button className="oh-inv-loc-confirm-cancel" onClick={() => setConfirmDelete(null)}>Cancel</button>
            <button className="oh-inv-loc-confirm-delete" onClick={doDel}>Delete</button>
          </div>
        </div></div>
      )}
    </div>
  );
}