/**
 * opsUtils.js — Shared Ops Hub Utility Library
 */

import { SHEET_IDS, readSheetSA, appendRowSA } from "@/lib/sheets";

// ═══════════════════════════════════════
// 1. SHEET — Cached reads (60s TTL)
// ═══════════════════════════════════════

const _cache = new Map();
const CACHE_TTL = 60 * 1000;

export async function cachedRead(spreadsheetId, tabName, { fresh = false } = {}) {
  const key = `${spreadsheetId}::${tabName}`;
  if (!fresh && _cache.has(key)) {
    const entry = _cache.get(key);
    if (Date.now() - entry.ts < CACHE_TTL) return entry.data;
  }
  const data = await readSheetSA(spreadsheetId, tabName);
  _cache.set(key, { data, ts: Date.now() });
  return data;
}

export async function batchRead(spreadsheetId, tabNames, opts = {}) {
  const results = await Promise.all(
    tabNames.map((tab) => cachedRead(spreadsheetId, tab, opts))
  );
  const out = {};
  tabNames.forEach((tab, i) => { out[tab] = results[i]; });
  return out;
}

export function invalidateCache(spreadsheetId, tabName) {
  _cache.delete(`${spreadsheetId}::${tabName}`);
}

// ═══════════════════════════════════════
// 2. ACCOUNT + PERIODS
// ═══════════════════════════════════════

/** Account label format: "${key} - ${name}" — matches main ops bootstrap. */
export async function getAccountConfigs() {
  const { rows } = await cachedRead(SHEET_IDS.HUB, "accounts");
  return rows.filter((r) => r[0]).map((r) => {
    const key = String(r[0]).trim();
    const name = r[1] ? String(r[1]).trim() : "";
    const level = r[2] ? String(r[2]).trim().toUpperCase() : "";
    return { key, name, label: name ? `${key} - ${name}` : key, level };
  });
}

/** Periods are GLOBAL (not per-account). Cols: name, start, end, due. */
export async function getPeriods() {
  const { rows } = await cachedRead(SHEET_IDS.HUB, "period_data");
  return rows.filter((r) => r[0]).map((r) => ({
    name: String(r[0]).trim(), start: r[1] || null, end: r[2] || null, due: r[3] || null,
  }));
}

/** Current period — where now falls between start and end. */
export async function getCurrentPeriod() {
  const periods = await getPeriods();
  const now = new Date();
  for (const p of periods) {
    if (!p.start || !p.end) continue;
    const s = new Date(p.start), e = new Date(p.end);
    if (isNaN(s) || isNaN(e)) continue;
    s.setHours(0, 0, 0, 0); e.setHours(23, 59, 59, 999);
    if (now >= s && now <= e) return p;
  }
  return periods[periods.length - 1] || null;
}

// ═══════════════════════════════════════
// 3. VENDOR
// ═══════════════════════════════════════

export async function getAllVendors() {
  const { rows } = await cachedRead(SHEET_IDS.HUB, "vendor_master");
  return rows.map((r) => ({
    id: r[0], name: r[1], shortName: r[2] || r[1], active: r[3] !== "FALSE",
  })).filter((v) => v.active);
}

export async function resolveVendorId(vendorId) {
  const { rows } = await cachedRead(SHEET_IDS.HUB, "vendor_master");
  const row = rows.find((r) => r[0] === vendorId);
  return row ? (row[2] || row[1] || vendorId) : vendorId;
}

// ═══════════════════════════════════════
// 4. NOTIFICATION
// ═══════════════════════════════════════

export async function opsNotify({ recipient, subject, eventType, relatedInfo }) {
  const row = [new Date().toISOString(), recipient || "ALL", "bell", subject, eventType || "ops_info", "logged", relatedInfo || ""];
  return appendRowSA(SHEET_IDS.COLLECTION, "notification_log", row).catch(() => {});
}

export async function postSlack(webhookUrl, text) {
  if (!webhookUrl) return { success: false };
  try {
    const res = await fetch(webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    return { success: res.ok };
  } catch { return { success: false }; }
}

// ═══════════════════════════════════════
// 5. FORMAT
// ═══════════════════════════════════════

export const parseNum = (v) => Number(String(v || 0).replace(/[$,]/g, "")) || 0;

export const formatCurrency = (v) => {
  const n = parseNum(v);
  return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
};

export const generateId = (prefix = "") => {
  const h = () => Math.random().toString(16).slice(2, 10);
  const id = `${h()}-${h().slice(0, 4)}-${h().slice(0, 4)}-${h()}`;
  return prefix ? `${prefix}_${id}` : id;
};