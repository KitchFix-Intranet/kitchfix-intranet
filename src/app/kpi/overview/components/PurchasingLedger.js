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
// P9: 188 rows, 100% vendor coverage, per-bucket totals match
// `weekly` to the cent on food ($35,081.17), packaging ($3,419.15),
// vehicle ($735.60) and reimbursable ($20,336.89).
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
  return "other";                              // 5000, 5002.5, 5017.3 etc; kept in totals so nothing disappears
}

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

export default function PurchasingLedger({ actuals, vendorRollup, periodLabel }) {
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

    // Uncoded strip (always computed from unfiltered rows so the
    // strip's count and total do not change when the filter chip
    // changes - it is a global signal, not filter-scoped).
    const uncoded = rows.filter(r => !String(r.gl_line_code || "").trim());
    const uncodedTotal = uncoded.reduce((s, r) => s + Number(r.amount || 0), 0);

    // Filtered universe for the table. Kevin R-133 step 5 rule
    // (2026-09-20): uncoded rows never enter the vendor grouping -
    // they are surfaced in the warn strip alone so the vendor table
    // stays clean and the footer's Food column ties to the board.
    // Once a card gets coded, its row starts flowing through here.
    const filtered = rows
      .filter(r => String(r.gl_line_code || "").trim())
      .filter(r => matchesFilter(r.source, filter));

    // Vendor aggregation. `displayVendor` unifies billcom_credit's raw
    // ID with the resolved bill-side name so Sysco is one row not two.
    const byVendor = new Map();
    for (const r of filtered) {
      const raw = r.vendor || "";
      const displayVendor = nameById.get(raw) || raw || "(no vendor)";
      const b = bucketOf(r.gl_line_code);
      const amt = Number(r.amount || 0);
      const entry = byVendor.get(displayVendor) || {
        name: displayVendor,
        food: 0, packaging: 0, vehicle: 0, reimbursable: 0, other: 0,
        lineCount: 0,
        lines: [],
        sources: new Set(),
      };
      entry[b] += amt;
      entry.lineCount += 1;
      entry.sources.add(sourceGroupOf(r.source));
      entry.lines.push(r);
      byVendor.set(displayVendor, entry);
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

    // Footer sums directly from `filtered` so it is invariant against
    // the vendor cap and matches per-bucket sums to the cent. Note
    // filtered has already dropped uncoded rows above; sums here only
    // cover coded lines, which is what Kevin's Part 5 verification
    // requires ("first three are identical to the board's period
    // column directly above" - TBJ P9 Food $35,081.17). Lines counter
    // reports the TOTAL row count (coded + uncoded) so the sub and
    // footer agree ("188 lines · every bill.com invoice and every
    // card charge").
    const foot = { food: 0, packaging: 0, vehicle: 0, reimbursable: 0, other: 0, lines: rows.length };
    for (const r of filtered) foot[bucketOf(r.gl_line_code)] += Number(r.amount || 0);

    return { display, foot, uncoded, uncodedTotal, totalRowsUnfiltered: rows.length };
  }, [actuals, nameById, filter]);

  if (!Array.isArray(actuals) || actuals.length === 0) return null;

  const short = (iso) => (iso || "").slice(5);          // MM-DD
  const cellDollar = (n) => n === 0
    ? <span className="kpi-ov-cp-led-dim">—</span>
    : dollar0(n);

  return (
    <div className="kpi-ov-cp-led-card">
      <div className="kpi-ov-cp-led-head">
        <span className="kpi-ov-cp-led-t">The purchasing ledger</span>
        <span className="kpi-ov-cp-led-sub">
          {periodLabel ? `${periodLabel} · ` : ""}{derived.totalRowsUnfiltered} lines · every bill.com invoice and every card charge
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
                  {isOpen && !v.aggregate && v.lines.map((r, li) => (
                    <tr key={`ln-${v.name}-${li}`} className="kpi-ov-cp-led-lrow">
                      <td className="kpi-ov-cp-led-l">{short(r.txn_date)} · {r.gl_line_code || "not coded"}</td>
                      <td colSpan="4" className="kpi-ov-cp-led-l kpi-ov-cp-led-mute">
                        {r.source === "rippling_spend" ? "card" : r.source === "billcom_credit" ? "credit" : r.source === "upload" ? "upload" : "bill.com"}
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
              <td>{dollar0(derived.foot.food + derived.foot.packaging + derived.foot.vehicle + derived.foot.reimbursable + derived.foot.other)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
