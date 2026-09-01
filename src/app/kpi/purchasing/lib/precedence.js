/**
 * Purchasing precedence rule - the machinery Option A ships, Option C
 * extends.
 *
 * Two halves.  Every reader that sums a transaction must apply both.
 *
 *   BETWEEN sources:
 *     A transaction present in `purchasing_actuals` from the API is
 *     authoritative.  It carries the GL split; the report does not.
 *     A transaction present only in the report is added, with no
 *     GL line, and renders as pending.
 *     No transaction is ever counted from both.
 *
 *   WITHIN report:
 *     Newest content_hash wins per parent_txn_id.  A recoded charge
 *     (a receipt attached, an approval, a category change) inserts
 *     as a new content_hash under append-on-content-hash semantics
 *     (purchasing-7-report-txns.sql).  Without a "current per parent"
 *     resolution, a single transaction would sum multiple times from
 *     the same source.  Resolved by the `rippling_report_txns_latest`
 *     view.
 *
 * Join key (verified 2026-08-26 by scripts/probes/_probe_report_join_key.mjs):
 *   report.parent_txn_id  =  substring(rippling_raw_spend_lines.external_id, 1, 24)
 *
 *   The report ID space is a 24-char lowercase hex string (Rippling's
 *   parent transaction id).  The API side stores it as the prefix of
 *   external_id ('<24-hex>__line_item_content_<...>').  Every raw
 *   spend row on the production snapshot carried a matching prefix
 *   (21578/21578).  Zero prefix-nulls on the API side; the join is
 *   total, not sparse.
 *
 * What Option C would extend (not built here):
 *   Report becomes the source of truth for existence and dates.  The
 *   precedence rule inverts inside a widened resolvedTransaction()
 *   function: report existence + dates flow first, API GL split flows
 *   second and only where the API row still exists.  The two views
 *   this migration ships (`rippling_report_txns_latest`,
 *   `rippling_report_only_pending_v1`) stay; a new `rippling_report_gl_join`
 *   view maps report parent_txn_id back to API rows so C can enrich
 *   report dates with API GL codes.  No re-derive, no schema change.
 */

// Named constants.  A reader that touches `pending` uses these names,
// not inline conditions - so a grep for the constant finds every
// place precedence applies.

export const PRECEDENCE_RULE = "api_over_report_between_sources__latest_over_older_within_report";

export const REPORT_TXNS_LATEST_VIEW    = "rippling_report_txns_latest";
export const REPORT_ONLY_PENDING_VIEW   = "rippling_report_only_pending_v1";

export const JOIN_KEY = {
  report_column: "parent_txn_id",
  api_expression: "substring(rippling_raw_spend_lines.external_id, 1, 24)",
  api_pattern:   "^[0-9a-f]{24}__",
  verified_at:   "2026-08-26",
  verified_by:   "scripts/probes/_probe_report_join_key.mjs",
};

// Attribute names used for the rulings gates.  A ruling that gets
// dropped from the view rebuild has to drop its constant here at the
// same time - so the coverage is greppable.
export const RULES_APPLIED_IN_VIEW = {
  R1_excluded_work_locations: true,   // WHERE excluded = FALSE
  R2_duplicate_splits: true,          // via _latest DISTINCT ON
  R3_non_usd: true,                   // WHERE currency = 'USD'
  R4_auth_pair: "not_applicable",     // structural: auth-pairs are same-source
  R5_zero_amount: true,               // WHERE amount != 0
};

/**
 * Read the report-only pending contribution for a members/range window.
 *
 * Returns:
 *   {
 *     amount:      number   - USD sum, rounded to cents
 *     line_count:  integer  - count of rows
 *     by_account:  { account_key -> amount }  - per-account breakdown
 *     max_purchased_at: string | null - newest purchased_at in the set
 *   }
 *
 * Contract:
 *   - Never returns a row the API has (structurally impossible - the
 *     view filters it out).
 *   - Never returns the same transaction twice from within report
 *     (structurally impossible - _latest resolves per parent_txn_id).
 *   - Never returns a row the operator wouldn't see attributed on the
 *     board (attribution unresolved -> dropped in the view).
 */
