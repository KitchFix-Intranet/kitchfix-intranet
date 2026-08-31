# Section F: Mobile

## F18: Per-module breakpoint inventory at 390 / 430

**Config context (all modules).** `tailwind.config.mjs` (lines 1-71) declares NO `screens` override, so Tailwind defaults apply: sm 640, md 768, lg 1024, xl 1280, 2xl 1536. Both 390 and 430 sit BELOW `sm`, so only unprefixed base classes take effect. Custom breakpoints live in raw CSS via `@media (max-width: ...)`.

**Global chrome bindings at 390/430.**
- `src/components/TopNav.css:11` sets `--kf-topnav-h: 56px` (52 on mobile).
- Mobile break at <=768 (:496): brand wordmark hidden, link labels hidden (icon-only), inner padding 12px, height drops to 52px.
- Second break at <=420 (:509): notif dropdown becomes fixed full-width, profile dropdown fixed, link padding reduced.
- At **390**: post-420 rules fire (compact link padding, fixed dropdowns).
- At **430**: pre-420 rules only (icon-only, wider inner dropdown at `100vw-24px`, offset `right: -48px`).
- Nav renders 7-8 icons (Home / People / Ops Hub / Service / KPI / Playbook / [Sous when gated] / Directory) + separator + bell + avatar. Each `.kf-topnav-link` at mobile ~ 20px icon + 10px+10px padding ~ 40px. Eight icons ~ 320px + separator + bell (36) + avatar (34) ~ 400+. **At 390 with all 8 icons + brand-logo (32) + inner padding (12+12), total ~ 460+. Likely overflows or forces horizontal scroll on the nav row.** At 430 slightly less pressure but still tight. [code-read]

---

### Playbook

**Files.** `src/app/playbook/playbook.css` (3302 lines), `src/app/playbook/admin/admin.css` (1417 lines), `src/app/playbook/PlaybookClient.js`, `src/app/playbook/SlideOverReader.js`.

**Explicit floor.** `playbook.css:3` header: *"Floor-first: laid out for 375px viewport, lifts to grid at >=640px."*

**Breakpoints observed:**
- `.pb-wrap` max-width 1240 with 14px horizontal padding (line 12). At 390: content = 362px.
- `.pb-layout` 1 column, no rail; grid at >=768 (line 566).
- `.pb-card-grid` 1 column base; 2 col at >=640; 3 col at >=960 (lines 834-840).
- `.pb-card` at <=767 becomes row-mode: min-height 56px, class chip + title + status on one line (line 846-886). Description hidden, pin/poster icons hidden.
- `.pb-list-row` at <=520 wraps meta items (line 974).
- `.pb-filter-bar` at <=640 wraps to 2 per row (line 455-458).
- `.pb-view-btn` at <=520 hides text labels (line 503).
- `.pb-hero` breakpoint at >=640: title jumps 28->36 (line 240-252).
- Sticky search bar at `top: 56px` (line 263) - aligned to TopNav height.
- Doc reader `.pb-slide` full-width at <=1023 (line 1261-1266).
- SousAI overlay `.pb-sous-panel` full-width at <=1023 (line 2160-2162).

**Verdict at 390 / 430:**
- **Fine.** Reader surface, catalog, hero, filter bar, slide-over, Sous panel - all have explicit sub-640 rules and card->row collapse. `pb-search-bar` + `pb-sous-btn` flex-basis 100% at <=640 (line 235-238).
- **Cramped.** Filter chips row `pb-chip-row` is horizontal scroll overflow-x auto. 4-6 status chips + All/Pinned at 390 will always scroll horizontally by design (line 513-517).
- **Potentially cramped.** Rail toggle (`pb-rail-toggle`) hidden until >=768; on mobile there's no rail at all (correct).
- **Breaks.** None found in catalog/reader.

Confidence: [code-read] high. Kevin's own comment establishes 375px floor for Playbook operator surfaces.

---

### Playbook admin (`/playbook/admin`)

