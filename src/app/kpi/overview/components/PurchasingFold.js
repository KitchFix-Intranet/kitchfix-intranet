// src/app/kpi/overview/components/PurchasingFold.js
//
// R-150 (2026-09-22). Purchasing detail as a fold on the P&L Overview,
// beside the Rippling labor fold. Kevin ruling: move and rebuild in
// one pass; do not carry the vendor-grouped shape across. Grain here
// is period into weeks into transactions, matching the labor table.
//
// 2026-11-09, Kevin ruling. Split into two folds:
//
//   variant="invoices"  - invoice_submissions + billcom + billcom_credit
//                         + upload. Keeps the Number column.
//   variant="cards"     - rippling_spend, CODED ROWS ONLY. A card line
//                         with no gl_line_code is a to-do (surfaces in
//                         Needs review today via CurrentPeriodReview),
//                         not a Food charge. Number column dropped.
//
// Both variants share this one component. page.js renders the two
// folds back-to-back on CP and on closed / CY single-account branches.
// Open state is per-variant in page.js (purchasingInvoicesFoldOpen /
// purchasingCardsFoldOpen) so disclosure does not cross folds.
//
// Single-period ranges only. Multi-period (Current Year, etc.) render
// nothing here - Kevin: the fold does not appear on multi-period, no
// placeholder, no message. Range gating lives on the mount, so this
// component assumes it is only invoked on a single-period range.
//
// Fold chrome mirrors LaborLedger.js exactly (kpi-ov-fold-card head +
// body, HelpPop as sibling to the trigger button, controlled open /
// onToggle).
//
// Data source: /api/kpi/purchasing with ?drill=lines. Payload rows
// (payload.actuals) carry the R-147 fields on invoice_submissions
// sources (invoice_number, type, status, sga_removed_amount) plus
// the shared columns for rippling_spend. See
// src/lib/purchasing/loaders.js:paginateInvoiceSubmissions.
//
// Bucket rule (R-150, ruled 2026-09-22, revised 2026-09-22 after PR
// review):
//   3200.*                -> Food                (Resale Food 3200.2 is a
//                                                 Food sub-line per finance
//                                                 CoA; verified against P9
//                                                 workbook TBJ - FL 3200.1
//                                                 $38,781.84 + 3200.2 $1,716
//                                                 = $40,497.84 Total Food)
//   3400.*                -> Pack & Sup          (Linen 3400.5 included)
//   3500.*                -> Vehicle
//   13*                   -> Billed back
//   5*                    -> SG&A (dropped from table)

"use client";

import { useMemo, useState } from "react";
import HelpPop from "@/app/kpi/labor/components/HelpPop";
import { weekStartsInRange } from "@/app/kpi/labor/lib/periods";
import { fmtWeekRange } from "@/lib/kpi/overview/formatting";
import { uncodedCardCount } from "@/lib/kpi/overview/uncodedCards";

const HELP_BODY = (
  <>
    <p>
      One row per transaction. Invoice rows come from operator capture
      (<code>invoice_submissions</code> / bill.com); card rows come from
      the Rippling API (<code>rippling_spend</code>). Uncoded card
      charges are not counted in any cost line and appear in
      &ldquo;Needs review today&rdquo; until a category is picked.
    </p>
    <p>
      Column buckets follow the accounting P&amp;L: 3200 sub-lines
      (including 3200.2 Resale Food) are Food, 3400 sub-lines are
      Pack &amp; Sup, 3500 is Vehicle, 13xx is Billed back. 5xxx
      (SG&amp;A) is not shown here; when an invoice mixes SG&amp;A
      with COGS the row total is the COGS portion and the row carries
      a small badge noting the SG&amp;A amount removed.
    </p>
  </>
);

const SOURCES_INVOICES = new Set(["invoice_submissions", "billcom", "billcom_credit", "upload"]);
const SOURCES_CARDS = new Set(["rippling_spend"]);

