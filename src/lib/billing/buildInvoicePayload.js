// ═══════════════════════════════════════════════════════════════════
// buildInvoicePayload - the pure invoice transform (PR-B, sc-31)
// 2026-08-07
// ═══════════════════════════════════════════════════════════════════
//
// Spec authority: docs/SC_QBO_SHAPE_SPEC.md §4 (builder rules) + §5
// (mapping table shapes). PR-C wires the adapter; this file NEVER
// writes to QBO and never emits network traffic.
//
// PURE FUNCTION. No side effects, no imports of DB clients, no
// network calls. Caller fetches `rows` (sc_daily_revenue), reads
// `accountMap` (one sc_qbo_account_map row) and `serviceMap`
// (sc_qbo_service_map rows for the account), and hands them in.
//
// ─── The five hard rules (spec §4, encoded exactly) ───────────────
//   1. Actuals only. `actual_count IS NOT NULL AND > 0` participates
//      as a MEAL line. `is_flat_fee` services with ANY actual row on
//      the week emit one weekly line at qty=1 (see rule 6).
//   2. `is_non_revenue` rows are dropped silently.
//   2b. `export_excluded` rows (mapping-side flag from sc-38) are
//       dropped from line emission but the row's revenue stays in
//       sc_daily_revenue. Distinct from rule 2: is_non_revenue drops
//       from revenue math itself; export_excluded drops from invoice
//       lines only. TBR B&G Lunch is the first case (Sebastian bills
//       B&G outside the system; B&G revenue must remain in TBR
//       account totals per Kevin's kitchen-margin rule).
//   3. Unmapped service handling (owner ruling 2026-08-10, retro-
//      shadow round 1 finding B):
//        actual_count > 0  and  unmapped -> THROW (real data being
//                                           ignored; add to
//                                           sc_qbo_service_map).
//        actual_count == 0 (or null) and unmapped -> WARN + SKIP
//                                           (zero-count rows produce
//                                           no line; only warn so
//                                           unmapped services still
//                                           surface without blocking
//                                           finalize on empty rows).
//      Applies to BOTH meal rows and FF rows.
//   4. Aggregate-group merge: same aggregate_group AND identical
//     cent-rounded rate merge into ONE line per day. Differing
//     rates within the same group SPLIT lines (rate-guard; CIN - AZ
//     Rehab Continental Plus vs meals is the case).
//   5. UnitPrice = SC price rounded to cents; Amount = rounded rate
//      x qty (rounded to cents). Storage stays 4dp (R10); rounding
//      matches Sebastian's observed practice + the live invoices.
//   6. Flat-weekly (`is_flat_fee`): one line PER WEEK at the flat
//      rate, qty 1. Bi-weekly combined payload carries two (one per
//      week). One line per is_flat_fee service that has ANY actual
//      row on the week. (If a week has zero rows for the FF service,
//      no line. But observed practice: FF services are always billed
//      each week.)
//
// ─── Line description convention (owner ruling 2026-08-10) ────────
//   `plain_name` line_desc_style emits `mapping.qbo_line_description` as
//   the invoice-line description, NOT the SC row's service_name.
//   The mapping's qbo_line_description field carries Sebastian's typed
//   convention (e.g. "Fountain Beverages"), NOT the QB item's
//   registered Name (e.g. "REDS Fountain Beverages"). QBO's ItemRef
//   resolves by `value` (id) at post time; `name` is a display hint
//   the API accepts as-is. sc-31a documents the seed convention.
//
// ─── Bi-weekly period-aligned rule (owner amendment 2026-08-06) ───
//   For cadence='biweekly': pairs are P.week1-2 and P.week3-4 of
//   each fiscal period. Derived from the fiscal calendar in
//   `sc_day_metadata` (which the caller has ALREADY joined into
//   `rows` via sc_daily_revenue's `period` and `week_label`
//   columns).
//
//   Input: weekStart = FIRST Monday of the pair (Monday of Week 1
//   or Week 3). Builder validates:
//     - all rows.service_date lie in weeks 1-2 OR 3-4 of the SAME
//       period as weekStart
//     - the pair spans exactly 14 days
//     - period is NOT P13 (undefined pairing; hard-fail)
//
//   TxnDate = the Sunday closing week 2 (or week 4). That Sunday is
//   `weekStart + 13 days`.
//
// ─── Output shape ─────────────────────────────────────────────────
//   { invoices: Array<Invoice>, warnings: Array<string> }
//   Invoice = { CustomerRef, TxnDate, TxnTaxDetail (with taxcode
//   only; QBO computes amount), Line[] with SalesItemLineDetail }
//
//   `invoices` has 2 elements for CIN - AZ (main + rehab slot) and
//   1 for everyone else. Empty `invoices[]` if no billable actuals
//   (still valid; caller decides what to do).

