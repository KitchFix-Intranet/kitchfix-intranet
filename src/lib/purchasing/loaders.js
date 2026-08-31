// Shared purchasing loaders extracted 2026-08-31 for Overview Phase 2 to
// consume without route bloat. Same functions the purchasing route calls
// - this file is a pure move out of src/app/api/kpi/purchasing/route.js
// (Overview Phase 2 PR-2b, sibling of PR-1's labor extraction). Zero
// behaviour change: identical function signatures, identical internal
// logic, identical return shapes and error paths. The purchasing route
// imports and calls these functions afterward with no duplicate
// definitions.
//
// Exports (functions):
//   paginateActuals          - PostgREST offset-paginate over
//     purchasing_actuals with the default (5-col) or drill (14-col)
//     select set. .in() chunked at IN_CHUNK; .range() walked to short
//     page. Filter drops excluded=true; caller drops account_key IS NULL
//     downstream (unattributed / uncoded analysis is a separate path).
//   paginateWeekly           - Weekly rollup from v_purchasing_by_site_week.
//   loadPriorPeriodHistory   - R13 P0-1 sparkline; last-8-period prior
//     spend for the closed-period card. Filters to the KPI GL families
//     (3200 / 3400 / 3500) so the sparkline compares like-to-like with
//     the hero.
//   loadPending              - rippling_spend rows with gl_line_code IS
//     NULL in range; SUM + count.
//   fetchMembers             - account -> members set (ALL/EAST/WEST -
//     accounts table filtered by region; single-account team_key -> [key]).
//   loadPurchasingBudgets    - kpi_budgets purchasing lines (excludes
//     3100.1 labor + 3100.2 salaried) for a set of accounts + fiscal
//     year. Returns nested Map: gl_line_code -> account_key -> period_no
//     -> amount.
//   computeSentinel          - frozen (TBR - FL, P8, 3200.1) probe value.
//   loadAccountsDirectory    - accounts.team_key + region + team_name +
//     city + state for the rail meta (11 rows).
//   loadFreshness            - purchasing_derive_runs latest per source
//     + max(txn_date) on rippling_spend (cards_through) + rippling_report
//     staleness gate.
//   loadLedgerRows           - capped (25/50) ledger rows per bucket
//     (vehicle / equipment / repair / reimbursable) with billcom vendor
//     name resolution.
//   loadCardCharges          - uncoded card charges + report-only pending
//     (R16 P0), category label resolution.
//   loadVendorRollup         - per-vendor spend rollup for the drill
//     table's By vendor row mode.
//   loadCompliance           - PR 6 compliance card. rippling_report_txns_latest
//     sentinel category, grouped by site + person, with region_split
//     parity assertion.
//
// Exports (constants):
//   IN_CHUNK                 - PostgREST .in() chunk size (100) used by
//     every loader here AND directly by the purchasing route (for
//     billcom vendor id resolution in the drill=lines branch, and passed
//     into loadReportOnlyPending). Kept in one place so the ceiling is
//     remembered.
//   V6_PAGE_DEFAULT          - PostgREST default response cap (1000).
//   chunk                    - helper: slice an array into IN_CHUNK-sized
//     pages. Used by every loader here AND by the route's drill=lines
//     branch for the billcom vendor id resolve, so it exports.
//   ACTUALS_COLS_DEFAULT     - the 5-column trim for the default payload
//     (INV-P23 finding); consumers are billsOnlySpentForGl /
//     codedCardSpentForGl / card totals / weekly_by_source, all needing
//     only { source, gl_line_code, amount, account_key, txn_date }.
//   ACTUALS_COLS_DRILL       - the full 14-column select for ?drill=lines.

import {
  periodStartISO, periodEndISO, periodOf,
} from "@/app/kpi/labor/lib/periods.js";

// ── constants ────────────────────────────────────────────────────────

// PostgREST .in() with 100+ 36-char UUIDs or 51+ char
// rippling_spend:<uuid> ids overflows the URL and throws
// `TypeError: fetch failed` before any HTTP status. Chunk at 100.
// team_keys are short enough that this could go higher for members,
// but the same constant applies consistently to every .in() so a
// single ceiling is remembered.
export const IN_CHUNK = 100;

// PostgREST default response cap.
export const V6_PAGE_DEFAULT = 1000;

// Chunk a values array to IN_CHUNK-size slices. Callers loop and
// merge results (concat for rows, add for counts).
export function chunk(values, size = IN_CHUNK) {
  const out = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

// ── purchasing_actuals paginator ─────────────────────────────────────

// Paginate purchasing_actuals for a members set and a date range.
// Filter drops excluded rows and null account_key rows so the caller
// never has to remember to exclude them. Unattributed / uncoded
// analysis reads a separate query (below) that keeps the null rows.
//
// Population: bills + coded card lines. Pending sum + null-attribution
// analysis go via separate paths that keep the rows this drops.
//
// INV-P23 column trim (2026-08-28): the DEFAULT payload (no
// ?drill=lines) only needs 5 columns for its consumers -
// billsOnlySpentForGl / codedCardSpentForGl / card totals block /
// weekly_by_source. That set is `source, gl_line_code, amount,
// account_key, txn_date`. Consumer walk 2026-08-28 confirmed nobody
// reads `r.gl_bucket` off an actuals row (see the columnFor() comment
// around L2033: "purchasing_actuals.gl_bucket is the broader family
// - do not read it"). `?drill=lines` still ships every column - the
// row-level table needs the full shape.
export const ACTUALS_COLS_DEFAULT = "source, gl_line_code, amount, account_key, txn_date";
export const ACTUALS_COLS_DRILL   = "id, source, source_bill_id, source_line_id, account_key, gl_line_code, gl_bucket, txn_date, posting_date, amount, paid, approx_date, derived_at, vendor_or_merchant";
export async function paginateActuals(supa, { members, start, end, pageSize, includeLines }) {
  const PS = pageSize && pageSize > 0 && pageSize <= V6_PAGE_DEFAULT ? pageSize : V6_PAGE_DEFAULT;
  const cols = includeLines ? ACTUALS_COLS_DRILL : ACTUALS_COLS_DEFAULT;
  const out = [];
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const q = await supa
        .from("purchasing_actuals")
        .select(cols)
        .in("account_key", memberChunk)
        .eq("excluded", false)
        .gte("txn_date", start)
        .lte("txn_date", end)
        .order("txn_date", { ascending: true })
        .order("account_key", { ascending: true })
        .order("id", { ascending: true })   // stable tiebreak - .order() accepts columns outside .select()
        .range(from, from + PS - 1);
      if (q.error) return { error: q.error };
      const rows = q.data || [];
      for (const r of rows) out.push(r);
      if (rows.length < PS) break;
      from += PS;
    }
  }
  return { data: out };
}