// F-11 (2026-09-01, PR): the view has 500'd on ALL/FYTD four times.
// Root cause not proven yet (measurement showed cold-start under
// Promise.all contention as the most likely candidate; unproven).
// Guard: race the view read against a 6s timeout. On timeout, return
// an unavailable shape so the route doesn't 500 and the surface can
// say so honestly. Firing counter logged for reproduction data.
// See docs/audits/F11_REPORT_ONLY_PENDING_500_2026-09-01.md.
const REPORT_ONLY_TIMEOUT_MS = process.env.F11_TIMEOUT_MS ? Number(process.env.F11_TIMEOUT_MS) : 6000;

export async function loadReportOnlyPending(supa, { members, start, end, IN_CHUNK = 200, PS = 1000 }) {
  const t0 = Date.now();
  let amount = 0;
  let line_count = 0;
  const by_account = new Map();
  let max_purchased_at = null;

  async function walk() {
    // Chunk the members set - PostgREST silent 1000-row cap, same
    // pattern as loadPending in the route.
    for (let i = 0; i < members.length; i += IN_CHUNK) {
      const chunk = members.slice(i, i + IN_CHUNK);
      let from = 0;
      while (true) {
        const q = await supa
          .from(REPORT_ONLY_PENDING_VIEW)
          .select("parent_txn_id, amount, account_key, purchased_at")
          .in("account_key", chunk)
          .gte("purchased_at", start)
          .lte("purchased_at", end)
          .order("parent_txn_id", { ascending: true })
          .range(from, from + PS - 1);
        if (q.error) return { error: q.error };
        const rows = q.data || [];
        for (const r of rows) {
          const amt = Number(r.amount || 0);
          amount += amt;
          line_count += 1;
          by_account.set(r.account_key, (by_account.get(r.account_key) || 0) + amt);
          if (r.purchased_at && (max_purchased_at == null || r.purchased_at > max_purchased_at)) {
            max_purchased_at = r.purchased_at;
          }
        }
        if (rows.length < PS) break;
        from += PS;
      }
    }
    return { ok: true };
  }

  const timeoutSentinel = Symbol("report_only_timeout");
  const raced = await Promise.race([
    walk(),
    new Promise((resolve) => setTimeout(() => resolve(timeoutSentinel), REPORT_ONLY_TIMEOUT_MS)),
  ]);

  if (raced === timeoutSentinel) {
    const elapsed = Date.now() - t0;
    console.warn(`[F-11] loadReportOnlyPending TIMEOUT after ${elapsed}ms (limit ${REPORT_ONLY_TIMEOUT_MS}ms) members=${members.length} range=${start}..${end}`);
    return {
      data: {
        amount: 0,
        line_count: 0,
        by_account: {},
        max_purchased_at: null,
        unavailable: true,
        unavailable_reason: "timeout",
        unavailable_elapsed_ms: elapsed,
      },
    };
  }
  if (raced?.error) return { error: raced.error };

  return {
    data: {
      amount:     Math.round(amount * 100) / 100,
      line_count,
      by_account: Object.fromEntries([...by_account].map(([k, v]) => [k, Math.round(v * 100) / 100])),
      max_purchased_at,
      unavailable: false,
    },
  };
}

/**
 * Merge API-derived pending + report-only pending under the precedence
 * rule.  Returns the combined shape the board consumes.
 */
export function mergePending(apiPending, reportOnlyPending) {
  return {
    amount:     Math.round(((apiPending?.amount || 0) + (reportOnlyPending?.amount || 0)) * 100) / 100,
    line_count: (apiPending?.line_count || 0) + (reportOnlyPending?.line_count || 0),
    api: {
      amount:     Math.round((apiPending?.amount || 0) * 100) / 100,
      line_count: apiPending?.line_count || 0,
    },
    report_only: {
      amount:            Math.round((reportOnlyPending?.amount || 0) * 100) / 100,
      line_count:        reportOnlyPending?.line_count || 0,
      by_account:        reportOnlyPending?.by_account || {},
      max_purchased_at:  reportOnlyPending?.max_purchased_at || null,
      // F-11: preserve the unavailable signal so the freshness pill
      // and every consumer can distinguish "empty because zero rows"
      // from "empty because the view timed out". Silent fallback would
      // be a lie by omission.
      unavailable:        reportOnlyPending?.unavailable === true,
      unavailable_reason: reportOnlyPending?.unavailable_reason || null,
    },
  };
}
