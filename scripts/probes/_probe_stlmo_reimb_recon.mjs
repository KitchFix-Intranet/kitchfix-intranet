// STL - MO reimbursables reconciliation - spend vs invoiced.
//
// Audit-only. Read-only against both Postgres (purchasing_actuals for
// the spend baseline) and QBO (via Josh's proxy for BILLED / PAID /
// PENDING). Writes a JSON snapshot to /tmp for the audit doc to embed
// and formats a summary to stdout.
//
// Owner directives 2026-08-26:
//   - PAID and PENDING mean CLIENT paying US. Our vendor-payment
//     status (purchasing_actuals.paid) is out of scope for this
//     report - it is a cash-flow question about us, not about what
//     the Cardinals owe. Never surface it here.
//   - Three "St. Louis Cardinals" customers exist in QBO. Pull ALL
//     THREE and report SEPARATELY. Do not sum. Only merge if the
//     line-item evidence says they belong together (and if so, name
//     the evidence in the report). If the other two come back empty,
//     that is a clean confirmation, not a wasted query.
//   - 17705 (STL-FL, Jupiter) has its own reimbursables under its
//     own account. Do not treat its balance as STL - MO's without
//     inspecting what the line items describe.
//
// Env: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (read purchasing_actuals),
//      QBO_PROXY_BASE / QBO_REALM_ID / QBO_PROXY_KEY (read QBO invoices).
// Presence-check only; never echo the values.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const REQUIRED = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "QBO_PROXY_BASE", "QBO_REALM_ID", "QBO_PROXY_KEY"];
const presence = {};
for (const k of REQUIRED) presence[k] = process.env[k] ? "PRESENT" : "ABSENT";
for (const k of REQUIRED) console.error(`env ${k}: ${presence[k]}`);
if (Object.values(presence).some(v => v === "ABSENT")) {
  console.error("required env absent; aborting");
  process.exit(1);
}

const ACCOUNT = "STL - MO";
const FY_START = "2025-12-29";
const TODAY = new Date().toISOString().slice(0, 10);

// Three customers to pull per owner ruling.
const CUSTOMERS = [
  { id: "22023", name: "St. Louis Cardinals (STL-MO)",       expected: "primary - almost certainly the answer" },
  { id: "17705", name: "St. Louis Cardinals (STL-FL)",       expected: "sibling account, own reimbursables likely; inspect line items" },
  { id: "20581", name: "St. Louis Cardinals (Tripleseat)",   expected: "separate customer, possibly empty" },
];

// ─── Postgres (spend baseline + GL codes crosscheck) ─────────────
const supa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function loadSpend() {
  const PS = 1000;
  const byCode = new Map();
  let from = 0;
  let totalRows = 0;
  let totalAmount = 0;
  while (true) {
    const q = await supa
      .from("purchasing_actuals")
      .select("gl_line_code, gl_bucket, amount, txn_date")
      .eq("account_key", ACCOUNT)
      .eq("gl_bucket", "reimbursable")
      .eq("excluded", false)
      .gte("txn_date", FY_START)
      .range(from, from + PS - 1);
    if (q.error) throw new Error(`purchasing_actuals: ${q.error.message}`);
    for (const r of q.data || []) {
      totalRows += 1;
      totalAmount += Number(r.amount || 0);
      const code = r.gl_line_code || "UNCODED";
      byCode.set(code, (byCode.get(code) || 0) + Number(r.amount || 0));
    }
    if ((q.data || []).length < PS) break;
    from += PS;
  }
  return {
    totalRows,
    totalAmount: r2(totalAmount),
    byCode: [...byCode.entries()].sort((a, b) => b[1] - a[1]).map(([code, amount]) => ({ code, amount: r2(amount) })),
  };
}

// ─── QBO (Josh's proxy) ───────────────────────────────────────────
const QBO_ROOT = `${process.env.QBO_PROXY_BASE}/v3/company/${process.env.QBO_REALM_ID}`;
const QBO_KEY = process.env.QBO_PROXY_KEY;