**Files.** `src/app/playbook/admin/admin.css` (1417 lines), `src/app/playbook/admin/AdminClient.js`.

**Explicit note (`admin.css:12-14`):** *"Mobile <1024px overrides to Comfortable per the floor-first rule."*

**Breakpoints:**
- `.pb-wrap.pb-admin` max-width 1280 with 24px padding (line 24). At 390: content = 342px.
- `.pb-admin-head-row` flex-wrap: wrap - vitals wrap below title at narrow widths (line 96-99).
- `.pb-admin-table-wrap` at <=720: `overflow-x: auto`, `.pb-admin-table { min-width: 720px }` (line 859-869). **Explicit horizontal-scroll pattern for the admin dashboard table on phones.**

**Verdict at 390 / 430:**
- **Cramped by design.** The admin table renders at 720px min-width with horizontal scroll. Chef on a phone will need to scroll horizontally to see columns. Comment confirms this is deliberate: *"scrolls horizontally rather than reflowing, keeps the sortable header pattern usable on phones"* (line 857-859).
- **Fine.** Tab nav, create modal use standard modal `--kf-r-modal: 12px` sizing. Header vitals wrap.
- **Breaks.** None known. Table's 720 min-width fits with horizontal scroll but a chef trying to sort or scan multi-column status will find it awkward.

Confidence: [code-read]. Admin is not a phone-first surface; the floor-comment for MDX catalog does not extend to `/playbook/admin`.

---

### Service Calendar (`/service-calendar`)

**Files.** `src/app/service-calendar/ServiceCalendar.js` (4000+ lines), `src/app/service-calendar/v2/*.css`, `src/app/service-calendar/season/*.css`, `src/app/service-calendar/DaySquare.css`.

**Breakpoints:**
- v2 shell in `src/app/service-calendar/v2/shell.css` widens the `.oh-bound` container when `.scv2` is present.
- `src/app/service-calendar/v2/drill.css:63-104` at <=767: FinancialFrame stats wrap, workspace-frame `border-radius: 0`, workspace-grid gap 6px, SC-036 urgency-signal reinforcement for tiny tiles.
- `src/app/service-calendar/v2/drill.css:45-54` at <=1279: two-pane rail unstacks; rail becomes non-sticky.
- `src/app/service-calendar/v2/mobileBooksBar.css:54` at <=1099: shipped MobileBooksBar sheet + backdrop mount. Bottom sheet with tokens `--sc2-mobile-bar-h` (~60px) and `--sc2-mobile-footer-h` (~116px). Safe-area-inset-bottom respected.
- `src/app/service-calendar/season/periodWorkspace.css:686-761` at <=767: workspace grid drops to 1 column, day-atom becomes horizontal 48px row, DOW header hidden, week mini-cards drop to 2 col.
- `src/app/service-calendar/season/periodWorkspace.css:764-768` **explicit <=375 rule** (narrow phones): stat-num font drops to size-subhead, day-atom padding tightens further.
- `src/app/service-calendar/season/season.css:259-261`: season grid `repeat(3) -> repeat(2) at <=1023 -> repeat(2) at <=767 -> 1 col at <=479`.
- `src/app/service-calendar/season/season.css:667-668`: period grid same 4-stop reflow.
- `src/app/service-calendar/season/chromeBar.css:267-290` at <=767 and again at <=639: chrome bar wrapping/spacing adjustments.
- `src/app/service-calendar/season/stateLegend.css:258` at <=767: legend items reflow, min-width 36px on swatch.
- `src/app/service-calendar/DaySquare.css:49-58`: sm variant min-height 44px (WCAG tap floor), lg variant 96px.
- `src/app/service-calendar/ops-sc.css:111` at <=767 + `:312` at <=640: overlay card widens to 100%, coming-soon banner narrows.

