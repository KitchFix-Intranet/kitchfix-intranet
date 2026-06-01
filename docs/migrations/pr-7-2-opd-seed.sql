-- ─────────────────────────────────────────────────────────────────────────────
-- pr-7-2-opd-seed.sql
-- Project OPD · PR 7.2 · The Playbook — catalog seed
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Seeds the document catalog reconciled from Documentation Tracker v0.5 onto the
-- six shelves. Run AFTER pr-7-1-opd-schema.sql and after verify-pr-7-1 passes.
--
-- Reconciliation decisions baked in (all Architect-approved):
--   • Old "Incident Reporting" section  → Safety shelf
--   • Old "Foundation" (STD-*)          → Operations shelf
--   • Old "Leadership Dugout"           → HR & People shelf
--   • Old "SLA OS"                      → Site & Client (except PB-006 → Culinary)
--   • Old "Operations Hub"              → Operations shelf
--   • Old "Other — Unassigned" (HR)     → HR & People shelf
--   • PB-003 Service Recovery           → Operations (training/coaching, not safety)
--   • POSTER-001 → POST-003             → malformed ID cleaned
--   • PB-002 Allergen                   → home Safety + surfaced on Culinary (see surfaces)
--   • PB-001                            → v9.1 (canonical; tracker had stale v8.1 / v7.0)
--   • STD-005 self-registers            → row one of the catalog it defines (STD-005 §11)
--
-- NOT set here: source_drive_id (NULL). The library_manifest + ldug_library_manifest
-- backfill (separate script) attaches Drive IDs to rows that already exist below.
-- Dates (effective/last_reviewed/next_review) left NULL pending backfill.
-- Relationships reconstructed from the Tracker References Map — a partial set, not
-- the lost 54-edge original. Expand as cross-refs are confirmed.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO documents
  (id, title, doc_class, status, version, shelf, card_line, owner, approver, pinned, print_required, critical, keywords, summary)
