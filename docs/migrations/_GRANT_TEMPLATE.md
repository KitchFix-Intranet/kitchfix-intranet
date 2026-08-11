# Grant hygiene template for new public-schema migrations

Every new SQL migration that creates a table in `public` MUST include the
explicit REVOKE line shown below, in addition to the standard GRANT block.
This is a load-bearing safety line, not a stylistic preference.

## Background

The Supabase project holds an `ALTER DEFAULT PRIVILEGES` record somewhere
that grants `TRUNCATE` on newly-created tables in `public` to `anon` and
`authenticated`. Our migrations do NOT write that grant - we only ever
grant `REFERENCES, TRIGGER` to those roles - and yet every new table
inherits `TRUNCATE`. This was surfaced by sc-33's investigation
(2026-08-11) after Kevin's V4 verify caught it on sc_week_finalize,
sc_qbo_service_map, and sc_export_ledger. `docs/audits/GRANT_HYGIENE_2026-07-29.md`
records the prior sweep that cleared this state once already; the
inheritance re-fills it every time a new table is created.

Until a follow-up PR lands the `ALTER DEFAULT PRIVILEGES ... REVOKE TRUNCATE`
against the correct grantor role (sc-33's verify block V2 exposes which
role that is), the only reliable defense is per-table explicit REVOKE.

## Canonical grant block

```sql
-- ─── GRANTs ────────────────────────────────────────────────────────
-- service_role holds the app-facing write privileges. anon and
-- authenticated get REFERENCES + TRIGGER only.
GRANT SELECT, INSERT, UPDATE ON <new_table> TO service_role;
GRANT REFERENCES, TRIGGER    ON <new_table> TO anon, authenticated;

-- REVOKE the TRUNCATE that the project's DEFAULT PRIVILEGES silently
-- grants to anon + authenticated on new public tables. Idempotent
-- (no-op when the privilege is not held). See
-- docs/migrations/_GRANT_TEMPLATE.md for the mechanism and
-- docs/audits/GRANT_HYGIENE_2026-07-29.md for the audit backstory.
REVOKE TRUNCATE ON <new_table> FROM anon, authenticated;
```

## Verify block additions

Every migration's verify block should include a per-table probe for the
four privilege types we care about. Expected zero rows for TRUNCATE /
DELETE / UPDATE on anon or authenticated.

```sql
-- Expected: 0 rows.
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name   = '<new_table>'
  AND grantee IN ('anon', 'authenticated')
  AND privilege_type IN ('TRUNCATE', 'DELETE', 'UPDATE');
```

## Skip this only if

- The table is a view (views inherit from base tables).
- The migration is renaming or altering an existing table without creating
  a new one.

## Related

- `docs/audits/GRANT_HYGIENE_2026-07-29.md` - the July 2026 sweep + Kevin's
  catalog-driven revoke that established the baseline.
- `docs/migrations/sc-33-grant-fence-and-desc-rename.sql` - the concrete
  fix + verify-block pattern this template distills.