**Verdict at 390 / 430:**
- **Fine.** Season grid, period grid, day cells - all explicitly re-authored for <=479 (390 hits it) and <=767 (430 hits it). Day tiles maintain 44px tap floor via DaySquare--sm and 48px on the workspace list re-layout.
- **Fine.** MobileBooksBar (v2) is the mobile primitive - bottom sheet + sticky bar with tokenized heights, safe-area handling.
- **Cramped.** Chrome bar `.sc-chrome-bar` at <=639 has narrow wrapping rules. Ribbon + chrome legends can get tight with account name + phase + step buttons + as-of pill. FinancialFrame stats stack "flex-wrap: wrap" with min-width 45% - at 390 this results in 2-per-row, which is intended.
- **Potentially cramped.** State legend (`stateLegend.css:258-306`) is explicitly re-authored below 767 but 8+ legend items can wrap onto many rows on 390.
- **Breaks.** None found in shipped code. Bulk overlay (`v2/bulk/`) has its own responsive rules but SC v2 team explicitly gates every SC tile change at 5 contexts including phone widths (per memory `feedback_sc_tile_gate_all_five`).

Confidence: [code-read] high. Explicit `@media (max-width: 375px)` in periodWorkspace.css:764 proves someone measured this in dev tools.

---

### KPI (`/kpi/labor`, `/kpi/purchasing`, aliased in nav as `/kpi/labor`)

**Files.** `src/app/kpi/kpi.css` (4381 lines), `src/app/kpi/labor/*`, `src/app/kpi/purchasing/*`.

**Breakpoints (dense - KPI is admin-tier and desktop-first):**
- `.kpi-cols` becomes 1 column at <=1023 (line 1698-1751). The whole shell reflows: folio becomes horizontal pill strip, command bar wraps.
- `.kpi-cal-pop` calendar picker: `min-width: 560px` desktop; at <=767 becomes `min-width: 280px` + 1-col months (line 634-637).
- `.kpi-rmenu-pop` range menu: `min-width: 640px` desktop; at <=767 becomes fixed full-width sheet (line 1127-1138). Explicit V6-24 note: *"becomes a full-width sheet under 1024px"*.
- `.kpi-hs-signals` 5-col -> 2-col at <=1024 -> 1-col at <=640 (line 3905-3914).
- `.kpi-skel-sigs` 4->2->1 col at 1279/767 (line 1795-1819).
- `.kpi-tbar` (table control bar) has `flex-wrap: wrap` (line 1150) - controls wrap naturally.
- Multiple week/day/homestand tables use `min-width: 0` on their internal cells and `overflow-x: auto` (via table-wraps not always visible in grep - would need visual verification).

**Verdict at 390 / 430:**
- **Fine.** Folio, calendar pop, range menu, signal cards - all have explicit sub-768 rules.
- **Cramped.** Command bar `.kpi-cmd` wraps to two lines at <=1023 (line 1700). At 390 with multiple controls (period picker + comparison + view toggle + admin actions) it likely wraps to 3-4 lines.
- **Cramped/potentially breaks.** Data tables (WeekTable, DayGrid, HomestandTable) rely on `min-width: 0` cells + tabular-nums numeric column widths. **Without an explicit horizontal-scroll wrap around each table**, wide 6-8 col dollar-amount tables will crush numeric formatting or overflow the card. Cannot confirm which tables have scroll wrappers without opening components. Per memory `feedback_low_risk_is_inference_not_evidence` I flag this rather than assume.
- **Breaks (probable).** The `kpi-vpill` + `kpi-sig-hero-val` numbers (e.g., `$1,234,567`) are `font-variant-numeric: tabular-nums` with no wrap - long dollar values in narrow signal cards at 390px stacked 1-col could truncate or force horizontal overflow of the card. No visible line-clamp or ellipsize rule.

Confidence: [code-read] moderate. KPI's density-mode + admin-tier design plainly targets desktop; the mobile reflow rules exist but are less proven than SC/Playbook. Would benefit from a [verified] pass at 390 on a real dataset.

---

### People (`/people`)

**Files.** `src/app/people/people.css` (4620 lines), `src/components/people/*`, `src/components/people/leadership-dugout/*`.

