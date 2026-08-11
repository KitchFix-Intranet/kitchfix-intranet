# Grant hygiene template for new public-schema migrations

Post-sc-34 (2026-08-11) the DEFAULT PRIVILEGES record for the postgres role
no longer grants TRUNCATE to anon or authenticated on new tables. That
removes the "silent TRUNCATE inheritance" problem. **The old workaround
(per-table `REVOKE TRUNCATE` line in every new migration) is no longer
required for tables created after sc-34 lands.** Keep the pattern below
only as a defensive belt-and-suspenders on money-adjacent tables; for
everything else the DEFAULT PRIVILEGES fix does the job.

The explicit `GRANT REFERENCES, TRIGGER TO anon, authenticated` line we
have been writing on every new sc- table is ALSO redundant. sc-33's V2
probe surfaced that the postgres role's DEFAULT PRIVILEGES record already
grants REFERENCES + TRIGGER to anon + authenticated on every new table.
Writing them again is harmless but noisy. Drop the line on new migrations
unless you specifically need to override the default (in which case say
so in a comment).

## Background

The Supabase project's DEFAULT PRIVILEGES record for the postgres role
grants `Dxtm` (TRUNCATE, REFERENCES, TRIGGER, MAINTAIN) to anon,
authenticated, and service_role, plus SELECT to `joe_readonly`, on every
new table in `public`. sc-34 stripped TRUNCATE for anon + authenticated
from that default; the rest stays.

sc-33 recorded the discovery + the per-table fix for the four SC billing
tables born under the leaky default (sc_week_finalize, sc_qbo_account_map,
sc_qbo_service_map, sc_export_ledger). sc-34 fixed the source.
`docs/audits/GRANT_HYGIENE_2026-07-29.md` §10 has the full recurrence
record.

**Standing flag (not fixed by sc-34):** `joe_readonly` still inherits
SELECT on every new public table, including `sc_export_ledger`. Kevin
rules whether that stays or gets scoped to non-money tables in a follow-up.

## Canonical grant block (current shape)

```sql
-- ─── GRANTs ────────────────────────────────────────────────────────
-- service_role holds the app-facing write privileges. anon +
-- authenticated get REFERENCES + TRIGGER by default from the postgres
-- role's DEFAULT PRIVILEGES (see sc-34 + docs/audits/GRANT_HYGIENE_
-- 2026-07-29.md §10); do not re-grant them here unless you have a
-- specific reason to override.
GRANT SELECT, INSERT, UPDATE ON <new_table> TO service_role;
```

For money-adjacent tables (billing, invoicing, payment state) prefer
belt-and-suspenders with an explicit REVOKE:

```sql
-- Extra defense for money-adjacent tables. Idempotent (no-op when the
-- privilege is not held). The DEFAULT PRIVILEGES record no longer
-- grants TRUNCATE here, but the REVOKE stays cheap and documents intent.
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
  catalog-driven revoke that established the baseline, plus §10 recurrence
  record.
- `docs/migrations/sc-33-grant-fence-and-desc-rename.sql` - per-table
  REVOKE + rename bundled fix for the four billing tables born under
  the leaky default.
- `docs/migrations/sc-34-alter-default-privileges.sql` - the one-line
  source fix. Runs after sc-33.
