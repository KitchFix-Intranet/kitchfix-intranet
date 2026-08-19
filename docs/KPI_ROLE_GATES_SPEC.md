# KPI ROLE GATES - SPEC
# Owner rulings 2026-08-19 (Kevin, following the Joe Lessard review). This is the design
# contract; the CC prompt is written from it. Nothing here is a suggestion.

## 0. Why this exists
Today the KPI board is one view: anyone who can reach the page sees every account, and the
salary toggle is gated to corporate + RDOs only. Joe's review changed both halves:
  - site leaders should see ONLY their own site, and should be able to toggle salary for it
  - other salaried managers at a site should see that site, hourly only, forever
  - RDOs see the full picture
  - everyone lands where they work

## 1. THE FOUR ROLES

  corporate       Kevin, Josh, Joe (+ Sebastian, Britt if Kevin adds them)
                  VIEW    every account, every region, ALL
                  SALARY  yes, everywhere
                  LANDS   ALL

  rdo             Shane Lynch (East), Ryan Moore (West)
                  VIEW    every account, every region, ALL  ("RDOs see full picture")
                  SALARY  yes, everywhere
                  LANDS   their own region pseudo-key (EAST / WEST)

  site_leader     one person per account, owner-designated (people.is_site_leader)
                  VIEW    their own account ONLY
                  SALARY  yes, for their own account only
                  LANDS   their own account

  site_manager    any other SALARIED person at a site (sous chef, hospitality manager,
                  performance chef, lead, etc.)
                  VIEW    their own account ONLY
                  SALARY  NEVER - the toggle is absent, not disabled
                  LANDS   their own account

  Anyone who resolves to none of the four has NO KPI access at all. Hourly staff resolve here
  by construction: 66 of 71 active hourly workers have no work email, so they cannot sign in.

## 2. WHERE EACH ROLE COMES FROM - two tables, two questions

  `kpi_roles`  is the authority for CORPORATE and RDO only.
               Columns already exist: email, role, scope. 32 rows today.
  `people`     is the authority for SITE-level access.
               `is_site_leader` (owner-set) -> site_leader
               `worker_class = 'salaried'` + an account_key -> site_manager
               join on `lower(people.work_email) = lower(<session email>)`

  RESOLUTION ORDER, first match wins:
    1. kpi_roles.role = 'corporate'          -> corporate
    2. kpi_roles.role = 'rdo'                -> rdo, scope = region
    3. people.status = 'ACTIVE'
       AND people.is_site_leader = true      -> site_leader, scope = account_key
    4. people.status = 'ACTIVE'
       AND people.worker_class = 'salaried'
       AND people.account_key IS NOT NULL
       AND people.account_key <> 'CORP'      -> site_manager, scope = account_key
    5. otherwise                             -> no access

  `status = 'ACTIVE'` IS LOAD-BEARING ON BOTH SITE RULES, not a tidiness filter. Seasonal
  staff are rehired under a NEW worker_id each season while keeping the same work_email:
  measured 2026-08-19, 142 rows carry an email across 129 distinct addresses, and NINE emails
  appear on more than one row (one person has five rows, 2022 through 2026). Zero appear on
  more than one ACTIVE row. So an email lookup without the ACTIVE filter returns several
  people rows for one login, and the wrong one may carry a stale account_key or a stale
  is_site_leader. The resolver must return AT MOST ONE row; assert it.

  `account_key <> 'CORP'` ON RULE 4 IS ALSO LOAD-BEARING. CORP is a value in
  rippling_department_map, not an account on the board, and it is NOT NULL - so without this
  clause every corporate salaried person who is not already in kpi_roles falls through to
  rule 4 and becomes a "site_manager scoped to CORP", holding a site that does not exist.
  Measured 2026-08-19 before the fix: 4 people hit this, including the CFO and the Corporate
  Field Chef. Corporate membership is a DECISION recorded in kpi_roles, never derived from a
  department.

  Verified 2026-08-19: all 30 active EXEMPT workers carry a work_email (zero without), so the
  join covers the whole salaried population. 4 of the 32 kpi_roles rows do not match a Rippling
  worker - expected, they are corporate emails that live outside the worker set, and kpi_roles
  is authoritative for them regardless.

  `kpi_roles` role='site' rows (27 today) are SUPERSEDED by `people` and must be ignored by the
  resolver. See open question OQ-1 on whether to delete them.