VALUES
  -- ── Safety (9) ──────────────────────────────────────────────────────────────
  ('SOP-002','Safety & Incident Management','SOP','Live','v2.1','Safety',
   'What to do, who to call, and what to record when something happens.',
   'Human Resources','Sr Director Operations', true, false, true,
   '{incident,safety,injury,response,classification}',
   'System of record for incident response, classification, and closure.'),
  ('PB-002','Allergen Playbook','PB','Live','v1.0','Safety',
   'How we prevent, flag, and respond to allergen risk on the line.',
   'Director of Culinary','SLT', true, false, true,
   '{allergen,top9,cross-contact,reaction}',
   'Company-wide allergen standard. Source for the Allergen Awareness posting.'),
  ('AGR-001','The Big Rules · Confidentiality','AGR','Live','v1.0','Safety',
   'The Big Rules every employee signs.',
   'Human Resources','SLT + counsel', false, false, true,
   '{confidentiality,conduct,signed,acknowledgement}',
   'Acknowledgement-required agreement. Source for the Big Rules posting.'),
  ('FORM-001','Refusal of Medical Treatment Form','FORM','Live','v1.0','Safety',
   'Refusal-of-treatment form for on-site medical incidents.',
   'Human Resources','Sr Director Operations', false, false, false,
   '{medical,refusal,form,incident}',
   'Single-page intake form referenced by SOP-002 §7.1.'),
  ('FORM-002','Vehicle Incident Worksheet','FORM','Live','v1.0','Safety',
   'Capture the facts at a vehicle incident before memory fades.',
   'Human Resources','Sr Director Operations', false, false, false,
   '{vehicle,incident,worksheet}',
   'Scene-capture worksheet referenced by SOP-002 §7.2.'),
  ('REF-001','Workers'' Comp State Annex','REF','Placeholder','v0.1','Safety',
   'State-by-state workers'' comp reference.',
   'Human Resources','Sr Director Operations', false, false, false,
   '{workers-comp,state,annex}',
   'Pending content from The Hartford and counsel — external blocker.'),
  ('POST-001','Incident Reporting Poster','POST','Live','v1.2','Safety',
   'Wall poster: what to do, who to call, when.',
   'Human Resources','Sr Director Operations', false, true, true,
   '{poster,incident,EN,ES}',
   'EN+ES wall poster derived from SOP-002.'),
  ('POST-002','Allergen Awareness Poster','POST','Live','v1.2','Safety',
   'Wall poster: top 9 allergens and reaction response.',
   'Director of Culinary','Sr Director Operations', false, true, true,
   '{poster,allergen,top9,EN,ES}',
   'EN+ES wall poster derived from PB-002.'),
  ('POST-003','The Big Rules Posting','POST','Live','v1.2','Safety',
   'Wall posting of the Big Rules.',
   'Human Resources','Sr Director Operations', false, true, true,
   '{poster,big-rules,EN,ES}',
   'EN+ES wall posting derived from AGR-001. (ID cleaned from POSTER-001.)'),

  -- ── Operations (10) ─────────────────────────────────────────────────────────
  ('STD-001','Documentation Format Standard','STD','Live','v0.96','Operations',
   'The format every KitchFix document follows.',
   'Sr Director Operations','SLT', false, false, false,
   '{format,standard,typography,template}',
   'Governs the format of every document in the catalog.'),
  ('STD-002','Visual Communication Standard','STD','Live','v0.2','Operations',
   'How postings and visual artifacts are built.',
   'Sr Director Operations','SLT', false, false, false,
   '{visual,posting,poster,infographic}',
   'Governs all postings and visual artifacts.'),
  ('STD-003','Internal Communication Standard','STD','Pending',NULL,'Operations',
   'Memo, email, and Slack standards.',
   'Sr Director Operations','SLT', false, false, false,
   '{memo,email,slack,communication}',
   'Third leg of the documentation system. Pending content.'),
  ('STD-004','Documentation Repository Standard','STD','Draft','v0.1','Operations',
   'Repository structure and front-matter schema.',
   'Sr Director Operations','SLT', false, false, false,
   '{repository,schema,front-matter}',
   'Front-matter schema and repo structure. Largely superseded by the Supabase catalog.'),
  ('STD-005','Project OPD Playbook','STD','Live','v1.0','Operations',
   'How the Playbook itself is built and governed.',
   'Sr Director Operations','SLT', false, false, false,
   '{opd,playbook,lifecycle,catalog,governance}',
   'The operating playbook for Project OPD. Row one of the catalog it defines.'),
  ('PB-003','Service Recovery Playbook','PB','Live','v1.1','Operations',
   'How to recover when service misses.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{service-recovery,training,coaching}',
   'Training and coaching document for recovering from service misses.'),
  ('TPL-007','Daily Site Log','TPL','Pending',NULL,'Operations',
   'EC daily site check-in.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{daily,log,site,EC}',
   'EC daily check-in artifact. Implements SOP-001 §7.'),
  ('TPL-008','Weekly Site Report','TPL','Pending',NULL,'Operations',
   'EC-to-RDO weekly site report.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{weekly,report,site}',
   'EC to RDO weekly rollup. Implements SOP-001 §7.'),
  ('TPL-009','Weekly RDO Rollup','TPL','Pending',NULL,'Operations',
   'RDO-to-VP weekly rollup.',
   'Sr Director Operations','VP of Operations', false, false, false,
   '{weekly,rollup,RDO}',
   'RDO to VP Ops weekly rollup. Implements SOP-001 §7.'),
  ('TPL-011','Client Check-In Log','TPL','Pending',NULL,'Operations',
   'Standing log of client touchpoints.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{client,check-in,log}',
   'Standing client-touchpoint log. Feeds the Cycle Review client theme.'),

  -- ── HR & People (13) ─────────────────────────────────────────────────────────
  ('PB-001','Leadership OS Handbook','PB','Live','v9.1','HR & People',
   'Org structure, role definitions, and the Six Themes.',
   'Sr Director Operations','SLT', true, false, false,
   '{leadership,org,roles,six-themes}',
   'Source of truth for org structure, role definitions, and the Six Themes.'),
  ('SOP-001','Leadership Performance System','SOP','Live','v2.0','HR & People',
   'How leadership performance is reviewed and run.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{performance,leadership,review,cadence}',
   'The leadership performance system. v2.1 redline pending (adds Operational Rhythm).'),
  ('TPL-003','Cycle Performance Review','TPL','Draft','v0.2','HR & People',
   'Cycle performance review instrument.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{cycle,review,performance}',
   'Master review instrument with five role addenda.'),
  ('TPL-004','90-Day WOW Plan','TPL','Draft','v0.2','HR & People',
   '90-day onboarding plan for new leaders.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{wow,onboarding,90-day}',
   'Master onboarding plan with five role addenda.'),
  ('TPL-001','Site Leader Scorecard','TPL','Draft','v0.1','HR & People',
   'Period performance scorecard for Site Leaders.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{scorecard,site-leader,performance}',
   'Period-level performance tracking. Inputs to the Cycle Review.'),
  ('TPL-002','RDO Scorecard','TPL','Draft','v0.1','HR & People',
   'Period performance scorecard for RDOs.',
   'Sr Director Operations','VP of Operations', false, false, false,
   '{scorecard,RDO,performance}',
   'Period-level performance tracking. Inputs to the RDO Cycle Review.'),
  ('TPL-010','Period-End Scorecard','TPL','Draft','v0.1','HR & People',
   'Site-level period close: metrics, variance, compliance.',
   'Sr Director Operations','VP of Operations', false, false, false,
   '{period-end,scorecard,variance,compliance}',
   'Site-level period close. Operations metrics, variance, compliance roll-up.'),
  ('SOP-007','Hourly Performance System','SOP','Draft','v0.1','HR & People',
   'How hourly performance is reviewed.',
   'Human Resources','Sr Director Operations', false, false, false,
   '{hourly,performance,review}',
   'Hourly performance system. 30-Day Check + Annual Cycle Review.'),
  ('TPL-012','Hourly Cycle Review','TPL','Draft','v0.1','HR & People',
   'Annual review instrument for hourly staff.',
   'Sr Director Operations','Human Resources', false, false, false,
   '{hourly,cycle,review}',
   '9-factor / 1-5 scale annual review for hourly staff.'),
  ('TPL-013','Hourly 30-Day Check','TPL','Draft','v0.1','HR & People',
   '30-day check-in for new hourly hires.',
   'Sr Director Operations','Human Resources', false, false, false,
   '{hourly,30-day,check-in}',
   '30-day check-in with a four-outcome decision for new hourly hires.'),
  ('PB-004','Hourly OS Handbook','PB','Pending',NULL,'HR & People',
   'Identity, expectations, and day-to-day for hourly staff.',
   'Human Resources','SLT', false, false, false,
   '{hourly,handbook,EN,ES}',
   'Full from-scratch handbook for the hourly audience. EN+ES required.'),
  ('POL-001','Employee Concerns Policy','POL','Pending',NULL,'HR & People',
   'Policy for harassment, discrimination, and wage concerns.',
   'Human Resources','SLT + counsel', false, false, false,
   '{policy,harassment,discrimination,wage}',
   'HR-led policy referenced by SOP-002 §1 and §9.'),
  ('SOP-004','Formal Disciplinary Process','SOP','Pending',NULL,'HR & People',
   'The formal disciplinary process.',
   'Human Resources','SLT + counsel', false, false, false,
   '{disciplinary,process,escalation}',
   'HR-led. The track that incident and review SOPs escalate into.'),

  -- ── Culinary (1) ──────────────────────────────────────────────────────────────
  ('PB-006','Culinary OS Handbook','PB','Draft','v0.3','Culinary',
   'The KitchFix culinary floor every account is built on.',
   'Director of Culinary','SLT', false, false, false,
   '{culinary,baseline,menu,sourcing}',
   'The culinary baseline. Gates SLA rebuilds — must finalize to v1.0 first.'),

  -- ── Finance (0) ── intentionally empty shelf; renders short, not gated ──

  -- ── Site & Client (5) ──────────────────────────────────────────────────────────
  ('PB-005','SLA OS Handbook','PB','Live','v1.0','Site & Client',
   'The ten-section structure every account SLA follows.',
   'Sr Director Operations','SLT', true, false, false,
   '{sla,account,structure}',
   'The ten-section structure every account SLA is built against.'),
  ('TPL-014','SLA Template — Blank Fill-In','TPL','Live','v1.0','Site & Client',
   'Blank fill-in template for a new account SLA.',
   'Sr Director Operations','SLT', false, false, false,
   '{sla,template,fill-in}',
   'The fillable template that implements PB-005. Refresh after PB-006 finalizes.'),
  ('TPL-015','Legacy SOP Intake Worksheet','TPL','Live','v1.0','Site & Client',
   'Per-account context capture before an SLA rebuild.',
   'Sr Director Operations','Sr Director Operations', false, false, false,
   '{sla,intake,worksheet}',
   'Captures account context to feed the SLA rebuild. Distribute to RDOs + Site Leaders.'),
  ('REF-005-A','SLA Example — Sea Slugs PDC','REF','Live','v1.0','Site & Client',
   'Worked PDC example SLA (fictional team).',
   'Sr Director Operations','SLT', false, false, false,
   '{sla,example,pdc}',
   'Worked PDC contract-type example. Fictional team, EXAMPLE-marked.'),
  ('REF-005-B','SLA Example — Sasquatches MLB','REF','Live','v1.0','Site & Client',
   'Worked MLB clubhouse example SLA (fictional team).',
   'Sr Director Operations','SLT', false, false, false,
   '{sla,example,mlb,clubhouse}',
   'Worked MLB Clubhouse contract-type example. Fictional team, EXAMPLE-marked.'),

  -- ── Retired (3) ── shelf NULL; filtered from all operator views (STD-005 §3.5) ──
  ('SOP-003','Quality & Service Recovery Process','SOP','Retired',NULL,NULL,
   NULL,'Sr Director Operations','Sr Director Operations', false, false, false,
   '{retired,service-recovery}',
   'Replaced by PB-003 Service Recovery Playbook.'),
  ('LEGACY-PR','Performance Reflection Process (legacy)','REF','Retired',NULL,NULL,
   NULL,'Sr Director Operations','Sr Director Operations', false, false, false,
   '{retired,legacy,performance}',
   'Old Google Forms process. Replaced by SOP-001 v2.0.'),
  ('LEGACY-WOW','WOW Plan (2021 legacy)','TPL','Retired',NULL,NULL,
   NULL,'Sr Director Operations','Sr Director Operations', false, false, false,
   '{retired,legacy,wow}',
   '2021 format. Content merged into TPL-004.');