const VARIANT_CONFIG = {
  invoices: {
    sources: SOURCES_INVOICES,
    title: "Purchasing detail - Invoices",
    helpId: "qPurchasingFoldInvoices",
    dataAttr: "purchasing-ledger-invoices",
    foldTrigger: "fold-purchasing-invoices",
    summaryNoun: (n) => `${n} ${n === 1 ? "invoice" : "invoices"}`,
    emptyState: "No vendor invoices this period.",
    showNumber: true,
  },
  cards: {
    sources: SOURCES_CARDS,
    title: "Purchasing detail - Cards",
    helpId: "qPurchasingFoldCards",
    dataAttr: "purchasing-ledger-cards",
    foldTrigger: "fold-purchasing-cards",
    summaryNoun: (n) => `${n} card ${n === 1 ? "charge" : "charges"}`,
    emptyState: "No card charges this period.",
    showNumber: false,
  },
};

// Kevin ruling 2026-09-22 (revised). 3200.* all sub-lines including
// Resale Food 3200.2 -> Food; 3400.* -> Pack & Sup; 3500.* -> Vehicle;
// 13* -> Billed back; 5* -> SG&A (dropped). Any other code (uncoded /
// anything not matching) falls to null and does not enter the table.
function bucketOf(gl) {
  const s = String(gl || "").trim();
  if (!s) return null;
  if (s === "3200" || s.startsWith("3200.")) return "food";
  if (s === "3400" || s.startsWith("3400.")) return "packaging";
  if (s === "3500" || s.startsWith("3500.")) return "vehicle";
  if (s.startsWith("13")) return "billed";
  if (s.startsWith("5"))  return "sga";
  return null;
}

const round2 = n => Math.round(Number(n || 0) * 100) / 100;
const fmt0 = (n) => (Number(n || 0) < 0 ? "-$" : "$") + Math.abs(Math.round(Number(n || 0))).toLocaleString("en-US");

function typeLabel(r) {
  if (r.source === "invoice_submissions") return r.type === "credit" ? "Credit" : "Invoice";
  if (r.source === "billcom_credit")      return "Credit";
  if (r.source === "billcom")             return "Invoice";
  if (r.source === "upload")              return "Invoice";
  if (r.source === "rippling_spend")      return "Card";
  return "—";
}
// Sub-line rendered under the vendor name. Restrict to EXCEPTION
// states only - a sub-line doubles row height for the whole table.
function statusSub(r) {
  if (r.source === "invoice_submissions" && r.status === "returned") {
    return { text: "Returned", warn: false };
  }
  return null;
}
function numberLabel(r) {
  if (r.source === "invoice_submissions") return r.invoice_number ? `#${r.invoice_number}` : "—";
  // Kevin ruling 2026-09-24. source_bill_id is a ULID; the first 8
  // hex chars collide on same-ms bills. slice(0, 13) is unique over
  // the ledger (measured) and keeps the chronological-scan property.
  return r.source_bill_id ? `#${String(r.source_bill_id).slice(0, 13)}` : "—";
}