async function qbo(qql) {
  const url = `${QBO_ROOT}/query?query=${encodeURIComponent(qql)}&minorversion=75`;
  const res = await fetch(url, {
    headers: { "X-API-Key": QBO_KEY, "Accept": "application/json" },
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`QBO ${res.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

async function loadInvoices(customerId) {
  const PS = 1000;
  let start = 1;
  const all = [];
  while (true) {
    const qql = `SELECT * FROM Invoice WHERE CustomerRef = '${customerId}' AND TxnDate >= '${FY_START}' AND TxnDate <= '${TODAY}' STARTPOSITION ${start} MAXRESULTS ${PS}`;
    const r = await qbo(qql);
    const rows = r.QueryResponse?.Invoice || [];
    for (const inv of rows) all.push(inv);
    if (rows.length < PS) break;
    start += PS;
  }
  return all;
}

function daysSince(iso) {
  const then = new Date(`${iso}T00:00:00.000Z`);
  const now = new Date();
  const nowUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.floor((nowUtc - then.getTime()) / 86400000));
}
function bucketAge(days) {
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}
function r2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function money(n) {
  return "$" + r2(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Aggregate one customer's invoices into the report shape.
function aggregate(invoices) {
  let billed = 0;
  let pending = 0;
  // Per-line category totals. Reimbursables are the like-for-like
  // compare against our spend baseline. Other line categories
  // (service fees, credits, other) inflate BILLED beyond what
  // reimbursables alone cover - the STL-FL fixture shows two
  // $350k Service Fee invoices as distinct lines, so STL-MO likely
  // has similar service-fee lines that need to be excluded before
  // comparing BILLED against the $404,394.46 spend baseline.
  let billedReimb = 0;    // "* Reimbursables *" items
  let billedFees = 0;     // "Service Fee" items
  let billedOther = 0;    // everything else (rare - credits, misc)
  const byItemCategory = new Map();  // item bucket -> total billed
  const list = [];
  const byGL = new Map();
  const byPeriod = new Map();
  const lineDescriptions = new Map();  // description -> count (for line-item shape reporting)
  const lineItemsSample = [];          // first 20 line items across all invoices for eyeball
  const ageBuckets = { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
  const glCandidatesFromLines = new Set();

  function categoriseLine(item) {
    if (!item) return "unknown";
    const s = String(item).toLowerCase();
    if (s.includes("reimbursable")) return "reimbursables";
    if (s.includes("service fee")) return "service_fees";
    return "other";
  }

  for (const inv of invoices) {
    const total = Number(inv.TotalAmt || 0);
    const bal = Number(inv.Balance || 0);
    const paid = r2(total - bal);
    billed += total;
    pending += bal;

    const txnDate = inv.TxnDate;
    const dueDate = inv.DueDate || null;
    const ageForBalance = dueDate ? daysSince(dueDate) : daysSince(txnDate);

    list.push({
      id: inv.Id,
      docNumber: inv.DocNumber || null,
      txnDate,
      dueDate,
      total: r2(total),
      paid,
      balance: r2(bal),
      ageFromTxn: daysSince(txnDate),
      ageFromDue: dueDate ? daysSince(dueDate) : null,
    });
    if (bal > 0.005) ageBuckets[bucketAge(ageForBalance)] = r2(ageBuckets[bucketAge(ageForBalance)] + bal);

    for (const line of inv.Line || []) {
      if (line.DetailType !== "SalesItemLineDetail") continue;
      const sil = line.SalesItemLineDetail;
      const item = sil.ItemRef?.name || sil.ItemRef?.value || null;
      const klass = sil.ClassRef?.name || sil.ClassRef?.value || null;
      const amt = Number(line.Amount || 0);
      const desc = line.Description || "";
      // Split-by-category so reimbursables billed can be compared
      // like-for-like against our reimbursable-only spend baseline.
      const cat = categoriseLine(item);
      if (cat === "reimbursables") billedReimb += amt;
      else if (cat === "service_fees") billedFees += amt;
      else billedOther += amt;
      byItemCategory.set(item || "unknown", (byItemCategory.get(item || "unknown") || 0) + amt);
      // Track line descriptions for the "what's this customer billed for" summary.
      const descKey = desc.slice(0, 60);
      lineDescriptions.set(descKey, (lineDescriptions.get(descKey) || 0) + 1);
      if (lineItemsSample.length < 20) {
        lineItemsSample.push({ invoice: inv.DocNumber || inv.Id, item, class: klass, amount: r2(amt), desc: desc.slice(0, 120) });
      }
      const glMatch = (item || "").match(/(\d{4}(?:\.\d+){0,3})/)
                   || (klass || "").match(/(\d{4}(?:\.\d+){0,3})/);
      const key = glMatch ? glMatch[1] : `raw:${item || klass || "unknown"}`;
      if (glMatch) glCandidatesFromLines.add(glMatch[1]);
      byGL.set(key, (byGL.get(key) || 0) + amt);
    }

    const yyyymm = txnDate.slice(0, 7);
    byPeriod.set(yyyymm, (byPeriod.get(yyyymm) || 0) + total);
  }
  billed = r2(billed);
  pending = r2(pending);
  const paidTotal = r2(billed - pending);
  const unpaid = list.filter(l => l.balance > 0.005).sort((a, b) => a.txnDate.localeCompare(b.txnDate));
  const oldest = unpaid[0] || null;

  const topDescriptions = [...lineDescriptions.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([desc, count]) => ({ desc, count }));

  return {
    billed, paid: paidTotal, pending,
    // v2 post-run: split totals by item category so reimbursables
    // can be compared like-for-like against the spend baseline.
    billedByCategory: {
      reimbursables: r2(billedReimb),
      service_fees: r2(billedFees),
      other: r2(billedOther),
    },
    byItem: [...byItemCategory.entries()].sort((a, b) => b[1] - a[1]).map(([item, amount]) => ({ item, amount: r2(amount) })),
    invoiceCount: invoices.length,
    unpaidCount: unpaid.length,
    ageBuckets,
    oldestUnpaid: oldest,
    byGL: [...byGL.entries()].sort((a, b) => b[1] - a[1]).map(([code, amount]) => ({ code, amount: r2(amount) })),
    byPeriodYYYYMM: [...byPeriod.entries()].sort().map(([month, amount]) => ({ month, amount: r2(amount) })),
    invoices: list.sort((a, b) => a.txnDate.localeCompare(b.txnDate)),
    lineItemsSample,
    topDescriptions,
    glCandidates: [...glCandidatesFromLines].sort(),
  };
}

// ─── Run ─────────────────────────────────────────────────────────
const spend = await loadSpend();
console.error(`\nSPEND (purchasing_actuals STL - MO reimbursable FY2026): ${money(spend.totalAmount)}  ${spend.totalRows} rows`);

const perCustomer = {};
for (const cust of CUSTOMERS) {
  console.error(`\npulling invoices for Id=${cust.id} "${cust.name}"...`);
  const invoices = await loadInvoices(cust.id);
  console.error(`  retrieved ${invoices.length} invoice(s)`);
  perCustomer[cust.id] = { customer: cust, ...aggregate(invoices) };
}

// GL cross-check across all three customers (any GL code present in
// spend but not in any QBO customer's line data, or vice versa).
const KEVIN_UNDEFINED_CODES = ["1385", "1385.3", "1385.3.1", "1374.3"];
const allQboGlCodes = new Set();
for (const id of Object.keys(perCustomer)) {
  for (const c of perCustomer[id].glCandidates) allQboGlCodes.add(c);
}
const kevinCodesInQbo = KEVIN_UNDEFINED_CODES.map(code => ({
  code,
  in_any_qbo_customer_line_data: allQboGlCodes.has(code),
}));

const out = {
  meta: {
    account: ACCOUNT,
    fy_start: FY_START,
    as_of: TODAY,
    customers: CUSTOMERS,
    directive: "pull all three separately, do not sum, only merge if line-item evidence supports it",
  },
  spend: {
    total: spend.totalAmount,
    row_count: spend.totalRows,
    by_gl: spend.byCode,
  },
  per_customer: perCustomer,
  gl_crosscheck: {
    kevin_undefined_codes_check: kevinCodesInQbo,
    all_gl_codes_seen_in_any_qbo_line: [...allQboGlCodes].sort(),
    gl_codes_in_spend: spend.byCode.map(r => r.code),
  },
};

fs.writeFileSync("/tmp/stlmo_recon.json", JSON.stringify(out, null, 2));
console.error(`\nwrote /tmp/stlmo_recon.json`);

// ─── Headline summary to stdout ──────────────────────────────────
console.log(`\n${"=".repeat(72)}`);
console.log(`STL - MO reimbursables reconciliation - ${FY_START}..${TODAY}`);
console.log(`${"=".repeat(72)}`);
console.log(``);
console.log(`SPENT (purchasing_actuals STL - MO reimbursable FY2026):`);
console.log(`  ${money(spend.totalAmount)}   ${spend.totalRows} rows`);
console.log(``);
console.log(`Per-customer BILLED / PAID / PENDING (NOT summed - per owner ruling)`);
console.log(``);

for (const cust of CUSTOMERS) {
  const a = perCustomer[cust.id];
  console.log(`--- Id=${cust.id} "${cust.name}" ---`);
  console.log(`  (expected: ${cust.expected})`);
  console.log(`  BILLED (total)    ${money(a.billed).padStart(16)}`);
  console.log(`    reimbursables   ${money(a.billedByCategory.reimbursables).padStart(16)}   <- like-for-like vs spend baseline`);
  console.log(`    service fees    ${money(a.billedByCategory.service_fees).padStart(16)}`);
  console.log(`    other/credits   ${money(a.billedByCategory.other).padStart(16)}`);
  console.log(`  PAID              ${money(a.paid).padStart(16)}`);
  console.log(`  PENDING           ${money(a.pending).padStart(16)}`);
  console.log(`  invoices retrieved: ${a.invoiceCount}   unpaid: ${a.unpaidCount}`);
  if (a.oldestUnpaid) {
    console.log(`  oldest unpaid: #${a.oldestUnpaid.docNumber || a.oldestUnpaid.id}  ${a.oldestUnpaid.txnDate}  ${money(a.oldestUnpaid.balance)}  ${a.oldestUnpaid.ageFromTxn} days`);
  }
  if (a.invoiceCount > 0) {
    console.log(`  aging of pending balance:`);
    for (const [b, amt] of Object.entries(a.ageBuckets)) {
      if (amt > 0.005) console.log(`    ${b.padEnd(8)}  ${money(amt).padStart(14)}`);
    }
    console.log(`  top line-item descriptions (first 10 by frequency):`);
    for (const d of a.topDescriptions) {
      console.log(`    ${String(d.count).padStart(3)}x  "${d.desc}"`);
    }
    console.log(`  first ${Math.min(a.lineItemsSample.length, 20)} line items (eyeball for MO vs other-account leakage):`);
    for (const li of a.lineItemsSample) {
      console.log(`    inv #${li.invoice}  item="${li.item}"  class="${li.class || ""}"  ${money(li.amount)}  desc="${li.desc}"`);
    }
    console.log(`  GL codes seen in line data: ${a.glCandidates.length > 0 ? a.glCandidates.join(", ") : "(none - QBO does not carry GL codes on line data for this customer)"}`);
  }
  console.log(``);
}

console.log(`GL cross-check (Kevin's undefined-in-gl_codes-for-STL-MO codes):`);
for (const k of kevinCodesInQbo) {
  console.log(`  ${k.code.padEnd(10)}  QBO recognises: ${k.in_any_qbo_customer_line_data ? "YES" : "no"}`);
}
