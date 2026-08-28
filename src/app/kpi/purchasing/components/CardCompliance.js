"use client";
// src/app/kpi/purchasing/components/CardCompliance.js
//
// PR 6 - the compliance card. Owner ruling 2026-08-28: Option B, site
// totals with people revealed on expand. Renders below the ledgers,
// above the drill table. Hides itself when nothing is outstanding
// (E-clause rule: an empty card does not appear).
//
// Population is the report-side sentinel category (uncoded), restricted
// to attributable work locations. Corp/Remote uncoded surfaces as a
// footer note at aggregate scopes only. Age is colored (red 14 / amber
// 7 / neutral); receipts are a plain fraction with no color - on the
// 2026-08-28 corpus 77% of person-rows are all-missing, so color would
// carry no signal (owner ruling 2026-08-28).
//
// Check 3 (site totals sum to their people rows) is asserted dev-side
// with a throw. Check 2 (region_split sums to total_count) rides the
// same gate. Both defect classes are "two things describing one number
// from different inputs" - the family this board has closed on three
// prior surfaces.

import { useState } from "react";
import { fmt$ } from "../lib/board";
import { assertSitePeopleParity, assertRegionParity } from "../lib/complianceAsserts";

// Age tier - purchased_at is the age source (owner ruling 2026-08-28:
// purchased is how long the money has been outstanding; submitted is
// how long since the person acted, which is a different question).
function ageTierClass(days, thresholds) {
  if (days == null) return "";
  if (days >= (thresholds?.red_days   ?? 14)) return "kpi-p-cc-red";
  if (days >= (thresholds?.amber_days ??  7)) return "kpi-p-cc-amber";
  return "";
}

// Age label - "N d" for one-word age, tabular so multi-row columns
// align. Zero = "today". Same shape as the mock.
function ageLabel(days) {
  if (days == null) return "—";
  if (days === 0) return "today";
  return `${days}d`;
}

// Receipts fraction - `N of M`. No color per note 4 ruling.
function receiptsLabel(present, total) {
  if (!total) return "—";
  return `${present} of ${total}`;
}

// Check 2 (region parity) + Check 3 (site/person parity) implementations
// live in ../lib/complianceAsserts so a probe script can seed a
// mismatch and prove they fire. Client-side use throws in dev, wraps in
// a try/catch in production so a broken payload logs but does not
// crash the operator's live board.
function runCheck2And3(data) {
  try {
    assertSitePeopleParity(data.site_rows);
  } catch (err) {
    if (process.env.NODE_ENV !== "production") throw err;
    console.error(err.message, { data });
  }
  try {
    assertRegionParity(data.region_split, data.total_count, data.total_amount);
  } catch (err) {
    if (process.env.NODE_ENV !== "production") throw err;
    console.error(err.message, { data });
  }
}

