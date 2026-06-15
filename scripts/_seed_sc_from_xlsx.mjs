// scripts/_seed_sc_from_xlsx.mjs
// One-time seed: populate the six sc_* Postgres tables from the 11
// Service Calendar spreadsheets.
//
// Pipeline:
//   1. scripts/_extract_sc_xlsx.py reads each .xlsx and emits
//      scripts/_sc_extract.json (per-account: projections + actuals +
//      optional B&G tabs, with column maps + per-row values).
//   2. This script reads that JSON, normalizes services, and writes:
//        - sc_service_groups
//        - sc_services
//        - sc_service_prices
//        - sc_daily_projections
//        - sc_daily_actuals
//        - sc_day_metadata
//   3. Final verification queries print counts per table per account.
//
// All conventions enforced:
//   - account_key uses canonical spaced form ('CIN - AZ' etc.)
//   - created_by = 'import-script'
//   - calculated columns are denied at extraction time (Total Revenue etc.)
//   - clicker tabs not extracted
//   - 'Blank' placeholder columns skipped (name='Blank' AND price=0)
//   - 'TOTALS' groups skipped
//   - Period normalized to integer string '1'..'13'
//   - game_type uppercased
//   - effective_date = 2026-01-01 for all initial prices
//   - upsert on tables with UNIQUE constraints
//
// Run:
//   node --env-file=.env.local scripts/_seed_sc_from_xlsx.mjs
//
// Idempotent on re-run for daily_actuals, daily_projections, and
// day_metadata (upsert). sc_service_groups, sc_services, and
// sc_service_prices are also upserted by their natural keys.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getServiceClient } from "../src/lib/supabase.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.join(__dirname, "_sc_extract.json");
const CREATED_BY = "import-script";
const EFFECTIVE_DATE = "2026-01-01";

// ─────────────────────────────────────────────────────────────────────
// Flag overrides per spec.
// Keyed by `account_key||group_name||service_name` for explicit assignment.
// ─────────────────────────────────────────────────────────────────────
const FLAG_OVERRIDES = {
  // CIN - AZ: Coffee Service + Fountain Bev are flat_fee + tax_free
  "CIN - AZ||Minor League||Coffee Service (tax-free)": {
    is_flat_fee: true, is_tax_free: true,
  },
  "CIN - AZ||Minor League||Fountain Bev (tax-free)": {
    is_flat_fee: true, is_tax_free: true,
  },

  // STL - FL: Fun Money allocation = flat_fee + non_revenue
  "STL - FL||Fun Money||Fun Money allocation": {
    is_flat_fee: true, is_non_revenue: true,
  },

  // TBJ - FL: Fun $$$$ Allocated = flat_fee + non_revenue
  "TBJ - FL||Other||Fun $$$$ Allocated": {
    is_flat_fee: true, is_non_revenue: true,
  },

  // TBR - FL: Extra Protein + MLB Extra MTO items + Extended Day Labor are flat fee
  "TBR - FL||Major League||Extra Protein - Chicken/Pork": { is_flat_fee: true },
  "TBR - FL||Major League||Extra Protein - Beef/Seafood": { is_flat_fee: true },
  "TBR - FL||Minor League||Extra Protein - Chicken/Pork": { is_flat_fee: true },
  "TBR - FL||Minor League||Extra Protein - Beef/Seafood": { is_flat_fee: true },
  "TBR - FL||Major League||MLB - Extra MTO - Sm": { is_flat_fee: true },
  "TBR - FL||Major League||MLB - Extra MTO - Med": { is_flat_fee: true },
  "TBR - FL||Major League||MLB - Extra MTO - Lrg": { is_flat_fee: true },
  "TBR - FL||Minor League||Extended Day labor": { is_flat_fee: true },

  // TXR - AZ: Extra Protein flat fee
  "TXR - AZ||Major League||Extra Protein - Chicken/Pork": { is_flat_fee: true },
  "TXR - AZ||Major League||Extra Protein - Beef/Seafood": { is_flat_fee: true },
  "TXR - AZ||Minor League||Extra Protein - Chicken/Pork": { is_flat_fee: true },
  "TXR - AZ||Minor League||Extra Protein - Beef/Seafood": { is_flat_fee: true },
};