**Header.** `people.css:3` reads *"Purple Theme | Mobile-First | Polished"*.

**Breakpoints:**
- `.pp-bound` max-width 1024 with 20px horiz padding (line 42). At 390: content = 350px.
- `.pp-hero` mobile compact: 84px height, `padding: 0 22px` (line 50-63); >=768 goes to 96px (line 65-72).
- `.pp-nav-item` at <=767: padding 8px 20px, font-size 13px (line 1436-1440).
- `.pp-nav-item` at <=420: padding 6px 12px, font-size 12px, `svg { display: none }` (line 1499-1507). **Icons stripped on very small phones.**
- `.pp-adm-split` (admin queue) 300px + 1fr at desktop; at <=768 becomes 1 column with list/detail toggle via `.pp-adm-split--detail-open` class swap and `.pp-adm-mobile-back` button (line 1942-1993).
- `.pp-adm-fields-grid` 2-col grid inside detail on mobile (line 1981-1983).
- `.pp-form-content` at <=420 padding drops to 16px (line 1489-1493).
- `.pp-adm-header-controls` at <=768 stacks vertically (line 2043-2053).
- Leadership Dugout: `pp-ldug-*` classes with <=1023 and <=540 mobile rules (line 4587-4635).

**Verdict at 390 / 430:**
- **Fine.** Hero, nav (icon-stripped at 390), admin queue split-to-stacked pattern, form padding, dashboard grid (`pp-grid--dashboard` -> 1fr at <=767 line 1468-1470).
- **Fine.** Leadership Dugout tool has explicit `pp-ldug-*` mobile rules relaxing density per the <=1023 non-negotiable rule (line 4587).
- **Cramped.** PeopleNav at 390 loses icons (pp-nav-item svg display:none at <=420); if the tab-set has 6+ tabs the pills may still wrap or scroll horizontally. Ops+People+Sub-nav all being sticky is untested at 390.
- **Cramped.** Incident/PAF forms with multi-column layouts (fields grids) at 390 with 2-col grid will pack labels tightly.
- **Breaks.** None confirmed in code. The `pp-app` padding-bottom: 100px accommodates the HelpFAB.

Confidence: [code-read] high. Extensive `<=420` rules across `people.css` show the author has designed for small phones. But there's no `<=375` rule; 390 sits close to the smallest tested width.

---

### Ops Hub (`/ops`)

**Files.** `src/app/ops/css/ops-shared.css`, `src/app/ops/css/ops-executive.css`, `src/app/ops/css/ops-inventory.css`, `src/app/ops/css/ops-inv-mgmt.css`, `src/app/ops/css/ops-invoice.css`, `src/app/ops/css/ops-vendor.css`, `src/app/ops/css/ops-labor.css`, `src/app/ops/components/*`.

**Breakpoints:**
- `.oh-bound` max-width 1024 (ops-shared.css:58). At 390: content = ~350px.
- `.oh-grid` becomes `repeat(3, 1fr)` at >=768 (line 174-177); default 1 col.
- `.oh-grid--dashboard` forces 1 col at <=767 with `!important` (line 506).
- `.oh-hero` mobile handled in main block; nav item padding shrinks at <=767 (line 500-529).
- `.oh-modal-overlay` at <=767 becomes bottom-sheet: align-items flex-end, modal border-radius 20px 20px 0 0, mobileSlideUp animation (line 525-526).
- `.oh-widget-header/body/footer` pad shrink at <=420 (line 533-542).
- `.oh-help-pill { display: none }` at <=767 (line 523).
- **Executive dashboard**: `.oh-exec-pnl-row` (P&L table) at <=768 becomes 6 cols dropping annual col; at <=480 becomes 4 cols dropping annual + pct + rev cols (line 1009-1097). Health matrix drops sparkline + one col at <=480 (line 1118-1136).
- Invoice: multiple <=600 and <=480 rules; deep responsive treatment.
- Vendor: rules at <=768 / <=500 / <=480.
- Labor: rules at <=700 / <=640 / <=600.
- Inventory: rules at <=768 / <=420.

