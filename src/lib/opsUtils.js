/**
 * opsUtils.js — Shared Ops Hub Utility Library
 * 
 * Foundation for Inventory Manager and future tools.
 * Five function groups:
 *   Sheet:        cachedRead (60s TTL), batchRead, appendRowSA
 *   Account:      getAccountConfig, getPeriodsForAccount, getCurrentPeriod, getPeriodForDate
 *   Vendor:       getVendorById, getVendorByName, resolveVendorId
 *   Notification:  opsNotify, sendOpsEmail, postSlack
 *   Format:       parseNum, formatCurrency, parseSheetDate, normalizeTimestamp
 */

import { SHEET_IDS, readSheetSA, appendRowSA, appendRowsSA } from "@/lib/sheets";

// ═══════════════════════════════════════
// 1. SHEET — Cached reads (60s TTL)
// ═══════════════════════════════════════

const _cache = new Map();
const CACHE_TTL = 60 * 1000; // 60 seconds

/**
 * Read a sheet tab with 60-second in-memory cache.
 * Transaction data (counts, submissions) should bypass cache by setting fresh=true.
 */
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

/**
 * Read multiple tabs in parallel. Returns object keyed by tab name.
 */
export async function batchRead(spreadsheetId, tabNames, opts = {}) {
  const results = await Promise.all(
    tabNames.map((tab) => cachedRead(spreadsheetId, tab, opts))
  );
  const out = {};
  tabNames.forEach((tab, i) => { out[tab] = results[i]; });
  return out;
}

/**
 * Clear cache for a specific tab (after writes).
 */
export function invalidateCache(spreadsheetId, tabName) {
  const key = `${spreadsheetId}::${tabName}`;
  _cache.delete(key);
}

// ═══════════════════════════════════════
// 2. ACCOUNT — Config, periods
// ═══════════════════════════════════════

/**
 * Get all account configs from HUB.
 */
export async function getAccountConfigs() {
  const { rows } = await cachedRead(SHEET_IDS.HUB, "accounts");
  return rows.map((r) => ({
    id: r[0] || "",
    label: r[1] || "",
    type: r[2] || "",
    sheetId: r[3] || "",
    driveId: r[4] || "",
    slackChannel: r[5] || "",
    active: r[6] !== "FALSE",
  })).filter((a) => a.active);
}

/**
 * Get period data for a specific account from HUB.
 */
export async function getPeriodsForAccount(accountLabel) {
  const { rows } = await cachedRead(SHEET_IDS.HUB, "period_data");
  return rows
    .filter((r) => r[0] === accountLabel)
    .map((r) => ({
      account: r[0],
      period: r[1] || "",
      start: r[2] || "",
      end: r[3] || "",
      due: r[4] || "",
    }));
}

/**
 * Get current period for an account (the one whose window we're in).
 */
export async function getCurrentPeriod(accountLabel) {
  const periods = await getPeriodsForAccount(accountLabel);
  const now = new Date();
  // Find the period where now is between start and due (inclusive)
  for (const p of periods) {
    const start = new Date(p.start + "T00:00:00");
    const due = new Date(p.due + "T23:59:59");
    if (now >= start && now <= due) return p;
  }
  // Fallback: next upcoming period
  const upcoming = periods
    .filter((p) => new Date(p.start) > now)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  return upcoming[0] || periods[periods.length - 1] || null;
}

/**
 * Get period that contains a specific date.
 */
export function getPeriodForDate(periods, dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  for (const p of periods) {
    const start = new Date(p.start + "T00:00:00");
    const end = new Date(p.end + "T23:59:59");
    if (d >= start && d <= end) return p;
  }
  return null;
}

// ═══════════════════════════════════════
// 3. VENDOR — Lookups from vendor_master
// ═══════════════════════════════════════

/**
 * Get vendor by UUID from vendor_master.
 */
