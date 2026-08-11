// Minimal in-memory Supabase mock. Supports only the query shapes
// qboAdapter + runFinalizeEffects exercise. Not a general-purpose
// substitute for supabase-js - just enough to prove behavior.
//
// Supports:
//   .from(t).select(cols).eq/gte/lte/in(...).order().limit().maybeSingle()/single()
//   .from(t).insert(row).select("...").single()
//   .from(t).update(patch).eq(...)
//   awaiting the chain (without .single/.maybeSingle) returns { data: rows[], error }

let seq = 1;

function matches(row, filters) {
  for (const f of filters) {
    if (f.op === "=") { if (row[f.col] !== f.val) return false; }
    else if (f.op === ">=") { if (String(row[f.col]) < String(f.val)) return false; }
    else if (f.op === "<=") { if (String(row[f.col]) > String(f.val)) return false; }
    else if (f.op === "in") { if (!f.val.includes(row[f.col])) return false; }
  }
  return true;
}

export function makeSupaMock({ tables = {} } = {}) {
  const store = Object.fromEntries(
    Object.entries(tables).map(([k, v]) => [k, v.map((r) => ({ ...r }))])
  );
  const log = [];

  function chain(tableName) {
    const state = {
      op: "select",
      filters: [],
      cols: "*",
      payload: null,
      updates: null,
      orderCol: null,
      orderAsc: true,
      limit: null,
      single: false,
      maybeSingle: false,
    };

    async function exec() {
      if (!store[tableName]) store[tableName] = [];

      if (state.op === "insert") {
        const rows = Array.isArray(state.payload) ? state.payload : [state.payload];
        const added = rows.map((r) => ({ id: r.id || `mock-id-${seq++}`, ...r }));
        store[tableName].push(...added);
        log.push({ op: "insert", table: tableName, rows: added });
        if (state.single) return { data: added[0] || null, error: null };
        if (state.maybeSingle) return { data: added[0] || null, error: null };
        return { data: added, error: null };
      }

      if (state.op === "update") {
        const affected = [];
        for (const row of store[tableName]) {
          if (matches(row, state.filters)) {
            Object.assign(row, state.updates);
            affected.push(row);
          }
        }
        log.push({ op: "update", table: tableName, filters: state.filters, patch: state.updates, count: affected.length });
        if (state.single) return { data: affected[0] || null, error: null };
        if (state.maybeSingle) return { data: affected[0] || null, error: null };
        return { data: affected, error: null };
      }

      // select
      let rows = store[tableName].filter((r) => matches(r, state.filters));
      if (state.orderCol) {
        rows.sort((a, b) => {
          const av = a[state.orderCol], bv = b[state.orderCol];
          if (av === bv) return 0;
          const cmp = av > bv ? 1 : -1;
          return state.orderAsc ? cmp : -cmp;
        });
      }
      if (state.limit != null) rows = rows.slice(0, state.limit);
      if (state.single) {
        if (rows.length === 0) return { data: null, error: { code: "PGRST116", message: "single: no rows" } };
        return { data: rows[0], error: null };
      }
      if (state.maybeSingle) return { data: rows[0] || null, error: null };
      return { data: rows, error: null };
    }

    const api = {
      select(cols) { state.cols = cols; return api; },
      eq(col, val)  { state.filters.push({ col, op: "=",  val }); return api; },
      gte(col, val) { state.filters.push({ col, op: ">=", val }); return api; },
      lte(col, val) { state.filters.push({ col, op: "<=", val }); return api; },
      in(col, arr)  { state.filters.push({ col, op: "in", val: arr }); return api; },
      order(col, opts) { state.orderCol = col; state.orderAsc = !!opts?.ascending; return api; },
      limit(n) { state.limit = n; return api; },
      single() { state.single = true; return exec(); },
      maybeSingle() { state.maybeSingle = true; return exec(); },
      insert(row) { state.op = "insert"; state.payload = row; return api; },
      update(patch) { state.op = "update"; state.updates = patch; return api; },
      then(onFulfilled, onRejected) { return exec().then(onFulfilled, onRejected); },
    };
    return api;
  }

  return {
    from(tableName) { return chain(tableName); },
    _dump(tableName) { return [...(store[tableName] || [])]; },
    _log() { return [...log]; },
  };
}