// Group actuals rows by source_bill_id + source. One transaction = one
// group. 2026-11-09, Kevin ruling: the prior "Uncoded card charge
// counts toward Food" fallback (previously here as an else-if branch
// after the bucketOf check) is retired. Uncoded card lines now belong
// in Needs review today only; a group whose every line is uncoded
// still forms a row (so it does not vanish) but with zero in every
// bucket. The Cards variant pre-filters its row pool to coded lines
// only before this function is called, so groups with no coded line
// are dropped at the filter, not here.
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
        drive_url_stamped: r.drive_url_stamped || null,
        drive_url_raw: r.drive_url_raw || null,
        submitter_email: r.submitter_email || null,
        txn_date: r.txn_date,
        sga_removed: 0,
        food: 0, packaging: 0, vehicle: 0, billed: 0,
        hasCogs: false,
        allSga: true,
        anyLine: false,
        codedLines: 0,
        uncodedLines: 0,
        rawLines: [],
        person: null, hasReceipt: null, memo: null,
      };
      groups.set(key, g);
    }
    const b = bucketOf(r.gl_line_code);
    g.anyLine = true;
    g.rawLines.push(r);
    if (r.source === "rippling_spend") {
      if (r.gl_line_code) g.codedLines += 1;
      else                g.uncodedLines += 1;
      if (g.person == null && r.employee_name) g.person = r.employee_name;
      if (g.hasReceipt == null && r.has_receipt != null) g.hasReceipt = r.has_receipt;
      if (g.memo == null && r.memo) g.memo = r.memo;
    }
    if (b === "sga") { /* drop from columns; sga_removed carries the total */ }
    else if (b) {
      g.allSga = false;
      g[b] += Number(r.amount || 0);
      if (b === "food" || b === "packaging" || b === "vehicle" || b === "billed") g.hasCogs = true;
    }
    // (retired 2026-11-09) else if (rippling_spend && !gl_line_code) {
    //   g.food += amount; - "uncoded counts toward Food" rule.
    // }
    if (r.source === "invoice_submissions" && r.sga_removed_amount) {
      g.sga_removed = Math.max(g.sga_removed, Number(r.sga_removed_amount));
    }
    if (r.txn_date && (!g.txn_date || r.txn_date < g.txn_date)) g.txn_date = r.txn_date;
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.allSga) continue;
    g.food      = round2(g.food);
    g.packaging = round2(g.packaging);
    g.vehicle   = round2(g.vehicle);
    g.billed    = round2(g.billed);
    g.total     = round2(g.food + g.packaging + g.vehicle + g.billed);
    // Cards variant: drop groups whose every line was uncoded (no
    // coded line, so no bucket). Invoices variant: every row has a
    // coded GL by construction (operator capture requires it), so
    // this guard is a no-op there.
    if (g.source === "rippling_spend" && g.codedLines === 0) continue;
    out.push(g);
  }
  return out;
}

// Assign a fiscal week_start to a txn_date.
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

function foldHeaderSummaryFromDerived(derived, variant) {
  if (!derived) return null;
  const n = derived.transactions?.length || 0;
  if (n <= 0) return null;
  return `${VARIANT_CONFIG[variant].summaryNoun(n)} · ${fmt0(derived.foot.total)}`;
}

