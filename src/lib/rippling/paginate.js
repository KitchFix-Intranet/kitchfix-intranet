// src/lib/rippling/paginate.js
//
// Shared pagination helpers for reads against Supabase tables and
// views. Three shapes:
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
//   fetchAllIn(supa, table, cols, { keyCol, keyValues, chunkSize, filters })
//     `.in(keyCol, keyValues)` pagination. Chunks keyValues on the
//     KEY side so each request stays under the Supabase 1000-row
//     response cap AND under any URL length ceiling. Chunks are then
//     paginated with `.range()` inside as a belt-and-suspenders in
//     case any single chunk still fans out past PAGE_SIZE rows.
//     Standing rule: `.in(<key>, <bigArray>)` without this helper is
//     the same failure mode as `.select()` without `.range()`.
//
// --- .in() failure mode note (2026-08-28 sweep) --------------------
//
// Bare `.in(col, bigArray)` fails TWO ways, not one:
//
//   1. Silent truncation at 1000 rows - same as `.select()` without
//      `.range()`. Fires when the .in() key list fits in the URL but
//      the RESPONSE would exceed the cap. The caller gets a partial
//      result and a null error; the code carries on with short data.
//
//   2. 400 Bad Request from URL overflow - fires when the .in() list
//      is long enough that the request URL crosses ~2KB. For UUID
//      keys this happens around 50-100 items. Not silent - the
//      response carries an error - but if the caller wraps the query
//      in a try/catch (or `if (q.error) return {...empty maps}`), the
//      operator sees "the feature just does not work" (blank cells,
//      missing names, empty exports) instead of an error surface.
//
// This PR fixed the 400 shape in resolveWorkerMeta.js and the two
// inline dupes in export/route.js. The catch blocks stay - they are
// defense-in-depth - but the read now succeeds instead of erroring.
// Related: swallowing-catch broader sweep flagged 2026-08-28. See
// docs/CONVENTIONS.md "error swallowing" if that pass lands guidance.
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

// Chunk an array into fixed-size slices. Pure function extracted so
// the probe can assert boundary behavior (empty, exact multiples,
// single-chunk) without booting a Supabase client.
export function chunkKeys(keys, chunkSize) {
  if (chunkSize <= 0) throw new Error(`chunkKeys: chunkSize must be > 0, got ${chunkSize}`);
  const out = [];
  for (let i = 0; i < keys.length; i += chunkSize) {
    out.push(keys.slice(i, i + chunkSize));
  }
  return out;
}

/**
 * `.in(keyCol, keyValues)` pagination for reads whose key set can
 * exceed the Supabase 1000-row response cap or the URL length ceiling.
 * Chunks the key array (default 100 per chunk - conservative for
 * UUID-length keys; 100 x ~37 chars stays well under standard URL
 * limits with room for the base URL and other filters). For each
 * chunk runs an offset-paginated fetch in case a single chunk still
 * fans out past PAGE_SIZE rows (e.g., .in on a non-unique column).
 *
 * De-dupes keyValues and drops falsy entries before chunking.
 *
 * @param {SupabaseClient} supa
 * @param {string} table
 * @param {string} cols
 * @param {object} opts
 * @param {string} opts.keyCol                   the column on the .in() filter
 * @param {Array}  opts.keyValues                the values to filter for
 * @param {number} [opts.chunkSize=100]          how many keys per request
 * @param {Array<(q:any)=>any>} [opts.filters]   additional filter builders per chunk
 * @returns {Promise<Array<object>>}
 */
export async function fetchAllIn(supa, table, cols, opts = {}) {
  const { keyCol, keyValues, chunkSize = 100, filters = [] } = opts;
  if (!keyCol) throw new Error(`fetchAllIn(${table}): keyCol is required`);
  const keys = [...new Set((keyValues || []).filter(v => v != null && v !== ""))];
  if (keys.length === 0) return [];
  const out = [];
  for (const chunk of chunkKeys(keys, chunkSize)) {
    let from = 0;
    while (true) {
      let q = supa.from(table).select(cols)
        .in(keyCol, chunk)
        .order(keyCol, { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      for (const f of filters) q = f(q);
      const { data, error } = await q;
      if (error) throw new Error(`${table}: ${error.message}`);
      if (!data?.length) break;
      out.push(...data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
  }
  return out;
}
