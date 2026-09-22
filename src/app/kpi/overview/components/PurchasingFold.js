// src/app/kpi/overview/components/PurchasingFold.js
//
// R-150 (2026-09-22). Purchasing detail as a fold on the P&L Overview,
// beside the Rippling labor fold. Kevin ruling: move and rebuild in
// one pass; do not carry the vendor-grouped shape across. Grain here
// is period into weeks into transactions, matching the labor table.
//
// Single-period ranges only. Multi-period (Current Year, etc.) render
// nothing here - Kevin: the fold does not appear on multi-period, no
// placeholder, no message. Range gating lives on the mount, so this
// component assumes it is only invoked on a single-period range.
//
// Fold chrome mirrors LaborLedger.js exactly (kpi-ov-fold-card head +
// body, HelpPop as sibling to the trigger button, controlled open /
// onToggle). Distinct id `qPurchasingFold` per Kevin's rule (avoid
// duplicated `data-hs-help` ids in the DOM).
//
// Data source: /api/kpi/purchasing with ?drill=lines. Payload rows
// (payload.actuals) carry the R-147 fields on invoice_submissions
// sources (invoice_number, type, status, sga_removed_amount) plus
// the shared columns for rippling_spend. See
// src/lib/purchasing/loaders.js:paginateInvoiceSubmissions.
//
// Bucket rule (R-150, ruled 2026-09-22):
//   3200.* except 3200.2  -> Food
//   3400.* and 3200.2     -> Pack & Sup    (includes 3400.5 Linen)
//   3500.*                -> Vehicle
//   13*                   -> Billed back
//   5*                    -> SG&A (dropped from table)
//
// R-147's shared GL_PREFIX_FOR_BUCKET treats every 3200.* as Food; a
// new local bucketOf here implements the split without altering the
// shared map or the existing PurchasingLedger.
//
// R-148 note (2026-09-22): the current dataset carries duplicated
// rippling_spend rows from reassigned parent ids. R-148 retires the
// duplicates in the derive; when it lands, Food totals will drop by
// roughly $600 on TBJ - FL P10. Not a regression here; verify against
// today's figures.

"use client";

import { useMemo, useState } from "react";
import HelpPop from "@/app/kpi/labor/components/HelpPop";
import { weekStartsInRange } from "@/app/kpi/labor/lib/periods";

const HELP_BODY = (
  <>
    <p>
      One row per transaction. Invoice rows come from operator capture
      (`invoice_submissions`); card rows come from the Rippling API
      (`rippling_spend`). Uncoded card charges count toward Food until
      someone codes them.
    </p>
    <p>
      Column buckets follow the accounting P&L: 3200 sub-lines are Food,
      3400 sub-lines and 3200.2 are Pack &amp; Sup, 3500 is Vehicle, 13xx
      is Billed back. 5xxx (SG&amp;A) is not shown here; when an invoice
      mixes SG&amp;A with COGS the row total is the COGS portion and the
      row carries a small badge noting the SG&amp;A amount removed.
    </p>
  </>
);

const R150_BUCKET = {
  food:      "Food",
  packaging: "Pack & Sup",
  vehicle:   "Vehicle",
  billed:    "Billed back",
  sga:       "SG&A",
};

// Kevin ruling 2026-09-22. 3200.* except 3200.2 -> Food; 3400.* AND
// 3200.2 -> Pack & Sup; 3500.* -> Vehicle; 13* -> Billed back; 5* ->
// SG&A (dropped). Any other code (uncoded / anything not matching)
// falls to null and does not enter the table.
function bucketOf(gl) {
  const s = String(gl || "").trim();
  if (!s) return null;                            // uncoded - handled separately
  if (s === "3200.2" || s.startsWith("3200.2.")) return "packaging";
  if (s === "3200" || s.startsWith("3200.")) return "food";
  if (s === "3400" || s.startsWith("3400.")) return "packaging";
  if (s === "3500" || s.startsWith("3500.")) return "vehicle";
  if (s.startsWith("13")) return "billed";
  if (s.startsWith("5"))  return "sga";
  return null;
}