export function CardCompliance({
  data,           // resolver payload's `compliance` block
  isAggregate,    // ALL / EAST / WEST -> true; single account -> false
  scopeLabel,     // e.g. "All accounts · FYTD" or "CIN - AZ · P8"
}) {
  // E-clause: card does not render when nothing is outstanding.
  if (!data || !data.total_count || data.site_rows.length === 0) {
    return null;
  }

  // Fire assertions on every render - cheap, and the payload can only
  // deliver a mismatch through a route-side bug that the server assert
  // didn't catch.
  runCheck2And3(data);

  // Auto-expand at single-account scope (there's one site row and its
  // people are the point of the card). Owner ruling item asked for:
  // reporting whether single-site auto-expand. Yes - the click-to-open
  // affordance saves nothing when there's only one row.
  const initialOpen = new Set();
  if (!isAggregate && data.site_rows.length === 1) {
    initialOpen.add(data.site_rows[0].site_code);
  }
  const [openSites, setOpenSites] = useState(initialOpen);

  function toggle(site_code) {
    setOpenSites(prev => {
      const next = new Set(prev);
      if (next.has(site_code)) next.delete(site_code); else next.add(site_code);
      return next;
    });
  }

  const heroAge   = data.oldest_age_days;
  const heroAgeCl = ageTierClass(heroAge, data.thresholds);

  return (
    <div className="kpi-p-card kpi-p-cc" data-card="compliance">
      {/* Header - title, scope label, outstanding pill */}
      <div className="kpi-p-cc-head">
        <span className="kpi-p-cardtitle">Card compliance</span>
        <span className="kpi-p-cc-meta">{scopeLabel}</span>
        <span className="kpi-p-cc-sp" />
        <span className="kpi-p-pill a">
          <i />
          {data.total_count} outstanding
        </span>
      </div>

      {/* Numbers block: hero (uncoded $) + oldest age tier + no-receipt count */}
      <div className="kpi-p-cc-nums">
        <div className="kpi-p-cc-hero">
          <span className="kpi-p-label">Not yet coded</span>
          <span className="kpi-p-hero num">{fmt$(data.total_amount)}</span>
          <span className="kpi-p-subline">
            <b>{data.total_count} charge{data.total_count === 1 ? "" : "s"}</b>{" "}
            waiting on a P&amp;L line
          </span>
        </div>
        <div className="kpi-p-cc-sec">
          <div className="kpi-p-cc-stat">
            <span className="kpi-p-cc-k">Oldest</span>
            <span className={`kpi-p-cc-v num ${heroAgeCl}`}>{ageLabel(heroAge)}</span>
          </div>
          <div className="kpi-p-cc-stat">
            <span className="kpi-p-cc-k">No receipt</span>
            {/* Header count is amber-badged - one number, one signal.
                Per-row receipts are uncolored (note 4 ruling). */}
            <span className={`kpi-p-cc-v num${data.no_receipt_count > 0 ? " kpi-p-cc-amber" : ""}`}>
              {data.no_receipt_count}
            </span>
          </div>
        </div>
      </div>

      {/* Column header - only shown at aggregate scopes where the site
          row is meaningful. At single-account scope we auto-expand to
          people directly under the header. */}
      <div className="kpi-p-cc-cols5 kpi-p-cc-colshead">
        <span>{isAggregate ? "Site" : "Who"}</span>
        <span className="kpi-p-cc-r">Charges</span>
        <span className="kpi-p-cc-r">Amount</span>
        <span className="kpi-p-cc-r">Oldest</span>
        <span className="kpi-p-cc-r">Receipts</span>
      </div>

      {/* Site rows + expandable people */}
      <div className="kpi-p-cc-body">
        {data.site_rows.map(site => {
          const isOpen = openSites.has(site.site_code);
          const siteAgeCl = ageTierClass(site.oldest_age_days, data.thresholds);
          return (
            <div key={site.site_code} className="kpi-p-cc-site">
              {isAggregate && (
                <button
                  type="button"
                  className={`kpi-p-cc-siterow kpi-p-cc-cols5${isOpen ? " kpi-p-cc-open" : ""}`}
                  onClick={() => toggle(site.site_code)}
                  aria-expanded={isOpen}
                >
                  <span className="kpi-p-cc-k">
                    <span className={`kpi-p-cc-chev${isOpen ? " kpi-p-cc-chev-open" : ""}`}>▸</span>
                    {site.site_code}
                  </span>
                  <span className="kpi-p-cc-r num">{site.charges}</span>
                  <span className="kpi-p-cc-r num">{fmt$(site.amount)}</span>
                  <span className={`kpi-p-cc-r num ${siteAgeCl}`}>{ageLabel(site.oldest_age_days)}</span>
                  <span className="kpi-p-cc-r num">{receiptsLabel(site.receipts_present, site.receipts_total)}</span>
                </button>
              )}
              {(isOpen || !isAggregate) && site.people.map(p => {
                const pAgeCl = ageTierClass(p.oldest_age_days, data.thresholds);
                const isUnatt = p.key === "__UNATTRIBUTED__";
                return (
                  <div
                    key={`${site.site_code}::${p.key}`}
                    className={`kpi-p-cc-personrow kpi-p-cc-cols5${isAggregate ? " kpi-p-cc-nested" : ""}${isUnatt ? " kpi-p-cc-unatt" : ""}`}
                  >
                    <span className="kpi-p-cc-k">{p.label}</span>
                    <span className="kpi-p-cc-r num">{p.charges}</span>
                    <span className="kpi-p-cc-r num">{fmt$(p.amount)}</span>
                    <span className={`kpi-p-cc-r num ${pAgeCl}`}>{ageLabel(p.oldest_age_days)}</span>
                    <span className="kpi-p-cc-r num">{receiptsLabel(p.receipts_present, p.receipts_total)}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Footer:
            aggregate scopes: Corp/Remote note + Open Rippling link
            single account:   Open Rippling link
          Corp/Remote line carries oldest_age_days so a nine-month-old
          Remote charge (275d observed on the 2026-08-28 corpus) is
          visible even though the card's scope excludes those rows. */}
      <div className="kpi-p-cc-foot">
        {data.corp_remote && (
          <div className="kpi-p-cc-footnote">
            <b>{data.corp_remote.count}</b> charge{data.corp_remote.count === 1 ? "" : "s"} at Corporate and Remote are also uncoded — they carry no site attribution · oldest <b>{ageLabel(data.corp_remote.oldest_age_days)}</b>.
          </div>
        )}
        {data.stale_over_90d.count > 0 && (
          <div className="kpi-p-cc-footnote kpi-p-cc-footnote-alert">
            <b>{data.stale_over_90d.count}</b> charge{data.stale_over_90d.count === 1 ? "" : "s"} on this card sit past <b>90 days</b> ({fmt$(data.stale_over_90d.amount)}).
          </div>
        )}
      </div>
    </div>
  );
}