// Generic per-service rules: Extra Protein is always flat_fee
function getFlags(accountKey, groupName, serviceName) {
  const key = `${accountKey}||${groupName}||${serviceName}`;
  if (FLAG_OVERRIDES[key]) return { ...FLAG_OVERRIDES[key] };
  // Generic Extra Protein catch-all (in case any account adds it later)
  if (/^Extra Protein/i.test(serviceName)) {
    return { is_flat_fee: true };
  }
  return {};
}

// ─────────────────────────────────────────────────────────────────────
// Service-name canonicalization: actuals tab sometimes uses a different
// label for the same logical service. Map actuals service-name -> projection
// service-name so they collapse into a single canonical sc_services row.
// Keyed by `account_key||group_name||actuals_name` -> canonical name.
// ─────────────────────────────────────────────────────────────────────
const ACTUALS_NAME_REMAP = {
  // STL - FL: Actuals col U is "Breakfast" in Palm Beach Cardinals but
  // projection has "Arrival". Per mapping doc, treat as the same service.
  "STL - FL||Palm Beach Cardinals||Breakfast": "Arrival",
};

// ─────────────────────────────────────────────────────────────────────
// Service-name skip rules: a few service rows we never want to import.
// (Blank placeholders are handled by their (name='Blank' AND price=0) filter.)
// ─────────────────────────────────────────────────────────────────────
function shouldSkipService(s) {
  // Blank placeholder columns
  if (s.service_name === "Blank" && (s.price === 0 || s.price === null)) return true;
  // Empty header
  if (!s.service_name) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Group skip rules
// ─────────────────────────────────────────────────────────────────────
function shouldSkipGroup(groupName, services) {
  if (!groupName) return true;
  if (groupName.trim().toUpperCase() === "TOTALS") return true;
  // 'Other' group containing ONLY Blank columns -> skip group entirely
  if (groupName.trim() === "Other") {
    const realServices = services.filter((s) => !shouldSkipService(s));
    if (realServices.length === 0) return true;
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────
// Period normalization: integer-string '1'..'13'
// ─────────────────────────────────────────────────────────────────────
function normalizePeriod(v) {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const p = Math.floor(n);
  if (p >= 1 && p <= 13) return String(p);
  return null;
}

function normalizeGameType(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.toUpperCase();
}

function asString(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s : null;
}

// ─────────────────────────────────────────────────────────────────────
// Build per-account canonical service list, merging projections + actuals.
// Returns:
//   groups:   [{ group_name, sort_order }]
//   services: [{ group_name, service_name, price, is_flat_fee, is_tax_free,
//                is_non_revenue, sort_order, source }]
//   colmaps:  { projection_col_to_service: { name_col -> canonical_service_name }, ... }
// ─────────────────────────────────────────────────────────────────────
function buildCanonical(accountKey, payload) {
  const proj = payload.projections;
  const acts = payload.actuals;
  const bg_p = payload.bg_projections;

  // Canonical groups: from projections tab + B&G if present.
  // The leftmost column of each group's services determines sort_order.
  const groupOrder = []; // group_name in order of first appearance
  const groupFirstCol = {}; // group_name -> leftmost col
  const services = []; // canonical service list
  const projColMap = {}; // name_col (projection tab) -> canonical service key
  const actsColMap = {}; // name_col (actuals tab)    -> canonical service key

  function ensureGroup(groupName, firstCol) {
    if (!groupOrder.includes(groupName)) {
      groupOrder.push(groupName);
      groupFirstCol[groupName] = firstCol;
    }
  }

  // Step 1: ingest projection services
  if (proj) {
    for (const s of proj.services) {
      if (shouldSkipGroup(s.group_name, proj.services)) continue;
      if (shouldSkipService(s)) continue;
      ensureGroup(s.group_name, s.name_col);
      const canonKey = `${s.group_name}||${s.service_name}`;
      if (!services.find((x) => x._key === canonKey)) {
        services.push({
          _key: canonKey,
          group_name: s.group_name,
          service_name: s.service_name,
          price: s.price == null ? 0 : s.price, // STL FL Snack -> 0
          sort_order: s.sort_in_group,
          source: "projection",
          proj_name_col: s.name_col,
        });
      }
      projColMap[String(s.name_col)] = canonKey;
    }
  }

  // Step 2: ingest actuals services (handle remap + actuals-only additions)
  if (acts) {
    for (const s of acts.services) {
      if (shouldSkipGroup(s.group_name, acts.services)) continue;
      if (shouldSkipService(s)) continue;
      let canonName = s.service_name;
      const remapKey = `${accountKey}||${s.group_name}||${s.service_name}`;
      if (ACTUALS_NAME_REMAP[remapKey]) {
        canonName = ACTUALS_NAME_REMAP[remapKey];
      }
      ensureGroup(s.group_name, s.name_col);
      const canonKey = `${s.group_name}||${canonName}`;
      let existing = services.find((x) => x._key === canonKey);
      if (!existing) {
        // actuals-only service
        services.push({
          _key: canonKey,
          group_name: s.group_name,
          service_name: canonName,
          price: s.price == null ? 0 : s.price,
          sort_order: s.sort_in_group,
          source: "actuals",
          acts_name_col: s.name_col,
        });
      } else {
        existing.acts_name_col = s.name_col;
      }
      actsColMap[String(s.name_col)] = canonKey;
    }
  }

  // Step 3: B&G projections add Boys & Girls Club group + B&G Lunch service.
  // B&G lives in its own tab so column position is unrelated to the main
  // tab's column positions; pin it to a large col index so it sorts AFTER
  // the main groups.
  if (bg_p) {
    for (const s of bg_p.services) {
      ensureGroup(s.group_name, 100000); // force last
      const canonKey = `${s.group_name}||${s.service_name}`;
      if (!services.find((x) => x._key === canonKey)) {
        services.push({
          _key: canonKey,
          group_name: s.group_name,
          service_name: s.service_name,
          price: s.price == null ? 6.5 : s.price,
          sort_order: 0,
          source: "bg",
        });
      }
    }
  }

  // Step 4: apply flags
  for (const s of services) {
    const flags = getFlags(accountKey, s.group_name, s.service_name);
    s.is_flat_fee = !!flags.is_flat_fee;
    s.is_tax_free = !!flags.is_tax_free;
    s.is_non_revenue = !!flags.is_non_revenue;
  }

  // Step 5: groups list with sort_order = leftmost-col index relative to other groups
  const orderedGroups = [...groupOrder].sort(
    (a, b) => groupFirstCol[a] - groupFirstCol[b]
  );
  const groups = orderedGroups.map((name, i) => ({
    group_name: name,
    sort_order: i,
  }));

  return { groups, services, projColMap, actsColMap };
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  console.log(`SC seed import starting...`);
  console.log(`JSON source: ${JSON_PATH}`);

  if (!fs.existsSync(JSON_PATH)) {
    console.error(`ERROR: ${JSON_PATH} not found. Run scripts/_extract_sc_xlsx.py first.`);
    process.exit(1);
  }
  const extract = JSON.parse(fs.readFileSync(JSON_PATH, "utf-8"));
  if (extract.errors && extract.errors.length) {
    console.warn(`Extractor reported ${extract.errors.length} errors:`);
    for (const e of extract.errors) console.warn(`  ${e}`);
  }

  const sb = getServiceClient();

  const accountResults = {};
  const perAccountCounts = {}; // per-account counts for final summary

  for (const accountKey of Object.keys(extract.accounts)) {
    const payload = extract.accounts[accountKey];
    if (!payload) {
      console.error(`SKIP ${accountKey}: extractor returned null payload`);
      accountResults[accountKey] = { ok: false, error: "no payload" };
      continue;
    }
    try {
      const counts = await processAccount(sb, accountKey, payload);
      accountResults[accountKey] = { ok: true, counts };
      perAccountCounts[accountKey] = counts;
    } catch (e) {
      console.error(`FAIL ${accountKey}: ${e?.message || e}`);
      if (e?.stack) console.error(e.stack);
      accountResults[accountKey] = { ok: false, error: e?.message || String(e) };
    }
  }

  // Verification queries
  console.log(`\n${"=".repeat(70)}`);
  console.log(`VERIFICATION - per-account row counts (from PG)`);
  console.log(`${"=".repeat(70)}`);
  await printPerAccountVerification(sb);

  // Per-table totals
  const totals = await fetchTableTotals(sb);
  console.log(`\n${"=".repeat(70)}`);
  console.log(`TOTAL ROW COUNTS vs expected`);
  console.log(`${"=".repeat(70)}`);
  const expected = {
    sc_service_groups: "~24",
    sc_services: "~95-100",
    sc_service_prices: "~95-100",
    sc_daily_projections: "~22,000",
    sc_daily_actuals: "~6,000",
    sc_day_metadata: "~4,200",
  };
  for (const t of Object.keys(totals)) {
    console.log(`  ${t.padEnd(25)} actual=${String(totals[t]).padStart(7)}  expected=${expected[t] || "?"}`);
  }

  // Final summary
  console.log(`\n${"=".repeat(70)}`);
  console.log(`ACCOUNT-LEVEL RESULTS`);
  console.log(`${"=".repeat(70)}`);
  let okCount = 0, failCount = 0;
  for (const [acct, res] of Object.entries(accountResults)) {
    if (res.ok) {
      okCount++;
      const c = res.counts;
      console.log(`  OK   ${acct.padEnd(15)} ${c.groups} groups, ${c.services} services, ${c.prices} prices, ${c.projections.toLocaleString()} projections, ${c.actuals.toLocaleString()} actuals, ${c.metadata.toLocaleString()} metadata rows`);
    } else {
      failCount++;
      console.log(`  FAIL ${acct.padEnd(15)} ${res.error}`);
    }
  }
  console.log(`\n${okCount} succeeded, ${failCount} failed.`);

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nElapsed: ${elapsed}s`);

  if (failCount > 0) process.exit(1);
}

// ─────────────────────────────────────────────────────────────────────
// Process one account: groups, services, prices, projections, actuals, metadata.
// ─────────────────────────────────────────────────────────────────────
async function processAccount(sb, accountKey, payload) {
  console.log(`\n[${accountKey}] processing...`);
  const canon = buildCanonical(accountKey, payload);

  // Step A: upsert groups; build group_name -> id
  const groupIds = {};
  for (const g of canon.groups) {
    const { data, error } = await sb
      .from("sc_service_groups")
      .upsert(
        {
          account_key: accountKey,
          group_name: g.group_name,
          sort_order: g.sort_order,
          active: true,
          created_by: CREATED_BY,
        },
        { onConflict: "account_key,group_name" }
      )
      .select("id, group_name")
      .single();
    if (error) {
      throw new Error(`sc_service_groups upsert failed for ${g.group_name}: ${error.message}`);
    }
    groupIds[g.group_name] = data.id;
  }

  // Step B: upsert services; build canonKey -> id
  const serviceIds = {};
  for (const s of canon.services) {
    const groupId = groupIds[s.group_name];
    if (!groupId) {
      throw new Error(`No group id for ${s.group_name} (service ${s.service_name})`);
    }
    const { data, error } = await sb
      .from("sc_services")
      .upsert(
        {
          account_key: accountKey,
          group_id: groupId,
          service_name: s.service_name,
          is_tax_free: s.is_tax_free,
          is_flat_fee: s.is_flat_fee,
          is_non_revenue: s.is_non_revenue,
          sort_order: s.sort_order,
          active: true,
          created_by: CREATED_BY,
        },
        { onConflict: "account_key,group_id,service_name" }
      )
      .select("id")
      .single();
    if (error) {
      console.error(`Offending service row:`, { accountKey, ...s });
      throw new Error(`sc_services upsert failed for ${s.service_name}: ${error.message}`);
    }
    serviceIds[s._key] = data.id;
  }

  // Step C: upsert prices
  let priceCount = 0;
  for (const s of canon.services) {
    const serviceId = serviceIds[s._key];
    const price = s.price == null ? 0 : s.price;
    const { error } = await sb
      .from("sc_service_prices")
      .upsert(
        {
          service_id: serviceId,
          price: Number(price).toFixed(5),
          effective_date: EFFECTIVE_DATE,
          created_by: CREATED_BY,
        },
        { onConflict: "service_id,effective_date" }
      );
    if (error) {
      console.error(`Offending price row:`, { service: s.service_name, price });
      throw new Error(`sc_service_prices upsert failed: ${error.message}`);
    }
    priceCount++;
  }

  // Step D: projections rows
  let projectionRows = [];
  if (payload.projections) {
    for (const row of payload.projections.rows) {
      for (const [colStr, val] of Object.entries(row.values)) {
        const canonKey = canon.projColMap[colStr];
        if (!canonKey) continue;
        const sid = serviceIds[canonKey];
        if (!sid) continue;
        const ival = Math.max(0, Math.round(val));
        projectionRows.push({
          account_key: accountKey,
          service_id: sid,
          service_date: row.date,
          projected_count: ival,
          created_by: CREATED_BY,
        });
      }
    }
  }
  // B&G projections
  if (payload.bg_projections) {
    // Single service: B&G Lunch
    const sid = serviceIds["Boys & Girls Club||B&G Lunch"];
    if (sid) {
      const nameCol = String(payload.bg_projections.services[0].name_col);
      for (const row of payload.bg_projections.rows) {
        const v = row.values[nameCol];
        if (v == null) continue;
        const ival = Math.max(0, Math.round(v));
        projectionRows.push({
          account_key: accountKey,
          service_id: sid,
          service_date: row.date,
          projected_count: ival,
          created_by: CREATED_BY,
        });
      }
    }
  }
  await bulkUpsert(
    sb,
    "sc_daily_projections",
    projectionRows,
    "account_key,service_id,service_date"
  );

  // Step E: actuals rows
  let actualRows = [];
  if (payload.actuals) {
    for (const row of payload.actuals.rows) {
      for (const [colStr, val] of Object.entries(row.values)) {
        const canonKey = canon.actsColMap[colStr];
        if (!canonKey) continue;
        const sid = serviceIds[canonKey];
        if (!sid) continue;
        const ival = Math.max(0, Math.round(val));
        actualRows.push({
          account_key: accountKey,
          service_id: sid,
          service_date: row.date,
          actual_count: ival,
          created_by: CREATED_BY,
        });
      }
    }
  }
  // B&G actuals
  if (payload.bg_actuals) {
    const sid = serviceIds["Boys & Girls Club||B&G Lunch"];
    if (sid) {
      const nameCol = String(payload.bg_actuals.services[0].name_col);
      for (const row of payload.bg_actuals.rows) {
        const v = row.values[nameCol];
        if (v == null) continue;
        const ival = Math.max(0, Math.round(v));
        actualRows.push({
          account_key: accountKey,
          service_id: sid,
          service_date: row.date,
          actual_count: ival,
          created_by: CREATED_BY,
        });
      }
    }
  }
  await bulkUpsert(
    sb,
    "sc_daily_actuals",
    actualRows,
    "account_key,service_id,service_date"
  );

  // Step F: day metadata. Use the projections tab as the canonical source.
  // For TBR - FL, also merge B&G dates beyond the projections range.
  const metaByDate = {};
  function buildMeta(rows) {
    if (!rows) return;
    for (const row of rows) {
      const m = row.meta || {};
      const period = normalizePeriod(m["period"]);
      const week_label = asString(m["week"]);
      const event_label = asString(m["camp name"]) || asString(m["holiday"]) || null;
      const game_type = normalizeGameType(m["game type"]);
      const game_time = asString(m["game time"]);
      const entry = {
        account_key: accountKey,
        service_date: row.date,
        period,
        week_label,
        event_label,
        game_type,
        game_time,
        notes: null,
        created_by: CREATED_BY,
      };
      // If we already have metadata for this date, only fill in missing fields
      // (rare for TBR-FL B&G to provide a date the projections tab missed).
      if (metaByDate[row.date]) {
        const ex = metaByDate[row.date];
        for (const k of ["period", "week_label", "event_label", "game_type", "game_time"]) {
          if (ex[k] == null && entry[k] != null) ex[k] = entry[k];
        }
      } else {
        metaByDate[row.date] = entry;
      }
    }
  }
  buildMeta(payload.projections?.rows);
  buildMeta(payload.bg_projections?.rows);
  // For accounts with no projections (e.g. CIN - OH has projections),
  // we'd fall back to actuals; in practice every account has projections.

  const metaRows = Object.values(metaByDate);
  await bulkUpsert(
    sb,
    "sc_day_metadata",
    metaRows,
    "account_key,service_date"
  );

  const counts = {
    groups: canon.groups.length,
    services: canon.services.length,
    prices: priceCount,
    projections: projectionRows.length,
    actuals: actualRows.length,
    metadata: metaRows.length,
  };
  console.log(
    `  ${accountKey}: ${counts.groups} groups, ${counts.services} services, ${counts.prices} prices, ` +
      `${counts.projections.toLocaleString()} projections, ${counts.actuals.toLocaleString()} actuals, ` +
      `${counts.metadata.toLocaleString()} metadata rows`
  );
  return counts;
}

// ─────────────────────────────────────────────────────────────────────
// Bulk upsert in chunks of 500 rows.
// ─────────────────────────────────────────────────────────────────────
async function bulkUpsert(sb, table, rows, onConflict) {
  if (!rows.length) return;
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await sb.from(table).upsert(chunk, { onConflict });
    if (error) {
      console.error(`upsert ${table} chunk ${i}/${rows.length} failed.`);
      console.error(`First row of failing chunk:`, chunk[0]);
      console.error(`Error:`, error);
      throw new Error(`bulkUpsert ${table} failed: ${error.message}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────
// Verification queries
// ─────────────────────────────────────────────────────────────────────
async function printPerAccountVerification(sb) {
  const tables = [
    "sc_service_groups",
    "sc_services",
    "sc_service_prices", // joins through sc_services to get account_key
    "sc_daily_projections",
    "sc_daily_actuals",
    "sc_day_metadata",
  ];

  // Collect per-account counts.
  const byAccount = {};
  function add(acct, key, n) {
    if (!byAccount[acct]) byAccount[acct] = {};
    byAccount[acct][key] = n;
  }

  for (const t of tables) {
    if (t === "sc_service_prices") {
      // Join through sc_services to get the account_key counts.
      const { data, error } = await sb
        .from("sc_service_prices")
        .select("service_id, sc_services!inner(account_key)")
        .limit(100000);
      if (error) throw error;
      const counts = {};
      for (const row of data) {
        const ak = row.sc_services?.account_key;
        if (!ak) continue;
        counts[ak] = (counts[ak] || 0) + 1;
      }
      for (const [ak, n] of Object.entries(counts)) add(ak, t, n);
      continue;
    }

    // Pull account_key column directly (paginate above 1000 rows).
    let from = 0;
    const PAGE = 1000;
    const counts = {};
    while (true) {
      const { data, error } = await sb
        .from(t)
        .select("account_key")
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      for (const r of data) counts[r.account_key] = (counts[r.account_key] || 0) + 1;
      if (data.length < PAGE) break;
      from += PAGE;
    }
    for (const [ak, n] of Object.entries(counts)) add(ak, t, n);
  }

  const accounts = Object.keys(byAccount).sort();
  console.log(
    `account`.padEnd(15) +
      `groups`.padStart(8) +
      `services`.padStart(10) +
      `prices`.padStart(8) +
      `projections`.padStart(13) +
      `actuals`.padStart(10) +
      `metadata`.padStart(10)
  );
  for (const ak of accounts) {
    const c = byAccount[ak];
    console.log(
      ak.padEnd(15) +
        String(c.sc_service_groups || 0).padStart(8) +
        String(c.sc_services || 0).padStart(10) +
        String(c.sc_service_prices || 0).padStart(8) +
        String(c.sc_daily_projections || 0).padStart(13) +
        String(c.sc_daily_actuals || 0).padStart(10) +
        String(c.sc_day_metadata || 0).padStart(10)
    );
  }
}

async function fetchTableTotals(sb) {
  const tables = [
    "sc_service_groups",
    "sc_services",
    "sc_service_prices",
    "sc_daily_projections",
    "sc_daily_actuals",
    "sc_day_metadata",
  ];
  const totals = {};
  for (const t of tables) {
    const { count, error } = await sb
      .from(t)
      .select("*", { count: "exact", head: true });
    if (error) {
      console.error(`count ${t}: ${error.message}`);
      totals[t] = "ERR";
    } else {
      totals[t] = count;
    }
  }
  return totals;
}

main().catch((e) => {
  console.error("Top-level failure:", e);
  process.exit(1);
});