## 3. VIEW ACCESS - what happens on another account

  A site_leader or site_manager who requests any account other than their own gets the LOCKED
  STATE - not a redirect, not a 403, not an empty board:

      In place of the board content:
        ACCOUNT LOCKED
        You do not have access to this account's data.
        If you need access, please reach out to Kevin Fietek.

  Rules for the locked state:
    - The command bar, the portfolio rail, and the section switcher STAY VISIBLE. The person
      must be able to navigate back to their own account without a browser back button.
    - The locked panel replaces the board region only.
    - NO figures of any kind render - no budget, no spend, no counts, no account name in a
      metric. The account NAME may appear in the rail (it already does) but no numbers.
    - THE ROUTE MUST NOT RETURN THE DATA. The lock is server-side: an unauthorised account
      request returns a body with `locked: true` and no `board`, no `actuals`, no `budget`.
      A client-side hide is not acceptable - the payload is visible in devtools.
    - Aggregates (ALL, EAST, WEST) are also locked for site_leader and site_manager.

## 4. LANDING ACCOUNT
  corporate    -> ALL
  rdo          -> their region pseudo-key (EAST or WEST)
  site_leader  -> their account_key
  site_manager -> their account_key
  Applies when the KPI page is opened with no account in the URL. An explicit account in the
  URL is honoured if permitted, and shows the locked state if not.

