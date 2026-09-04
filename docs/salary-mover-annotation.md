# salary mover annotation · R-70

Kevin fills this in as facts arrive from finance / operations. Every row Kevin marks `moved` becomes a set of `worker_dept_history` INSERT statements (see `docs/migrations/worker-dept-history-seed-bailey.sql` for the shape).

## The spell-coverage rule (LOAD-BEARING)

**A moved worker needs a row for every spell in the fiscal year, INCLUDING their opening spell.** The resolver falls back to `worker.department_id` when no history row matches, and that fallback returns the worker's CURRENT department. If only the destination spell is seeded, the origin weeks silently attribute to the destination via fallback - which is the exact defect the table exists to fix.

Bailey seeding is the reference case: two rows, one for TBR - FL from FY start through 2026-03-08, one for CIN - KY from 2026-03-09 onward. See `docs/migrations/worker-dept-history-seed-bailey.sql`.

**Do not infer a move from a title change.** A title change happens on promotions and reclassifications too; guessing puts wrong money on real accounts. Only annotate `moved` when finance / operations confirms the transfer date + from/to accounts.

## Candidate list · 12 salaried workers with title_effective_date in FY2026

Recon output (`_probe_r70_movers_by_title.mjs`, 2026-09-04). `TED` = `title_effective_date` on the worker record. Kevin annotates `moved` or `promoted`; for each `moved`, records the effective date + both accounts.

```
worker_id                        email                          current_acct  TED         status         effective_from  from_acct       to_acct       note
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
68d2e115d6202a69840a6bc3         j.poletti@kitchfix.com         STL - MO      2026-01-05  [ ] moved  [ ] promoted  __________  ____________  ____________  ___________________
69617589f9640ff1c1f6b8f9         l.delaportilla@kitchfix.com    STL - FL      2026-01-26  [ ] moved  [ ] promoted  __________  ____________  ____________  ___________________
69681ecdaf0f72ae95a0e0d2         r.jackson@kitchfix.com         STL - FL      2026-01-26  [ ] moved  [ ] promoted  __________  ____________  ____________  ___________________
69726cdabdcdfbf4d90e4385         (email null)                   STL - MO      2026-02-01  [ ] moved  [ ] promoted  __________  ____________  ____________  ___________________
699a432808ded0428c60bf66         j.forkner@kitchfix.com         TXR - TX - H  2026-02-16  [ ] moved  [ ] promoted  __________  ____________  ____________  ___________________
698e21466aef8c58cf2e92f7         j.crask@kitchfix.com           STL - MO      2026-02-23  [ ] moved  [ ] promoted  __________  ____________  ____________  ___________________
698cb8a24008fba6e1b015ea         j.rogers@kitchfix.com          TXR - TX - V  2026-03-02  [ ] moved  [ ] promoted  __________  ____________  ____________  ___________________
62b618f3c44ba8b9fb4221d2         s.bailey@kitchfix.com          CIN - KY      2026-03-09  [x] moved                2026-03-09  TBR - FL     CIN - KY      SEEDED
69b99c5d583554e163325578         k.gilman@kitchfix.com          TBJ - NY      2026-03-16  [ ] moved  [ ] promoted  __________  ____________  ____________  ___________________
68630464603951d355c2d9e4         m.decanio@kitchfix.com         CIN - AZ      2026-04-20  [ ] moved  [ ] promoted  __________  ____________  ____________  ___________________
69ef6d9ee63256cdb9669f86         w.hofmann@kitchfix.com         STL - FL      2026-05-18  [ ] moved  [ ] promoted  __________  ____________  ____________  ___________________
6a677c2553a52174b1bd7c7f         c.parry@kitchfix.com           TBJ - FL      2026-08-24  [ ] moved  [ ] promoted  __________  ____________  ____________  ___________________
```

## Departure case · `end_date`

A worker who leaves needs `end_date` set on their final spell. Otherwise the loader keeps accruing on their last account forever (Kevin's Gordon Rouse III case: left TBJ - FL 2026-04-30, single INSERT with `end_date='2026-04-30'`).

## SQL template · one move

```sql
BEGIN;
INSERT INTO worker_dept_history
  (worker_id, effective_from, end_date, account_key, source, note)
VALUES
  ('<worker_id>', '<fy_start_or_hire_date>', '<day_before_move>', '<from_acct>',
   'kevin_manual', '<opening spell reason>'),
  ('<worker_id>', '<move_date>',              NULL,               '<to_acct>',
   'kevin_manual', '<move reason>')
ON CONFLICT (worker_id, effective_from) DO NOTHING;
COMMIT;
```

## SQL template · a departure with no move

```sql
BEGIN;
INSERT INTO worker_dept_history
  (worker_id, effective_from, end_date, account_key, source, note)
VALUES
  ('<worker_id>', '<fy_start_or_hire_date>', '<last_day_worked>', '<acct>',
   'kevin_manual', 'Departed <date>')
ON CONFLICT (worker_id, effective_from) DO NOTHING;
COMMIT;
```
