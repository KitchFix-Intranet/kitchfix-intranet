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
    else if (f.op === "not_is") {
      // .not(col, "is", null) -> SQL "col IS NOT NULL"
      if (f.val === null) { if (row[f.col] == null) return false; }
      else if (row[f.col] === f.val) return false;
    }
    else if (f.op === "ilike") {
      const cell = String(row[f.col] || "").toLowerCase();
      // The mock does not implement % wildcards; every caller today
      // passes a bare email address for a case-insensitive equality
      // check. Add wildcard support when a caller needs it.
      if (cell !== f.val.toLowerCase()) return false;
    }
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
      // 2026-09-18: orderList replaces single (orderCol, orderAsc).
      // supabase-js accumulates multiple .order() calls into a
      // primary-then-secondary sort. The prior single-slot mock
      // silently dropped every non-final .order() - Cause C from
      // the finalize-tests-fix brief. getSalariedManagerEmails
      // called .order("is_site_leader", ...).order("display_name")
      // and the site-leader ordering vanished under the mock,
      // returning "Adam, Zoe" when production returns "Zoe, Adam".
      // A test asserting on the mock's order would pin the wrong
      // person as chase-email recipient (chasePersonName's
      // first_salaried fallback takes index 0).
      orderList: [],
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
      if (state.orderList.length > 0) {
        // Multi-column sort. Primary is the first .order() call,
        // then secondary tiebreakers, matching supabase-js /
        // PostgreSQL ORDER BY semantics. Also honors nullsFirst
        // and the ascending default (production defaults asc=true
        // when opts is omitted; the prior single-slot mock
        // defaulted asc=false via !!opts?.ascending).
        rows.sort((a, b) => {
          for (const o of state.orderList) {
            const av = a[o.col], bv = b[o.col];
            const aNull = av == null, bNull = bv == null;
            if (aNull && bNull) continue;
            if (aNull) return o.nullsFirst ? -1 : 1;
            if (bNull) return o.nullsFirst ? 1 : -1;
            if (av === bv) continue;
            const cmp = av > bv ? 1 : -1;
            return o.asc ? cmp : -cmp;
          }
          return 0;
        });
      }
      if (state.limit != null) rows = rows.slice(0, state.limit);
      if (state.single) {
        if (rows.length === 0) return { data: null, error: { code: "PGRST116", message: "single: no rows" } };
        if (rows.length > 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
        return { data: rows[0], error: null };
      }
      if (state.maybeSingle) {
        // 2026-09-16 fix: real .maybeSingle() ERRORS when the query
        // matches more than one row, returning
        //   { data: null, error: { code: "PGRST116", ... } }.
        // Previously the mock silently returned rows[0], which hid a
        // production defect (runFinalizeEffects biweekly meta query
        // missing account_key filter, matching 11 rows across
        // accounts). Match production semantics so the corresponding
        // tests can seed a multi-row shape and assert the error path.
        if (rows.length > 1) return { data: null, error: { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" } };
        return { data: rows[0] || null, error: null };
      }
      return { data: rows, error: null };
    }

    const api = {
      select(cols) { state.cols = cols; return api; },
      eq(col, val)  { state.filters.push({ col, op: "=",  val }); return api; },
      gte(col, val) { state.filters.push({ col, op: ">=", val }); return api; },
      lte(col, val) { state.filters.push({ col, op: "<=", val }); return api; },
      in(col, arr)  { state.filters.push({ col, op: "in", val: arr }); return api; },
      not(col, op, val) { state.filters.push({ col, op: `not_${op}`, val }); return api; },
      // ilike: case-insensitive equality with SQL-style wildcards
      // stripped for the mock (no seed data uses %). Added 2026-09-09
      // so scWeekFinalize's contacts lookup (submitterName) is
      // exercised by the runFinalizeEffects tests.
      ilike(col, val) { state.filters.push({ col, op: "ilike", val: String(val || "") }); return api; },
      order(col, opts) {
        // supabase-js default: ascending=true when opts omitted.
        // supabase-js default: nullsFirst=false unless explicitly set
        // (PostgreSQL's own default varies by direction, but supabase-
        // js normalises to nullsFirst=false).
        const asc = opts == null || opts.ascending !== false;
        const nullsFirst = !!opts?.nullsFirst;
        state.orderList.push({ col, asc, nullsFirst });
        return api;
      },
      limit(n) { state.limit = n; return api; },
      single() { state.single = true; return exec(); },
      maybeSingle() { state.maybeSingle = true; return exec(); },
      insert(row) { state.op = "insert"; state.payload = row; return api; },
      update(patch) { state.op = "update"; state.updates = patch; return api; },
      then(onFulfilled, onRejected) { return exec().then(onFulfilled, onRejected); },
    };
    return api;
  }

  // sc-48: RPC support for the invoice-number sequences. Returns a
  // monotonically-increasing integer per RPC name. Tests can assert
  // on the emitted KF/KFT strings by predicting the counter.
  const rpcCounters = {};
  function rpc(name, _args) {
    const cur = (rpcCounters[name] || 0) + 1;
    rpcCounters[name] = cur;
    log.push({ op: "rpc", name, result: cur });
    return Promise.resolve({ data: cur, error: null });
  }

  return {
    from(tableName) { return chain(tableName); },
    rpc(name, args) { return rpc(name, args); },
    _dump(tableName) { return [...(store[tableName] || [])]; },
    _log() { return [...log]; },
    _rpcCounters() { return { ...rpcCounters }; },
  };
}