**Verdict at 390 / 430:**
- **Fine.** Home tiles (oh-grid -> 1 col), modals (bottom-sheet), hero, help-pill hidden.
- **Fine.** Executive P&L reflows aggressively to 4 columns at <=480 (390 hits it), 6 cols at <=768 (430 hits it, not 480). **Note: 430 lands in the 6-col P&L layout (worse for small screens), while 390 gets the 4-col layout. There's no <=430 or <=450 rule to give 430 the 4-col treatment.**
- **Cramped.** At 430, oh-exec-pnl-row uses `grid-template-columns: 1.4fr 0.8fr 0.8fr 0.6fr 0.9fr 0.5fr` (5.0fr total) with `font-size: 12px, padding: 8px 12px`. Content width is ~430-40 = 390px. That's 65px average per column - budget lines like *"Cost of Goods Sold"* will truncate or wrap awkwardly.
- **Cramped.** Health matrix at <=768 has 7-col grid `1fr 40px 40px 40px 40px 70px 80px` = 270px + 1fr for name. At 430: 430 - card-pad - 270 = ~120px for the name column. Account labels like "PDC Chicago Cubs" fit; longer ones truncate.
- **Breaks.** None visible in shipped code. But **the mid-range 421-479 gap** means at 430 several tables render with more columns than they can accommodate.

Confidence: [code-read] moderate. Ops Hub has robust responsive treatment but was clearly authored for the 375 / 480 / 768 waypoints, not for 430. The Pro Max iPhone (430) lands in an "in-between" band. Would benefit from [verified].

---

### Directory (`/directory`)

**Files.** `src/app/directory/directory.css` (1875 lines), `src/app/directory/page.js`, `src/components/directory/*`.

**Breakpoints:**
- `.td-bound` (implied) max-width 1024, container pattern shared with People/Ops.
- `.td-hero` at <=768: height 100px, padding 0 24px, margin-top 16 (line 887-894).
- `.td-controls--inner` at <=640 flex-direction column, `.td-filter-chips` centered, `.td-grid` becomes 1fr (line 896-900).
- `.td-admin-drawer` (admin overlay) max-width 860; on mobile fills width.
- `.td-adm-*` at <=640 has additional rules (line 1391).
- Card details use `min-width: 0` for text truncation.

**Verdict at 390 / 430:**
- **Fine.** Hero, controls stack, grid -> 1 col, filter chips center. All at <=640 so both 390 and 430 get the mobile layout.
- **Cramped.** Team cards (`td-grid` -> 1fr) means one full-width card per row; each card contains contact list rows with initial + name + role + phone/email icons. At 390 with padding, name+role may truncate.
- **Cramped.** Admin drawer opens as a fixed right-anchored panel; on mobile it becomes full-width. Multi-field forms inside will be tight.
- **Breaks.** None confirmed.

Confidence: [code-read] high. Directory is the simpler module; the responsive pattern is straightforward.

---

### Sous panel

Two surfaces called "Sous":
1. **Standalone Sous page** at `/sous` - full assistant workspace (`src/app/sous/sous.css` 1840 lines).
2. **Sous overlay panel** inside `/playbook/d/[docId]` - the `.pb-sous-panel` slide-over (in playbook.css:2143-2162).

**Standalone `/sous` breakpoints:**
- `.sa-shell` max-width 1520 with `padding: 20px 24px 0`, gap 16 (line 86-90). At 390: content = 342px.
- At <=767: padding drops to 12px 16px, gap 12 (line 91-93).
- `.sa-workspace` grid: `264px + 1fr` desktop; `220px + 1fr` at 1024-1279; **`1fr` and `.sa-rail { display: none }` at <=1023** (line 108-115). Rail is hidden on all phones.
- `.sa-hero` compact at <=767 (line 432-434); short-laptop rule at >=768 with max-height 800.
- `.sa-firstrun`, `.sa-pane`, `.sa-composer` all have <=767 padding-shrink rules.
- Answer body max-width 68ch, source-title max-width 180 (line 1817).
- `@media (hover: none) and (pointer: coarse)` block at line 1247 - touch-specific tuning.

