// src/lib/rippling/paginate.js
//
// Shared pagination helpers for reads against Supabase tables and
// views. Two shapes:
//
//   fetchAllOffset(supa, table, cols, filters)
//     LIMIT/OFFSET pagination. Safe on base tables where offset is
//     bounded by the row count. Do NOT use on `_latest` DISTINCT ON
//     views - see fetchAllKeyset for the reason.
//
//   fetchAllKeyset(supa, view, cols, { keyCol='rippling_id', filters })
//     Keyset pagination via `WHERE keyCol > $last ORDER BY keyCol
//     LIMIT N`. Each page is O(index seek); table size stops
//     mattering. Required on every `rippling_raw_*_latest` view.
//
// Why fetchAllKeyset exists (owner incident 2026-08-27):
//
// The `_latest` views are `SELECT DISTINCT ON (rippling_id) ... ORDER
// BY rippling_id, fetched_at DESC, id DESC`. The compound index
// `(rippling_id, fetched_at DESC, id DESC)` is textbook optimal for
// the DISTINCT ON. But LIMIT/OFFSET pagination on such a view means
// Postgres has to walk the deduplication result from the first
// rippling_id to the offset boundary, discard those rows, then
// return the next page. Every deep page pays the cost of every prior
// page, and the underlying table sits behind that too - if the raw
// table grew 8.8x through nightly revisions (Aug 22-27), deep pages
// cross the 60s statement timeout.
//
// Reproduced live (2026-08-27) on rippling_raw_time_entries_latest:
//   page 0-999    with payload    405 ms
//   page 9000-9999 with payload  8362 ms  ← "canceling statement"
//
// After swapping OFFSET for keyset:
//   full 10,113-row read          10.8 s
//   deepest page                  1.8 s
//
// Keyset works because DISTINCT ON preserves the ORDER BY on
// rippling_id, so a `WHERE rippling_id > $last ORDER BY rippling_id`
// filter pushes down into the underlying scan and returns the next
// N distinct rippling_ids in O(index seek). No offset re-execution.
//
// Both helpers pass errors through as thrown exceptions with the
// table name in the message so the deriving caller can catch and
// tag which table failed.

const PAGE_SIZE = 1000;

/**
 * LIMIT/OFFSET pagination against a base table.
 *
 * @param {SupabaseClient} supa
 * @param {string}   table    table or plain view (NOT a `_latest` DISTINCT ON view)
 * @param {string}   cols     column selection - "col1, col2" or "*"
 * @param {Array<(q:any)=>any>} [filters]  filter builders applied to each page
 * @returns {Promise<Array<object>>}
 */
export async function fetchAllOffset(supa, table, cols = "*", filters = []) {
  const out = [];
  let from = 0;
  while (true) {
    let q = supa.from(table).select(cols).range(from, from + PAGE_SIZE - 1);
    for (const f of filters) q = f(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

/**
 * Keyset pagination via a monotonically increasing key. Required for
 * `_latest` DISTINCT ON views; safe for any table where rows can be
 * ordered by a unique key column.
 *
 * @param {SupabaseClient} supa
 * @param {string}   view     the `_latest` view (or any table with a monotonically-orderable key)
 * @param {string}   cols     column selection - MUST include the key column
 * @param {object}   [opts]
 * @param {string}   [opts.keyCol='rippling_id']  the ordering + cursor column
 * @param {Array<(q:any)=>any>} [opts.filters]   filter builders applied to each page
 * @returns {Promise<Array<object>>}
 */
export async function fetchAllKeyset(supa, view, cols = "*", opts = {}) {
  const { keyCol = "rippling_id", filters = [] } = opts;
  // Callers MUST include the key column so the cursor can advance.
  // A quick check on the columns string catches the obvious miss;
  // a select of "*" is always safe.
  if (cols !== "*" && !cols.includes(keyCol)) {
    throw new Error(`fetchAllKeyset(${view}): cols must include the key column "${keyCol}" so the cursor can advance; got "${cols}"`);
  }
  const out = [];
  let last = null;
  while (true) {
    let q = supa.from(view).select(cols).order(keyCol, { ascending: true }).limit(PAGE_SIZE);
    if (last !== null) q = q.gt(keyCol, last);
    for (const f of filters) q = f(q);
    const { data, error } = await q;
    if (error) throw new Error(`${view}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    last = data[data.length - 1][keyCol];
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}
