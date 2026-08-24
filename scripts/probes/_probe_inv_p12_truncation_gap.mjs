#!/usr/bin/env node
/*
 * INV-P12: three-part read-only investigation.
 *
 * PART A: Ruling 4 exact-string matching. Rippling truncates merchant names
 *   inconsistently. Every auth/settlement pair where one side truncated and
 *   the other did not has escaped Ruling 4 since it shipped. Question:
 *   how many still sit in the ledger? Truncation-blind (prefix-tolerant)
 *   re-run + control rate.
 *
 * PART B: Beau Davis Electric via GET /billcom/payments proxy. One payment
 *   or two? Plus portfolio-wide count of bill.com payments whose invoice
 *   has a same-amount rippling_spend row within 5 days.
 *
 * PART C: Raw payload dump for the four flagged rows. Does BEAU DAVIS memo
 *   reference the oven job? Systemic impact of the spend_transaction.id vs
 *   rippling_id join mismatch.
 *
 * CHANGE NOTHING. No writes, GET only against bill.com, report only.
 *
 * Env consumed via process.env only (never read .env* into script output):
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (Supabase)
 *   BILLCOM_PROXY_BASE, BILLCOM_PROXY_KEY   (bill.com proxy)
 */

import ExcelJS from "exceljs";
import path from "node:path";
import os from "node:os";
import { createClient } from "@supabase/supabase-js";

// ─── env preflight (PRESENT / ABSENT only) ──────────────────────────
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BC_BASE = process.env.BILLCOM_PROXY_BASE;
const BC_KEY  = process.env.BILLCOM_PROXY_KEY;

console.log("=== env preflight (PRESENT / ABSENT) ===");
console.log(`SUPABASE_URL:              ${SB_URL  ? "PRESENT" : "ABSENT"}`);
console.log(`SUPABASE_SERVICE_ROLE_KEY: ${SB_KEY  ? "PRESENT" : "ABSENT"}`);
console.log(`BILLCOM_PROXY_BASE:        ${BC_BASE ? "PRESENT" : "ABSENT"}`);
console.log(`BILLCOM_PROXY_KEY:         ${BC_KEY  ? "PRESENT" : "ABSENT"}`);

if (!SB_URL || !SB_KEY) {
  console.error("BLOCKED: Supabase env not present. Cannot execute Parts A + C.");
  process.exit(2);
}

const supa = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

const FYTD_START = "2025-12-29";
const WINDOW_DAYS = 5;
const today = new Date().toISOString().slice(0, 10);
const OUT_PATH = path.join(os.homedir(), "Downloads", `inv_p12_truncation_gap_${today}.xlsx`);

const BEAU_DAVIS_VENDOR_ID = "00901YILIZSZTJ3i1i5u";

// ─── helpers ────────────────────────────────────────────────────────
function money(n) { return Number(n || 0).toFixed(2); }
function daysBetween(a, b) {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round(Math.abs(db - da) / 86400000);
}

