-- ─────────────────────────────────────────────────────────────────────────────
-- pr-7-2-opd-seed.sql
-- Project OPD · PR 7.2 · The Playbook — catalog seed
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Seeds the document catalog reconciled from Documentation Tracker v0.5 onto the
-- six shelves. Run AFTER pr-7-1-opd-schema.sql and after verify-pr-7-1 passes.
--
-- v2 changes (2026-06-01, Architect review):
--   • ALL documents seed at Pending/Draft/Placeholder/Retired — NOTHING at Live.
--     Nothing claims published until Kevin's content review pass. (chk_live_complete
--     never fires because no row is Live.)
--   • audience populated to record intent (enforcement deferred to page-launch; the
--     v1 page gate makes the whole Playbook owner-only regardless):
--       - 'internal' : STD-001..005 — system-governance docs, owner/Corp only
--       - 'slt'      : SLA set (PB-005, TPL-014/015, REF-005-A/B) — Josh/Joe/Britt/Kevin
--       - 'operator' : everything else
--   • PB-003 → Operations · POSTER-001 → POST-003 · PB-002 home Safety (+ Culinary
--     surface) · PB-001 v9.1 · STD-005 self-registered.
--
-- source_drive_id is NULL throughout — the manifest backfill (separate script)
-- attaches Drive IDs to the 7 matchable rows; the rest fill in as files are written.
-- Seed rows are marked is_historical = TRUE / data_provenance = 'batch_rebuild'
-- (reconstructed, not app-created) via the closing UPDATEs.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO documents
  (id, title, doc_class, status, version, shelf, audience, card_line, owner, approver, pinned, print_required, critical, keywords, summary)