export async function getVendorById(vendorId) {
  const { rows } = await cachedRead(SHEET_IDS.HUB, "vendor_master");
  const row = rows.find((r) => r[0] === vendorId);
  if (!row) return null;
  return { id: row[0], name: row[1], shortName: row[2] || row[1], active: row[3] !== "FALSE" };
}

/**
 * Get vendor by name (case-insensitive partial match).
 */
export async function getVendorByName(name) {
  const { rows } = await cachedRead(SHEET_IDS.HUB, "vendor_master");
  const lower = (name || "").toLowerCase();
  const row = rows.find((r) => (r[1] || "").toLowerCase().includes(lower));
  if (!row) return null;
  return { id: row[0], name: row[1], shortName: row[2] || row[1], active: row[3] !== "FALSE" };
}

/**
 * Get all vendors (for dropdowns / lookups).
 */
export async function getAllVendors() {
  const { rows } = await cachedRead(SHEET_IDS.HUB, "vendor_master");
  return rows.map((r) => ({
    id: r[0], name: r[1], shortName: r[2] || r[1], active: r[3] !== "FALSE",
  })).filter((v) => v.active);
}

/**
 * Resolve a vendorId to display name.
 */
export async function resolveVendorId(vendorId) {
  const v = await getVendorById(vendorId);
  return v ? v.shortName || v.name : vendorId;
}

// ═══════════════════════════════════════
// 4. NOTIFICATION — Email, Slack, Bell
// ═══════════════════════════════════════

/**
 * Write a bell notification to the notification_log.
 */
export async function opsNotify({ recipient, subject, eventType, relatedInfo }) {
  const row = [
    new Date().toISOString(),
    recipient || "ALL",
    "bell",
    subject,
    eventType || "ops_info",
    "logged",
    relatedInfo || "",
  ];
  return appendRowSA(SHEET_IDS.COLLECTION, "notification_log", row).catch((e) => {
    console.warn("[opsUtils] notification write failed:", e.message);
  });
}

/**
 * Post a message to a Slack webhook.
 */
export async function postSlack(webhookUrl, text, blocks = null) {
  if (!webhookUrl) {
    console.warn("[opsUtils] No Slack webhook URL provided");
    return { success: false };
  }
  try {
    const body = blocks ? { text, blocks } : { text };
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { success: res.ok };
  } catch (e) {
    console.error("[opsUtils] Slack post failed:", e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Send email via Gmail API using service account impersonation.
 * Falls back gracefully if Gmail scope isn't available.
 */
export async function sendOpsEmail({ to, cc, subject, html, from }) {
  // This will be wired to the Gmail API pattern from invoiceActions
  // For now, log and return — will be implemented in Week 2 submission pipeline
  console.log(`[opsUtils] Email queued: to=${to}, subject=${subject}`);
  return { success: true, queued: true };
}

// ═══════════════════════════════════════
// 5. FORMAT — Parsing & formatting
// ═══════════════════════════════════════

/**
 * Parse a numeric value from sheet data (strips $, commas).
 */
export function parseNum(v) {
  return Number(String(v || 0).replace(/[$,]/g, "")) || 0;
}

/**
 * Format as currency string.
 */
export function formatCurrency(v) {
  const n = parseNum(v);
  return "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * Parse a date from sheet data (handles YYYY-MM-DD and various formats).
 */
export function parseSheetDate(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T00:00:00");
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Normalize a timestamp to ISO string.
 */
export function normalizeTimestamp(v) {
  if (!v) return new Date().toISOString();
  const d = parseSheetDate(v);
  return d ? d.toISOString() : new Date().toISOString();
}

/**
 * Generate a unique ID (UUID v4 style).
 */
export function generateId(prefix = "") {
  const hex = () => Math.random().toString(16).slice(2, 10);
  const id = `${hex()}-${hex().slice(0, 4)}-${hex().slice(0, 4)}-${hex()}`;
  return prefix ? `${prefix}_${id}` : id;
}