// ── v_purchasing_by_site_week paginator ──────────────────────────────

// Paginate v_purchasing_by_site_week for the weekly series. Same
// members + range filter as paginateActuals, but the view has already
// aggregated per (account_key, week_start, gl_line_code, gl_bucket),
// so payload size drops by ~2 orders of magnitude for ALL FYTD.
//
// View's week_start floor is DATE '2025-12-29' + floor((txn_date -
// FY_START)/7)*7. INV-P1 Q4 confirmed byte-identical to
// weekStartsInRange('2025-12-29', today) - 34 weeks on ALL FYTD.
//
// Population: bills + coded card lines (view excludes excluded=true
// and null account_key). Uncoded card lines don't have gl_line_code
// so they group under NULL gl_line_code - callers that only want
// bill buckets should filter gl_bucket='pl_cogs'.
export async function paginateWeekly(supa, { members, start, end }) {
  const PS = V6_PAGE_DEFAULT;
  const out = [];
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const q = await supa
        .from("v_purchasing_by_site_week")
        .select("account_key, week_start, week_end, gl_line_code, gl_bucket, amount, line_count, bill_count, paid_amount")
        .in("account_key", memberChunk)
        .gte("week_start", start)
        .lte("week_start", end)
        .order("account_key", { ascending: true })
        .order("week_start", { ascending: true })
        .order("gl_line_code", { ascending: true, nullsFirst: false })
        .range(from, from + PS - 1);
      if (q.error) return { error: q.error };
      const rows = q.data || [];
      for (const r of rows) out.push(r);
      if (rows.length < PS) break;
      from += PS;
    }
  }
  return { data: out };
}

// ── prior-period history for the closed-card sparkline ───────────────

// R13 P0-1: prior-period + last-8-periods spend history for the
// closed-card comparison block.  Rolled up across the members set so
// aggregate scopes (ALL / EAST / WEST) return the portfolio shape
// rather than one site's (INV-P21 axis).  Reads the SQL-aggregated
// weekly view - a single call for the P(N-7)..P(N-0) window rolled
// client-side to periods.  Probe 2026-08-26 measured wall-time at
// 74ms (single-account) to 250ms (ALL) for the 8-period window; the
// call runs in parallel with the other loaders so it doesn't add
// serial cost.
export async function loadPriorPeriodHistory(supa, { members, periodNo }) {
  if (!periodNo || periodNo < 2) return { data: null };   // no prior period exists for P1
  const firstPeriod = Math.max(1, periodNo - 7);          // last 8 periods ending at current
  const startISO = periodStartISO(firstPeriod);
  const endISO   = periodEndISO(periodNo);
  const IN_CHUNK_LOCAL = 100;
  const PS = 1000;
  const byWeek = new Map();
  for (let i = 0; i < members.length; i += IN_CHUNK_LOCAL) {
    const chunk = members.slice(i, i + IN_CHUNK_LOCAL);
    let from = 0;
    while (true) {
      // R13 P0-1: sparkline must compare like-to-like with the hero,
      // which is the KPI line only (food + packaging + vehicle).  Pull
      // gl_line_code and filter client-side to lines beginning with
      // 3200 / 3400 / 3500 - same predicate as kpiBudget in
      // src/app/kpi/purchasing/lib/board.js.  Without this filter the
      // prior-period value included reimbursable + SG&A and read as a
      // different base than the hero it was compared against.
      const q = await supa.from("v_purchasing_by_site_week")
        .select("week_start, amount, gl_line_code")
        .in("account_key", chunk)
        .gte("week_start", startISO)
        .lte("week_start", endISO)
        .order("week_start", { ascending: true })
        .range(from, from + PS - 1);
      if (q.error) return { error: q.error };
      const rows = q.data || [];
      for (const r of rows) {
        const gl = String(r.gl_line_code || "");
        if (!(gl.startsWith("3200") || gl.startsWith("3400") || gl.startsWith("3500"))) continue;
        const wk = r.week_start;
        byWeek.set(wk, (byWeek.get(wk) || 0) + Number(r.amount || 0));
      }
      if (rows.length < PS) break;
      from += PS;
    }
  }
  const byPeriod = new Map();
  for (const [wk, amt] of byWeek) {
    const p = periodOf(wk);
    if (p >= firstPeriod && p <= periodNo) {
      byPeriod.set(p, (byPeriod.get(p) || 0) + amt);
    }
  }
  const sparkline = [];
  for (let p = firstPeriod; p <= periodNo; p++) {
    sparkline.push({
      period_no: p,
      spent: Math.round((byPeriod.get(p) || 0) * 100) / 100,
    });
  }
  const priorSpent = Math.round((byPeriod.get(periodNo - 1) || 0) * 100) / 100;
  return {
    data: {
      prior: {
        period_no: periodNo - 1,
        spent: priorSpent,
        label: `Period ${periodNo - 1}`,
      },
      sparkline,   // P(N-7) .. P(N), inclusive
    },
  };
}

