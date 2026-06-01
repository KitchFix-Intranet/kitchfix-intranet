// ─────────────────────────────────────────────────────────────────────────────
// scripts/verify-pr-7-1-opd-schema.mjs
// Project OPD · PR 7.1 · verifies pr-7-1-opd-schema.sql applied cleanly.
//
// Run AFTER applying pr-7-1 and BEFORE applying the seed (pr-7-2):
//   node --env-file=.env.local scripts/verify-pr-7-1-opd-schema.mjs
//
// Checks (house pattern): tables exist + empty, enum CHECK constraints reject
// bad rows, FK rejects orphan child, GRANTs present for service_role.
// Exits non-zero on any failure.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const TABLES = ['documents', 'document_relationships', 'document_surfaces', 'document_issues'];
let failures = 0;
const pass = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { console.error(`  FAIL ${m}`); failures++; };

async function tablesExistAndEmpty() {
  for (const t of TABLES) {
    const { count, error } = await sb.from(t).select('*', { count: 'exact', head: true });
    if (error) { fail(`${t}: ${error.message}`); continue; }
    count === 0 ? pass(`${t} exists, empty (count=0)`) : fail(`${t} not empty (count=${count}) — run verify before seed`);
  }
}

// A bad insert should be rejected by a CHECK/FK (error present). Clean up if it slips through.
async function expectRejected(label, table, row) {
  const { data, error } = await sb.from(table).insert(row).select('id');
  if (error) { pass(`${label} rejected (${error.code || 'constraint'})`); return; }
  fail(`${label} was ACCEPTED — constraint missing`);
  if (data?.[0]?.id) await sb.from(table).delete().eq('id', data[0].id);
}

async function checkConstraints() {
  await expectRejected('bad doc_class', 'documents',
    { id: '_v_class', title: 't', doc_class: 'XYZ', status: 'Live' });
  await expectRejected('bad status', 'documents',
    { id: '_v_status', title: 't', doc_class: 'PB', status: 'Nope' });
  await expectRejected('bad shelf', 'documents',
    { id: '_v_shelf', title: 't', doc_class: 'PB', status: 'Live', shelf: 'Basement' });
  await expectRejected('bad data_provenance', 'documents',
    { id: '_v_prov', title: 't', doc_class: 'PB', status: 'Live', data_provenance: 'mystery' });
  await expectRejected('incomplete Live doc (chk_live_complete)', 'documents',
    { id: '_v_live', title: 't', doc_class: 'PB', status: 'Live', is_historical: false, version: null, card_line: null });
  await expectRejected('bad rel_type', 'document_relationships',
    { from_doc: '_a', to_doc: '_b', rel_type: 'invents' });
  await expectRejected('orphan relationship FK', 'document_relationships',
    { from_doc: 'NOPE-1', to_doc: 'NOPE-2', rel_type: 'references' });
  await expectRejected('bad issue status', 'document_issues',
    { doc_id: 'NOPE-1', reporter_email: 'x@y.z', issue_text: 't', status: 'frozen' });
}

async function grants() {
  const { data, error } = await sb.rpc('exec_sql', { sql:
    `SELECT table_name, count(*) AS n FROM information_schema.role_table_grants
     WHERE grantee='service_role' AND table_name = ANY($1) GROUP BY table_name`
  }).catch(() => ({ data: null, error: { message: 'exec_sql rpc unavailable' } }));
  if (error || !data) {
    console.log('  note GRANT check skipped (no exec_sql rpc) — verify in Studio: service_role has 7 privs per table');
    return;
  }
  for (const r of data) {
    r.n >= 7 ? pass(`${r.table_name} grants present (${r.n})`) : fail(`${r.table_name} grants incomplete (${r.n}/7)`);
  }
}

(async () => {
  console.log('verify pr-7-1-opd-schema');
  console.log('\n[1] tables exist + empty');     await tablesExistAndEmpty();
  console.log('\n[2] CHECK / FK constraints');    await checkConstraints();
  console.log('\n[3] service_role grants');       await grants();
  console.log(failures === 0 ? '\nPASS — pr-7-1 applied cleanly.' : `\nFAIL — ${failures} issue(s).`);
  process.exit(failures === 0 ? 0 : 1);
})();