**Sous overlay panel (`.pb-sous-panel`)** in playbook.css:
- Fixed right, 100% width, max-width 580 desktop.
- At <=1023: `max-width: 100vw` - fills entire viewport (line 2160-2162).

**Verdict at 390 / 430:**
- **Fine.** Standalone Sous drops the session rail and gives full width to the answer pane. Composer, hero, examples all responsive. Touch-specific tuning present.
- **Fine.** Sous overlay panel fills viewport on both widths.
- **Cramped.** Answer body at 390 with `max-width: 68ch` gets capped by viewport not by ch. But long markdown code blocks or wide tables in Sous answers have no explicit horizontal-scroll wrapper visible in the grep.
- **Cramped.** Rail-in-panel navigation: with the rail hidden at <=1023, users on mobile must open a session/history control that lives inside the composer/pane. If that control depends on rail visibility for discovery, the mobile UX loses affordance. Not confirmed in code without opening SousSurface.js.
- **Breaks.** None confirmed.

Confidence: [code-read] moderate. Sous is the newest surface (per memory `project_opd_phase2_active`) and the touch-media block at line 1247 hints the author verified some paths on a real device, but no explicit <=375 or <=430 rule.

---

## F19: Mobile Chrome Contract - recommendation

### Repo presence check

Grep confirmed:
- **No file, class, or component called "MobileChrome", "AppShell", "ShellPrimitive", or "mobile chrome contract"** exists.
- The word "chrome" appears ~30 times across the src tree, ALL as generic UI-frame terminology (`.sc-chrome-bar`, `.pb-sous-panel`'s inline comment referring to "panel chrome", the `.kf-topnav` playbook print rule stripping "app chrome"). None are shared primitives; each module authors its own frame.
- The only globally-shared chrome primitives are:
  - `src/components/TopNav.js` + `src/components/TopNav.css` - the one sticky nav.
  - `src/components/HelpFAB.js` - the help FAB (positioned bottom-right, mobile-adapted in globals.css:278-289).
  - `src/components/ProfileModal.js` - shared profile modal.
- Module heroes, chrome bars, filter bars, breadcrumbs, bottom-sheets, sticky search bars, drill navs, and mobile books-bars are all **per-module implementations** with no shared primitive layer.

The `src/app/layout.js` mounts only `<TopNav>` and children - there is no `<AppShell>` or `<MobileChrome>` wrapper.

### Recommendation

**Option (b): Ship a separate shared-chrome effort first; make Academy PR 1 a chrome-consumer.**

**Rationale.**
- **Blast radius of (a) is severe.** If Academy PR 1 ships chrome primitives "app-neutral", every module will inherit them retroactively - even those with mature, deeply-tuned per-module chrome (SC's `.sc-chrome-bar` + MobileBooksBar; Playbook's sticky search + slide-over reader; KPI's `.kpi-cmd` command bar; Sous's `.sa-shell` + hidden-rail pattern; Ops Exec's health matrix column-drop cascade). Retrofitting a shared primitive over 6 modules that already reflow correctly (F18 evidence: floor rules from 375 to 1099) is a rewrite disguised as a lift. Each module would need its per-module rules re-anchored to the new primitive. That is a multi-PR cross-module refactor, not "Academy PR 1".
- **Bank-invariant / floor-first laws favor (b).** Per memory `feedback_bank_invariant_pattern` and `feedback_report_before_build`, any cross-cutting change to load-bearing UI needs baseline capture + assertion extension + numeric evidence per module before code change. That is fundamentally a separate PR-arc.
- **Migration-gate discipline (CLAUDE.md "Migration-gated PRs open as DRAFT") favors (b).** A chrome contract that touches every module's DOM is analogous to a schema-touching change - it needs its own gated arc with per-module verification, not a bundled Academy PR.
- **Precedent.** The `--kf-topnav-h: 56px` token (`TopNav.css:11`) is the pattern already established for shared shell primitives: tokenize the constraint, let each module consume it. A Mobile Chrome Contract should follow the same shape (tokens + optional slot components) BEFORE any Academy work assumes it.

**Cost (a) - Academy ships chrome primitives as PR 1:**
- PR sequencing: PR 1 becomes ~30-40 files touched (one per module's chrome adapter + globals) + Playwright regression across 6 modules x 2 widths. Realistically 4-6 PRs to land safely: primitive introduction, then per-module adopt.
- Blast radius: **wide**. Every module's mobile break-point becomes gated on the primitive's behavior. Any regression in one module's SC-style tile stacking or Ops-style P&L reflow surfaces as a chrome-contract bug.
- Rollback path: complex - once modules consume, reverting the primitive re-orphans them.

**Cost (b) - Separate shared-chrome effort first:**
- PR sequencing: chrome effort ships ~3-5 PRs (contract definition, primitive components, per-module adoption in staged waves), THEN Academy PR 1 opens as a chrome-consumer with a narrow surface.
- Blast radius: **contained per PR**. Each module's adoption is its own PR with per-module DOM/Playwright coverage.
- Rollback path: per-module. Backing out a module's chrome-adoption PR doesn't affect others.
- Trade-off: Academy PR 1 is deferred until the chrome effort lands. Given the current codebase has 6 modules with mature but inconsistent per-module chrome, that deferral is honest, not lost time.

**Chosen: (b).** Ship the shared-chrome effort first; Academy PR 1 becomes a chrome-consumer.

---

## Contradictions with the prompt's Section 1 facts

None to flag directly - Section 1's verified facts (people counts, obligations schema, canonical shelves, design contract) do not overlap with the mobile subject matter surveyed here.

Two observations that may be relevant to broader claims elsewhere in the prompt:
- **Mobile Chrome Contract "has no repo presence"** (prompt F19 premise) - **confirmed**. Nothing exists.
- **Sous is "one shell, four rooms"** (prompt Section 1.8 design) - Sous currently ships as ONE component (`SousSurface`) with two variants (`page`, `overlay`); "rooms" is not a codebase concept today.

---

## Completeness map

**[verified]** - **NONE**. This investigation was entirely code-read. No browser was opened, no viewport measurements were taken, no screenshots reviewed. Per memory `feedback_low_risk_is_inference_not_evidence`, all findings here are [code-read] inferences from CSS + JSX inspection. Do not treat any "Fine" verdict as evidence a chef's phone will render it correctly.

**[code-read]** - **ALL of F18 and F19**. Confidence tiers within [code-read]:
- **High confidence code-read**: Playbook (explicit floor comment + 375/420/520/640/768 rules), SC (explicit <=375 rule in periodWorkspace + shipped MobileBooksBar), People (mobile-first header + explicit <=420 icon-strip), Directory (simple pattern), TopNav (dual mobile breakpoints).
- **Moderate confidence code-read**: KPI (density-mode reflow but table overflow paths not fully confirmed), Ops Hub (mid-range 421-479 gap at 430px), Sous (touch-media block present but no explicit small-phone rule).

**What would promote to [verified]:**
1. Run each module at exactly 390 and 430 in Chrome DevTools device toolbar (iPhone 12/13/14 = 390x844 CSS; iPhone 14 Pro Max = 430x932 CSS) with representative data (a real account, 15+ playbook docs, 30+ team members, 6-month P&L, homestand week).
2. For each module capture: nav-fit (does TopNav overflow?), primary tables (do numbers truncate?), overlays/sheets (do modals close correctly?), tap-target measurements (44px minimum per WCAG 2.5.5), horizontal scroll presence (any unwanted?), specific cramped areas identified above.
3. Compare to per-module expected behavior anchors in this report.
4. Use `TEST_MODE=true` per memory `feedback_test_mode_bypass_for_playwright` if a scripted probe is preferred over hand-visits.