VALUES
  -- ── Safety (9) · audience operator ──────────────────────────────────────────
  ('SOP-002','Safety & Incident Management','SOP','Pending',NULL,'Safety','operator',
   'What to do, who to call, and what to record when something happens.',
   'Human Resources','Sr Director Operations', true, false, true,
   '{incident,safety,injury,response,classification}',
   'System of record for incident response, classification, and closure.'),
  ('PB-002','Allergen Playbook','PB','Pending',NULL,'Safety','operator',
   'How we prevent, flag, and respond to allergen risk on the line.',
   'Director of Culinary','SLT', true, false, true,
   '{allergen,top9,cross-contact,reaction}',
   'Company-wide allergen standard. Source for the Allergen Awareness posting.'),
  ('AGR-001','The Big Rules · Confidentiality','AGR','Pending',NULL,'Safety','operator',
   'The Big Rules every employee signs.',
   'Human Resources','SLT + counsel', false, false, true,
   '{confidentiality,conduct,signed,acknowledgement}',
   'Acknowledgement-required agreement. Source for the Big Rules posting.'),
  ('FORM-001','Refusal of Medical Treatment Form','FORM','Pending',NULL,'Safety','operator',
   'Refusal-of-treatment form for on-site medical incidents.',
   'Human Resources','Sr Director Operations', false, false, false,
   '{medical,refusal,form,incident}',
   'Single-page intake form referenced by SOP-002.'),
  ('FORM-002','Vehicle Incident Worksheet','FORM','Pending',NULL,'Safety','operator',
   'Capture the facts at a vehicle incident before memory fades.',
   'Human Resources','Sr Director Operations', false, false, false,
   '{vehicle,incident,worksheet}',
   'Scene-capture worksheet referenced by SOP-002.'),
  ('REF-001','Workers'' Comp State Annex','REF','Placeholder','v0.1','Safety','operator',
   'State-by-state workers'' comp reference.',
   'Human Resources','Sr Director Operations', false, false, false,
   '{workers-comp,state,annex}',
   'Pending content from carrier and counsel — external blocker.'),
  ('POST-001','Incident Reporting Poster','POST','Pending',NULL,'Safety','operator',
   'Wall poster: what to do, who to call, when.',
   'Human Resources','Sr Director Operations', false, true, true,
   '{poster,incident,EN,ES}',
   'EN+ES wall poster derived from SOP-002.'),
  ('POST-002','Allergen Awareness Poster','POST','Pending',NULL,'Safety','operator',
   'Wall poster: top 9 allergens and reaction response.',
   'Director of Culinary','Sr Director Operations', false, true, true,
   '{poster,allergen,top9,EN,ES}',
   'EN+ES wall poster derived from PB-002.'),
  ('POST-003','The Big Rules Posting','POST','Pending',NULL,'Safety','operator',
   'Wall posting of the Big Rules.',
   'Human Resources','Sr Director Operations', false, true, true,
   '{poster,big-rules,EN,ES}',
   'EN+ES wall posting derived from AGR-001. (ID cleaned from POSTER-001.)'),

  -- ── Operations (10) · STD docs audience internal, rest operator ─────────────
  ('STD-001','Documentation Format Standard','STD','Pending','v0.96','Operations','internal',
   'The format every KitchFix document follows.',
   'Sr Director Operations','SLT', false, false, false,
   '{format,standard,typography,template}',
   'Governs the format of every document in the catalog.'),
  ('STD-002','Visual Communication Standard','STD','Pending','v0.2','Operations','internal',
   'How postings and visual artifacts are built.',
   'Sr Director Operations','SLT', false, false, false,
   '{visual,posting,poster,infographic}',
   'Governs all postings and visual artifacts.'),
  ('STD-003','Internal Communication Standard','STD','Pending',NULL,'Operations','internal',
   'Memo, email, and Slack standards.',
   'Sr Director Operations','SLT', false, false, false,
   '{memo,email,slack,communication}',
   'Third leg of the documentation system. Pending content.'),
  ('STD-004','Documentation Repository Standard','STD','Draft','v0.1','Operations','internal',
   'Repository structure and front-matter schema.',
   'Sr Director Operations','SLT', false, false, false,
   '{repository,schema,front-matter}',
   'Front-matter schema and repo structure. Largely superseded by the Supabase catalog.'),
  ('STD-005','Project OPD Playbook','STD','Pending','v1.0','Operations','internal',
   'How the Playbook itself is built and governed.',
   'Sr Director Operations','SLT', false, false, false,
   '{opd,playbook,lifecycle,catalog,governance}',
   'The operating playbook for Project OPD. Row one of the catalog it defines.'),
  ('PB-003','Service Recovery Playbook','PB','Pending',NULL,'Operations','operator',
   'How to recover when service misses.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{service-recovery,training,coaching}',
   'Training and coaching document for recovering from service misses.'),
  ('TPL-007','Daily Site Log','TPL','Pending',NULL,'Operations','operator',
   'EC daily site check-in.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{daily,log,site,EC}',
   'EC daily check-in artifact. Implements SOP-001.'),
  ('TPL-008','Weekly Site Report','TPL','Pending',NULL,'Operations','operator',
   'EC-to-RDO weekly site report.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{weekly,report,site}',
   'EC to RDO weekly rollup. Implements SOP-001.'),
  ('TPL-009','Weekly RDO Rollup','TPL','Pending',NULL,'Operations','operator',
   'RDO-to-VP weekly rollup.',
   'Sr Director Operations','VP of Operations', false, false, false,
   '{weekly,rollup,RDO}',
   'RDO to VP Ops weekly rollup. Implements SOP-001.'),
  ('TPL-011','Client Check-In Log','TPL','Pending',NULL,'Operations','operator',
   'Standing log of client touchpoints.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{client,check-in,log}',
   'Standing client-touchpoint log. Feeds the Cycle Review client theme.'),

  -- ── HR & People (13) · audience operator ────────────────────────────────────
  ('PB-001','Leadership OS Handbook','PB','Pending','v9.1','HR & People','operator',
   'Org structure, role definitions, and the Six Themes.',
   'Sr Director Operations','SLT', true, false, false,
   '{leadership,org,roles,six-themes}',
   'Source of truth for org structure, role definitions, and the Six Themes.'),
  ('SOP-001','Leadership Performance System','SOP','Pending','v2.0','HR & People','operator',
   'How leadership performance is reviewed and run.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{performance,leadership,review,cadence}',
   'The leadership performance system.'),
  ('TPL-003','Cycle Performance Review','TPL','Draft','v0.2','HR & People','operator',
   'Cycle performance review instrument.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{cycle,review,performance}',
   'Master review instrument with five role addenda.'),
  ('TPL-004','90-Day WOW Plan','TPL','Draft','v0.2','HR & People','operator',
   '90-day onboarding plan for new leaders.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{wow,onboarding,90-day}',
   'Master onboarding plan with five role addenda.'),
  ('TPL-001','Site Leader Scorecard','TPL','Draft','v0.1','HR & People','operator',
   'Period performance scorecard for Site Leaders.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{scorecard,site-leader,performance}',
   'Period-level performance tracking. Inputs to the Cycle Review.'),
  ('TPL-002','RDO Scorecard','TPL','Draft','v0.1','HR & People','operator',
   'Period performance scorecard for RDOs.',
   'Sr Director Operations','VP of Operations', false, false, false,
   '{scorecard,RDO,performance}',
   'Period-level performance tracking. Inputs to the RDO Cycle Review.'),
  ('TPL-010','Period-End Scorecard','TPL','Draft','v0.1','HR & People','operator',
   'Site-level period close: metrics, variance, compliance.',
   'Sr Director Operations','VP of Operations', false, false, false,
   '{period-end,scorecard,variance,compliance}',
   'Site-level period close. Operations metrics, variance, compliance roll-up.'),
  ('SOP-007','Hourly Performance System','SOP','Draft','v0.1','HR & People','operator',
   'How hourly performance is reviewed.',
   'Human Resources','Sr Director Operations', false, false, false,
   '{hourly,performance,review}',
   'Hourly performance system. 30-Day Check + Annual Cycle Review.'),
  ('TPL-012','Hourly Cycle Review','TPL','Draft','v0.1','HR & People','operator',
   'Annual review instrument for hourly staff.',
   'Sr Director Operations','Human Resources', false, false, false,
   '{hourly,cycle,review}',
   '9-factor annual review for hourly staff.'),
  ('TPL-013','Hourly 30-Day Check','TPL','Draft','v0.1','HR & People','operator',
   '30-day check-in for new hourly hires.',
   'Sr Director Operations','Human Resources', false, false, false,
   '{hourly,30-day,check-in}',
   '30-day check-in with a four-outcome decision for new hourly hires.'),
  ('PB-004','Hourly OS Handbook','PB','Pending',NULL,'HR & People','operator',
   'Identity, expectations, and day-to-day for hourly staff.',
   'Human Resources','SLT', false, false, false,
   '{hourly,handbook,EN,ES}',
   'Full from-scratch handbook for the hourly audience. EN+ES required.'),
  ('POL-001','Employee Concerns Policy','POL','Pending',NULL,'HR & People','operator',
   'Policy for harassment, discrimination, and wage concerns.',
   'Human Resources','SLT + counsel', false, false, false,
   '{policy,harassment,discrimination,wage}',
   'HR-led policy referenced by SOP-002.'),
  ('SOP-004','Formal Disciplinary Process','SOP','Pending',NULL,'HR & People','operator',
   'The formal disciplinary process.',
   'Human Resources','SLT + counsel', false, false, false,
   '{disciplinary,process,escalation}',
   'HR-led. The track that incident and review SOPs escalate into.'),

  -- ── Culinary (1) · audience operator ────────────────────────────────────────
  ('PB-006','Culinary OS Handbook','PB','Draft','v0.3','Culinary','operator',
   'The KitchFix culinary floor every account is built on.',
   'Director of Culinary','SLT', false, false, false,
   '{culinary,baseline,menu,sourcing}',
   'The culinary baseline. Gates SLA rebuilds — must finalize first.'),

  -- ── Finance (0) ── intentionally empty shelf ──

  -- ── Site & Client (5) · audience slt (Josh/Joe/Britt/Kevin) ─────────────────
  ('PB-005','SLA OS Handbook','PB','Draft','v1.0','Site & Client','slt',
   'The ten-section structure every account SLA follows.',
   'Sr Director Operations','SLT', true, false, false,
   '{sla,account,structure}',
   'The ten-section structure every account SLA is built against. Early/raw.'),
  ('TPL-014','SLA Template — Blank Fill-In','TPL','Draft','v1.0','Site & Client','slt',
   'Blank fill-in template for a new account SLA.',
   'Sr Director Operations','SLT', false, false, false,
   '{sla,template,fill-in}',
   'The fillable template that implements PB-005. Early/raw.'),
  ('TPL-015','Legacy SOP Intake Worksheet','TPL','Draft','v1.0','Site & Client','slt',
   'Per-account context capture before an SLA rebuild.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{sla,intake,worksheet}',
   'Captures account context to feed the SLA rebuild. Early/raw.'),
  ('REF-005-A','SLA Example — Sea Slugs PDC','REF','Draft','v1.0','Site & Client','slt',
   'Worked PDC example SLA (fictional team).',
   'Sr Director Operations','SLT', false, false, false,
   '{sla,example,pdc}',
   'Worked PDC contract-type example. Fictional team, EXAMPLE-marked. Early/raw.'),
  ('REF-005-B','SLA Example — Sasquatches MLB','REF','Draft','v1.0','Site & Client','slt',
   'Worked MLB clubhouse example SLA (fictional team).',
   'Sr Director Operations','SLT', false, false, false,
   '{sla,example,mlb,clubhouse}',
   'Worked MLB Clubhouse contract-type example. Fictional team, EXAMPLE-marked. Early/raw.'),

  -- ── Retired (3) · shelf NULL, hidden from operator views (STD-005 §3.5) ──────
  ('SOP-003','Quality & Service Recovery Process','SOP','Retired',NULL,NULL,NULL,
   NULL,'Sr Director Operations','Sr Director Operations', false, false, false,
   '{retired,service-recovery}',
   'Replaced by PB-003 Service Recovery Playbook.'),
  ('LEGACY-PR','Performance Reflection Process (legacy)','REF','Retired',NULL,NULL,NULL,
   NULL,'Sr Director Operations','Sr Director Operations', false, false, false,
   '{retired,legacy,performance}',
   'Old Google Forms process. Replaced by SOP-001.'),
  ('LEGACY-WOW','WOW Plan (2021 legacy)','TPL','Retired',NULL,NULL,NULL,
   NULL,'Sr Director Operations','Sr Director Operations', false, false, false,
   '{retired,legacy,wow}',
   '2021 format. Content merged into TPL-004.');