// Deep-log rounding to keep cent totals stable.
const round2 = n => Math.round(Number(n || 0) * 100) / 100;
const fmt0 = (n) => (Number(n || 0) < 0 ? "-$" : "$") + Math.abs(Math.round(Number(n || 0))).toLocaleString("en-US");

// Type / Status derivations per row source.
//   invoice_submissions type='invoice'   -> "Invoice"
//   invoice_submissions type='credit'    -> "Credit"
//   billcom                              -> "Invoice"   (pre-cutover bills)
//   billcom_credit                       -> "Credit"    (pre-cutover credits)
//   upload                               -> "Invoice"   (finance-injected)
//   rippling_spend                       -> "Card"
//   invoice_submissions status='sent'    -> "Submitted"
//   invoice_submissions status='returned' -> "Returned"
//   rippling_spend gl_line_code IS NULL  -> "Not coded"
//   rippling_spend otherwise             -> "Coded"
//   billcom / billcom_credit / upload    -> "—"          (no status field on bill.com lane)
function typeLabel(r) {
  if (r.source === "invoice_submissions") return r.type === "credit" ? "Credit" : "Invoice";
  if (r.source === "billcom_credit")      return "Credit";
  if (r.source === "billcom")             return "Invoice";
  if (r.source === "upload")              return "Invoice";
  if (r.source === "rippling_spend")      return "Card";
  return "—";
}
function statusLabel(r) {
  if (r.source === "invoice_submissions") {
    if (r.status === "returned") return "Returned";
    if (r.status === "sent")     return "Submitted";
    return "—";
  }
  if (r.source === "rippling_spend") return r.gl_line_code ? "Coded" : "Not coded";
  return "—";
}
function numberLabel(r) {
  if (r.source === "invoice_submissions") return r.invoice_number ? `#${r.invoice_number}` : "—";
  // Card + bill.com share the short-source_bill_id convention.
  return r.source_bill_id ? `#${String(r.source_bill_id).slice(0, 8)}` : "—";
}