// ── pending (uncoded rippling_spend) ─────────────────────────────────

// Pending: SUM(amount) + line count of rippling_spend rows in range
// whose gl_line_code IS NULL. Members-filtered so ALL/EAST/WEST return
// the aggregate. excluded=false always. §3.5: a dollar sum, never
// split by bucket. Card spend carries no GL line - that IS why it
// sits outside the buckets.
//
// Population differs from paginateActuals (which drops gl_line_code
// only if account_key is null too): we specifically WANT the
// gl_line_code=NULL rows.
export async function loadPending(supa, { members, start, end }) {
  let amount = 0;
  let line_count = 0;
  const PS = V6_PAGE_DEFAULT;
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const q = await supa
        .from("purchasing_actuals")
        .select("amount, source_line_id")
        .eq("source", "rippling_spend")
        .eq("excluded", false)
        .is("gl_line_code", null)
        .in("account_key", memberChunk)
        .gte("txn_date", start)
        .lte("txn_date", end)
        .order("source_line_id", { ascending: true })
        .range(from, from + PS - 1);
      if (q.error) return { error: q.error };
      const rows = q.data || [];
      for (const r of rows) {
        amount += Number(r.amount || 0);
        line_count += 1;
      }
      if (rows.length < PS) break;
      from += PS;
    }
  }
  return {
    data: {
      amount:     Math.round(amount * 100) / 100,
      line_count,
    },
  };
}

// ── members resolver ─────────────────────────────────────────────────

export async function fetchMembers(supa, account) {
  if (account === "ALL") {
    const q = await supa.from("accounts").select("team_key").neq("team_key", "CORP").order("team_key");
    return q.error ? { error: q.error } : { members: (q.data || []).map(r => r.team_key) };
  }
  if (account === "EAST" || account === "WEST") {
    const regionValue = account === "EAST" ? "East" : "West";
    const q = await supa.from("accounts").select("team_key").neq("team_key", "CORP").eq("region", regionValue).order("team_key");
    return q.error ? { error: q.error } : { members: (q.data || []).map(r => r.team_key) };
  }
  return { members: [account] };
}

// ── kpi_budgets loader for the purchasing lines ──────────────────────

// Load kpi_budgets purchasing lines for a set of accounts + FY. Returns
// map: gl_line_code -> Map(account_key -> Map(period_no -> amount)).
// Purchasing lines are all COGS + reimbursable + SG&A lines except
// 3100.1 (labor - handled by /api/kpi/labor).
//
// Paginates the .in() over accounts AND the row window. FY2026 ALL
// membership is ~24 lines x 11 accounts x 13 periods = ~3,400 rows,
// well over PostgREST's silent 1000-row cap. Mirrors the pagination
// pattern the other three .select() calls in this file already use
// (paginateActuals, paginateWeekly, loadPending): .order() BEFORE
// .range(), chunk members through IN_CHUNK, walk pages until a short
// page returns.
export async function loadPurchasingBudgets(supa, accounts, fiscalYear) {
  const byLine = new Map();
  const PS = V6_PAGE_DEFAULT;
  for (const memberChunk of chunk(accounts, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const q = await supa.from("kpi_budgets")
        .select("account_key, line_code, period_no, amount")
        .eq("fiscal_year", fiscalYear)
        .in("account_key", memberChunk)
        .neq("line_code", "3100.1")     // labor lives in labor route
        .neq("line_code", "3100.2")     // salaried; not in scope for purchasing v1
        .order("account_key", { ascending: true })
        .order("line_code", { ascending: true })
        .order("period_no", { ascending: true })
        .range(from, from + PS - 1);
      if (q.error) return { error: q.error };
      const rows = q.data || [];
      for (const r of rows) {
        const gl = String(r.line_code);
        const acct = String(r.account_key);
        if (!byLine.has(gl)) byLine.set(gl, new Map());
        if (!byLine.get(gl).has(acct)) byLine.get(gl).set(acct, new Map());
        byLine.get(gl).get(acct).set(Number(r.period_no), Number(r.amount));
      }
      if (rows.length < PS) break;
      from += PS;
    }
  }
  return { data: byLine };
}

// ── sentinel probe ───────────────────────────────────────────────────