-- Reconstructed-from-tracker rows: mark historical + batch_rebuild (exempts from
-- strict gates, records true provenance).
UPDATE documents SET is_historical = TRUE, data_provenance = 'batch_rebuild';

-- ─────────────────────────────────────────────────────────────────────────────
-- Relationships (reconstructed from the Tracker References Map — partial set)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO document_relationships (from_doc, to_doc, rel_type) VALUES
  ('SOP-003','PB-003','superseded_by'),
  ('LEGACY-PR','SOP-001','superseded_by'),
  ('LEGACY-WOW','TPL-004','superseded_by'),
  ('POST-001','SOP-002','derived_from'),
  ('POST-002','PB-002','derived_from'),
  ('POST-003','AGR-001','derived_from'),
  ('FORM-001','SOP-002','references'),
  ('FORM-002','SOP-002','references'),
  ('REF-001','SOP-002','references'),
  ('TPL-014','PB-005','implements'),
  ('TPL-003','SOP-001','implements'),
  ('TPL-004','SOP-001','implements'),
  ('TPL-001','SOP-001','implements'),
  ('TPL-002','SOP-001','implements'),
  ('TPL-010','SOP-001','implements'),
  ('TPL-007','SOP-001','implements'),
  ('TPL-008','SOP-001','implements'),
  ('TPL-009','SOP-001','implements'),
  ('TPL-011','SOP-001','implements'),
  ('TPL-012','SOP-007','implements'),
  ('TPL-013','SOP-007','implements'),
  ('REF-005-A','TPL-014','derived_from'),
  ('REF-005-B','TPL-014','derived_from'),
  ('PB-001','STD-001','references'),
  ('PB-001','AGR-001','references'),
  ('PB-001','SOP-001','references'),
  ('PB-001','PB-002','references'),
  ('PB-004','AGR-001','references'),
  ('PB-004','PB-002','references'),
  ('PB-004','PB-003','references'),
  ('PB-004','SOP-007','references'),
  ('STD-001','STD-002','references'),
  ('STD-001','STD-003','references'),
  ('SOP-001','SOP-004','references'),
  ('SOP-007','SOP-004','references'),
  ('PB-006','PB-005','references');

UPDATE document_relationships SET is_historical = TRUE, data_provenance = 'batch_rebuild';

-- ─────────────────────────────────────────────────────────────────────────────
-- Surfaces (representative seed; STD-005 §7.2)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO document_surfaces (doc_id, surface) VALUES
  ('PB-002','incident-reporting'),
  ('PB-002','kitchen'),
  ('PB-002','new-hire-onboarding'),
  ('PB-002','culinary'),
  ('POST-001','incident-reporting'),
  ('POST-002','incident-reporting'),
  ('POST-002','kitchen'),
  ('POST-003','new-hire-onboarding'),
  ('AGR-001','new-hire-onboarding'),
  ('SOP-002','incident-reporting');

UPDATE document_surfaces SET is_historical = TRUE, data_provenance = 'batch_rebuild';

-- ─────────────────────────────────────────────────────────────────────────────
-- End pr-7-2. 41 documents · 36 relationships · 10 surfaces.
-- All docs at Pending/Draft/Placeholder/Retired — nothing Live until review pass.
-- Next: manifest backfill attaches source_drive_id to the 7 matchable rows.
-- ─────────────────────────────────────────────────────────────────────────────