-- These rows are reconstructed from Tracker v0.5, not app-created. Mark them historical
-- (exempts them from chk_live_complete and future strict gates) with batch_rebuild provenance.
UPDATE documents SET is_historical = TRUE, data_provenance = 'batch_rebuild';

-- ─────────────────────────────────────────────────────────────────────────────
-- Relationships (reconstructed from the Tracker References Map — partial set)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO document_relationships (from_doc, to_doc, rel_type) VALUES
  -- supersession chains (retired → replacement; STD-005 §3.5)
  ('SOP-003','PB-003','superseded_by'),
  ('LEGACY-PR','SOP-001','superseded_by'),
  ('LEGACY-WOW','TPL-004','superseded_by'),
  -- postings / forms derived from their source documents
  ('POST-001','SOP-002','derived_from'),
  ('POST-002','PB-002','derived_from'),
  ('POST-003','AGR-001','derived_from'),
  ('FORM-001','SOP-002','references'),
  ('FORM-002','SOP-002','references'),
  ('REF-001','SOP-002','references'),
  -- templates implement their governing system
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
  -- handbook + standard cross-references
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
-- Surfaces (representative seed; STD-005 §7.2). Expand as intranet tools are wired.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO document_surfaces (doc_id, surface) VALUES
  ('PB-002','incident-reporting'),
  ('PB-002','kitchen'),
  ('PB-002','new-hire-onboarding'),
  ('PB-002','culinary'),            -- Architect-approved cross-placement onto the Culinary shelf
  ('POST-001','incident-reporting'),
  ('POST-002','incident-reporting'),
  ('POST-002','kitchen'),
  ('POST-003','new-hire-onboarding'),
  ('AGR-001','new-hire-onboarding'),
  ('SOP-002','incident-reporting');

UPDATE document_surfaces SET is_historical = TRUE, data_provenance = 'batch_rebuild';

-- ─────────────────────────────────────────────────────────────────────────────
-- End pr-7-2. 41 documents · 38 relationships · 10 surfaces.
-- Next: backfill source_drive_id from library_manifest + ldug_library_manifest.
-- ─────────────────────────────────────────────────────────────────────────────
