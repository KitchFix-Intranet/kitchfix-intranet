"use client";
// src/app/kpi/overview/components/PurchasingLedger.js
//
// Kevin R-133 step 5 (2026-09-20). Replaces `Every purchase` (kpi-p-sl)
// and `Also purchased · billed back to the club` (kpi-p-rt) with a
// single vendor-grouped ledger on Current + closed single periods.
// This year keeps the two-table shape.
//
// Data source · `payload.actuals` with `?drill=lines`. The purchasing
// page already fetches with drill=lines on single-period ranges (line
// ~291 in purchasing/page.js: `rangeSelectionEarly?.kind === "period"`
// → drill=lines), so `data.actuals` is populated on CP, NP, LP AND
// any specific closed period. Verified 2026-09-20 against TBJ - FL
// P9 + P10: per-bucket footer totals match the board's landedFor()
// output to the cent on food, packaging, vehicle and reimbursable
// (see the "board-tie" comment on the Food computation below).
//
// Why not vendor_rollup? Kevin's reconciliation 2026-09-20: vr is
// $1,185.40 short on TBJ - FL P9. It drops uncoded card charges
// ($1,243.52) and drops a finance-injected $611.41 Vehicle line from
// pnl_actuals (source="upload"). The footer would not tie to the
// board on any account with either kind of row.
//
// Credit resolution · billcom_credit rows carry raw billcom vendor
// IDs (e.g. "00901MIZUOPIBZ2f7ji7") in .vendor because the route's
// resolver only translates `source === "billcom"` (route.js:1343).
// vendor_rollup.rows maps id → resolved name, so a client-side lookup
// unifies credits with their bill-side vendor (Sysco). Without this
// Sysco would appear as two rows in the ledger, one for bills and
// one for credits. Client-only fix; no server change.
//
// Source filter · three chips (All / bill.com / Cards) per Kevin's
// 2026-09-20 ruling. bill.com = billcom + billcom_credit (a credit
// is part of the invoice story). Cards = rippling_spend. upload rows
// (pnl_actuals injections, 2 on TBJ P9) ride in All only.
//
// Cap + All other vendors · vendors are sorted by absolute row total
// descending. Top N render individually; the remainder aggregates
// into "All other vendors" so the footer always ties by construction.

import { Fragment, useMemo, useState } from "react";

const dollar0 = (n) => (Number(n || 0) < 0 ? "-$" : "$") + Math.abs(Math.round(Number(n || 0))).toLocaleString("en-US");
const VENDOR_CAP = 25;

function bucketOf(gl) {
  const s = String(gl || "");
  if (!s.trim())            return "uncoded"; // exclude from vendor rows AND footer buckets; warn strip carries them
  if (s.startsWith("3200")) return "food";
  if (s.startsWith("3400")) return "packaging";
  if (s.startsWith("3500")) return "vehicle";
  if (s.startsWith("13"))   return "reimbursable";
  return "other";                              // 5000, 5002.5, 5017.3 etc - SGA. Excluded from vendor grouping;
                                                // surfaced as the muted "Equipment and repairs" line below the table
                                                // (Kevin R-133 step 5 addition, 2026-09-20).
}
// The four buckets the ledger renders as columns AND that the board
// above shows as rows. In-scope population for vendor grouping.
const IN_SCOPE_BUCKETS = new Set(["food", "packaging", "vehicle", "reimbursable"]);
function isInScope(gl) { return IN_SCOPE_BUCKETS.has(bucketOf(gl)); }

function sourceGroupOf(src) {
  if (src === "billcom" || src === "billcom_credit") return "bill";
  if (src === "rippling_spend") return "card";
  return "upload";
}

function matchesFilter(src, filter) {
  if (filter === "all") return true;
  if (filter === "bill") return src === "billcom" || src === "billcom_credit";
  if (filter === "cards") return src === "rippling_spend";
  return false;
}