// Group actuals rows by source_bill_id + source. One transaction = one
// group. Aggregates line amounts across buckets so a multi-line
// invoice renders as one row with the split across columns.
function buildTransactions(rows) {
  const groups = new Map();
  for (const r of rows) {
    const bill = r.source_bill_id;
    if (!bill) continue;
    const key = `${r.source}|${bill}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        source: r.source,
        source_bill_id: bill,
        vendor: r.vendor || r.vendor_or_merchant || "(no vendor)",
        type: r.type || null,
        status: r.status || null,
        invoice_number: r.invoice_number || null,
        txn_date: r.txn_date,
        sga_removed: 0,
        // buckets:
        food: 0, packaging: 0, vehicle: 0, billed: 0,
        // metadata:
        hasCogs: false,
        allSga: true,
        anyLine: false,
        rawLines: [],
      };
      groups.set(key, g);
    }
    const b = bucketOf(r.gl_line_code);
    g.anyLine = true;
    g.rawLines.push(r);
    if (b === "sga") { /* drop from columns; sga_removed carries the total for invoices */ }
    else if (b) {
      g.allSga = false;
      g[b] += Number(r.amount || 0);
      if (b === "food" || b === "packaging" || b === "vehicle" || b === "billed") g.hasCogs = true;
    } else if (r.source === "rippling_spend" && !r.gl_line_code) {
      // Uncoded card charge counts toward Food (Kevin's rule).
      g.allSga = false;
      g.food += Number(r.amount || 0);
      g.hasCogs = true;
    }
    // Track SG&A amount per invoice for the badge. On captured
    // invoices this comes pre-computed on each row (same value across
    // all rows of one submission), so max() is a safe pick.
    if (r.source === "invoice_submissions" && r.sga_removed_amount) {
      g.sga_removed = Math.max(g.sga_removed, Number(r.sga_removed_amount));
    }
    // Earliest txn_date within the group wins (rows share txn_date on
    // invoices; for cards a bill has one txn_date across its lines).
    if (r.txn_date && (!g.txn_date || r.txn_date < g.txn_date)) g.txn_date = r.txn_date;
  }
  // Drop groups whose whole invoice was SG&A - no row here.
  const out = [];
  for (const g of groups.values()) {
    if (g.allSga) continue;
    g.food      = round2(g.food);
    g.packaging = round2(g.packaging);
    g.vehicle   = round2(g.vehicle);
    g.billed    = round2(g.billed);
    g.total     = round2(g.food + g.packaging + g.vehicle + g.billed);
    out.push(g);
  }
  return out;
}

// Assign a fiscal week_start to a txn_date. Same floor the view uses:
// FY_START + floor((d - FY_START) / 7) * 7. Kept local so the fold
// does not import a weekly helper that does not exist for the daily
// grain.
const FY_START_MS = new Date("2025-12-29T00:00:00Z").getTime();
function weekStartOf(iso) {
  if (!iso) return null;
  const t = new Date(iso + "T00:00:00Z").getTime();
  if (!Number.isFinite(t) || t < FY_START_MS) return null;
  const w = Math.floor((t - FY_START_MS) / (7 * 86400000));
  return new Date(FY_START_MS + w * 7 * 86400000).toISOString().slice(0, 10);
}
function weekEndOf(weekStart) {
  const t = new Date(weekStart + "T00:00:00Z").getTime();
  return new Date(t + 6 * 86400000).toISOString().slice(0, 10);
}
function weekState(weekStart, weekEnd, todayISO) {
  if (weekEnd < todayISO) return "settled";
  if (weekStart > todayISO) return "ahead";
  return "in-progress";
}

// Uncoded card charges strip - source=rippling_spend AND gl_line_code
// null AND txn_date in range. Same population the current
// PurchasingLedger surfaces above its table (Kevin's rule: they count
// toward Food until someone codes them).
function uncodedCardCount(rows) {
  let n = 0, s = 0;
  for (const r of rows) {
    if (r.source !== "rippling_spend") continue;
    if (r.gl_line_code) continue;
    n += 1;
    s += Number(r.amount || 0);
  }
  return { n, total: round2(s) };
}

export default function PurchasingFold({ payload, error, account, start, end, today, open, onToggle }) {
  const actuals = Array.isArray(payload?.actuals) ? payload.actuals : null;

  const derived = useMemo(() => {
    if (!actuals) return null;

    // In-scope sources for the fold. Post-cutover on capture-eligible
    // accounts the loader emits invoice_submissions + rippling_spend.
    // Pre-cutover (P1-P9) and CIN - KY / TBJ - NY every period read
    // through bill.com (billcom / billcom_credit / upload). All five
    // land here as transaction rows so the fold's period footer ties
    // to the board on P9 as well as P10 (Kevin's A1).
    const inScope = actuals.filter(r =>
      r.source === "invoice_submissions" ||
      r.source === "rippling_spend" ||
      r.source === "billcom" ||
      r.source === "billcom_credit" ||
      r.source === "upload"
    );

    // For the Uncoded strip we count from the raw pool so it stays
    // stable if the same charge is later coded and we would drop it
    // from a bucketed row.
    const uncoded = uncodedCardCount(inScope);

    const transactions = buildTransactions(inScope);

    // Bucket totals across every transaction. Vehicle-column visibility
    // gates on the non-zero sum for the whole range.
    const foot = { food: 0, packaging: 0, vehicle: 0, billed: 0 };
    for (const t of transactions) {
      foot.food      += t.food;
      foot.packaging += t.packaging;
      foot.vehicle   += t.vehicle;
      foot.billed    += t.billed;
    }
    foot.food = round2(foot.food);
    foot.packaging = round2(foot.packaging);
    foot.vehicle = round2(foot.vehicle);
    foot.billed = round2(foot.billed);
    foot.total = round2(foot.food + foot.packaging + foot.vehicle + foot.billed);

    // Bucket by week. weekStartsInRange enumerates every fiscal week
    // overlapping the range (Kevin rule 4 - do not fork a
    // week-boundary helper).
    const weeks = weekStartsInRange(start, end);
    const byWeek = new Map();
    for (const w of weeks) byWeek.set(w, { week_start: w, week_end: weekEndOf(w), state: weekState(w, weekEndOf(w), today), rows: [], food: 0, packaging: 0, vehicle: 0, billed: 0 });
    for (const t of transactions) {
      const w = weekStartOf(t.txn_date);
      const bucket = w && byWeek.get(w);
      if (!bucket) continue;
      bucket.rows.push(t);
      bucket.food      += t.food;
      bucket.packaging += t.packaging;
      bucket.vehicle   += t.vehicle;
      bucket.billed    += t.billed;
    }
    // Sort transactions within each week: txn_date asc, then vendor.
    for (const b of byWeek.values()) {
      b.rows.sort((a, b) => (a.txn_date || "").localeCompare(b.txn_date || "") || a.vendor.localeCompare(b.vendor));
      b.food = round2(b.food);
      b.packaging = round2(b.packaging);
      b.vehicle = round2(b.vehicle);
      b.billed = round2(b.billed);
    }
    const weekBands = [...byWeek.values()];

    return {
      uncoded,
      transactions,
      foot,
      weekBands,
      showVehicle: foot.vehicle !== 0,
    };
  }, [actuals, start, end, today]);

  return (
    <div
      className={`kpi-ov-card kpi-ov-mt kpi-ov-fold-card${open ? " kpi-ov-fold-open" : ""}`}
      data-kpi-ov="purchasing-ledger"
      data-kpi-ov-open={open ? "1" : "0"}
    >
      <div className="kpi-ov-fold-head">
        <button
          type="button"
          className="kpi-ov-fold-trigger"
          data-kpi-ov="fold-purchasing"
          onClick={onToggle}
          aria-expanded={open ? "true" : "false"}
        >
          <span className="kpi-ov-eb">Purchasing detail</span>
          <span className="kpi-ov-fold-cv" aria-hidden="true">▾</span>
        </button>
        <HelpPop id="qPurchasingFold" title="The purchasing table" body={HELP_BODY} />
      </div>
      {open && (
        <div className="kpi-ov-cb">
          {error ? (
            <div className="kpi-ov-cp-led-warn" role="status" data-kpi-ov="purchasing-ledger-error">
              Purchasing detail could not load: {error}
            </div>
          ) : !derived ? (
            <div className="kpi-ov-cp-led-warn" role="status" data-kpi-ov="purchasing-ledger-loading">
              Loading purchasing detail…
            </div>
          ) : derived.transactions.length === 0 ? (
            <div className="kpi-ov-cp-led-warn" role="status" data-kpi-ov="purchasing-ledger-empty">
              No purchases for this range.
            </div>
          ) : (
            <PurchasingTable derived={derived} />
          )}
        </div>
      )}
    </div>
  );
}

function PurchasingTable({ derived }) {
  const { uncoded, weekBands, foot, showVehicle } = derived;
  return (
    <>
      {uncoded.n > 0 && (
        <div className="kpi-ov-cp-led-warn" role="status" data-kpi-ov="purchasing-ledger-uncoded">
          {uncoded.n} card {uncoded.n === 1 ? "charge has" : "charges have"} no P&amp;L line yet · {fmt0(uncoded.total)} · they count toward Food until someone codes them
        </div>
      )}
      <div className="kpi-ov-cp-led-scroll">
        <table className="kpi-ov-cp-led-tbl">
          <thead>
            <tr>
              <th className="kpi-ov-cp-led-l">Vendor</th>
              <th className="kpi-ov-cp-led-l">Type</th>
              <th className="kpi-ov-cp-led-l">Status</th>
              <th className="kpi-ov-cp-led-l">Number</th>
              <th>Food</th>
              <th>Pack. &amp; Sup.</th>
              {showVehicle && <th>Vehicle</th>}
              <th>Billed back</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {weekBands.map((band, wi) => (
              <PurchasingWeekBand key={band.week_start} band={band} showVehicle={showVehicle} />
            ))}
            <tr className="kpi-ov-cp-led-foot" data-kpi-ov="purchasing-ledger-foot">
              <td className="kpi-ov-cp-led-l" colSpan={4}>Period</td>
              <td>{fmt0(foot.food)}</td>
              <td>{fmt0(foot.packaging)}</td>
              {showVehicle && <td>{fmt0(foot.vehicle)}</td>}
              <td className="kpi-ov-cp-led-bb">{fmt0(foot.billed)}</td>
              <td>{fmt0(foot.total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}

function PurchasingWeekBand({ band, showVehicle }) {
  const colSpan = 4 + (showVehicle ? 4 : 3); // vendor+type+status+number + buckets + total column count
  const label = (() => {
    const dtRange = `${band.week_start.slice(5)} – ${band.week_end.slice(5)}`;
    if (band.state === "in-progress") return `Week · ${dtRange} · in progress`;
    if (band.state === "ahead")       return `Week · ${dtRange} · ahead`;
    return `Week · ${dtRange}`;
  })();
  const stateTag = band.state === "in-progress" ? "kpi-ov-pf-wband-run"
                : band.state === "ahead"       ? "kpi-ov-pf-wband-ahead"
                :                                "kpi-ov-pf-wband-settled";
  return (
    <>
      <tr className={`kpi-ov-pf-wband ${stateTag}`} data-kpi-ov="purchasing-week-band" data-week-start={band.week_start}>
        <td className="kpi-ov-cp-led-l" colSpan={4}>{label}</td>
        <td>{fmt0(band.food)}</td>
        <td>{fmt0(band.packaging)}</td>
        {showVehicle && <td>{fmt0(band.vehicle)}</td>}
        <td className="kpi-ov-cp-led-bb">{fmt0(band.billed)}</td>
        <td>{fmt0(band.food + band.packaging + band.vehicle + band.billed)}</td>
      </tr>
      {band.rows.length === 0 ? (
        <tr className="kpi-ov-cp-led-lrow" data-kpi-ov="purchasing-week-empty">
          <td className="kpi-ov-cp-led-l kpi-ov-cp-led-mute" colSpan={colSpan}>No purchases in this week.</td>
        </tr>
      ) : (
        band.rows.map((r, i) => (
          <tr key={r.key} className="kpi-ov-cp-led-lrow" data-kpi-ov="purchasing-txn">
            <td className="kpi-ov-cp-led-l">
              {r.vendor}
              {r.sga_removed > 0 && (
                <span className="kpi-ov-cp-led-sga" title="Invoice included SG&A lines that are not part of COGS; the row total is the COGS portion.">
                  {" "}SG&amp;A {fmt0(r.sga_removed)}
                </span>
              )}
            </td>
            <td className="kpi-ov-cp-led-l kpi-ov-cp-led-mute">{typeLabel(r)}</td>
            <td className="kpi-ov-cp-led-l kpi-ov-cp-led-mute">{statusLabel(r)}</td>
            <td className="kpi-ov-cp-led-l kpi-ov-cp-led-mute">{numberLabel(r)}</td>
            <td>{cellCell(r.food)}</td>
            <td>{cellCell(r.packaging)}</td>
            {showVehicle && <td>{cellCell(r.vehicle)}</td>}
            <td className="kpi-ov-cp-led-bb">{cellCell(r.billed)}</td>
            <td><b>{fmt0(r.total)}</b></td>
          </tr>
        ))
      )}
    </>
  );
}

function cellCell(n) {
  if (Math.abs(n) < 0.005) return <span className="kpi-ov-cp-led-dim">—</span>;
  return fmt0(n);
}