// Compute the sentinel: TBR - FL, P8, gl 3200.1.
export async function computeSentinel(supa) {
  const p8start = periodStartISO(8);
  const p8end = periodEndISO(8);
  const q = await supa.from("purchasing_actuals")
    .select("amount")
    .eq("source", "billcom")
    .eq("excluded", false)
    .eq("account_key", "TBR - FL")
    .eq("gl_line_code", "3200.1")
    .gte("txn_date", p8start)
    .lte("txn_date", p8end);
  if (q.error) return { error: q.error };
  const total = (q.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  return {
    data: {
      account:      "TBR - FL",
      period_no:    8,
      range:        { start: p8start, end: p8end },
      gl_line_code: "3200.1",
      amount:       Math.round(total * 100) / 100,
      line_count:   (q.data || []).length,
    },
  };
}

// ── accounts directory ───────────────────────────────────────────────
//
// PR-2 R2 Fix 7 - owner ruling 2026-08-24: purchasing must ship
// `accounts_directory` too. Previously the page passed
// `accountsDirectory={undefined}` and the rail fell back to
// STATIC_DIRECTORY, whose `team_name`/`city`/`state` are all null, so
// 8 of 11 members rendered blank because `folioMemberDescription`
// returns `line: null` when team_name is missing. Labor already
// resolves this exact query - mirroring here (rule 4: never fork; but
// the labor helper is not exported and the module boundary keeps the
// two routes independent - this is a live query, not a fork of logic).
export async function loadAccountsDirectory(supa) {
  const q = await supa.from("accounts")
    .select("team_key, region, name, city, state")
    .neq("team_key", "CORP")
    .order("team_key");
  if (q.error) return { error: q.error };
  const salaried = new Set(["CIN - KY", "TBJ - NY"]);
  return {
    data: (q.data || []).map(r => ({
      team_key: r.team_key,
      region: r.region,
      team_name: r.name || null,
      city: r.city || null,
      state: r.state || null,
      salaried: salaried.has(r.team_key),
    })),
  };
}

// ── freshness read ───────────────────────────────────────────────────

export async function loadFreshness(supa) {
  // PR-2 R4 Part E: freshness pill splits `Bills current` from
  // `cards through <date>`. `cards_through` = the newest txn_date on
  // any rippling_spend row (excluded=false). Cards land in the derive
  // ~8 days after they post to the card (ObjectID latency finding from
  // PR-2 R3), so the pill must be honest about that boundary. Derived
  // date, never hardcoded.
  //
  // INV-P20 report-ingest lane: `source='rippling_report'` is the
  // scheduled email ingestion (purchasing_report_ingest.mjs); its
  // completed_at drives the third staleness gate. If the newest
  // successful ingest is > 36h old, the pill flips red - "Report feed
  // stale, last ingest Nh ago". The 36h boundary tolerates one missed
  // night: schedule runs at 06:00 UTC daily, so 36h means "we missed
  // last night entirely" before we page an operator.
  const [bc, rp, rr, cardMaxTxn] = await Promise.all([
    supa.from("purchasing_derive_runs")
      .select("completed_at, bills_touched, lines_written")
      .eq("source", "billcom").eq("status", "success")
      .order("completed_at", { ascending: false }).limit(1).maybeSingle(),
    supa.from("purchasing_derive_runs")
      .select("completed_at, lines_written")
      .eq("source", "rippling_spend").eq("status", "success")
      .order("completed_at", { ascending: false }).limit(1).maybeSingle(),
    supa.from("purchasing_derive_runs")
      .select("completed_at, lines_written")
      .eq("source", "rippling_report").eq("status", "success")
      .order("completed_at", { ascending: false }).limit(1).maybeSingle(),
    supa.from("purchasing_actuals")
      .select("txn_date")
      .eq("source", "rippling_spend").eq("excluded", false)
      .order("txn_date", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const latestDerive = (bc.data?.completed_at && rp.data?.completed_at)
    ? (bc.data.completed_at > rp.data.completed_at ? bc.data.completed_at : rp.data.completed_at)
    : (bc.data?.completed_at || rp.data?.completed_at || null);
  const reportAt = rr.data?.completed_at || null;
  const reportAgeHours = reportAt
    ? Math.round((Date.now() - new Date(reportAt).getTime()) / 3600000)
    : null;
  const REPORT_STALE_LIMIT_H = 36;
  const reportStale = reportAgeHours == null ? true : reportAgeHours > REPORT_STALE_LIMIT_H;
  return {
    last_billcom_sync:      bc.data?.completed_at || null,
    last_rippling_sync:     rp.data?.completed_at || null,
    last_derive_at:         latestDerive,
    cards_through:          cardMaxTxn.data?.txn_date || null,   // PR-2 R4 Part E
    last_report_ingest_at:  reportAt,                            // INV-P20
    report_row_count:       rr.data?.lines_written ?? null,      // INV-P20
    report_age_hours:       reportAgeHours,                      // INV-P20
    report_stale:           reportStale,                         // INV-P20
    report_stale_limit_h:   REPORT_STALE_LIMIT_H,                // INV-P20
  };
}


// ── PR-2 R6 Part B - capped aggregations for the five populated cards ───
//
// Owner ruling 2026-08-24: five cards on the board currently render
// honest placeholders (equipment / repair / reimbursable ledgers, card
// purchases, vendor breakdown). Each needs a SMALL pre-aggregated list
// in the default payload - never the full 12,672-row `?drill=lines`
// stream. Rules that apply to every one:
//   - sorted by amount DESC, capped at 25/50/25
//   - total_count + total_amount alongside so "showing 25 of 188"
//     copy is honest (silent truncation is the failure mode this
//     board has three times over)
//   - account_key on every row (only rendered at ALL by the client)
//   - vendor names via billcom_ref_vendors (v_purchasing_actuals_billcom_named
//     view; unresolved vendor_id stays unresolved, gets counted, never
//     invented)
//   - rippling_spend rows (coded card) join by merchant_name in
//     `vendor_or_merchant` directly (no billcom vendor id)
//
// A ledger card's rows must sum to something the card can explain
// (Check 9 - THE GATE). The uncapped sum of ledger rows == the bucket
// hero for that GL family. Check 9 is asserted on the CLIENT in
// LedgerCard.js:56-73 + CardPurchases.js:39-59 against local props.
// A server-side duplicate lived here until INV-P23 removed it - see
// the deleted `ledger_reconciliation` block for why one implementation
// per assertion is the rule.
//
// Vendor rollup ships UN-ROLLED-UP for now (Kevin ruling: report
// fragmentation, do not implement).

export async function loadLedgerRows(supa, { members, start, end, glLineCode, glLikePrefix, cap = 25 }) {
  // billcom rows carry a vendor_id we can resolve; rippling_spend rows
  // carry the raw merchant name. Read both from purchasing_actuals so
  // hero (categories.spent) and rows come from the same query.
  const rows = [];
  const PS = V6_PAGE_DEFAULT;
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      let q = supa.from("purchasing_actuals")
        .select("id, source, source_bill_id, source_line_id, account_key, gl_line_code, txn_date, amount, vendor_or_merchant")
        .in("account_key", memberChunk)
        .eq("excluded", false)
        .gte("txn_date", start)
        .lte("txn_date", end)
        .order("txn_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PS - 1);
      if (glLineCode) q = q.eq("gl_line_code", glLineCode);
      else if (glLikePrefix) q = q.like("gl_line_code", glLikePrefix);
      const r = await q;
      if (r.error) return { error: r.error };
      const data = r.data || [];
      for (const row of data) rows.push(row);
      if (data.length < PS) break;
      from += PS;
    }
  }
  // Total (uncapped) - this must equal the bucket hero for Check 9.
  const totalAmount = rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalCount = rows.length;
  // Resolve billcom vendor ids to names in one round trip.
  const billcomVendorIds = [
    ...new Set(rows.filter(r => r.source === "billcom" && r.vendor_or_merchant).map(r => r.vendor_or_merchant)),
  ];
  const vendorNameMap = new Map();
  let unresolved = 0;
  if (billcomVendorIds.length > 0) {
    for (const idChunk of chunk(billcomVendorIds, IN_CHUNK)) {
      const vr = await supa.from("billcom_ref_vendors").select("id, name").in("id", idChunk);
      if (vr.error) return { error: vr.error };
      for (const v of vr.data || []) vendorNameMap.set(v.id, v.name || null);
    }
  }
  // Enrich + sort by amount desc + cap.
  const enriched = rows.map(r => {
    let vendor = null;
    if (r.source === "billcom") {
      if (r.vendor_or_merchant && vendorNameMap.has(r.vendor_or_merchant)) {
        vendor = vendorNameMap.get(r.vendor_or_merchant);
      } else {
        if (r.vendor_or_merchant) unresolved += 1;
      }
    } else {
      // rippling_spend: vendor_or_merchant is the raw merchant string.
      vendor = r.vendor_or_merchant || null;
    }
    return {
      account_key: r.account_key,
      gl_line_code: r.gl_line_code,
      txn_date: r.txn_date,
      amount: Math.round(Number(r.amount || 0) * 100) / 100,
      vendor: vendor,
      source: r.source,
    };
  }).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const capped = enriched.slice(0, cap);
  return {
    data: {
      rows: capped,
      cap,
      total_count: totalCount,
      total_amount: Math.round(totalAmount * 100) / 100,
      unresolved_vendor_id_count: unresolved,
    },
  };
}

export async function loadCardCharges(supa, { members, start, end, cap = 50 }) {
  // Uncoded card charges - rippling_spend rows with gl_line_code IS NULL
  // PLUS report-only pending rows (parents in rippling_report_only_pending_v1
  // that have not yet landed in purchasing_actuals).
  //
  // R16 P0 (owner ruling 2026-08-28): before this change the list walked
  // purchasing_actuals only, while the hero (board.pending) added report-
  // only pending via mergePending().  That produced the 222 vs 219 gap on
  // ALL FYTD - hero counted the report-only slice, list didn't.  The fix:
  // ship both slices in one row set so hero, footer and drill agree.
  // Removing the slice from the hero would understate real exposure -
  // report-only rows are exactly what yesterday's ingest lane was built
  // to bring onto the board.
  //
  // No double-count risk: the report-only view excludes parents already
  // seen by the API (precedence rule, migration-8).  See
  // src/app/kpi/purchasing/lib/precedence.js for the invariant.
  const rows = [];
  const PS = V6_PAGE_DEFAULT;
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const r = await supa.from("purchasing_actuals")
        .select("id, source_line_id, account_key, txn_date, amount, vendor_or_merchant, gl_line_code")
        .in("account_key", memberChunk)
        .eq("excluded", false)
        .eq("source", "rippling_spend")
        .is("gl_line_code", null)
        .gte("txn_date", start)
        .lte("txn_date", end)
        .order("txn_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PS - 1);
      if (r.error) return { error: r.error };
      const data = r.data || [];
      for (const row of data) rows.push(row);
      if (data.length < PS) break;
      from += PS;
    }
  }
  // R16 P0 - parallel walk of the report-only view.  Uses the same
  // (account_key, date-window) chunking as loadReportOnlyPending, so the
  // count/amount this produces exactly matches the aggregate that hero
  // adds via mergePending().  CORP is filtered out at the site of the
  // preamble Promise.all; we keep the same filter here for parity.
  const reportRows = [];
  const membersNoCorp = members.filter(m => m !== "CORP");
  for (const memberChunk of chunk(membersNoCorp, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const r = await supa.from("rippling_report_only_pending_v1")
        .select("parent_txn_id, account_key, purchased_at, amount, category, work_location")
        .in("account_key", memberChunk)
        .gte("purchased_at", start)
        .lte("purchased_at", end)
        .order("parent_txn_id", { ascending: true })
        .range(from, from + PS - 1);
      if (r.error) return { error: r.error };
      const data = r.data || [];
      for (const row of data) reportRows.push(row);
      if (data.length < PS) break;
      from += PS;
    }
  }
  const totalAmount = rows.reduce((s, r) => s + Number(r.amount || 0), 0)
                    + reportRows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalCount = rows.length + reportRows.length;
  // Operator category (the label the operator picked in Rippling)
  // lives on rippling_raw_spend_lines_latest as `category_id`, and the
  // human label lives on `spend_category_map.category_label`. Join
  // via source_line_id (rippling_spend:<uuid> -> raw uuid) then map
  // category_id -> category_label. Never invented - a category with
  // no map row surfaces as null.
  const rawIds = rows.map(r => (r.source_line_id || "").replace(/^rippling_spend:/, "")).filter(Boolean);
  const rawCatIdMap = new Map();     // rippling_id -> category_id
  if (rawIds.length > 0) {
    for (const idChunk of chunk(rawIds, IN_CHUNK)) {
      const rr = await supa.from("rippling_raw_spend_lines_latest")
        .select("rippling_id, category_id")
        .in("rippling_id", idChunk);
      if (rr.error) return { error: rr.error };
      for (const row of rr.data || []) rawCatIdMap.set(row.rippling_id, row.category_id || null);
    }
  }
  const catIds = [...new Set([...rawCatIdMap.values()].filter(Boolean))];
  const catLabelMap = new Map();
  if (catIds.length > 0) {
    for (const idChunk of chunk(catIds, IN_CHUNK)) {
      const cr = await supa.from("spend_category_map").select("category_id, category_label").in("category_id", idChunk);
      if (cr.error) return { error: cr.error };
      for (const row of cr.data || []) catLabelMap.set(row.category_id, row.category_label || null);
    }
  }
  const enrichedApi = rows.map(r => {
    const rawId = (r.source_line_id || "").replace(/^rippling_spend:/, "");
    const catId = rawCatIdMap.get(rawId) || null;
    return {
      account_key: r.account_key,
      txn_date: r.txn_date,
      amount: Math.round(Number(r.amount || 0) * 100) / 100,
      merchant: r.vendor_or_merchant || null,
      category: catId ? (catLabelMap.get(catId) || null) : null,
      gl_line_code: null,   // uncoded by definition
      source: "api",
    };
  });
  // R16 P0 - report-only rows carry `purchased_at`, `amount`, `category`
  // and `work_location` from the CSV.  They do not carry a merchant
  // name (the ingest lane hasn't matched them yet), so `merchant` is
  // null; the client's `needsAttention` gate already flags null-merchant
  // rows, so report-only rows read as "unknown merchant" - accurate.
  // `source: "report_only"` marks their origin so future UI can label
  // them if wanted.
  const enrichedReport = reportRows.map(r => ({
    account_key: r.account_key,
    txn_date: r.purchased_at,
    amount: Math.round(Number(r.amount || 0) * 100) / 100,
    merchant: null,
    category: r.category || null,
    gl_line_code: null,
    source: "report_only",
  }));
  const enriched = [...enrichedApi, ...enrichedReport]
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  const capped = enriched.slice(0, cap);
  return {
    data: {
      rows: capped,
      cap,
      total_count: totalCount,
      total_amount: Math.round(totalAmount * 100) / 100,
    },
  };
}

// R15 F - per-vendor rollup for PurchasingTable's "By vendor" row mode.
// Slimmed from the pre-R15 loadVendorRollup: prior-range compare and
// fragmentation report dropped (they were VendorBreakdown-specific and
// ruled not-value-delivering).  Ships one row per vendor id with total
// spend + gl split, sorted by |spend| desc.  Uncapped - the table's
// own scroll owns the row count.
export async function loadVendorRollup(supa, { members, start, end }) {
  const rows = [];
  const PS = V6_PAGE_DEFAULT;
  for (const memberChunk of chunk(members, IN_CHUNK)) {
    let from = 0;
    while (true) {
      const r = await supa.from("v_purchasing_actuals_billcom_named")
        .select("account_key, gl_line_code, amount, vendor_id, vendor_name, vendor_resolved")
        .in("account_key", memberChunk)
        .eq("excluded", false)
        .gte("txn_date", start)
        .lte("txn_date", end)
        .order("id", { ascending: true })
        .range(from, from + PS - 1);
      if (r.error) return { error: r.error };
      const data = r.data || [];
      for (const row of data) rows.push(row);
      if (data.length < PS) break;
      from += PS;
    }
  }
  const byVendor = new Map();
  for (const r of rows) {
    const key = r.vendor_id || "__UNRESOLVED__";
    if (!byVendor.has(key)) {
      byVendor.set(key, {
        vendor_id: r.vendor_id,
        name: r.vendor_name,
        resolved: !!r.vendor_resolved,
        spend: 0,
        line_count: 0,
        gl_split: { food: 0, packaging: 0, vehicle: 0, equipment: 0, repair: 0, reimbursable: 0, other: 0 },
      });
    }
    const v = byVendor.get(key);
    const amt = Number(r.amount || 0);
    v.spend += amt;
    v.line_count += 1;
    const gl = String(r.gl_line_code || "");
    if      (gl.startsWith("3200")) v.gl_split.food      += amt;
    else if (gl.startsWith("3400")) v.gl_split.packaging += amt;
    else if (gl.startsWith("3500")) v.gl_split.vehicle   += amt;
    else if (gl === "5002.5")       v.gl_split.equipment += amt;
    else if (gl === "5002.1")       v.gl_split.repair    += amt;
    else if (gl.startsWith("13"))   v.gl_split.reimbursable += amt;
    else                            v.gl_split.other     += amt;
  }
  const enriched = [...byVendor.values()].map(v => ({
    vendor_id: v.vendor_id,
    name: v.name,
    resolved: v.resolved,
    spend: Math.round(v.spend * 100) / 100,
    line_count: v.line_count,
    gl_split: {
      food:         Math.round(v.gl_split.food * 100) / 100,
      packaging:    Math.round(v.gl_split.packaging * 100) / 100,
      vehicle:      Math.round(v.gl_split.vehicle * 100) / 100,
      equipment:    Math.round(v.gl_split.equipment * 100) / 100,
      repair:       Math.round(v.gl_split.repair * 100) / 100,
      reimbursable: Math.round(v.gl_split.reimbursable * 100) / 100,
      other:        Math.round(v.gl_split.other * 100) / 100,
    },
  })).sort((a, b) => Math.abs(b.spend) - Math.abs(a.spend));
  const totalAmount = enriched.reduce((s, v) => s + v.spend, 0);
  return {
    data: {
      rows: enriched,
      total_count: enriched.length,
      total_amount: Math.round(totalAmount * 100) / 100,
    },
  };
}

// ── Compliance card loader (PR 6) ────────────────────────────────────
//
// Population: rippling_report_txns_latest rows where category is the
// sentinel `Please Select A Category`. This is the report's equivalent
// of "uncoded" - the coder has to pick a P&L line before a row leaves
// the sentinel bucket. Restricted to attributable work locations (rows
// whose spend_work_location_site_map.account_key is set) so the card
// counts what the period card counts: two surfaces describing uncoded
// card spend with the SAME exclusion set. Two cards on different rules
// is exactly the defect class Kevin ruled out.
//
// The Corp/Remote uncoded rows (work_location = "Remote" or "Corporate
// (CORP)", account_key = null in the map, excluded = true) carry no site
// attribution and surface as a footer count only at aggregate scopes -
// they are real compliance work but a site-attribution card is not
// their home.
//
// Compliance attributes come straight off the report row:
//   has_receipt    - fraction present per site + person (Check 7)
//   approval_state - "Missing Requirements" count feeds the header only;
//                    per-person receipt fraction stays the primary signal
//   purchased_at   - age source. Owner ruling 2026-08-28: purchased is
//                    how long the money has been outstanding; submitted
//                    is how long since the person acted. This card is
//                    the money question, so purchased_at is the age.
//
// People are grouped by employee. Empty employee -> "unattributed" row,
// never dropped (Check 4). The people sum to the site row (Check 3
// gate) and the site rows sum to the hero. The client asserts the
// site==sum(people) invariant.
export async function loadCompliance(supa, { members, start, end, today }) {
  const PS = V6_PAGE_DEFAULT;
  const rows = [];
  let from = 0;
  while (true) {
    const q = await supa.from("rippling_report_txns_latest")
      .select("purchased_at, amount, work_location, employee, has_receipt, approval_state, category")
      .ilike("category", "%please select%")
      .gte("purchased_at", start)
      .lte("purchased_at", end)
      .order("purchased_at", { ascending: true })
      .range(from, from + PS - 1);
    if (q.error) return { error: q.error };
    const data = q.data || [];
    for (const r of data) rows.push(r);
    if (data.length < PS) break;
    from += PS;
  }

  // Resolve work_location label -> account_key. The map keys by
  // work_location_id, but the report gives us the label string, so join
  // on label. Attributable labels are 1:1 with account_key; Corp/Remote
  // labels have many map rows (one per work_location_id) all with
  // account_key=null, so first-wins collapses them consistently.
  const labels = [...new Set(rows.map(r => r.work_location).filter(Boolean))];
  const labelToKey = new Map();
  if (labels.length > 0) {
    for (const chunkLabels of chunk(labels, IN_CHUNK)) {
      const mr = await supa.from("spend_work_location_site_map")
        .select("work_location_label, account_key")
        .in("work_location_label", chunkLabels);
      if (mr.error) return { error: mr.error };
      for (const m of mr.data || []) {
        if (!labelToKey.has(m.work_location_label)) {
          labelToKey.set(m.work_location_label, m.account_key || null);
        }
      }
    }
  }

  // Age is computed as of the range end, clamped to today for
  // in-progress ranges. A closed-period range reads the age as it was on
  // that period's last day; an FYTD-through-today range reads the age
  // as of today. Consistent with how period cards handle "as of".
  const asOfIso = (end > today) ? today : end;
  const asOf = new Date(asOfIso + "T00:00:00Z");
  function daysBetween(dateStr) {
    if (!dateStr) return 0;
    const d = new Date(dateStr + "T00:00:00Z");
    return Math.floor((asOf.getTime() - d.getTime()) / 86400000);
  }

  // Partition rows: attributable (mapped to an account_key in members)
  // vs Corp/Remote (label mapped to null account_key). Rows at
  // attributable sites outside `members` (e.g. single-account scope
  // looking at CIN - AZ, row is at TBR - FL) drop silently - they
  // belong to a different account's view.
  const memberSet = new Set(members);
  const attributable = [];
  const corpRemote = [];
  for (const r of rows) {
    const key = r.work_location ? labelToKey.get(r.work_location) : null;
    if (key && memberSet.has(key)) {
      attributable.push({ ...r, _account_key: key });
    } else if (!key) {
      corpRemote.push(r);
    }
  }

  // Group by site, then by employee within site.
  const bySite = new Map();
  for (const r of attributable) {
    const site = r._account_key;
    if (!bySite.has(site)) bySite.set(site, new Map());
    const perSite = bySite.get(site);
    const empKey = (r.employee || "").trim() || "__UNATTRIBUTED__";
    if (!perSite.has(empKey)) {
      perSite.set(empKey, {
        key: empKey,
        label: empKey === "__UNATTRIBUTED__" ? "unattributed" : r.employee,
        charges: 0,
        amount: 0,
        oldest_age_days: 0,
        receipts_present: 0,
        receipts_total: 0,
      });
    }
    const person = perSite.get(empKey);
    person.charges += 1;
    person.amount += Number(r.amount || 0);
    const age = daysBetween(r.purchased_at);
    if (age > person.oldest_age_days) person.oldest_age_days = age;
    if (r.has_receipt === true) person.receipts_present += 1;
    person.receipts_total += 1;
  }

  // Build site_rows: people amount-desc, unattributed last so the
  // catch-all reads as a floor, not a headline.
  const site_rows = [];
  for (const [site_code, perSite] of bySite.entries()) {
    const people = [...perSite.values()].map(p => ({
      key: p.key,
      label: p.label,
      charges: p.charges,
      amount: Math.round(p.amount * 100) / 100,
      oldest_age_days: p.oldest_age_days,
      receipts_present: p.receipts_present,
      receipts_total: p.receipts_total,
    })).sort((a, b) => {
      if (a.key === "__UNATTRIBUTED__") return 1;
      if (b.key === "__UNATTRIBUTED__") return -1;
      return b.amount - a.amount;
    });
    const charges = people.reduce((s, p) => s + p.charges, 0);
    const amount = Math.round(people.reduce((s, p) => s + p.amount, 0) * 100) / 100;
    const oldest_age_days = people.reduce((m, p) => Math.max(m, p.oldest_age_days), 0);
    const receipts_present = people.reduce((s, p) => s + p.receipts_present, 0);
    const receipts_total = people.reduce((s, p) => s + p.receipts_total, 0);
    site_rows.push({
      site_code,
      charges,
      amount,
      oldest_age_days,
      receipts_present,
      receipts_total,
      people,
    });
  }
  site_rows.sort((a, b) => b.amount - a.amount);

  const total_count = site_rows.reduce((s, r) => s + r.charges, 0);
  const total_amount = Math.round(site_rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const oldest_age_days = site_rows.reduce((m, r) => Math.max(m, r.oldest_age_days), 0);
  const no_receipt_count = site_rows.reduce((s, r) => s + (r.receipts_total - r.receipts_present), 0);

  // Stale-over-90d - a standing figure on the card's OWN population
  // (attributable/in-range). Currently zero on 2026-08-28. Ships even
  // when zero so a nine-month-old charge landing on this surface is
  // observable, not a silent transition from empty to populated.
  const stale_over_90d_count = site_rows.reduce(
    (s, r) => s + r.people.reduce((sp, p) => sp + (p.oldest_age_days > 90 ? p.charges : 0), 0),
    0,
  );
  // We can't cleanly derive amount from the per-person aggregate above
  // without re-walking rows; do the walk once here.
  let stale_over_90d_amount = 0;
  for (const r of attributable) {
    const age = daysBetween(r.purchased_at);
    if (age > 90) stale_over_90d_amount += Number(r.amount || 0);
  }
  const stale_over_90d = {
    count:  stale_over_90d_count,
    amount: Math.round(stale_over_90d_amount * 100) / 100,
  };

  // Corp/Remote footer bucket - only at aggregate scopes (single
  // accounts don't need noise about Corp/Remote spend they don't own).
  // Kevin ruling 2026-08-28: also carry oldest_age_days on the footer
  // so a nine-month-old Corp/Remote charge (275d observed on the
  // corpus) has a surface. Card's own scope is unchanged.
  let corp_remote = null;
  if (members.length > 1 && corpRemote.length > 0) {
    let crOldest = 0;
    for (const r of corpRemote) {
      const age = daysBetween(r.purchased_at);
      if (age > crOldest) crOldest = age;
    }
    corp_remote = {
      count: corpRemote.length,
      amount: Math.round(corpRemote.reduce((s, r) => s + Number(r.amount || 0), 0) * 100) / 100,
      oldest_age_days: crOldest,
    };
  }

  // Region split at aggregate scopes. Same shape as Check 3 - the
  // regions must sum to the portfolio, otherwise a row belongs to a
  // site that no region owns and the ALL / EAST / WEST views disagree.
  // Server throws (not just logs) so a drift can't ship. Region parity
  // holds structurally on 2026-08-28 (5 East + 6 West + 0 NULL), but
  // this guards against future region-null accounts.
  let region_split = null;
  if (members.length > 1) {
    // 11-row read; kept inside the resolver so loadCompliance is
    // self-contained and its assertions don't depend on parallel-load
    // ordering. loadAccountsDirectory also fetches these fields for the
    // rail; the duplication is worth the isolation.
    const arResp = await supa.from("accounts").select("team_key, region").neq("team_key", "CORP");
    if (arResp.error) return { error: arResp.error };
    const regionByKey = new Map();
    for (const row of arResp.data || []) regionByKey.set(row.team_key, row.region);
    const east = { count: 0, amount: 0 };
    const west = { count: 0, amount: 0 };
    const other = { count: 0, amount: 0, keys: new Set() };
    for (const site of site_rows) {
      const region = regionByKey.get(site.site_code);
      const bucket = region === "East" ? east : region === "West" ? west : other;
      bucket.count += site.charges;
      bucket.amount += site.amount;
      if (bucket === other) bucket.keys.add(site.site_code);
    }
    east.amount  = Math.round(east.amount  * 100) / 100;
    west.amount  = Math.round(west.amount  * 100) / 100;
    other.amount = Math.round(other.amount * 100) / 100;
    // Same-defect-shape check: regions must sum to total. Throw so the
    // resolver refuses to serve a broken payload; the client Check 3 is
    // the belt-and-braces gate over the same invariant on the whole
    // (site == sum-of-people == sum-of-regions) column.
    const combined = east.count + west.count + other.count;
    if (combined !== total_count) {
      return { error: { message: `region parity: east=${east.count} west=${west.count} other=${other.count} sum=${combined} total_count=${total_count}`, code: "region_parity_sum" } };
    }
    if (other.count > 0) {
      return { error: { message: `region parity: ${other.count} charge(s) at site(s) [${[...other.keys].join(",")}] whose region is neither East nor West. Fix accounts.region before continuing.`, code: "region_parity_other" } };
    }
    region_split = { east, west };
  }

  return {
    data: {
      total_count,
      total_amount,
      oldest_age_days,
      no_receipt_count,
      site_rows,
      corp_remote,
      region_split,
      stale_over_90d,
      thresholds: { red_days: 14, amber_days: 7 },
    },
  };
}