## 5. SALARY PERMISSION - replaces the current `canSeeSalary`
  corporate     true everywhere
  rdo           true everywhere
  site_leader   true for their own account ONLY. False for any other account, false for
                every aggregate.
  site_manager  ALWAYS false.
  no access     n/a

  The route already ships `salary_available` and the client renders the toggle only when true
  (V41). That contract is unchanged - only the predicate behind it changes. A site_manager must
  see no toggle and no scope pill, exactly as an unpermitted caller does today.

  8.2 note: the subtraction concern (hourly + full = one person's pay) is now an ACCEPTED risk
  for a site leader viewing their own site, per owner ruling. It is NOT accepted for a
  site_manager, which is why they never get the toggle even on their own account.

## 6. WHAT MUST NOT LEAK
  - A site_manager must not be able to infer that a salary view exists. No disabled control, no
    tooltip, no key in the payload that flips.
  - The locked state must not carry the locked account's figures in the response.
  - Corporate salary totals: unchanged from the existing rule - the salary derive excludes CORP
    departments, so no corporate compensation is in any site or aggregate figure.

## 7. PROBES (every one runs against a real session, not a unit fixture)
  G1  corporate  -> can request ALL, EAST, WEST, and all 11 accounts; salary_available true on
                    each
  G2  rdo/East   -> can request ALL, both regions, all 11 accounts (full picture);
                    salary_available true; lands on EAST with no account in the URL
  G3  site_leader (TBR - FL) -> own account returns a board with salary_available true;
                    ANY other account and ALL/EAST/WEST return locked:true with NO board,
                    NO actuals, NO budget keys in the serialized payload
  G4  site_manager (a salaried non-leader at the same account) -> own account returns a board
                    with salary_available FALSE; the serialized payload is byte-identical to
                    the same request with include_salary=1
  G5  no-access email -> every account returns locked:true
  G6  landing: each role with no account in the URL resolves to the account named in §4
  G7  the 27 kpi_roles role='site' rows have no effect on any of the above
  Sentinels unchanged: CIN - OH 06/29 = 113.98 / 2.32 / 39.91 / $4,328.27 on a corporate
  session.

## 8. OWNER RULINGS ON THE OPEN QUESTIONS (2026-08-19, all four answered)
  OQ-1  RULED: DELETE the 27 role='site' rows. `kpi_roles` becomes a corporate + rdo table
        only. Ships as a data migration in the same PR (see §9). Six of the 27 carry
        scope='CORP', which is not an account key at all - more evidence the table was
        seeded on a superseded model.
  OQ-2  RULED: correct. A salaried person with a null account_key gets NO access. No
        fallback. They surface in the exception log the people derive already writes.
  OQ-3  RULED: corporate is Kevin, Josh, Joe, PLUS Sebastian, Britt, Mariela, and Alex.
        Seven rows. Kevin supplies the four new email addresses; the derive never writes
        kpi_roles.
  OQ-4  RULED: correct - a contractor gets no KPI access BY DEFAULT, because rule 4 admits
        only `worker_class = 'salaried'`.
        IMPORTANT AND INTENTIONAL: rule 3 (`is_site_leader = true`) does NOT check
        worker_class, so a contractor whom Kevin has designated as a real site leader (a
        contract RD, an interim executive chef) DOES get site_leader access. That override is
        deliberate - the designation is owner-set, so it is a decision, not an inference.
        Document it in a comment beside rule 3 so nobody "fixes" it later by adding a
        worker_class check.

## 8b. POPULATION - the numbers the gate covers (verified 2026-08-19)
  active workers                          101
  active EXEMPT (salaried)                 30
    -> resolve to a site account_key       19   <- site_leader (11) + site_manager (8)
    -> resolve to CORP                     11
    -> unmapped / no department             0   <- OQ-2 is theoretical today, not real
  active EXEMPT with a work_email           30   (zero without - the join is total)
  active NON_EXEMPT with a work_email        5   (of 71 - hourly staff mostly cannot sign in)

  If a probe or a report quotes a different active-EXEMPT figure, reconcile it before
  proceeding. A count of 22 was observed once from a script-side query and does not reproduce
  against `rippling_raw_workers_latest`; the authoritative shape is
  `status='ACTIVE' AND overtime_exemption='EXEMPT'` over the _latest view, which returns 30.

## 8c. EMAIL NORMALISATION (adopted - lands in the resolver PR)
  Rippling has shipped values with trailing whitespace and mixed case on string fields.
  NORMALISE ON INGEST, not at query time: in `scripts/derive_people.mjs`, store
  `work_email` and `personal_email` as `String(v).trim().toLowerCase() || null`. One place,
  done once, and the column reads cleanly in Studio.
  The resolver still compares case-insensitively as a belt-and-braces measure, but it must not
  be the only defence.

## 9. WHAT SHIPS AS A MIGRATION (schema + data, Kevin applies in Studio)
  M1  DELETE FROM kpi_roles WHERE role = 'site';            -- 27 rows, per OQ-1
  M2  Tighten the role CHECK to ('corporate','rdo') so a 'site' row cannot come back. Drop
      and re-add the constraint; name it in the migration so a future reader sees why.
  M3  CORRECT the two wrong corporate emails already in the table. kpi_roles carries
      `j.katt@kitchfix.com` and `j.lessard@kitchfix.com`; NEITHER matches any Rippling work
      email. The real addresses are `josh@kitchfix.com` and `joe@kitchfix.com` (owner
      confirmed). Left uncorrected, the CEO and the VP of Operations miss rule 1 on sign-in
      and fall through to rule 4 - locked out of the board they commissioned. UPDATE the two
      rows rather than deleting and re-inserting, so nothing depends on insert order.
  M4  INSERT the six new corporate rows, role 'corporate', scope NULL, ON CONFLICT DO NOTHING:
        m.chavez@kitchfix.com       Mariela Chavez
        a.wasserman@kitchfix.com    Alex Wasserman
        s.castro@kitchfix.com       Sebastian Castro
        britt@kitchfix.com          Brittany Chernikovich
        john@kitchfix.com           CFO
        d.inthavone@kitchfix.com    Corporate Field Chef

  ORDERING IS LOAD-BEARING - M1 MUST RUN BEFORE M4. Mariela, Sebastian and Britt ALREADY
  exist in kpi_roles as role='site', scope='CORP'. `email` is the key and M4 uses ON CONFLICT
  DO NOTHING, so if the insert ran first their rows would silently skip, and M1 would then
  delete them - three people with no access and no error anywhere. Do not reorder for
  convenience.

  Post-state to assert: kpi_roles holds exactly 9 corporate + 2 rdo = 11 rows, zero 'site',
  and every corporate/rdo email matches an ACTIVE person in `people` by work_email.