const MEAL_ORDER = new Map([
  ["Breakfast",              10],
  ["Continental Breakfast",  15],
  ["Continental Plus",       15],
  ["Lunch",                  20],
  ["Dinner",                 30],
  ["Pre-Game",               35],
  ["Post-Game",              40],
  ["Post Game Meal",         40],
  ["Umpire",                 50],
  ["Umpire Meal",            50],
  ["Snack",                  60],
  ["Pre-Game Hot Snack",     61],
  ["Regular Snack",          62],
]);

// Stable comparator for aggregate group members. Falls back to
// alphabetical for anything we do not know explicitly.
function compareMealOrder(a, b) {
  const oa = MEAL_ORDER.get(a) ?? 999;
  const ob = MEAL_ORDER.get(b) ?? 999;
  if (oa !== ob) return oa - ob;
  return a.localeCompare(b);
}

// Cent rounding via banker's-friendly Math.round to avoid fp jitter.
// (Sebastian's manual entries have historically used away-from-zero
// half-round; Math.round matches on all the fixture rates observed.)
function roundToCent(x) {
  if (x == null || !isFinite(Number(x))) return null;
  return Math.round(Number(x) * 100) / 100;
}

// Compose the multi-component line description matching the observed
// invoice shape:
//   1 comp:  "A"                    (plain meal name; matches Sebastian's
//                                    Rehab convention on live invoices)
//   2 comps: "A - N & B - M. Total = X."
//   3 comps: "A - N, B - M, & C - K. Total = X."
//   N comps: Oxford-comma-with-ampersand style
//
// Single-component convention (fixture-verified K300168900):
// Sebastian types just "Lunch" for single-meal Rehab days, not
// "Lunch - 17. Total = 17." The rule was inferred from live
// invoices; multi-meal days get the composed "Total =" suffix and
// single-meal days get the plain name.
function composeAggregateDescription(components) {
  if (components.length === 0) return "";
  const sorted = [...components].sort((a, b) => compareMealOrder(a.name, b.name));
  if (sorted.length === 1) return sorted[0].name;
  const total = sorted.reduce((s, c) => s + c.qty, 0);
  const parts = sorted.map((c) => `${c.name} - ${c.qty}`);
  let joined;
  if (parts.length === 2) joined = `${parts[0]} & ${parts[1]}`;
  else {
    // "A, B, & C" (Oxford + ampersand)
    joined = `${parts.slice(0, -1).join(", ")}, & ${parts[parts.length - 1]}`;
  }
  return `${joined}. Total = ${total}.`;
}