export default function PurchasingFold({
  payload,
  error,
  start,
  end,
  today,
  open,
  onToggle,
  billbackPeriod,
  periodCurrent = false,
  variant = "invoices",
}) {
  const cfg = VARIANT_CONFIG[variant] || VARIANT_CONFIG.invoices;
  const actuals = Array.isArray(payload?.actuals) ? payload.actuals : null;
  const [expandedWeeks, setExpandedWeeks] = useState(() => new Set());
  const toggleWeek = (wk) => setExpandedWeeks((prev) => {
    const next = new Set(prev);
    if (next.has(wk)) next.delete(wk); else next.add(wk);
    return next;
  });

  const derived = useMemo(() => {
    if (!actuals) return null;

    // Variant-specific source filter. Cards additionally drops uncoded
    // lines at the row level so they never enter buildTransactions;
    // uncoded card charges surface only in Needs review today.
    const inScope = actuals.filter(r => {
      if (!cfg.sources.has(r.source)) return false;
      if (variant === "cards" && !r.gl_line_code) return false;
      return true;
    });

    const transactions = buildTransactions(inScope);

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
    for (const b of byWeek.values()) {
      b.rows.sort((a, b) => (a.txn_date || "").localeCompare(b.txn_date || "") || a.vendor.localeCompare(b.vendor));
      b.food = round2(b.food);
      b.packaging = round2(b.packaging);
      b.vehicle = round2(b.vehicle);
      b.billed = round2(b.billed);
    }
    const ascendingBands = [...byWeek.values()];
    const inProgress = ascendingBands.find(b => b.state === "in-progress");
    const weekBands = inProgress
      ? [
          inProgress,
          ...ascendingBands.filter(b => b.state === "settled").reverse(),
          ...ascendingBands.filter(b => b.state === "ahead"),
        ]
      : [...ascendingBands].reverse();

    return {
      transactions,
      foot,
      weekBands,
      showVehicle: foot.vehicle !== 0,
    };
  }, [actuals, start, end, today, variant, cfg.sources]);

  const headerSummary = foldHeaderSummaryFromDerived(derived, variant);

  return (
    <div
      className={`kpi-ov-card kpi-ov-mt kpi-ov-fold-card kpi-ov-fold-panel kpi-ov-fold-strip-purch${open ? " kpi-ov-fold-open" : ""}`}
      data-kpi-ov={cfg.dataAttr}
      data-kpi-ov-variant={variant}
      data-kpi-ov-open={open ? "1" : "0"}
    >
      <div className="kpi-ov-fold-head">
        <span className="kpi-ov-eb">{cfg.title}</span>
        <HelpPop id={cfg.helpId} title="The purchasing table" body={HELP_BODY} />
        <button
          type="button"
          className="kpi-ov-fold-trigger"
          data-kpi-ov={cfg.foldTrigger}
          onClick={onToggle}
          aria-expanded={open ? "true" : "false"}
        >
          {headerSummary && (
            <span className="kpi-ov-fold-summary" data-kpi-ov={`${cfg.dataAttr}-summary`}>{headerSummary}</span>
          )}
          <span className="kpi-ov-fold-cv" aria-hidden="true">▾</span>
        </button>
      </div>
      {open && (
        <>
          <div className="kpi-ov-cb">
            {error ? (
              <div className="kpi-ov-cp-led-warn" role="status" data-kpi-ov={`${cfg.dataAttr}-error`}>
                Purchasing detail could not load: {error}
              </div>
            ) : !derived ? (
              <div className="kpi-ov-cp-led-warn" role="status" data-kpi-ov={`${cfg.dataAttr}-loading`}>
                Loading purchasing detail…
              </div>
            ) : derived.transactions.length === 0 ? (
              <div className="kpi-ov-cp-led-warn" role="status" data-kpi-ov={`${cfg.dataAttr}-empty`}>
                {cfg.emptyState}
              </div>
            ) : (
              <>
                <PurchasingTable
                  derived={derived}
                  expandedWeeks={expandedWeeks}
                  onToggleWeek={toggleWeek}
                  periodCurrent={periodCurrent}
                  showNumber={cfg.showNumber}
                  dataAttr={cfg.dataAttr}
                />
                {variant === "invoices" && <PurchasingGoalRow billbackPeriod={billbackPeriod} />}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function PurchasingGoalRow({ billbackPeriod }) {
  const bb = billbackPeriod;
  if (!bb || bb.annual_goal == null) return null;

  if (bb.state === "pre_season") {
    return (
      <div className="kpi-ov-cp-led-goal kpi-ov-cp-led-goal-note" data-kpi-ov="purchasing-billback-goal" data-kpi-ov-state="pre-season">
        Pre-season &middot; reimbursable spend here rolls into P{bb.first_goal_period}&rsquo;s billed-back goal.
      </div>
    );
  }
  if (bb.goal == null) {
    return (
      <div className="kpi-ov-cp-led-goal kpi-ov-cp-led-goal-note" data-kpi-ov="purchasing-billback-goal" data-kpi-ov-state="no-goal">
        No billed-back goal for this period.
      </div>
    );
  }

  const toneCls = bb.tone === "over" ? "kpi-ov-wait" : bb.tone === "under" ? "kpi-ov-good" : "";
  const settled = bb.state === "closed";
  const running = bb.state === "in_progress";
  const arrow = bb.delta > 0 ? "▲" : bb.delta < 0 ? "▼" : "";
  const pct = bb.pct == null ? null : Math.round(bb.pct);

  return (
    <div className="kpi-ov-cp-led-goal" data-kpi-ov="purchasing-billback-goal" data-kpi-ov-state="has-goal">
      <div className="kpi-ov-cp-led-goal-row">
        <span className="kpi-ov-cp-led-goal-eb">P{bb.period_no} billed-back goal</span>
        <span className="kpi-ov-cp-led-goal-fig"><b>{fmt0(bb.goal)}</b> goal</span>
        <span className="kpi-ov-cp-led-goal-fig">
          <b>{fmt0(bb.actual)}</b> billed back{running ? " so far" : ""}
        </span>
        {settled ? (
          <>
            <span className={`kpi-ov-cp-led-goal-delta ${toneCls}`}>{arrow ? arrow + " " : ""}{fmt0(Math.abs(bb.delta))}</span>
            <span className="kpi-ov-cp-led-goal-vs">vs goal</span>
            <span className={`kpi-ov-cp-led-goal-pct ${toneCls}`}>{pct == null ? "—" : pct + "%"}</span>
          </>
        ) : (
          <span className="kpi-ov-cp-led-goal-pct kpi-ov-cp-led-goal-soft">{running ? "period in progress" : "not started"}</span>
        )}
      </div>
      {bb.is_first_goal_period && bb.pre_season_amount > 0.005 && (
        <div className="kpi-ov-cp-led-goal-sub">
          Billed back includes {fmt0(bb.pre_season_amount)} pre-season reimbursables (P1&ndash;P{bb.first_goal_period - 1}); it exceeds this period&rsquo;s transactions above by that amount, matching the Current-Year ledger.
        </div>
      )}
    </div>
  );
}

function PurchasingTable({ derived, expandedWeeks, onToggleWeek, periodCurrent = false, showNumber, dataAttr }) {
  const { weekBands, foot, showVehicle } = derived;
  const leadingCols = showNumber ? 3 : 2; // vendor + type [+ number]
  return (
    <>
      <div className="kpi-ov-cp-led-scroll">
        <table className="kpi-ov-cp-led-tbl">
          <thead>
            <tr>
              <th className="kpi-ov-cp-led-l">Vendor</th>
              <th className="kpi-ov-cp-led-l">Type</th>
              {showNumber && <th className="kpi-ov-cp-led-l">Number</th>}
              <th>Food</th>
              <th>Pack. &amp; Sup.</th>
              {showVehicle && <th>Vehicle</th>}
              <th>Billed back</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {weekBands.map((band) => (
              <PurchasingWeekBand
                key={band.week_start}
                band={band}
                showVehicle={showVehicle}
                showNumber={showNumber}
                leadingCols={leadingCols}
                periodCurrent={periodCurrent}
                open={!!expandedWeeks?.has(band.week_start)}
                onToggle={() => onToggleWeek?.(band.week_start)}
              />
            ))}
            <tr className="kpi-ov-cp-led-foot" data-kpi-ov={`${dataAttr}-foot`}>
              <td className="kpi-ov-cp-led-l" colSpan={leadingCols}>Period total</td>
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

function PurchasingWeekBand({ band, showVehicle, showNumber, leadingCols, periodCurrent = false, open, onToggle }) {
  // Right side of the table: Food + Pack + [Vehicle] + Billed + Total.
  const rightCols = showVehicle ? 5 : 4;
  const colSpan = leadingCols + rightCols;
  const dtRange = fmtWeekRange(band.week_start, band.week_end);
  const stateTag = band.state === "in-progress" ? "kpi-ov-pf-wband-run"
                : band.state === "ahead"       ? "kpi-ov-pf-wband-ahead"
                :                                "kpi-ov-pf-wband-settled";
  const weekTotal = band.food + band.packaging + band.vehicle + band.billed;
  return (
    <>
      <tr className={`kpi-ov-pf-wband ${stateTag}`} data-kpi-ov="purchasing-week-band" data-week-start={band.week_start} data-week-state={band.state} data-kpi-ov-open={open ? "1" : "0"}>
        <td className="kpi-ov-cp-led-l" colSpan={leadingCols}>
          <button
            type="button"
            className="kpi-ov-pf-wbandbtn"
            onClick={onToggle}
            aria-expanded={open ? "true" : "false"}
            data-wk={band.week_start}
          >
            <span className="kpi-ov-pf-chev" aria-hidden="true">{open ? "⌄" : "›"}</span>
            <span className="kpi-ov-pf-wband-label">{dtRange}</span>
            {band.state === "in-progress" && (
              <span className="kpi-ov-pf-wband-tag">
                <span className="kpi-ov-pf-wband-dot" aria-hidden="true" />
                in progress
              </span>
            )}
            {band.state === "ahead" && (
              <span className="kpi-ov-pf-wband-tag kpi-ov-pf-wband-tag-ahead">ahead</span>
            )}
          </button>
        </td>
        <td>{fmt0(band.food)}</td>
        <td>{fmt0(band.packaging)}</td>
        {showVehicle && <td>{fmt0(band.vehicle)}</td>}
        <td className="kpi-ov-cp-led-bb">{fmt0(band.billed)}</td>
        <td className="kpi-ov-pf-wband-total">{fmt0(weekTotal)}</td>
      </tr>
      {open && (band.rows.length === 0 ? (
        <tr className="kpi-ov-cp-led-lrow" data-kpi-ov="purchasing-week-empty">
          <td className="kpi-ov-cp-led-l kpi-ov-cp-led-mute" colSpan={colSpan}>No purchases in this week.</td>
        </tr>
      ) : (
        band.rows.map((r) => {
          const sub = statusSub(r);
          return (
            <tr
              key={r.key}
              className="kpi-ov-cp-led-lrow"
              data-kpi-ov="purchasing-txn"
            >
              <td className="kpi-ov-cp-led-l">
                <span className="kpi-ov-pf-vname">
                  {r.vendor}
                  {r.sga_removed > 0 && (
                    <span className="kpi-ov-cp-led-sga" title="Invoice included SG&A lines that are not part of COGS; the row total is the COGS portion.">
                      {" "}SG&amp;A {fmt0(r.sga_removed)}
                    </span>
                  )}
                </span>
                {sub && (
                  <span className={`kpi-ov-pf-vsub${sub.warn ? " kpi-ov-pf-vsub-warn" : ""}`}>
                    {sub.text}
                  </span>
                )}
                {r.source === "rippling_spend" && (r.person || r.memo || r.hasReceipt != null) && (
                  <span className="kpi-ov-pf-vsub kpi-ov-pf-vcarddetail">
                    {[
                      r.person,
                      r.memo ? `"${r.memo}"` : null,
                      r.hasReceipt === true ? "receipt" : r.hasReceipt === false ? "no receipt" : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                )}
              </td>
              <td className="kpi-ov-cp-led-l kpi-ov-cp-led-mute">{typeLabel(r)}</td>
              {showNumber && (
                <td className="kpi-ov-cp-led-l kpi-ov-cp-led-mute">
                  {r.source === "invoice_submissions" && r.drive_url_stamped
                    ? (
                      <a
                        href={r.drive_url_stamped}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="kpi-ov-pf-numlink"
                        aria-label={r.invoice_number ? `Invoice ${r.invoice_number}, opens stamped PDF in a new tab` : "Invoice, opens stamped PDF in a new tab"}
                        title="Open stamped PDF (new tab)"
                      >{numberLabel(r)}</a>
                    )
                    : numberLabel(r)}
                </td>
              )}
              <td>{cellCell(r.food)}</td>
              <td>{cellCell(r.packaging)}</td>
              {showVehicle && <td>{cellCell(r.vehicle)}</td>}
              <td className="kpi-ov-cp-led-bb">{cellCell(r.billed)}</td>
              <td><b>{fmt0(r.total)}</b></td>
            </tr>
          );
        })
      ))}
    </>
  );
}

function cellCell(n) {
  if (Math.abs(n) < 0.005) return <span className="kpi-ov-cp-led-dim">—</span>;
  return fmt0(n);
}

// Re-export the shared helper so existing callers that imported from
// this module keep working without hunting the new path.
export { uncodedCardCount };
