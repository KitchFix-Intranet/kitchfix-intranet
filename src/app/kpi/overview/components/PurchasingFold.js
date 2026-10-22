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
//
// Prior draft split 3200.2 into Pack & Sup, which put the ledger $297.91
// out of tie with the board's Food line on TBJ - FL P9 (Kevin's ruling
// referenced the workbook to correct). This rule now matches
// GL_PREFIX_FOR_BUCKET on 3200 / 3400 / 3500; the fold + board tie on
// every bucket, every period.
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
import { CARD_FEED_PAUSED } from "./CurrentPeriodReview";

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

// Kevin ruling 2026-09-22 (revised). 3200.* all sub-lines including
// Resale Food 3200.2 -> Food; 3400.* -> Pack & Sup; 3500.* -> Vehicle;
// 13* -> Billed back; 5* -> SG&A (dropped). Any other code (uncoded /
// anything not matching) falls to null and does not enter the table.
function bucketOf(gl) {
  const s = String(gl || "").trim();
  if (!s) return null;                            // uncoded - handled separately
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
//   invoice_submissions type='invoice'         -> "Invoice"
//   invoice_submissions type='credit'          -> "Credit"
//   billcom                                    -> "Invoice"   (pre-cutover bills)
//   billcom_credit                             -> "Credit"    (pre-cutover credits)
//   upload                                     -> "Invoice"   (finance-injected)
//   rippling_spend                             -> "Card"
//   invoice_submissions status='sent'          -> "Submitted"
//   invoice_submissions status='returned'      -> "Returned"
//   rippling_spend group has any uncoded line  -> "Needs coding"
//
// Editorial (2026-09-25). Status was a standalone column, retired
// here. The signal moves to two places on the row: a 3px amber rail
// on the vendor cell when the group needs coding (statusRail), and
// a second line inside the vendor cell (statusSub) reading the same
// text an operator saw in the old column. Rail predicate is
// uncodedLines > 0 - the same test statusLabel used before, so the
// signal is unchanged; only its render surface moved.
function typeLabel(r) {
  if (r.source === "invoice_submissions") return r.type === "credit" ? "Credit" : "Invoice";
  if (r.source === "billcom_credit")      return "Credit";
  if (r.source === "billcom")             return "Invoice";
  if (r.source === "upload")              return "Invoice";
  if (r.source === "rippling_spend")      return "Card";
  return "—";
}
// Sub-line rendered under the vendor name. Kevin ruling 2026-10-05:
// a sub-line here doubles the row height for the whole table, so
// restrict it to EXCEPTION states only. "Submitted" is retired - it
// renders on effectively every invoice row and the label is almost
// always identical. "Needs coding" moves inline next to the vendor
// name (see JSX render below) so the row stays one line. "Returned"
// kept as a sub-line because it IS an exception the operator must
// read.
function statusSub(r) {
  if (r.source === "invoice_submissions" && r.status === "returned") {
    return { text: "Returned", warn: false };
  }
  return null;
}
// Rail predicate. Same uncodedLines > 0 test the retired statusLabel
// used - one source of truth for "row needs work" so the rail and any
// future header count read the same population.
function needsCodingRail(r) {
  return r.source === "rippling_spend" && r.uncodedLines > 0;
}
function numberLabel(r) {
  if (r.source === "invoice_submissions") return r.invoice_number ? `#${r.invoice_number}` : "—";
  // Kevin ruling 2026-09-24. source_bill_id is a ULID; the first 8
  // hex chars encode the millisecond epoch, so multiple bills within
  // the same ms collide on slice(0, 8). Measured on the ledger since
  // 2026-08-10: 1,952 distinct charges collapsed into 1,032 distinct
  // 8-char prefixes - roughly half the numbers on screen were shared
  // by unrelated charges, which is why three different American
  // Airlines charges displayed under one # and looked like duplicates.
  // slice(0, 13) is fully unique over the same set (measured), and
  // keeps the chronological-scan property operators are used to (the
  // ULID timestamp prefix stays visible).
  return r.source_bill_id ? `#${String(r.source_bill_id).slice(0, 13)}` : "—";
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
        // Kevin ruling 2026-10-06: Drive links + submitter uploaded by
        // the loader at paginateInvoiceSubmissions. drive_url_stamped
        // is drive_urls[0] (the stamped PDF matching the GL coding).
        // Fold renders the invoice number as an anchor to this URL;
        // raw + submitter ship on the wire now so a later rendering
        // ruling does not need another loader change.
        drive_url_stamped: r.drive_url_stamped || null,
        drive_url_raw: r.drive_url_raw || null,
        submitter_email: r.submitter_email || null,
        txn_date: r.txn_date,
        sga_removed: 0,
        // buckets:
        food: 0, packaging: 0, vehicle: 0, billed: 0,
        // metadata:
        hasCogs: false,
        allSga: true,
        anyLine: false,
        // Card coding counts. statusLabel reads these to answer
        // "Coded" (all lines have a gl_line_code) vs "Needs coding"
        // (any one line is still uncoded). Group-level, not line-
        // level, because a card bill can be GL-split across lines.
        codedLines: 0,
        uncodedLines: 0,
        rawLines: [],
      };
      groups.set(key, g);
    }
    const b = bucketOf(r.gl_line_code);
    g.anyLine = true;
    g.rawLines.push(r);
    if (r.source === "rippling_spend") {
      if (r.gl_line_code) g.codedLines += 1;
      else                g.uncodedLines += 1;
    }
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