export default function PurchasingLedger({ actuals, cardCharges, vendorRollup, rangeStart, rangeEnd, periodLabel }) {
  const [filter, setFilter] = useState("all");
  const [openVendor, setOpenVendor] = useState(null);

  // Vendor ID → resolved name, built from vendor_rollup so a
  // billcom_credit row whose .vendor is the raw ID resolves to the
  // same display name as its billcom sibling (e.g. Sysco TBJ).
  const nameById = useMemo(() => {
    const m = new Map();
    for (const v of (vendorRollup?.rows || [])) {
      if (v.vendor_id && v.name) m.set(v.vendor_id, v.name);
    }
    return m;
  }, [vendorRollup]);

  const derived = useMemo(() => {
    const rows = Array.isArray(actuals) ? actuals : [];
    const cc = Array.isArray(cardCharges) ? cardCharges : [];

    // Uncoded strip (always computed from unfiltered rows so the
    // strip's count and total do not change when the filter chip
    // changes - it is a global signal, not filter-scoped).
    const uncoded = rows.filter(r => !String(r.gl_line_code || "").trim());
    const uncodedTotal = uncoded.reduce((s, r) => s + Number(r.amount || 0), 0);

    // Kevin R-133 step 5 board-tie fix (2026-09-20). CurrentPeriodTable's
    // landedFor("3200") builds Food from `weekly` 3200-prefix rows PLUS
    // `purch.card_charges.rows` whose txn_date falls inside the range's
    // four weeks (ungated by phase - runs on running AND closed). Weekly
    // 3200-prefix corresponds to CODED 3200 lines in actuals; card_
    // charges is the uncoded-card + report-only-pending set the loader
    // publishes (loaders.js:618 filters `source=rippling_spend AND
    // gl_line_code IS NULL` and merges report-only pending).
    //
    // To tie to the board on every phase the ledger's Food therefore
    // must include: coded actuals with gl~"3200" AND every card_
    // charges row whose txn_date is in [rangeStart, rangeEnd].
    //
    // The uncoded rippling_spend actuals rows and the "api"-labeled
    // card_charges rows are the SAME rows underneath (both filter
    // source=rippling_spend AND gl_line_code IS NULL AND txn_date in
    // range), so we exclude uncoded actuals from the ledger's actuals
    // pipeline and route them in via card_charges to avoid a double
    // count. Report-only pending rows only appear in card_charges
    // (they have not landed in purchasing_actuals yet); they enter
    // Food only via this pipeline.
    //
    // Filter rules Kevin ruled on 2026-09-20:
    //   - Out-of-scope actuals (5000/5002.1/5002.5/5017.3 → "other"
    //     bucket = SGA) excluded. Money surfaces as the muted
    //     "Equipment and repairs" line under the table.
    //   - Filter the LINE POPULATION, not vendors after the fact.
    //     Vendors with no in-scope lines legitimately do not appear.
    const inRange = (dateStr) => {
      if (!rangeStart || !rangeEnd) return true;
      const t = String(dateStr || "");
      return t >= rangeStart && t <= rangeEnd;
    };
    const filteredActuals = rows
      .filter(r => isInScope(r.gl_line_code))
      .filter(r => matchesFilter(r.source, filter));
    // Card_charges rows that pass the filter chip. "Cards" chip matches
    // (natural home). "bill.com" chip does not - card charges are
    // never bill invoices. "All" includes them.
    const ccMatchesFilter = filter === "all" || filter === "cards";
    const filteredCC = ccMatchesFilter
      ? cc.filter(r => inRange(r.txn_date))
      : [];

    // Excluded (SGA population, reported as the muted line under the
    // table). Uncoded strip lives on its own.
    const excludedTotal = rows
      .filter(r => bucketOf(r.gl_line_code) === "other")
      .reduce((s, r) => s + Number(r.amount || 0), 0);

    // Vendor aggregation. Two feeds merged:
    //
    //   filteredActuals · in-scope coded rows from purchasing_actuals
    //     (bills + coded card lines + upload/finance). `displayVendor`
    //     unifies billcom_credit's raw ID with its bill-side resolved
    //     name so Sysco is one row not two. Unresolved billcom IDs get
    //     "Unknown vendor (bill.com)" per Kevin 2026-09-20 (one row
    //     per unresolved ID, never merged).
    //
    //   filteredCC · card_charges rows in-range. Bucketed to Food
    //     because that is where landedFor routes them (Kevin's rule:
    //     "count toward Food until someone codes them"). Grouped by
    //     `merchant` (fallback "Unknown vendor (card)" if missing).
    //
    //   Both feeds share the same byVendor map, so a merchant that
    //   appears as both a coded actual and an uncoded card charge
    //   groups under one row (e.g. Sam's Club with a coded Food bill
    //   and an uncoded card charge would sit on one line).
    const byVendor = new Map();
    const addEntry = (key, name, rawId, bucket, amt, sourceGroup, lineRow) => {
      const entry = byVendor.get(key) || {
        name, rawId,
        food: 0, packaging: 0, vehicle: 0, reimbursable: 0, other: 0,
        lineCount: 0,
        lines: [],
        sources: new Set(),
      };
      entry[bucket] += amt;
      entry.lineCount += 1;
      entry.sources.add(sourceGroup);
      entry.lines.push(lineRow);
      byVendor.set(key, entry);
    };
    for (const r of filteredActuals) {
      const raw = r.vendor || "";
      const resolved = nameById.get(raw);
      const looksLikeBillcomId = !resolved
        && (r.source === "billcom" || r.source === "billcom_credit")
        && /^[0-9a-zA-Z]{15,}$/.test(raw);
      const displayVendor = resolved || raw || "(no vendor)";
      const isUnknownBillcom = !resolved && looksLikeBillcomId;
      const groupKey = displayVendor;
      addEntry(
        groupKey,
        isUnknownBillcom ? "Unknown vendor (bill.com)" : displayVendor,
        isUnknownBillcom ? raw : null,
        bucketOf(r.gl_line_code),
        Number(r.amount || 0),
        sourceGroupOf(r.source),
        r,
      );
    }
    for (const c of filteredCC) {
      const merchant = String(c.merchant || "").trim();
      const displayVendor = merchant || "Unknown vendor (card)";
      const groupKey = displayVendor;
      addEntry(
        groupKey,
        displayVendor,
        null,
        "food", // landedFor's rule: card_charges all go to Food
        Number(c.amount || 0),
        "card",
        // Synthesize a line-row shape so the expand renders consistently.
        // `source: "uncoded_card"` distinguishes from a coded card line
        // in the expand label; caller downstream reads it in the source
        // label switch.
        {
          txn_date: c.txn_date,
          gl_line_code: c.gl_line_code || "",
          amount: c.amount,
          source: c.source === "report_only" ? "report_only" : "uncoded_card",
        },
      );
    }
    // Sort by absolute net total desc so credit-heavy vendors surface.
    const vendorList = [...byVendor.values()].map(v => {
      const total = v.food + v.packaging + v.vehicle + v.reimbursable + v.other;
      const primarySource = v.sources.size === 1 ? [...v.sources][0] : "mixed";
      return { ...v, total, primarySource };
    }).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

    // Cap + "All other vendors" aggregate. Kevin: the footer must tie.
    let display = vendorList;
    if (vendorList.length > VENDOR_CAP) {
      const top = vendorList.slice(0, VENDOR_CAP);
      const rest = vendorList.slice(VENDOR_CAP);
      const restAgg = rest.reduce((acc, v) => ({
        name: "All other vendors",
        food: acc.food + v.food,
        packaging: acc.packaging + v.packaging,
        vehicle: acc.vehicle + v.vehicle,
        reimbursable: acc.reimbursable + v.reimbursable,
        other: acc.other + v.other,
        lineCount: acc.lineCount + v.lineCount,
        total: acc.total + v.total,
        primarySource: "mixed",
        aggregate: true,
        aggregateCount: (acc.aggregateCount || 0) + 1,
        lines: [],
      }), {
        name: "All other vendors",
        food: 0, packaging: 0, vehicle: 0, reimbursable: 0, other: 0,
        lineCount: 0, total: 0, primarySource: "mixed",
        aggregate: true, aggregateCount: 0, lines: [],
      });
      display = [...top, restAgg];
    }

    // Footer sums direct from the two filtered feeds so they are
    // invariant against the vendor cap. Coded actuals drive Food/Pack/
    // Veh/Billed; card_charges in-range add to Food (Kevin 2026-09-20
    // "same date test, same source" - mirrors landedFor by construction
    // so it ties on every phase). Line count is the in-scope population
    // (coded actuals + in-range card_charges), matching the sub above.
    const foot = { food: 0, packaging: 0, vehicle: 0, reimbursable: 0, lines: 0 };
    for (const r of filteredActuals) {
      foot[bucketOf(r.gl_line_code)] += Number(r.amount || 0);
      foot.lines += 1;
    }
    for (const c of filteredCC) {
      foot.food += Number(c.amount || 0);
      foot.lines += 1;
    }

    // Line count reported in the sub. Uses the ALL-filter population
    // so the sub is a stable "how many transactions this period"
    // signal that does not shift with the filter chip.
    const inScopeCountAll =
      rows.filter(r => isInScope(r.gl_line_code)).length +
      cc.filter(r => inRange(r.txn_date)).length;

    return {
      display, foot, uncoded, uncodedTotal,
      excludedTotal,
      inScopeCount: inScopeCountAll,
    };
  }, [actuals, cardCharges, nameById, filter, rangeStart, rangeEnd]);

  const hasActuals = Array.isArray(actuals) && actuals.length > 0;
  const hasCards   = Array.isArray(cardCharges) && cardCharges.length > 0;
  if (!hasActuals && !hasCards) return null;

  const short = (iso) => (iso || "").slice(5);          // MM-DD
  const cellDollar = (n) => n === 0
    ? <span className="kpi-ov-cp-led-dim">—</span>
    : dollar0(n);

  return (
    <div className="kpi-ov-cp-led-card">
      <div className="kpi-ov-cp-led-head">
        <span className="kpi-ov-cp-led-t">The purchasing ledger</span>
        <span className="kpi-ov-cp-led-sub">
          {periodLabel ? `${periodLabel} · ` : ""}{derived.inScopeCount} lines · every bill.com invoice and every card charge
        </span>
        <span className="kpi-ov-cp-led-seg" role="group" aria-label="Source filter">
          <button type="button" className={filter === "all"   ? "kpi-ov-cp-led-seg-on" : ""} onClick={() => setFilter("all")} aria-pressed={filter === "all"}>ALL</button>
          <button type="button" className={filter === "bill"  ? "kpi-ov-cp-led-seg-on" : ""} onClick={() => setFilter("bill")} aria-pressed={filter === "bill"}>BILL.COM</button>
          <button type="button" className={filter === "cards" ? "kpi-ov-cp-led-seg-on" : ""} onClick={() => setFilter("cards")} aria-pressed={filter === "cards"}>CARDS</button>
        </span>
      </div>
      {derived.uncoded.length > 0 && (
        <div className="kpi-ov-cp-led-warn" role="status">
          {derived.uncoded.length} card {derived.uncoded.length === 1 ? "charge has" : "charges have"} no P&amp;L line yet · {dollar0(derived.uncodedTotal)} · they count toward Food until someone codes them
        </div>
      )}
      <div className="kpi-ov-cp-led-scroll">
        <table className="kpi-ov-cp-led-tbl">
          <thead>
            <tr>
              <th className="kpi-ov-cp-led-l">Vendor</th>
              <th>Food</th>
              <th>Pack. &amp; Sup.</th>
              <th>Vehicle</th>
              <th>Billed back</th>
              <th>Lines</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {derived.display.map((v, i) => {
              const isOpen = openVendor === v.name;
              return (
                <Fragment key={v.name + "-" + i}>
                  <tr
                    className={`kpi-ov-cp-led-vrow${isOpen ? " kpi-ov-cp-led-vrow-open" : ""}`}
                    onClick={() => !v.aggregate && setOpenVendor(isOpen ? null : v.name)}
                    role={v.aggregate ? undefined : "button"}
                    tabIndex={v.aggregate ? undefined : 0}
                    onKeyDown={v.aggregate ? undefined : (e) => {
                      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenVendor(isOpen ? null : v.name); }
                    }}
                  >
                    <td className="kpi-ov-cp-led-l">
                      {v.name}
                      {v.aggregate ? (
                        <span className="kpi-ov-cp-led-cx">{v.aggregateCount} more</span>
                      ) : (
                        <>
                          <span className={`kpi-ov-cp-led-src${v.primarySource === "card" ? " kpi-ov-cp-led-src-card" : v.primarySource === "mixed" ? " kpi-ov-cp-led-src-mixed" : ""}`}>{v.primarySource === "card" ? "card" : v.primarySource === "mixed" ? "mixed" : "bill.com"}</span>
                          <span className="kpi-ov-cp-led-cx">{isOpen ? "−" : "+"}</span>
                        </>
                      )}
                    </td>
                    <td>{cellDollar(v.food)}</td>
                    <td>{cellDollar(v.packaging)}</td>
                    <td>{cellDollar(v.vehicle)}</td>
                    <td className="kpi-ov-cp-led-bb">{cellDollar(v.reimbursable)}</td>
                    <td>{v.lineCount}</td>
                    <td><b>{dollar0(v.total)}</b></td>
                  </tr>
                  {isOpen && !v.aggregate && v.rawId && (
                    <tr className="kpi-ov-cp-led-lrow">
                      <td className="kpi-ov-cp-led-l kpi-ov-cp-led-mute" colSpan="7">
                        bill.com vendor id: {v.rawId}
                      </td>
                    </tr>
                  )}
                  {isOpen && !v.aggregate && v.lines.map((r, li) => (
                    <tr key={`ln-${v.name}-${li}`} className="kpi-ov-cp-led-lrow">
                      <td className="kpi-ov-cp-led-l">{short(r.txn_date)} · {r.gl_line_code || "not coded"}</td>
                      <td colSpan="4" className="kpi-ov-cp-led-l kpi-ov-cp-led-mute">
                        {r.source === "rippling_spend" ? "card"
                          : r.source === "billcom_credit" ? "credit"
                          : r.source === "upload" ? "upload"
                          : r.source === "uncoded_card" ? "card · not yet coded"
                          : r.source === "report_only" ? "card · report-only pending"
                          : "bill.com"}
                      </td>
                      <td></td>
                      <td>{dollar0(r.amount)}</td>
                    </tr>
                  ))}
                </Fragment>
              );
            })}
            <tr className="kpi-ov-cp-led-foot">
              <td className="kpi-ov-cp-led-l">Total</td>
              <td>{dollar0(derived.foot.food)}</td>
              <td>{dollar0(derived.foot.packaging)}</td>
              <td>{dollar0(derived.foot.vehicle)}</td>
              <td className="kpi-ov-cp-led-bb">{dollar0(derived.foot.reimbursable)}</td>
              <td>{derived.foot.lines}</td>
              <td>{dollar0(derived.foot.food + derived.foot.packaging + derived.foot.vehicle + derived.foot.reimbursable)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      {/* Kevin R-133 step 5 addition (2026-09-20). Muted footer line
          reporting the SGA population that the ledger's four columns
          do not cover (Equipment gl=5002.5, R&M gl=5002.1, Other/SGA
          gl=5000/5017.3). Without this, filtering the line population
          to the four board-mirrored buckets would silently drop real
          spend - on TBJ - FL P9 that is $2,549.94, ~6.5% of the
          period. Omitted entirely when excluded population is $0
          rather than printing "$0". Amount always rendered as its
          absolute value in the copy (credit-only case would read
          "-$" otherwise, and the line's job is to redirect a reader,
          not editorialize on the sign). */}
      {derived.excludedTotal !== 0 && (
        <div className="kpi-ov-cp-led-footnote">
          Equipment and repairs are tracked on the at-risk board · {dollar0(derived.excludedTotal)} this period
        </div>
      )}
    </div>
  );
}
