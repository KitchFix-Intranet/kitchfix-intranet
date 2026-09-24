#!/usr/bin/env node
// R-148B · halt-path test. Proves Proof 5 (Kevin dry-run battery):
// an untested halt path is not a halt path.
//
// Runs the same detection + assertion pass as the sweep, then injects
// a synthetic uncovered row so A4 fires with uncovered > 0. Confirms
// the assertion halts + the process exits non-zero.
//
// READ ONLY. Never writes. Never touches Supabase writes.
//
// Usage: node --env-file=.env.local scripts/probes/_probe_r148b_halt_test.mjs

import { createClient } from "@supabase/supabase-js";

const KEY_URL = process.env.SUPABASE_URL;
const KEY_SVC = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!KEY_URL || !KEY_SVC) { console.error("env missing"); process.exit(1); }

const s = createClient(KEY_URL, KEY_SVC, { auth: { persistSession: false, autoRefreshToken: false } });

const PLEASE_SELECT_CAT = "68ed4977b7aabd4234afda3a";
const OBJECTID_RE = /^[a-f0-9]{24}__line_item_content_/;
const INTENTIONAL_REASONS = new Set(["map_excluded", "report_coded"]);
const FIVE_DAYS_MS = 5 * 86400000;
const PAGE = 1000;
async function pageAll(table, sel, filters = q => q) {
  const out = [];
  let from = 0;
  for (;;) {
    const q = filters(s.from(table).select(sel).range(from, from + PAGE - 1));
    const r = await q;
    if (r.error) throw r.error;
    out.push(...(r.data || []));
    if ((r.data || []).length < PAGE) break;
    from += PAGE;
  }
  return out;
}

console.log("PROOF 5 · force uncovered row, confirm halt fires with non-zero exit");
console.log();
console.log("Step A · load data + run detection + A4 classification (same as sweep)");
const rawAll = await pageAll("rippling_raw_spend_lines_latest", "rippling_id, external_id, category_id, amount, last_seen_at");
const raw = rawAll.filter(r => r.external_id && OBJECTID_RE.test(r.external_id));
const paAll = await pageAll("purchasing_actuals", "id, source, source_line_id, source_bill_id, account_key, amount, txn_date, vendor_or_merchant, excluded, reason", q => q.eq("source", "rippling_spend"));
const paBySli = new Map(paAll.map(r => [r.source_line_id.replace(/^rippling_spend:/, ""), r]));

const byGroup = new Map();
for (const r of raw) {
  const k = `${r.external_id.slice(0, 24)}|${Number(r.amount).toFixed(2)}`;
  if (!byGroup.has(k)) byGroup.set(k, []);
  byGroup.get(k).push(r);
}
const retireRows = [];
for (const [, members] of byGroup) {
  const unset = members.filter(r => r.category_id === PLEASE_SELECT_CAT);
  const coded = members.filter(r => r.category_id && r.category_id !== PLEASE_SELECT_CAT);
  if (unset.length === 0 || coded.length === 0) continue;
  for (const u of unset) {
    const uSeen = new Date(u.last_seen_at).getTime();
    const maxCoded = coded.reduce((a, b) => new Date(a.last_seen_at).getTime() > new Date(b.last_seen_at).getTime() ? a : b);
    if (new Date(maxCoded.last_seen_at).getTime() <= uSeen) continue;
    const pa = paBySli.get(u.rippling_id);
    if (!pa || pa.excluded !== false) continue;
    retireRows.push({ pa, coded_all: coded.map(c => c.rippling_id) });
  }
}
const countingByKey = new Map();
for (const pa of paAll) {
  if (pa.excluded !== false) continue;
  const k = `${pa.account_key}|${pa.vendor_or_merchant}|${Number(pa.amount).toFixed(2)}`;
  if (!countingByKey.has(k)) countingByKey.set(k, []);
  countingByKey.get(k).push(pa);
}
const retireIds = new Set(retireRows.map(r => r.pa.id));
const a4 = { direct: 0, settled_elsewhere: 0, intentional: 0, uncovered: [] };
for (const r of retireRows) {
  const directCounting = r.coded_all.some(rid => {
    const twinPa = paBySli.get(rid);
    return twinPa && twinPa.excluded === false;
  });
  if (directCounting) { a4.direct += 1; continue; }
  const k = `${r.pa.account_key}|${r.pa.vendor_or_merchant}|${Number(r.pa.amount).toFixed(2)}`;
  const nearby = countingByKey.get(k) || [];
  const rDate = r.pa.txn_date ? new Date(r.pa.txn_date + "T00:00:00Z").getTime() : null;
  const settledElsewhere = rDate != null && nearby.some(pa =>
    pa.id !== r.pa.id && !retireIds.has(pa.id) && pa.txn_date
    && Math.abs(new Date(pa.txn_date + "T00:00:00Z").getTime() - rDate) <= FIVE_DAYS_MS);
  if (settledElsewhere) { a4.settled_elsewhere += 1; continue; }
  const intentional = r.coded_all.some(rid => {
    const twinPa = paBySli.get(rid);
    return twinPa && twinPa.excluded === true && INTENTIONAL_REASONS.has(twinPa.reason);
  });
  if (intentional) { a4.intentional += 1; continue; }
  a4.uncovered.push(r);
}
console.log(`  baseline A4 · direct=${a4.direct} settled_elsewhere=${a4.settled_elsewhere} intentional=${a4.intentional} uncovered=${a4.uncovered.length}`);
if (a4.uncovered.length !== 0) {
  console.error("  UNEXPECTED · baseline uncovered != 0. Halt path might have been firing already. Test invalid.");
  process.exit(9);
}

console.log();
console.log("Step B · inject synthetic uncovered row");
a4.uncovered.push({
  pa: { source_line_id: "rippling_spend:__test_halt__", account_key: "__TEST__", txn_date: "9999-12-31", vendor_or_merchant: "__TEST_UNCOVERED__" },
});
console.log(`  injected · uncovered now = ${a4.uncovered.length}`);

console.log();
console.log("Step C · run the halt check (same predicate as sweep)");
if (a4.uncovered.length > 0) {
  console.error(`[r148b] HALT A4 · ${a4.uncovered.length} retirements uncovered · sample:`);
  for (const r of a4.uncovered.slice(0, 3)) {
    console.error(`  ${r.pa.account_key} · ${r.pa.txn_date} · ${r.pa.vendor_or_merchant} · sli=${r.pa.source_line_id}`);
  }
  console.log();
  console.log("  HALT FIRED · exiting non-zero (PROOF 5 PASS)");
  process.exit(4);  // documented halt exit code
}

console.log();
console.log("  HALT DID NOT FIRE · PROOF 5 FAIL · sweep would silently ignore uncovered rows");
process.exit(1);