async function paginate(sel, cols, extras = (q) => q, pageSize = 1000) {
  const rows = [];
  let from = 0;
  for (;;) {
    let q = supa.from(sel).select(cols).range(from, from + pageSize - 1);
    q = extras(q);
    const { data, error } = await q;
    if (error) throw new Error(`${sel} fetch failed: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════════════
// PART A: truncation gap in Ruling 4
// ═══════════════════════════════════════════════════════════════════
async function partA() {
  console.log("\n════════ PART A: truncation gap in Ruling 4 ════════");

  // Load non-excluded rippling_spend rows in purchasing_actuals FYTD.
  // Ruling 4 keys on merchant string + amount to cent + 5-day window +
  // same account (the code effectively groups on merchant + amount at
  // the parent level; account emerges via the account_key on each line,
  // but pairs are formed pre-account. INV-P12 spec: match by same
  // account, so we filter by account_key.
  console.log("loading purchasing_actuals (source=rippling_spend, excluded=false, FYTD)...");
  const actuals = await paginate(
    "purchasing_actuals",
    "id, source, source_line_id, account_key, excluded, gl_line_code, gl_bucket, txn_date, amount, vendor_or_merchant",
    (q) => q.eq("source", "rippling_spend").eq("excluded", false).gte("txn_date", FYTD_START).order("txn_date", { ascending: true }).order("id", { ascending: true }),
  );
  console.log(`  non-excluded rippling_spend rows: ${actuals.length}`);

  // Aggregate to PARENT level. Ruling 4 works parent-level (see
  // scripts/_build_auth_pair_exclusions_workbook.mjs). Each parent =
  // one Rippling spend_transaction that fans out to lines. The pair
  // rule is on the parent's merchant+amount. Load raw lines to get
  // parent_txn_id + merchant_name.
  console.log("loading rippling_raw_spend_lines_latest (for parent + merchant)...");
  const rawLines = await paginate(
    "rippling_raw_spend_lines_latest",
    "rippling_id, external_id, amount, currency, department_label, work_location_label, merchant_name, parent_txn_id",
  );
  console.log(`  raw lines: ${rawLines.length}`);

  const rawByRid = new Map();
  for (const r of rawLines) rawByRid.set(r.rippling_id, r);

  // Build parent-level aggregation. rippling_spend source_line_id is
  // "rippling_spend:<rippling_id>". Use raw parent_txn_id as the parent
  // key.
  const parentAgg = new Map();
  for (const a of actuals) {
    if (!a.source_line_id?.startsWith("rippling_spend:")) continue;
    const rid = a.source_line_id.slice("rippling_spend:".length);
    const raw = rawByRid.get(rid);
    if (!raw?.parent_txn_id) continue;
    const parent = raw.parent_txn_id;
    if (!parentAgg.has(parent)) {
      parentAgg.set(parent, {
        parent,
        merchant: raw.merchant_name || a.vendor_or_merchant || "",
        cents: 0,
        txn_date: a.txn_date,
        account_key: a.account_key,
        work_location: raw.work_location_label || "",
        department: raw.department_label || "",
        anyNonUSD: false,
        lines: 0,
      });
    }
    const p = parentAgg.get(parent);
    const ccy = String(raw.currency || "").toUpperCase();
    if (ccy && ccy !== "USD") p.anyNonUSD = true;
    else p.cents += Math.round(Number(a.amount || 0) * 100);
    p.lines++;
    // Keep earliest txn_date at parent level (stable with the derive)
    if (a.txn_date && (!p.txn_date || a.txn_date < p.txn_date)) p.txn_date = a.txn_date;
    // account_key can vary across lines; keep first non-null
    if (!p.account_key && a.account_key) p.account_key = a.account_key;
  }
  const parents = [...parentAgg.values()].filter(
    (p) => !p.anyNonUSD && p.cents !== 0 && p.merchant && p.txn_date && p.account_key,
  );
  console.log(`  parents (non-excluded, USD, non-zero, has merchant+date+account): ${parents.length}`);

  // ─── A1: merchant-string length distribution ────────────────────
  console.log("\n─── A1: merchant-string length distribution (parent level) ───");
  const lenDist = new Map();
  for (const p of parents) {
    const L = p.merchant.length;
    lenDist.set(L, (lenDist.get(L) || 0) + 1);
  }
  const sortedLen = [...lenDist.entries()].sort((a, b) => a[0] - b[0]);
  const totalParents = parents.length;
  const top = [...lenDist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log("  top 10 lengths by count:");
  for (const [L, n] of top) {
    const pct = ((n / totalParents) * 100).toFixed(1);
    console.log(`    len=${String(L).padStart(3)}  parents=${String(n).padStart(5)}  ${pct}%`);
  }
  // Truncation spike detection: does any length in 18-25 range have >5x
  // the count of its neighbours? Report the plain distribution.
  console.log("\n  full distribution (all lengths):");
  for (const [L, n] of sortedLen) {
    const bar = "#".repeat(Math.min(60, Math.round(n / (top[0][1] / 60))));
    console.log(`    len=${String(L).padStart(3)}  n=${String(n).padStart(5)}  ${bar}`);
  }

  // Find truncation spike candidates: any length with >= 4x the median
  // count of the surrounding 5-length window.
  const lens = sortedLen.map(([L]) => L);
  const medianAround = (target) => {
    const window = sortedLen
      .filter(([L]) => L >= target - 3 && L <= target + 3 && L !== target)
      .map(([, n]) => n)
      .sort((a, b) => a - b);
    if (!window.length) return 0;
    return window[Math.floor(window.length / 2)];
  };
  const spikes = [];
  for (const [L, n] of sortedLen) {
    const med = medianAround(L);
    if (med > 0 && n >= med * 4) spikes.push({ L, n, median: med, ratio: n / med });
  }
  console.log("\n  spike candidates (count >= 4x median of neighbour window):");
  if (!spikes.length) console.log("    NONE - no truncation spike detected");
  else {
    for (const s of spikes) {
      console.log(`    len=${s.L}  parents=${s.n}  neighbour-median=${s.median}  ratio=${s.ratio.toFixed(1)}x`);
    }
  }

  // ─── A1 continued: prefix pairs ─────────────────────────────────
  console.log("\n─── A1: strict-prefix pair analysis ───");
  const distinctMerchants = new Set();
  for (const p of parents) distinctMerchants.add(p.merchant);
  const merchantList = [...distinctMerchants];
  console.log(`  distinct merchant strings: ${merchantList.length}`);

  // For each pair (m_short, m_long) where m_short is a strict prefix of
  // m_long, both distinct, min len >= 8 (avoid trivial prefixes like
  // "IN" being a prefix of everything).
  const MIN_PREFIX_LEN = 8;
  const byShort = new Map();  // short -> [long, ...]
  merchantList.sort();
  for (let i = 0; i < merchantList.length; i++) {
    const a = merchantList[i];
    if (a.length < MIN_PREFIX_LEN) continue;
    for (let j = 0; j < merchantList.length; j++) {
      if (i === j) continue;
      const b = merchantList[j];
      if (b.length <= a.length) continue;
      if (b.startsWith(a)) {
        if (!byShort.has(a)) byShort.set(a, []);
        byShort.get(a).push(b);
      }
    }
  }
  console.log(`  distinct short strings that are a strict prefix of at least one longer: ${byShort.size}`);

  // Per-group transaction + dollar counts (aggregate over parent list).
  const parentsByMerchant = new Map();
  for (const p of parents) {
    if (!parentsByMerchant.has(p.merchant)) parentsByMerchant.set(p.merchant, []);
    parentsByMerchant.get(p.merchant).push(p);
  }
  const prefixGroups = [];
  for (const [shortStr, longStrs] of byShort) {
    const shortParents = parentsByMerchant.get(shortStr) || [];
    let longParents = [];
    for (const L of longStrs) {
      longParents = longParents.concat(parentsByMerchant.get(L) || []);
    }
    if (!shortParents.length && !longParents.length) continue;
    const shortDollars = shortParents.reduce((s, p) => s + p.cents / 100, 0);
    const longDollars = longParents.reduce((s, p) => s + p.cents / 100, 0);
    const accounts = new Set();
    for (const p of [...shortParents, ...longParents]) if (p.account_key) accounts.add(p.account_key);
    prefixGroups.push({
      shortStr, shortLen: shortStr.length,
      longStrs, nLongs: longStrs.length,
      shortParents: shortParents.length, longParents: longParents.length,
      shortDollars, longDollars,
      accounts: [...accounts],
    });
  }
  prefixGroups.sort((a, b) => (b.shortDollars + b.longDollars) - (a.shortDollars + a.longDollars));
  console.log(`  prefix groups (top 15 by combined dollars):`);
  for (const g of prefixGroups.slice(0, 15)) {
    const combinedDollars = g.shortDollars + g.longDollars;
    const combinedTxns = g.shortParents + g.longParents;
    console.log(
      `    "${g.shortStr}" (len=${g.shortLen})  short-txns=${g.shortParents}  long-txns=${g.longParents}  ` +
      `combined=${combinedTxns}  $${combinedDollars.toFixed(2)}  n-long-variants=${g.nLongs}  accounts=${g.accounts.length}`
    );
  }

  // ─── A2: truncation-blind re-run + baseline exact-match ─────────
  console.log("\n─── A2: truncation-blind re-run vs baseline exact-match ───");

  // Baseline: same-merchant (exact) + same account + same amount + within 5 days.
  // Uses parent-level, the same slice Ruling 4 works on.
  function pairsExact(parents) {
    const byKey = new Map();
    for (const p of parents) {
      const key = JSON.stringify([p.account_key, p.merchant, p.cents]);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(p);
    }
    const pairs = [];
    for (const arr of byKey.values()) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => (a.txn_date < b.txn_date ? -1 : 1));
      for (let i = 0; i < arr.length - 1; i++) {
        const a = arr[i], b = arr[i + 1];
        const d = daysBetween(a.txn_date, b.txn_date);
        if (d <= WINDOW_DAYS) pairs.push({ a, b, days: d, mode: "exact" });
      }
    }
    return pairs;
  }

  // Prefix-tolerant: same account + same amount to cent + within 5 days
  // + merchant strings share a prefix relationship (one is a strict
  // prefix of the other, min shared prefix length >= MIN_PREFIX_LEN, or
  // strings identical).
  function pairsPrefixTolerant(parents) {
    // Group by (account, cents). Then within group, form all pairs and
    // filter on prefix relationship + window.
    const byGroup = new Map();
    for (const p of parents) {
      const key = JSON.stringify([p.account_key, p.cents]);
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(p);
    }
    const pairs = [];
    for (const arr of byGroup.values()) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => (a.txn_date < b.txn_date ? -1 : 1));
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i], b = arr[j];
          const d = daysBetween(a.txn_date, b.txn_date);
          if (d > WINDOW_DAYS) continue;
          const [shorter, longer] = a.merchant.length <= b.merchant.length ? [a.merchant, b.merchant] : [b.merchant, a.merchant];
          let related = false, mode = null;
          if (a.merchant === b.merchant) { related = true; mode = "exact"; }
          else if (shorter.length >= MIN_PREFIX_LEN && longer.startsWith(shorter)) { related = true; mode = "prefix"; }
          if (related) pairs.push({ a, b, days: d, mode });
        }
      }
    }
    return pairs;
  }

  function pairsUnrelatedControl(parents) {
    // Same (account, amount, 5-day window) but merchants have NO prefix
    // relationship. This is the false-positive baseline.
    const byGroup = new Map();
    for (const p of parents) {
      const key = JSON.stringify([p.account_key, p.cents]);
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key).push(p);
    }
    const pairs = [];
    for (const arr of byGroup.values()) {
      if (arr.length < 2) continue;
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i], b = arr[j];
          const d = daysBetween(a.txn_date, b.txn_date);
          if (d > WINDOW_DAYS) continue;
          if (a.merchant === b.merchant) continue;   // exact - not "unrelated"
          const [shorter, longer] = a.merchant.length <= b.merchant.length ? [a.merchant, b.merchant] : [b.merchant, a.merchant];
          const isPrefix = shorter.length >= MIN_PREFIX_LEN && longer.startsWith(shorter);
          if (isPrefix) continue;   // prefix - captured by tolerant rule
          pairs.push({ a, b, days: d, mode: "unrelated" });
        }
      }
    }
    return pairs;
  }

  const exactPairs = pairsExact(parents);
  const tolerantPairs = pairsPrefixTolerant(parents);
  const unrelatedPairs = pairsUnrelatedControl(parents);

  // additional-catch = tolerant \ exact  (identified by parent pair set)
  const exactKey = (p) => `${p.a.parent}||${p.b.parent}`;
  const exactSet = new Set(exactPairs.map(exactKey));
  const additional = tolerantPairs.filter((p) => !exactSet.has(exactKey(p)));

  // Recurrence filter: per (merchant NORMALIZED to shortest common prefix,
  // amount) - count all parents with same amount + prefix-related merchant.
  // For simpler comparability with INV-P11, use (merchant_raw, amount) at
  // the parent level to count recurrence.
  const recurrence = new Map();
  for (const p of parents) {
    const key = `${p.merchant}||${p.cents}`;
    recurrence.set(key, (recurrence.get(key) || 0) + 1);
  }
  function recurrenceOf(pair) {
    const kA = `${pair.a.merchant}||${pair.a.cents}`;
    const kB = `${pair.b.merchant}||${pair.b.cents}`;
    return Math.max(recurrence.get(kA) || 0, recurrence.get(kB) || 0);
  }
  const additionalAfterRecurrence = additional.filter((p) => recurrenceOf(p) <= 2);
  const additionalRecurring = additional.filter((p) => recurrenceOf(p) > 2);

  const dollars = (arr) => arr.reduce((s, p) => s + p.a.cents / 100, 0);

  console.log("\n  BASELINE - exact-match (what Ruling 4 catches today):");
  console.log(`    parent pairs: ${exactPairs.length}   dollars(one-side): $${dollars(exactPairs).toFixed(2)}`);

  console.log("\n  TRUNCATION-BLIND (exact OR strict-prefix):");
  console.log(`    parent pairs: ${tolerantPairs.length}   dollars(one-side): $${dollars(tolerantPairs).toFixed(2)}`);

  console.log("\n  ADDITIONAL CATCH (tolerant \\ exact):");
  console.log(`    parent pairs: ${additional.length}   dollars(one-side): $${dollars(additional).toFixed(2)}`);
  console.log(`    after recurrence filter (recurrenceMax <= 2): ${additionalAfterRecurrence.length}   dollars: $${dollars(additionalAfterRecurrence).toFixed(2)}`);
  console.log(`    recurring (recurrenceMax > 2, likely contract): ${additionalRecurring.length}   dollars: $${dollars(additionalRecurring).toFixed(2)}`);

  console.log("\n  CONTROL - unrelated merchants (same account, amount, window):");
  console.log(`    parent pairs: ${unrelatedPairs.length}   dollars(one-side): $${dollars(unrelatedPairs).toFixed(2)}`);

  // ─── A3: control rate side by side with prefix rate ─────────────
  // "Rate" = pairs per parent-day. To be comparable: compute pairs
  // per (account, amount) group where at least 2 parents landed.
  // Prefix-only pairs = tolerantPairs - exactPairs. Unrelated pairs
  // in same slice = unrelatedPairs.
  console.log("\n─── A3: control vs prefix rate (false-positive control) ───");
  const prefixOnly = additional;  // tolerant minus exact = prefix-only
  console.log(`  prefix-only pairs (window/account/amount match, prefix-related merchant): ${prefixOnly.length}`);
  console.log(`  unrelated pairs (same window/account/amount, unrelated merchant):          ${unrelatedPairs.length}`);
  console.log("\n  How to read:");
  console.log("    If prefix >> unrelated -> the truncation signal is real, prefix-related");
  console.log("      pairs are systematically more common than random coincidences at the same slice.");
  console.log("    If prefix ~ unrelated  -> noise. Prefix-relatedness carries no signal above random.");

  // Four-tier breakdown per INV-P11 shape, applied to additional-catch
  const tierBucket = { identical: [], prefix: [], similar: [], unrelated: [] };
  for (const p of additionalAfterRecurrence) tierBucket.prefix.push(p);
  // (identical is exactPairs; not in additional. Similar not used - spec says do not do fuzzy.)
  console.log("\n  Four-tier breakdown of the ADDITIONAL CATCH (recurrence-filtered):");
  console.log(`    identical: 0 (already in baseline exact-match)`);
  console.log(`    prefix:    ${tierBucket.prefix.length}   dollars=$${dollars(tierBucket.prefix).toFixed(2)}`);
  console.log(`    similar:   0 (spec: no fuzzy)`);
  console.log(`    unrelated: n/a (control - not for catch)`);

  return {
    actuals, rawByRid, parentAgg, parents,
    lenDist: sortedLen, spikes,
    prefixGroups,
    exactPairs, tolerantPairs, additional, additionalAfterRecurrence, additionalRecurring,
    unrelatedPairs,
  };
}

// ═══════════════════════════════════════════════════════════════════
// PART B: Beau Davis via /billcom/payments proxy
// ═══════════════════════════════════════════════════════════════════
async function partB() {
  console.log("\n════════ PART B: Beau Davis via /billcom/payments proxy ════════");

  if (!BC_BASE || !BC_KEY) {
    console.log("  BLOCKED: BILLCOM_PROXY_BASE / BILLCOM_PROXY_KEY not in process.env.");
    console.log("  Not working around. Reporting block.");
    return { blocked: true };
  }

  const base = String(BC_BASE).replace(/\/+$/, "");
  const headers = {
    "X-API-Key": BC_KEY,
    "Accept": "application/json",
    "User-Agent": "kitchfix-intranet/inv-p12",
  };

  async function fetchJson(url) {
    // GET only. No writes.
    const r = await fetch(url, { headers });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* keep body null */ }
    return { ok: r.ok, status: r.status, body, raw: text.slice(0, 500) };
  }

  // Envelope: per spec, GET only, nextPage cursor. Try both v2 and v3
  // extraction. First probe endpoint shape.
  console.log(`  proxy base: ${base}`);
  console.log("  probing GET /payments (first page)...");
  let firstUrl = `${base}/payments?max=100`;
  let first = await fetchJson(firstUrl);
  console.log(`    status=${first.status}`);
  if (!first.ok) {
    console.log(`    body preview: ${first.raw}`);
    console.log("  BLOCKED: /payments proxy call failed. Reporting block.");
    return { blocked: true, status: first.status, raw: first.raw };
  }

  // Extract rows. Try both v2 and v3 shapes.
  function extractRows(body) {
    if (Array.isArray(body?.results)) return body.results;
    if (Array.isArray(body?.response_data)) return body.response_data;
    if (Array.isArray(body?.data)) return body.data;
    if (Array.isArray(body)) return body;
    return [];
  }
  function nextCursor(body) {
    return body?.nextPage || body?.next_page || body?.pagination?.nextPage || null;
  }

  const rows = extractRows(first.body);
  console.log(`    first page rows: ${rows.length}`);
  if (rows.length) {
    console.log(`    first row keys: ${Object.keys(rows[0]).slice(0, 20).join(", ")}`);
  }

  // Walk all pages
  const allPayments = [...rows];
  let cursor = nextCursor(first.body);
  let pageNum = 1;
  while (cursor) {
    pageNum++;
    const u = `${base}/payments?max=100&page=${encodeURIComponent(cursor)}`;
    const r = await fetchJson(u);
    if (!r.ok) {
      console.log(`    page ${pageNum} FAILED status=${r.status}`);
      break;
    }
    const batch = extractRows(r.body);
    allPayments.push(...batch);
    cursor = nextCursor(r.body);
    if (batch.length === 0) break;
    if (pageNum > 500) { console.log("    safety cap 500 pages"); break; }
  }
  console.log(`  total payments fetched: ${allPayments.length} across ${pageNum} pages`);

  // Filter: Beau Davis Electric FY2026
  const beauPayments = allPayments.filter((p) => {
    // vendor_id lives at different keys across bill.com shapes:
    const vid = p.vendorId || p.vendor_id || p.vendor?.id || p.payeeId || null;
    return vid === BEAU_DAVIS_VENDOR_ID;
  });
  console.log(`  Beau Davis payments (all-time on proxy): ${beauPayments.length}`);
  for (const p of beauPayments) {
    console.log(`    id=${p.id || p.paymentId || "?"}  amount=${p.amount}  date=${p.paymentDate || p.processDate || p.updatedTime || "?"}  status=${p.status || p.paymentStatus}  invoice=${p.invoiceId || p.billId || p.invoice_id || (p.invoices?.map?.((i)=>i.billId||i.id).join(","))}`);
  }

  // Also check whole payment set for "invoice has a same-amount
  // rippling_spend row within 5 days". Load rippling_spend actuals
  // side (excluded=false, FYTD) then match each payment to a bill
  // via invoiceId + amount + date. We already have actuals from Part
  // A - reload here to keep partB independent-ish; safe because it's
  // just a Supabase read.
  console.log("\n  portfolio-wide: payments whose invoice has same-amount rippling_spend within 5 days");
  console.log("  loading rippling_spend actuals for cross-match...");
  const rippActuals = await paginate(
    "purchasing_actuals",
    "amount, txn_date, account_key, vendor_or_merchant",
    (q) => q.eq("source", "rippling_spend").eq("excluded", false).gte("txn_date", FYTD_START),
  );
  console.log(`    rippling_spend rows: ${rippActuals.length}`);

  // Index rippling by (amount_cents) -> [{ txn_date, account_key }]
  const rippByCents = new Map();
  for (const r of rippActuals) {
    const c = Math.round(Number(r.amount || 0) * 100);
    if (!rippByCents.has(c)) rippByCents.set(c, []);
    rippByCents.get(c).push({ txn_date: r.txn_date, account_key: r.account_key });
  }

  // For each payment, find date + amount. Cross-match on cents + 5 days.
  let paymentsWithRipplingMatch = 0;
  for (const p of allPayments) {
    const amt = Number(p.amount || 0);
    if (!Number.isFinite(amt) || amt === 0) continue;
    const cents = Math.round(amt * 100);
    const bucket = rippByCents.get(cents);
    if (!bucket) continue;
    const payDate = p.paymentDate || p.processDate || p.updatedTime || p.createdTime;
    if (!payDate) continue;
    const pd = String(payDate).slice(0, 10);
    const withinWindow = bucket.some((r) => {
      if (!r.txn_date) return false;
      return daysBetween(pd, r.txn_date) <= WINDOW_DAYS;
    });
    if (withinWindow) paymentsWithRipplingMatch++;
  }
  console.log(`  payments whose amount has a rippling_spend row within 5 days: ${paymentsWithRipplingMatch} of ${allPayments.length}`);

  return { allPayments, beauPayments, paymentsWithRipplingMatch };
}

// ═══════════════════════════════════════════════════════════════════
// PART C: raw payloads + join mismatch
// ═══════════════════════════════════════════════════════════════════
async function partC() {
  console.log("\n════════ PART C: four flagged payloads + join mismatch ════════");

  // Kevin's four flagged rows (per INV-P11):
  //   - Beau Davis pair: TBR - FL, $6,600.00, near 2025-12-27..2026-01-05
  //     (one billcom, one rippling_spend, per INV-P11 spec)
  //   - IN SOUTHWEST pair: CIN - AZ, $1,968.22, 2026-01-20 + 2026-01-21
  //     (two rippling_spend rows)
  console.log("locating four flagged rows in purchasing_actuals...");
  const { data: flagged, error } = await supa
    .from("purchasing_actuals")
    .select("id, source, source_bill_id, source_line_id, account_key, excluded, gl_line_code, gl_bucket, txn_date, posting_date, amount, vendor_or_merchant, paid, approx_date, derived_at")
    .or(
      "and(account_key.eq.TBR - FL,amount.eq.6600.00,txn_date.gte.2025-12-27,txn_date.lte.2026-01-05)," +
      "and(account_key.eq.CIN - AZ,amount.eq.1968.22,txn_date.gte.2026-01-18,txn_date.lte.2026-01-24)"
    );
  if (error) throw new Error(`flagged rows fetch failed: ${error.message}`);
  console.log(`  flagged rows found: ${flagged.length}`);

  // For each flagged row, dump full raw payload.
  const results = [];
  for (const r of flagged) {
    console.log(`\n─── FLAGGED ROW ──`);
    console.log(`  id=${r.id}  source=${r.source}  account=${r.account_key}  txn_date=${r.txn_date}  amount=$${money(r.amount)}`);
    console.log(`  source_bill_id=${r.source_bill_id}  source_line_id=${r.source_line_id}`);
    console.log(`  gl_line_code=${r.gl_line_code}  gl_bucket=${r.gl_bucket}  excluded=${r.excluded}  paid=${r.paid}`);
    console.log(`  vendor_or_merchant=${r.vendor_or_merchant}  derived_at=${r.derived_at}`);
    const entry = { fact: r, rawBill: null, rawLine: null, rawSpend: null };

    if (r.source === "billcom") {
      // Load bill header + specific line via source_bill_id + source_line_id
      const billId = r.source_bill_id;
      const lineId = r.source_line_id?.startsWith("billcom:") ? r.source_line_id.slice("billcom:".length) : null;

      const [{ data: bills, error: eB }, { data: lines, error: eL }] = await Promise.all([
        supa.from("billcom_raw_bills_latest").select("*").eq("bill_id", billId).limit(1),
        supa.from("billcom_raw_bill_lines_latest").select("*").eq("bill_id", billId),
      ]);
      if (eB) throw new Error(`billcom bill fetch: ${eB.message}`);
      if (eL) throw new Error(`billcom lines fetch: ${eL.message}`);
      entry.rawBill = bills?.[0] || null;
      entry.rawLine = lines?.find((l) => l.line_id === lineId) || null;
      console.log(`\n  ── BILL HEADER (billcom_raw_bills_latest) ──`);
      if (entry.rawBill) {
        for (const k of Object.keys(entry.rawBill)) {
          if (k === "raw") continue;
          console.log(`    ${k.padEnd(20)}: ${JSON.stringify(entry.rawBill[k])}`);
        }
        console.log(`\n  ── BILL RAW JSONB ──`);
        console.log("    " + JSON.stringify(entry.rawBill.raw, null, 2).replace(/\n/g, "\n    "));
      } else console.log("    (bill not found)");

      console.log(`\n  ── BILL LINE (matching source_line_id) ──`);
      if (entry.rawLine) {
        for (const k of Object.keys(entry.rawLine)) {
          if (k === "raw") continue;
          console.log(`    ${k.padEnd(20)}: ${JSON.stringify(entry.rawLine[k])}`);
        }
        console.log(`\n  ── LINE RAW JSONB ──`);
        console.log("    " + JSON.stringify(entry.rawLine.raw, null, 2).replace(/\n/g, "\n    "));
      } else console.log("    (line not found)");
    } else if (r.source === "rippling_spend") {
      const rid = r.source_line_id?.startsWith("rippling_spend:") ? r.source_line_id.slice("rippling_spend:".length) : null;
      const { data, error: eR } = await supa
        .from("rippling_raw_spend_lines_latest")
        .select("*")
        .eq("rippling_id", rid)
        .limit(1);
      if (eR) throw new Error(`rippling raw fetch: ${eR.message}`);
      entry.rawSpend = data?.[0] || null;
      console.log(`\n  ── RIPPLING RAW LINE (rippling_raw_spend_lines_latest) ──`);
      if (entry.rawSpend) {
        for (const k of Object.keys(entry.rawSpend)) {
          if (k === "raw") continue;
          console.log(`    ${k.padEnd(20)}: ${JSON.stringify(entry.rawSpend[k])}`);
        }
        console.log(`\n  ── RIPPLING RAW JSONB ──`);
        console.log("    " + JSON.stringify(entry.rawSpend.raw, null, 2).replace(/\n/g, "\n    "));
      } else console.log("    (rippling raw not found)");
    }

    results.push(entry);
  }

  // ─── join mismatch systemic impact ─────────────────────────────
  console.log("\n─── join mismatch: spend_transaction.id vs rippling_id ───");
  console.log("Definition:");
  console.log("  - purchasing_actuals.source_line_id for rippling_spend = 'rippling_spend:<rippling_id>'");
  console.log("    where <rippling_id> is the SPEND LINE ID (spend_transaction_line_item_zo.id)");
  console.log("  - rippling_raw_spend_lines.rippling_id = same SPEND LINE ID");
  console.log("  - raw.spend_transaction.id = the PARENT TRANSACTION ID (spend_transaction_zo.id)");
  console.log("");
  console.log("Failure shape: any join that keys on raw.spend_transaction.id but");
  console.log("expects rippling_id (or vice-versa) silently returns nothing because");
  console.log("the two ID spaces are disjoint - one is a line id, the other a parent id.");

  // Measure: distinct parent vs distinct line counts + any overlap.
  console.log("\nMeasuring rippling_raw_spend_lines_latest:");
  const { count: nLines } = await supa
    .from("rippling_raw_spend_lines_latest")
    .select("*", { count: "exact", head: true });
  console.log(`  total rippling_id (line) count: ${nLines}`);

  // Distinct parent_txn_id count via a page walk
  const allParentIds = new Set();
  const allLineIds  = new Set();
  {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      const { data, error } = await supa
        .from("rippling_raw_spend_lines_latest")
        .select("rippling_id, parent_txn_id, raw")
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`raw walk: ${error.message}`);
      if (!data || data.length === 0) break;
      for (const r of data) {
        allLineIds.add(r.rippling_id);
        if (r.parent_txn_id) allParentIds.add(r.parent_txn_id);
      }
      if (data.length < PAGE) break;
      from += PAGE;
    }
  }
  console.log(`  distinct line ids (rippling_id):        ${allLineIds.size}`);
  console.log(`  distinct parent ids (parent_txn_id):    ${allParentIds.size}`);

  // Overlap: is there any rippling_id (line) that equals some parent_txn_id?
  let overlap = 0;
  for (const pid of allParentIds) if (allLineIds.has(pid)) overlap++;
  console.log(`  overlap (id present as both line AND parent): ${overlap}`);
  console.log(`  interpretation: overlap == 0 means the two id spaces are disjoint,`);
  console.log(`  so any join keyed on the wrong field returns nothing - silent.`);

  // Report: any code in this repo joining on the wrong field?
  console.log("\nSearches to verify this failure mode elsewhere (not executed here - grep-only guidance):");
  console.log("  - grep for `.eq('rippling_id',` where the RHS comes from raw.spend_transaction.id");
  console.log("  - grep for `parent_txn_id` used as a rippling_raw_spend_lines join key");
  console.log("  - See scripts/probes/_inv_p8b_recon.mjs / _probe_rippling_spend_payload.mjs for prior treatment");

  return { results, nLines, nParents: allParentIds.size, overlap };
}

// ═══════════════════════════════════════════════════════════════════
// Workbook
// ═══════════════════════════════════════════════════════════════════
async function writeWorkbook(A, B, C) {
  console.log(`\n=== writing workbook: ${OUT_PATH} ===`);
  const wb = new ExcelJS.Workbook();

  // Sheet: Read me
  const readme = wb.addWorksheet("Read me");
  readme.columns = [{ header: "note", key: "note", width: 120 }];
  const notes = [
    `INV-P12 read-only investigation, generated ${today}.`,
    `Part A: Ruling 4 truncation gap analysis. FYTD start ${FYTD_START}. 5-day window.`,
    `Non-excluded rippling_spend parents: ${A.parents.length}`,
    `Baseline exact-match pairs (parent level, same account+amount+merchant+window): ${A.exactPairs.length}`,
    `Truncation-blind (exact OR strict-prefix, min 8 char shared): ${A.tolerantPairs.length}`,
    `Additional catch beyond baseline: ${A.additional.length} pairs`,
    `Additional catch after recurrence filter (recurrenceMax <= 2): ${A.additionalAfterRecurrence.length}`,
    `Control (same slice, unrelated merchant strings): ${A.unrelatedPairs.length}`,
    `Read: if prefix-only >> unrelated, the truncation signal is real. Otherwise noise.`,
    ``,
    `Part B: Beau Davis + payments cross-match. Blocked=${B?.blocked ? "YES" : "NO"}`,
    `Beau Davis payments count: ${B?.beauPayments?.length ?? "n/a"}`,
    `Portfolio payments with same-amount rippling_spend within 5 days: ${B?.paymentsWithRipplingMatch ?? "n/a"}`,
    ``,
    `Part C: four flagged raw payloads dumped in terminal. Join-mismatch measurement:`,
    `  distinct rippling_id (line) count: ${C.nLines}`,
    `  distinct parent_txn_id count:      ${C.nParents}`,
    `  overlap (id in both spaces):       ${C.overlap}`,
  ];
  for (const n of notes) readme.addRow({ note: n });

  // Sheet: A - length distribution
  const shLen = wb.addWorksheet("A - length dist");
  shLen.columns = [
    { header: "merchant_length", key: "L", width: 18 },
    { header: "parent_count", key: "n", width: 15 },
  ];
  for (const [L, n] of A.lenDist) shLen.addRow({ L, n });

  // Sheet: A - prefix groups
  const shPref = wb.addWorksheet("A - prefix groups");
  shPref.columns = [
    { header: "short_merchant", key: "shortStr", width: 40 },
    { header: "short_len", key: "shortLen", width: 12 },
    { header: "n_long_variants", key: "nLongs", width: 16 },
    { header: "short_parents", key: "shortParents", width: 15 },
    { header: "long_parents", key: "longParents", width: 15 },
    { header: "short_dollars", key: "shortDollars", width: 15, style: { numFmt: '"$"#,##0.00' } },
    { header: "long_dollars", key: "longDollars", width: 15, style: { numFmt: '"$"#,##0.00' } },
    { header: "combined_dollars", key: "combined", width: 17, style: { numFmt: '"$"#,##0.00' } },
    { header: "accounts", key: "accounts", width: 30 },
  ];
  for (const g of A.prefixGroups) {
    shPref.addRow({
      ...g,
      combined: g.shortDollars + g.longDollars,
      accounts: g.accounts.join(","),
    });
  }

  // Sheet: A - additional catch (prefix-only pairs, after recurrence)
  const shAdd = wb.addWorksheet("A - additional catch");
  shAdd.columns = [
    { header: "days_apart", key: "days", width: 10 },
    { header: "account_key", key: "account", width: 14 },
    { header: "amount", key: "amount", width: 12, style: { numFmt: '"$"#,##0.00' } },
    { header: "A_merchant", key: "am", width: 32 },
    { header: "A_parent", key: "ap", width: 26 },
    { header: "A_txn_date", key: "ad", width: 12 },
    { header: "A_len", key: "al", width: 8 },
    { header: "B_merchant", key: "bm", width: 32 },
    { header: "B_parent", key: "bp", width: 26 },
    { header: "B_txn_date", key: "bd", width: 12 },
    { header: "B_len", key: "bl", width: 8 },
    { header: "mode", key: "mode", width: 10 },
  ];
  for (const p of A.additionalAfterRecurrence) {
    shAdd.addRow({
      days: p.days, account: p.a.account_key, amount: p.a.cents / 100,
      am: p.a.merchant, ap: p.a.parent, ad: p.a.txn_date, al: p.a.merchant.length,
      bm: p.b.merchant, bp: p.b.parent, bd: p.b.txn_date, bl: p.b.merchant.length,
      mode: p.mode,
    });
  }

  // Sheet: A - control (unrelated)
  const shCtrl = wb.addWorksheet("A - control unrelated");
  shCtrl.columns = shAdd.columns;
  for (const p of A.unrelatedPairs.slice(0, 500)) {
    shCtrl.addRow({
      days: p.days, account: p.a.account_key, amount: p.a.cents / 100,
      am: p.a.merchant, ap: p.a.parent, ad: p.a.txn_date, al: p.a.merchant.length,
      bm: p.b.merchant, bp: p.b.parent, bd: p.b.txn_date, bl: p.b.merchant.length,
      mode: p.mode,
    });
  }

  // Sheet: A - recurring additional (excluded from strong)
  const shRecur = wb.addWorksheet("A - additional recurring");
  shRecur.columns = shAdd.columns;
  for (const p of A.additionalRecurring) {
    shRecur.addRow({
      days: p.days, account: p.a.account_key, amount: p.a.cents / 100,
      am: p.a.merchant, ap: p.a.parent, ad: p.a.txn_date, al: p.a.merchant.length,
      bm: p.b.merchant, bp: p.b.parent, bd: p.b.txn_date, bl: p.b.merchant.length,
      mode: p.mode,
    });
  }

  await wb.xlsx.writeFile(OUT_PATH);
  console.log(`  workbook written: ${OUT_PATH}`);
}

// ═══════════════════════════════════════════════════════════════════
// main
// ═══════════════════════════════════════════════════════════════════
(async () => {
  const A = await partA();
  const B = await partB();
  const C = await partC();
  await writeWorkbook(A, B, C);

  console.log("\n════════ FINAL SUMMARY ════════");
  console.log(`PART A:`);
  console.log(`  non-excluded rippling_spend parents:        ${A.parents.length}`);
  console.log(`  baseline (exact-match) pairs:               ${A.exactPairs.length}`);
  console.log(`  truncation-blind (exact + prefix) pairs:    ${A.tolerantPairs.length}`);
  console.log(`  additional catch (prefix-only):             ${A.additional.length}`);
  console.log(`  additional after recurrence filter:         ${A.additionalAfterRecurrence.length}`);
  console.log(`  control (unrelated names, same slice):      ${A.unrelatedPairs.length}`);
  const addD = A.additionalAfterRecurrence.reduce((s, p) => s + p.a.cents / 100, 0);
  console.log(`  additional after recurrence, dollars:       $${addD.toFixed(2)}`);
  console.log(`  spikes in merchant-length dist:             ${A.spikes.length ? A.spikes.map(s=>`len=${s.L} (ratio ${s.ratio.toFixed(1)}x)`).join(", ") : "NONE"}`);

  console.log(`\nPART B:`);
  if (B?.blocked) console.log(`  BLOCKED (see reason above).`);
  else {
    console.log(`  Beau Davis payments count:                  ${B.beauPayments.length}`);
    console.log(`  Portfolio payments w/ rippling match:       ${B.paymentsWithRipplingMatch} / ${B.allPayments.length}`);
  }

  console.log(`\nPART C:`);
  console.log(`  flagged rows dumped:                        ${C.results.length}`);
  console.log(`  distinct rippling_id (line) count:          ${C.nLines}`);
  console.log(`  distinct parent_txn_id count:               ${C.nParents}`);
  console.log(`  overlap:                                    ${C.overlap}`);
  console.log(`\nWORKBOOK: ${OUT_PATH}`);
})().catch((err) => {
  console.error("FATAL:", err.stack || err.message || err);
  process.exit(1);
});