// Fold header summary. Reads uncoded card charge count + dollar amount
// from payload.card_charges (loadCardCharges in src/lib/purchasing/
// loaders.js). Rendered on the header at --kpi-t-meta so the collapsed
// fold still names the work outstanding. Zero-uncoded state renders
// nothing rather than "0 charges" - a collapsed fold with a busy label
// on a quiet account reads louder than the account deserves.
function foldHeaderSummary(payload) {
  const cc = payload?.card_charges;
  if (!cc) return null;
  const n = Number(cc.total_count || 0);
  if (n <= 0) return null;
  const amt = fmt0(cc.total_amount || 0);
  return `${n} card ${n === 1 ? "charge" : "charges"} awaiting coding · ${amt}`;
}

// Kevin ruling 2026-10-13 (cleanup). The `account` prop was accepted but
// never read inside this component. Callers in page.js stopped passing
// it in the same PR. Dropped from the signature.
export default function PurchasingFold({ payload, error, start, end, today, open, onToggle, billbackPeriod, periodCurrent = false }) {
  const actuals = Array.isArray(payload?.actuals) ? payload.actuals : null;
  // Card-coding chrome (header badge, feed-updating banner, uncoded
  // strip) renders ONLY on the running single-period mount. Closed /
  // CY mounts pass periodCurrent={false} so a closed Finance period
  // does not display fake pending work or Food-inflating uncoded
  // messaging. The underlying table + buckets render on every mount.
  const headerSummary = periodCurrent ? foldHeaderSummary(payload) : null;
  // Kevin ruling 2026-10-12. Purchasing weeks collapse by default; a chevron
  // on the band row expands that week's transactions. Mirrors the labor
  // WeekTable disclosure. Set keyed by week_start ISO so toggling preserves
  // state across re-renders triggered by payload refreshes.
  const [expandedWeeks, setExpandedWeeks] = useState(() => new Set());
  const toggleWeek = (wk) => setExpandedWeeks((prev) => {
    const next = new Set(prev);
    if (next.has(wk)) next.delete(wk); else next.add(wk);
    return next;
  });

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
    const ascendingBands = [...byWeek.values()];
    // PR B item B5 (Kevin ruling 2026-09-23). Reorder weeks for display:
    // - Running period: current (in-progress) week first, then settled
    //   weeks most-recent-first, then any future (ahead) weeks last.
    //   e.g. WK3, WK2, WK1, WK4. Kevin's rule (future week has no
    //   purchases, so it goes last, not before the current week).
    // - Closed period: no in-progress week; reverse to most-recent-first
    //   (WK4, WK3, WK2, WK1). This is my inference, not Kevin's ruling;
    //   flagged for his review.
    // Period footer total is computed from the whole set above and is
    // order-independent; not affected by this reordering.
    const inProgress = ascendingBands.find(b => b.state === "in-progress");
    const weekBands = inProgress
      ? [
          inProgress,
          ...ascendingBands.filter(b => b.state === "settled").reverse(),
          ...ascendingBands.filter(b => b.state === "ahead"),
        ]
      : [...ascendingBands].reverse();

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
      className={`kpi-ov-card kpi-ov-mt kpi-ov-fold-card kpi-ov-fold-panel kpi-ov-fold-strip-purch${open ? " kpi-ov-fold-open" : ""}`}
      data-kpi-ov="purchasing-ledger"
      data-kpi-ov-open={open ? "1" : "0"}
    >
      {/* Kevin ruling 2026-10-12 (follow-up). Title + HelpPop live as a
          static left cluster inside .kpi-ov-fold-head; the trigger button
          (now summary + chevron only) fills the rest of the row and stays
          the fold click target. Title moved OUT of the trigger because the
          "?" is a sibling button that cannot nest inside the trigger
          (button-in-button is invalid HTML). The .kpi-ov-fold-meta row the
          prior PR introduced for this fold is retired - PnlStatement still
          uses the class, so the CSS rule stays. */}
      <div className="kpi-ov-fold-head">
        <span className="kpi-ov-eb">Purchasing detail</span>
        <HelpPop id="qPurchasingFold" title="The purchasing table" body={HELP_BODY} />
        <button
          type="button"
          className="kpi-ov-fold-trigger"
          data-kpi-ov="fold-purchasing"
          onClick={onToggle}
          aria-expanded={open ? "true" : "false"}
        >
          {headerSummary && (
            <span className="kpi-ov-fold-summary" data-kpi-ov="purchasing-fold-summary">{headerSummary}</span>
          )}
          <span className="kpi-ov-fold-cv" aria-hidden="true">▾</span>
        </button>
      </div>
      {open && (
        <>
          <div className="kpi-ov-cb">
            {periodCurrent && CARD_FEED_PAUSED && (
              <div
                className="kpi-ov-cp-mute"
                data-kpi-ov="purchasing-card-feed-paused"
                style={{ padding: "10px 18px", fontSize: "var(--kpi-t-meta)", fontWeight: 600 }}
              >
                Card spend feed updating - back online this week
              </div>
            )}
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
              <>
                <PurchasingTable
                  derived={derived}
                  expandedWeeks={expandedWeeks}
                  onToggleWeek={toggleWeek}
                  periodCurrent={periodCurrent}
                />
                <PurchasingGoalRow billbackPeriod={billbackPeriod} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// PR-billback-2. Goal row for the single-period surface. Renders under the
// purchasing period total. All figures come from the resolver's
// billback_period (same source as the Current-Year ledger); this only
// formats + tones. Tone: over = amber (notable, pass-through, not a loss),
// under = green, otherwise neutral - the same meaning the card/ledger use.
function PurchasingGoalRow({ billbackPeriod }) {
  const bb = billbackPeriod;
  // Kevin ruling 2026-10-12 (TXR-TX-H chart slot fix). `!bb` catches non-MF
  // single-period views (resolver ships null). `bb.annual_goal == null`
  // catches MF accounts with no kpi_billback_goals row (TXR - TX - H) where
  // buildBillbackPeriod returned a full row object with null annual_goal.
  // Same pattern BillbackLedger uses.
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

function PurchasingTable({ derived, expandedWeeks, onToggleWeek, periodCurrent = false }) {
  const { uncoded, weekBands, foot, showVehicle } = derived;
  return (
    <>
      {periodCurrent && uncoded.n > 0 && (
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
              <th className="kpi-ov-cp-led-l">Number</th>
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
                open={!!expandedWeeks?.has(band.week_start)}
                onToggle={() => onToggleWeek?.(band.week_start)}
              />
            ))}
            <tr className="kpi-ov-cp-led-foot" data-kpi-ov="purchasing-ledger-foot">
              <td className="kpi-ov-cp-led-l" colSpan={3}>Period</td>
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

function PurchasingWeekBand({ band, showVehicle, open, onToggle }) {
  // Editorial (2026-09-25). Status column retired: leading label
  // columns drop from 4 (vendor + type + status + number) to 3 (vendor
  // + type + number). Both the computed colSpan for empty-week rows
  // AND the two hardcoded colSpan sites (band label + period footer)
  // move together - a mismatched pair would shear the table on empty
  // weeks or across showVehicle transitions.
  // Right side is Food + Pack + [Vehicle] + Billed + Total = 5/4, not
  // 4/3. Pre-existing off-by-one carried over from `4 + (showVehicle
  // ? 4 : 3)` (Kevin ruling 2026-09-25, post PR-1222 review); affects
  // only the lone-td empty-week row, which was leaving one blank cell
  // at the right.
  const colSpan = 3 + (showVehicle ? 5 : 4); // vendor + type + number + buckets + total column count
  const dtRange = `${band.week_start.slice(5)} – ${band.week_end.slice(5)}`;
  const stateTag = band.state === "in-progress" ? "kpi-ov-pf-wband-run"
                : band.state === "ahead"       ? "kpi-ov-pf-wband-ahead"
                :                                "kpi-ov-pf-wband-settled";
  const weekTotal = band.food + band.packaging + band.vehicle + band.billed;
  return (
    <>
      <tr className={`kpi-ov-pf-wband ${stateTag}`} data-kpi-ov="purchasing-week-band" data-week-start={band.week_start} data-week-state={band.state} data-kpi-ov-open={open ? "1" : "0"}>
        <td className="kpi-ov-cp-led-l" colSpan={3}>
          {/* Kevin ruling 2026-10-12. Week band becomes a chevron toggle;
              bucket subtotals on this row stay visible so a collapsed
              week still carries its summary. Mirrors the labor WeekTable
              week disclosure. Default is collapsed - the containing Set
              starts empty, so opening the fold shows one row per week
              with subtotals, and clicking a week reveals its transactions. */}
          <button
            type="button"
            className="kpi-ov-pf-wbandbtn"
            onClick={onToggle}
            aria-expanded={open ? "true" : "false"}
            data-wk={band.week_start}
          >
            <span className="kpi-ov-pf-chev" aria-hidden="true">{open ? "⌄" : "›"}</span>
            <span className="kpi-ov-pf-wband-label">{`Week · ${dtRange}`}</span>
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
        band.rows.map((r, i) => {
          const sub = statusSub(r);
          const rail = needsCodingRail(r);
          return (
            <tr
              key={r.key}
              className="kpi-ov-cp-led-lrow"
              data-kpi-ov="purchasing-txn"
              data-status-rail={rail ? "1" : "0"}
            >
              <td className="kpi-ov-cp-led-l">
                <span className="kpi-ov-pf-vname">
                  {r.vendor}
                  {r.sga_removed > 0 && (
                    <span className="kpi-ov-cp-led-sga" title="Invoice included SG&A lines that are not part of COGS; the row total is the COGS portion.">
                      {" "}SG&amp;A {fmt0(r.sga_removed)}
                    </span>
                  )}
                  {rail && (
                    <span className="kpi-ov-pf-vneedscoding">Needs coding</span>
                  )}
                </span>
                {sub && (
                  <span className={`kpi-ov-pf-vsub${sub.warn ? " kpi-ov-pf-vsub-warn" : ""}`}>
                    {sub.text}
                  </span>
                )}
              </td>
              <td className="kpi-ov-cp-led-l kpi-ov-cp-led-mute">{typeLabel(r)}</td>
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