// Derive the day-of-week (0=Sun..6=Sat) from an ISO date.
function isoDow(iso) {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

// Add N days to an ISO date; returns ISO string.
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Parse a week_label like "Week 1" -> 1.
function parseWeekIndex(label) {
  if (typeof label !== "string") return null;
  const m = label.match(/^Week\s+(\d+)$/i);
  return m ? Number(m[1]) : null;
}

// ─── Main entry ───────────────────────────────────────────────────
export function buildInvoicePayload({
  accountKey,
  weekStart,       // ISO Monday
  rows,            // sc_daily_revenue rows (already fetched by caller)
  accountMap,      // sc_qbo_account_map row for accountKey
  serviceMap,      // sc_qbo_service_map rows for accountKey
}) {
  if (!accountKey) throw new Error("buildInvoicePayload: accountKey required");
  if (!weekStart) throw new Error("buildInvoicePayload: weekStart required");
  if (!accountMap) throw new Error(`buildInvoicePayload: accountMap missing for ${accountKey}`);
  if (!Array.isArray(rows)) throw new Error("buildInvoicePayload: rows must be an array");
  if (!Array.isArray(serviceMap)) throw new Error("buildInvoicePayload: serviceMap must be an array");
  if (isoDow(weekStart) !== 1) {
    throw new Error(`buildInvoicePayload: weekStart must be a Monday (ISO), got ${weekStart}`);
  }

  const warnings = [];

  // Compute the target date range.
  const isBiweekly = accountMap.cadence === "biweekly";
  const spanDays = isBiweekly ? 14 : 7;
  const lastDate = addDays(weekStart, spanDays - 1);
  const closingSunday = lastDate; // weekStart + 6 (weekly) or +13 (biweekly), always a Sunday

  // Filter rows to the target span.
  const inSpan = (rows || []).filter((r) => {
    const d = String(r.service_date).slice(0, 10);
    return d >= weekStart && d <= lastDate;
  });

  // ─── Biweekly period alignment (owner amendment 2026-08-06) ────
  if (isBiweekly) {
    // Every row must have a period; all must share ONE period.
    const periods = new Set(inSpan.map((r) => r.period).filter(Boolean));
    if (periods.size > 1) {
      throw new Error(
        `buildInvoicePayload: biweekly ${accountKey} pair rows span multiple periods ${JSON.stringify([...periods])}. Pairs must be period-aligned (P.week1-2 or P.week3-4).`
      );
    }
    if (periods.size === 0 && inSpan.length > 0) {
      throw new Error(
        `buildInvoicePayload: biweekly ${accountKey} rows carry no period; sc_day_metadata missing?`
      );
    }
    const period = [...periods][0];
    if (period === "13") {
      throw new Error(
        `buildInvoicePayload: P13 has 3 weeks; bi-weekly pairing is undefined for ${accountKey} P13. Halt.`
      );
    }
    // Week labels must be exactly Weeks 1+2 or Weeks 3+4.
    const wks = new Set(inSpan.map((r) => parseWeekIndex(r.week_label)).filter((n) => n != null));
    const valid12 = wks.size === 2 && wks.has(1) && wks.has(2);
    const valid34 = wks.size === 2 && wks.has(3) && wks.has(4);
    if (inSpan.length > 0 && !(valid12 || valid34)) {
      throw new Error(
        `buildInvoicePayload: biweekly ${accountKey} weekStart ${weekStart} does not span Weeks 1-2 or 3-4 of P${period}; got weeks ${JSON.stringify([...wks])}`
      );
    }
  }

  // ─── Index serviceMap for O(1) lookup ─────────────────────────
  const svcMapById = new Map(serviceMap.map((s) => [s.service_id, s]));

  // ─── Classify rows: MEAL vs FF, drop non-revenue, refuse unmapped
  // for any row that WOULD produce a line ─────────────────────────
  const mealRows = [];         // { date, service_id, service_name, actual_count, price, is_flat_fee, is_non_revenue }
  const ffPerWeek = new Map(); // week_index (1..N) -> Map<service_id, { any_actual }>

  // For biweekly: we consider the 14 days as two weeks. Week 1 =
  // days 0-6 from weekStart; Week 2 = days 7-13. For weekly: just
  // week 1.
  const weekIndexFor = (dateIso) => {
    const idx = Math.floor((new Date(`${dateIso}T12:00:00Z`) - new Date(`${weekStart}T12:00:00Z`)) / 86400000);
    return idx < 7 ? 1 : 2;
  };

  for (const r of inSpan) {
    // is_non_revenue drop (rule 2).
    if (r.is_non_revenue) continue;
    // No actual_count = no operational data; skip (would be a
    // no-service day or unentered day; either way not billable).
    if (r.actual_count == null) continue;

    // Lookup mapping here so both rule 2b + the unmapped-service
    // policy below can read it without re-fetching.
    const mapping = svcMapById.get(r.service_id);

    // export_excluded drop (rule 2b, sc-38 2026-09-02): mapping row
    // asserts the service is billed outside the system. Line emission
    // is suppressed; revenue in sc_daily_revenue is unchanged (the
    // row already contributed to actual_revenue via the view's
    // LATERAL price join). B&G Lunch on TBR - FL is the first case.
    if (mapping && mapping.export_excluded) continue;

    // Unmapped-service policy (owner ruling 2026-08-10):
    //   actual_count > 0  and unmapped -> THROW (real data lost if
    //                                     we billed without mapping).
    //   actual_count == 0 and unmapped -> WARN + SKIP (no line
    //                                     produced anyway; only
    //                                     surface so ops can see
    //                                     the unmapped row).
    const qty = Number(r.actual_count);
    if (r.is_flat_fee) {
      if (!mapping) {
        if (qty === 0) {
          warnings.push(
            `unmapped FF service ${r.service_name} (${r.service_id}) on ${accountKey} ${r.service_date} skipped (zero actual_count).`
          );
          continue;
        }
        throw new Error(
          `buildInvoicePayload: unmapped FF service ${r.service_name} (${r.service_id}) on ${accountKey} ${r.service_date} - add to sc_qbo_service_map before finalize.`
        );
      }
      // FF services always bill weekly at qty=1 when any row exists.
      // A zero-actual FF row still contributes presence (spec §4
      // rule 6: observed practice bills every week).
      const wIdx = weekIndexFor(String(r.service_date).slice(0, 10));
      const wKey = String(wIdx);
      if (!ffPerWeek.has(wKey)) ffPerWeek.set(wKey, new Map());
      const wMap = ffPerWeek.get(wKey);
      if (!wMap.has(r.service_id)) {
        wMap.set(r.service_id, {
          service_id: r.service_id,
          service_name: r.service_name,
          mapping,
          price: Number(r.actual_price_at_date ?? r.price_at_date ?? 0),
        });
      }
      continue;
    }

    // Meal rows: skip zero-qty actuals (they contribute nothing).
    // If the row is ALSO unmapped, warn so it still surfaces.
    if (qty === 0) {
      if (!mapping) {
        warnings.push(
          `unmapped service ${r.service_name} (${r.service_id}) on ${accountKey} ${r.service_date} skipped (zero actual_count).`
        );
      }
      continue;
    }
    if (!mapping) {
      throw new Error(
        `buildInvoicePayload: unmapped service ${r.service_name} (${r.service_id}) on ${accountKey} ${r.service_date} - add to sc_qbo_service_map before finalize.`
      );
    }
    mealRows.push({
      date: String(r.service_date).slice(0, 10),
      service_id: r.service_id,
      service_name: r.service_name,
      qty: Number(r.actual_count),
      price: Number(r.actual_price_at_date ?? r.price_at_date ?? 0),
      mapping,
    });
  }

  // ─── Group per (day, qbo_item, cent-rounded-rate) ─────────────
  // Same aggregate_group + same cent-rounded rate = one line.
  // Different aggregate_group OR different cent-rate = separate lines.
  const bySlot = new Map(); // slot -> Array<Line>
  const upsertLine = (slot, line) => {
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(line);
  };

  // Group meal rows by (date, invoice_slot, aggregate_group, cent-rate)
  const groupKey = (r) => {
    const rate = roundToCent(r.price);
    const grp = r.mapping.aggregate_group || `__solo__${r.service_id}`;
    return `${r.date}|${r.mapping.invoice_slot}|${r.mapping.qbo_item_id}|${grp}|${rate.toFixed(2)}`;
  };
  const grouped = new Map();
  for (const mr of mealRows) {
    const k = groupKey(mr);
    if (!grouped.has(k)) grouped.set(k, []);
    grouped.get(k).push(mr);
  }

  for (const bucket of grouped.values()) {
    const first = bucket[0];
    const slot = first.mapping.invoice_slot;
    const rate = roundToCent(first.price);
    const totalQty = bucket.reduce((s, r) => s + r.qty, 0);
    const amount = roundToCent(rate * totalQty);

    // Description composition:
    //   aggregate_group (any bucket size) -> composed (plain name
    //   for single component; "Total = X." shape for multi)
    //   solo + line_desc_style='plain_name' -> mapping.qbo_line_description
    //     (owner ruling 2026-08-10: the mapping carries Sebastian's
    //      typed convention; SC service_name is not authoritative
    //      for line descriptions)
    //   solo + no line_desc_style           -> empty
    let description;
    if (first.mapping.aggregate_group) {
      const comps = bucket.map((r) => ({ name: r.service_name, qty: r.qty }));
      description = composeAggregateDescription(comps);
    } else if (first.mapping.line_desc_style === "plain_name") {
      description = first.mapping.qbo_line_description;
    } else {
      description = "";
    }

    const line = {
      DetailType: "SalesItemLineDetail",
      Amount: amount,
      Description: description || undefined,
      SalesItemLineDetail: {
        ServiceDate: first.date,
        ItemRef: { value: first.mapping.qbo_item_id, name: first.mapping.qbo_line_description },
        UnitPrice: rate,
        Qty: totalQty,
        TaxCodeRef: { value: first.mapping.tax_override || "TAX" },
      },
    };
    upsertLine(slot, line);
  }

  // ─── Flat-weekly lines (spec §4 rule 6) ────────────────────────
  // One line per week per FF service. Bi-weekly emits 2 weekly lines
  // for each FF service.
  for (const [wKey, svcMap] of ffPerWeek.entries()) {
    const wIdx = Number(wKey);
    for (const ff of svcMap.values()) {
      const rate = roundToCent(ff.price);
      // Amount for FF = qty (1) * rate.
      const amount = roundToCent(rate * 1);
      // ServiceDate for the FF line: the FIRST day of that week
      // (Monday of week 1 for weekly, or the first Monday of week 2
      // for the second half of a biweekly).
      const weekMonday = addDays(weekStart, (wIdx - 1) * 7);
      const ffDescription = ff.mapping.line_desc_style === "plain_name"
        ? ff.mapping.qbo_line_description
        : undefined;
      const line = {
        DetailType: "SalesItemLineDetail",
        Amount: amount,
        Description: ffDescription,
        SalesItemLineDetail: {
          ServiceDate: weekMonday,
          ItemRef: { value: ff.mapping.qbo_item_id, name: ff.mapping.qbo_line_description },
          UnitPrice: rate,
          Qty: 1,
          TaxCodeRef: { value: ff.mapping.tax_override || "TAX" },
        },
      };
      upsertLine(ff.mapping.invoice_slot, line);
    }
  }

  // ─── Assemble invoices per slot ────────────────────────────────
  // Line ordering: by ServiceDate ascending, then by ItemRef.value
  // ascending, then by Amount descending (matches observed order).
  const sortLines = (lines) => {
    lines.sort((a, b) => {
      const da = a.SalesItemLineDetail.ServiceDate;
      const db = b.SalesItemLineDetail.ServiceDate;
      if (da !== db) return da.localeCompare(db);
      const ia = a.SalesItemLineDetail.ItemRef.value;
      const ib = b.SalesItemLineDetail.ItemRef.value;
      if (ia !== ib) return ia.localeCompare(ib);
      return b.Amount - a.Amount;
    });
    // Attach LineNum for stability + assign Id to null (QBO assigns).
    return lines.map((ln, i) => ({ ...ln, LineNum: i + 1 }));
  };

  const invoices = [];
  const slots = [...bySlot.keys()].sort(); // main before rehab alphabetically
  for (const slot of slots) {
    const lines = sortLines(bySlot.get(slot));
    if (lines.length === 0) continue;
    const preTaxSubtotal = lines.reduce((s, ln) => s + ln.Amount, 0);
    invoices.push({
      _slot: slot, // internal marker; adapter drops before POST if needed
      CustomerRef: {
        value: accountMap.qbo_customer_id,
        name: accountMap.qbo_customer_name,
      },
      TxnDate: closingSunday,
      TxnTaxDetail: {
        TxnTaxCodeRef: { value: accountMap.qbo_taxcode_id },
      },
      Line: lines,
      _preTaxSubtotal: preTaxSubtotal,
    });
  }

  return { invoices, warnings };
}

// ─── Named helpers exposed for the diff harness + tests ────────────
export const _internals = {
  MEAL_ORDER,
  compareMealOrder,
  roundToCent,
  composeAggregateDescription,
  parseWeekIndex,
  isoDow,
  addDays,
};
