# OPD Review Packet - Resolved Source Content

**Built:** 2026-06-15
**Source:** content/documents/ - frontmatter, body, with Facts resolved against `content/facts/operational-facts.yaml` and Includes inlined from peer docs.
**For:** rendering into per-reviewer packets (Britt, Counsel, Finance). Reviewers approve content, not tokens - so every `<Fact />` is substituted with its real value and every `<Include />` is inlined.

**Resolution path:** mirrors `project_pilot.mjs` (post-F6.5): Includes resolve first (so any Fact carried in by an Include resolves in the calling doc's ctx), then Facts. `<NonCanonical>` blocks are kept and clearly labeled "[EXAMPLE - not policy text]" so reviewers see illustrations but know they are not binding. `<SourceGoverns>` expands to its one-line preamble. No content changes were made to the source MDX.

---

## Section 1 - Britt (Director of Culinary)

Director of Culinary is the owner or co-approver on these. Real temperatures, real cooling rules, real TPHC clock - all Facts resolved. SOP-009 §03 inlines POL-003 §06 (the supplement protocol). PB-006 is the Placeholder Britt delivers; it is included so the packet is complete but is NOT for review.

### SOP-008 - Food Safety Management

**Status:** In Build | **Version:** 1.0 | **Owner:** Director of Culinary | **Approver:** SLT + Director of Culinary | **Shelf:** Safety

> **Resolution note.** Facts resolved: date_mark_max -> 7 days at 41F; danger_zone -> 41F - 135F; cook_temp_poultry -> 165F (15s); cook_temp_ground -> 155F (17s); cook_temp_wholemuscle_fish -> 145F (15s); cooling_rule -> 135F to 70F in 2 hours, 70F to 41F in 4 hours (6 hours total); reheat_rule -> 165F within 2 hours; quat_ppm -> 200 - 400 ppm

# 01 Purpose and Scope

The complete food-safety management program for every KitchFix kitchen - the system, the standards, and the controls that keep food safe from source to service.

> ANCHOR: We feed elite athletes. A single foodborne-illness incident can end a stretch for a player and a contract for us. Food safety is a managed system, not a checklist.

This SOP defines how KitchFix manages food safety across every account, built on the FDA Food Code, ServSafe, and HACCP principles. It covers the full path of food through our kitchens: source, receiving, storage, preparation, cooking, holding, service, cleaning, and the people and facility around it.

It applies to every employee who touches food - Executive Chef to dishwasher. Where a Club or local health authority sets a stricter standard, the stricter standard governs.

> NOTE: Site-specific protocols - account layout, local health code, Club requirements - sit on top of this SOP. Your Executive Chef trains you on those. The standards here apply everywhere, always.

# 02 Food Safety Management System

Food safety is managed, not hoped for. KitchFix runs an active system that names its hazards and controls them.

## Active Managerial Control

Active managerial control means we do not wait for a health inspector to find a problem. The Person in Charge actively watches the practices most likely to cause foodborne illness, corrects them in the moment, and documents both. Every site runs this loop every shift: monitor, correct, document.

## The Five Risk Factors

The CDC identifies five risk factors behind most foodborne illness. Our entire program exists to control them:

1. Food from unsafe sources.
2. Inadequate cooking.
3. Improper holding temperatures.
4. Contaminated equipment.
5. Poor personal hygiene.

Every section of this SOP maps to one or more of these five. Understand the five and you understand why each rule here exists.

## A HACCP-Based Approach

For our higher-risk processes - cooking, cooling, holding - KitchFix applies HACCP thinking: identify the hazard, set the critical control point and limit (the temperature or time that must be met), monitor it, and act the moment it is missed. The cook, cool, and hold temperatures in this SOP are critical limits, not suggestions.

> ANCHOR: A clean kitchen that isn't managed is one bad shift from an outbreak. The system is what makes safety repeatable.

# 03 Roles, the Person-in-Charge and Certifications

Every shift has a Person in Charge who owns food safety on the floor.

The Executive Chef is the Person in Charge (PIC) for the site. On every shift a designated PIC - the EC, Sous Chef, or a trained lead - is present and accountable. The PIC has the authority to stop service, pull product, exclude a sick employee, and correct any unsafe practice on the spot.

## Certifications

Every KitchFix food handler holds a current ServSafe Food Handler and ServSafe Allergen certification, per PB-004. At least one ServSafe-certified manager serving as PIC is on site whenever the kitchen is operating. Certifications are kept current and on file.

## Who Owns What

- **Person in Charge** - owns food safety for the shift; verifies monitoring and logs are current; corrects problems and documents them.
- **Cooks** - follow temperature, time, and cross-contamination rules; record temperatures; never serve food they are unsure of.
- **FOH Attendants** - handle ready-to-eat food with gloves or utensils; keep service lines at temperature.
- **Dishwashers** - run wash / rinse / sanitize correctly and keep sanitizer and warewasher at standard.

## The PIC's Daily Duties

- **At open**: verify refrigeration and equipment temperatures, sanitizer, and that the kitchen is clean and pest-free before any prep begins.
- **During service**: monitor holding, time, and hygiene; correct and document as needed.
- **At close**: confirm storage, date marking, cleaning, and that all logs are complete.

# 04 Approved Sources and Receiving

Safe food starts before it arrives. Buy from approved sources; inspect everything at the door.

## Approved Sources

KitchFix buys only from approved, reputable suppliers that meet federal and state licensing and inspection requirements. Food from unapproved sources - home kitchens, unlicensed vendors, foraged or home-canned items - is never used. The approved-vendor list is maintained by the Executive Chef and the Director of Culinary.

- Suppliers meet applicable licensing and inspection standards, with vendor allergen statements and recall contacts on file.
- Deliveries are scheduled for hours when they can be received and inspected, not left unattended.

## Receiving Standards

Inspect every delivery before accepting it:

- Cold TCS food at 41F or below; frozen food solid with no sign of thaw-and-refreeze; hot food at 135F or above.
- Packaging intact - no tears, leaks, swelling, broken seals, or dented can seams.
- No pests, no off odors, no thawing or condensation. Reject and document anything that fails; record accepted deliveries on the Daily Food Safety Log (TPL-018).

## Special Items

- **Shellfish** - keep shellstock identification tags on file for 90 days from the date the container is emptied.
- **Reduced-oxygen / vacuum-packed** - check for damage, swelling, and date; reject compromised packaging.
- **Eggs and dairy** - refrigerated at delivery; eggs clean and uncracked.

# 05 Storage, Date Marking and Thawing

Store it cold, store it in order, date it, and thaw it safely.

## Cold and Dry Storage

Refrigerators hold TCS food at 41F or below; freezers keep food frozen solid; dry storage stays cool and dry, food off the floor (six inches) and away from walls and chemicals.

## Storage Order

Store raw protein below and away from ready-to-eat food, in cook-temperature order (lowest cook temp on top):

1. Ready-to-eat foods, dairy, and packaged or commercial products
2. Raw fruit and vegetables
3. Seafood
4. Whole cuts of beef and pork
5. Ground meat and ground fish
6. Poultry

> NOTE: Lowest cook temperature on the bottom, highest on top: ready-to-eat foods, dairy, packaged products, and raw produce sit above all raw proteins, so nothing drips onto a food that won't be cooked hot enough to kill what dripped on it. This is the same order shown in your site storage guide.

## Date Marking

Ready-to-eat TCS food held longer than 24 hours is date-marked with a discard date. The use-by is a maximum of 7 days at 41F, counting the prep or open day as day one. When combining items, the earliest date governs. Discard on the use-by date.

## Thawing

Thaw TCS food only by one of three approved methods:

1. **In the refrigerator** - at 41F or below.
2. **Under cold running water** - at 70F or below.
3. **As part of cooking** - straight from frozen into the cooking process.

> CRITICAL: Never thaw food at room temperature. The outside sits in the danger zone (41F - 135F) for hours while the center is still frozen.

> NOTE: KitchFix does not use microwaves to thaw or cook food for players. A Club may provide a microwave; we neither use it nor advise its use.

# 06 Cooking, Cooling and Reheating

These temperatures are critical limits - they must be met, not approximated.

## Minimum Cooking Temperatures

| Food | Minimum internal temperature |
|---|---|
| Poultry, stuffed meats, reheated TCS food | 165F (15s) |
| Ground meat, sausage, ground seafood | 155F (17s) |
| Pork, beef, veal, lamb (whole cuts), seafood, shell eggs for immediate service | 145F (15s) |
| Fruit, vegetables, grains, legumes held hot | 135F |

## Cooling

Cool TCS food per the canonical cooling rule: 135F to 70F in 2 hours, 70F to 41F in 4 hours (6 hours total). Miss the first stage and you reheat and start over, or discard.

Cool fast: shallow pans, ice baths, ice paddles, or a blast chiller. Never cool at room temperature in deep, covered containers. Record on the Daily Food Safety Log (TPL-018).

## Reheating

Reheat TCS food to 165F within 2 hours before hot holding. Commercially processed, ready-to-eat food reheated for hot holding reaches 135F.

# 07 Holding and Time as a Public Health Control

Hold hot food hot and cold food cold - or, when you can't, use time as the control, on a strict clock.

## Temperature Holding

- Hot holding at 135F or above; cold holding at 41F or below.
- Check and record holding temperatures at least every four hours - more often on a busy line - on the Daily Food Safety Log (TPL-018).

## Time as a Public Health Control

When food is held without temperature control - a service line with no hot or cold equipment - KitchFix may use time instead, but only with a written procedure and a strict clock:

- Food starting at 41F or below, or 135F or above, may be held without temperature control for up to 4 hours, then served or discarded.
- Mark each item with its discard time. Never reuse it, never return it to storage.
- Time as a control requires PIC approval and a documented procedure on file.

> CRITICAL: Time control is unforgiving. When the clock runs out, the food is discarded - no exceptions, no "just a few more minutes."

# 08 Thermometers and Calibration

Every temperature rule in this SOP depends on an accurate thermometer.

## Using Thermometers

- Use a clean, sanitized probe thermometer for internal temperatures; check the thickest part or center of the food.
- Clean and sanitize the probe before and after every use, and wait for the reading to stabilize.

## Calibration

Calibrate probe thermometers on a regular schedule and after any drop or temperature shock, by one of two methods:

1. **Ice-point method** - in a slush of crushed ice and water, the thermometer should read 32F.
2. **Boiling-point method** - in boiling water, it should read 212F (adjust for altitude).

Record each calibration when performed. Tag and remove any thermometer that cannot be calibrated.

> NOTE: An uncalibrated thermometer is worse than none - it gives false confidence in a number that may be wrong.

# 09 Cross-Contamination and Allergens

Keep raw away from ready-to-eat, and keep allergens controlled. This is where most problems start.

## Preventing Cross-Contamination

- Separate raw protein from ready-to-eat food at every step - storage, prep, and cooking.
- Use separate, color-coded boards and utensils, or clean and sanitize thoroughly between tasks.
- No bare-hand contact with ready-to-eat food. Use gloves or utensils; change gloves between tasks and after handling raw.
- Wash, rinse, and sanitize any surface or tool that touched raw protein before it touches anything else.

## Allergens

The Allergen Playbook (PB-002) governs allergen handling. The essentials: know the top 9 allergens, prevent allergen cross-contact the same way you prevent raw-to-ready cross-contamination, and never guess. When an allergen is involved, confirm with the PIC and the team dietitian.

> CRITICAL: KitchFix does not offer allergen-free meals or allergen-free stations. A severe-allergy accommodation is a Chef-level decision, made case by case through the dietitian - never improvised on the line.

# 10 Cleaning, Sanitizing and Warewashing

Cleaning removes what you can see. Sanitizing kills what you can't. And the chemicals that do it are themselves a hazard.

A dirty surface cannot be sanitized - clean first, then sanitize. Food-contact surfaces are cleaned and sanitized every four hours of continuous use, and after any change of task.

## Three-Compartment Sink

1. **Wash** - detergent and water at 110F or hotter.
2. **Rinse** - clean water.
3. **Sanitize** - correct concentration and full contact time.
4. **Air dry** - never towel dry.

## Warewashing Machines

- High-temperature machines: the final sanitizing rinse reaches 180F at the manifold (about 160F at the dish surface).
- Low-temperature chemical machines: sanitizer at the correct concentration. Check and record the gauge temperature or sanitizer level daily; air-dry everything.

## Sanitizer

KitchFix uses quaternary ammonium (quat) sanitizer at every site - no chlorine, no iodine. Mix it to the manufacturer's concentration (typically 200 - 400 ppm), verify each batch with quat test strips, and remake it fresh the moment it drops below concentration. Record the check on the Daily Food Safety Log (TPL-018).

## Chemical and Toxic-Materials Storage

- Store cleaning chemicals and toxic materials below and away from food, equipment, and single-use items - never above a prep area.
- Keep chemicals in their original labeled containers, or in labeled working bottles. Never store a chemical in a food container, or food in a chemical container.
- A Safety Data Sheet (SDS) is available for every chemical on site, per the HazCom / SDS program.

# 11 Personal Hygiene and Employee Health

Clean hands and healthy staff - the two things that keep pathogens off the plate.

## Handwashing

- Wash for at least 20 seconds with soap and warm water.
- Wash after the restroom, after handling raw food, after touching your face or hair, after trash or money, after eating or smoking, and before putting on gloves.
- Hand sanitizer is not a substitute for handwashing. Handwashing sinks are used only for handwashing - never for food prep or filling buckets.

## Personal Practices

Clean uniform and apron; hair fully restrained under a hat or hairnet; no nail polish or false nails; no bare-hand contact with ready-to-eat food. Eat, drink, and smoke only in designated areas.

## Employee Health and Illness Exclusion

- Tell your manager if you have vomiting, diarrhea, jaundice, a sore throat with fever, or an infected, uncovered wound.
- Stay home - or be sent home - for vomiting or diarrhea until you are symptom-free for at least 24 hours.
- The "Big 6" reportable illnesses - Norovirus, Hepatitis A, Shigella, Shiga toxin-producing E. coli, Salmonella Typhi, and nontyphoidal Salmonella - require exclusion and may require a doctor's or health-department clearance before return.

> NOTE: You will not be penalized for staying home when you are genuinely sick. Reporting illness protects the team, the players, and you.

# 12 Facility, Water and Pest Control

The building around the food matters - safe water, sound plumbing, and no pests.

## Water and Plumbing

- Use potable water from an approved source. No cross-connections; backflow prevention on hose bibbs and equipment connections.
- Report leaks, drain backups, or any sewage immediately, and stop service in the affected area until it is resolved.

## Pest Control

KitchFix follows Integrated Pest Management - deny pests food, water, and shelter:

- Keep exterior doors and screens closed; seal entry points and gaps.
- Store food off the floor and sealed; clean spills and remove trash and grease promptly.
- Work with a licensed pest-control operator on a regular schedule, and report any sign of pests - droppings, gnaw marks, live or dead pests - to the PIC.

## Facility Upkeep

Surfaces, floors, walls, and equipment are cleanable and in good repair; lighting adequate; hoods and ventilation maintained.

> NOTE: Deep, vendor-specific pest-control procedures may live in a separate SOP. This section is the operating standard every site holds to.

# 13 Monitoring, Logs and Corrective Actions

If it isn't logged, it didn't happen. Monitoring proves the system is working - and catches it when it isn't.

## The Daily Food Safety Log

KitchFix uses one consolidated Daily Food Safety Log (TPL-018) - a single sheet the Person in Charge completes and signs each day. One sheet, one sign-off, covering the day's critical checks:

- Refrigeration and freezer temperatures - at open and close.
- Hot and cold holding temperatures - checked across service.
- Delivery temperatures at receiving.
- Any TCS item cooked and cooled - cook temperature and the cooling clock.
- Quat sanitizer concentration.
- End-of-day cleaning, and a space to record any corrective action taken.

## Corrective Actions

When a check is out of range, fix it and record what you did:

- Food in the danger zone (41F - 135F) too long - discard it. When in doubt, throw it out.
- Holding or refrigeration out of temperature - move product to a working unit, correct the equipment, and discard anything time- or temperature-abused.
- Sanitizer or warewasher out of range - remake or correct it before using it again.

> ANCHOR: A log full of perfect numbers that nobody acts on is worthless. The point of monitoring is to catch problems and fix them - and to show, on paper, that we did.

# 14 Food Safety Incidents and Recalls

When something goes wrong - a suspected illness, a contamination, a recall - speed and documentation matter.

## Suspected Foodborne Illness

- Take any report of a guest or player illness seriously. Notify the PIC and your RDO immediately.
- Preserve any suspect food that remains - do not discard it. Bag it, label it, and refrigerate it.
- Do not speculate or discuss it. Route all communication through KitchFix leadership and the Club, never to the player or the media (AGR-001).

## Contamination and Recalls

- Pull any recalled or contaminated product immediately, label it "DO NOT USE," and segregate it from all other food.
- Record the incident and notify the PIC and RDO.

## Reporting Chain

Food-safety incidents follow SOP-002 Safety and Incident Management for the report-and-notify process. A gross or willful food-safety violation - deliberate contamination, concealing an incident, or willful disregard of these protocols - is an immediate-termination offense under SOP-004.

> CRITICAL: Never conceal a food-safety incident. Concealing one is more dangerous - and more serious - than the incident itself.

# Related Documents

Documents this SOP references or governs. Cross-references use the Document ID, which resolves to the current version.

| Document ID | Title | Status |
|---|---|---|
| PB-002 | Allergen Playbook | Live |
| SOP-002 | Safety and Incident Management | Live |
| SOP-004 | Formal Disciplinary Process | Live |
| PB-004 | Hourly Employee Handbook | Live |
| TPL-018 | Daily Food Safety Log | Live |
| CHK-003 | Health Inspection Readiness | Live |
| POST-003 | Kitchen Safety Posting | Live |
| STD-001 | Documentation Format Standard | Live |

---
### SOP-009 - NSF Certified-for-Sport Sourcing

**Status:** In Build | **Version:** 1.1 | **Owner:** Director of Culinary | **Approver:** SLT | **Shelf:** Culinary

> **Resolution note.** Includes inlined: POL-003 §06

# 01 Purpose and Scope

KitchFix is not the source of supplements, performance products, or NSF Certified for Sport items on any client account. The client manages the program; KitchFix serves what the client provides. This SOP names that posture in one place so the Drug & Alcohol Policy (POL-003 section 06) and the Code of Conduct (POL-014 section 06) point at one canonical rule.

Applies to every KitchFix Performance Food Service employee on every Major League, Player Development Complex, and Minor League Club account.

# 02 The KitchFix Position

> CRITICAL: KitchFix does not procure, store, prepare, serve, or hand out any nutritional or dietary supplement, functional-food supplement, powder, or energy product. NSF Certified for Sport items are managed by the client; the client provides any NSF item we use.

This is a hard rule, not a preference. The supplement industry is not tightly regulated. Products can be mislabeled or contaminated with a Prohibited Substance the label does not declare. A Covered Individual can test positive from a supplement without knowing it contained a banned substance, and under the MLB Drug Policy and Prevention Program for Non-Playing Personnel that still counts as a positive test. KitchFix's posture protects the player, the Club, KitchFix, and our team. Per POL-003 section 06.

# 03 What This Means in Practice


Supplements are a positive-test risk for the people we serve. The KitchFix protocol is simple and absolute: we do not procure, stock, prepare, or distribute supplements of any kind.

> CRITICAL: KitchFix does not supply supplements. If a product is not part of the client's NSF Certified for Sport program, it does not get prepared, served, or handed to anyone.

## The KitchFix Position

KitchFix does not buy, store, prepare, serve, or hand out any nutritional or dietary supplement, functional-food supplement, powder, or energy product. Any such product present in a clubhouse setting is supplied by the client, never by KitchFix. Our role stops at food.

## Why

The supplement industry is not tightly regulated. Products can be mislabeled or contaminated with a Prohibited Substance that is not listed on the label. A Covered Individual can test positive from a supplement without ever knowing it contained a banned substance - and under the MLB Program that still counts as a positive test.

Only supplements certified under the NSF Certified for Sport program are permitted in a clubhouse. That certification verifies the product contains no Prohibited Substances. Clients supply only NSF Certified for Sport products.

## Staff Rules

- Do not bring personal supplements into a club kitchen or clubhouse.
- Do not prepare, plate, or serve any supplement, powder, or additive that is not part of the client-directed, NSF-certified program.
- Do not give any supplement to a player or other covered individual. Distributing a non-certified product that results in a positive test exposes the individual to discipline and the club to a fine.
- Route any supplement question to the club dietitian and your Executive Chef. Never improvise.


# 04 If the Client Provides an NSF Item

Where the client supplies an NSF Certified for Sport item for inclusion in a meal or station, KitchFix handles it under the client's documented program direction. The Site Leader confirms with the dietitian or medical staff at the start of season and as the program changes. KitchFix is the kitchen; the client is the program owner.

# 05 Consequences

Distributing a non-NSF-certified product that results in a positive test exposes the individual to MLB Program discipline and the club to a fine. From KitchFix's side, the conduct falls under SOP-004 Formal Disciplinary Process per POL-003 section 08.

# 06 Related Documents

See POL-003 Drug & Alcohol Policy section 06 for the underlying rule, POL-014 Code of Conduct & Ethics section 06 for the banned-substances cross-reference, and AGR-001 The Big Rules sections 03.4 and 03.7 for the related no-PED-talk and no-dietary-advice rules.

---
### SOP-012 - Pest Control and IPM

**Status:** In Build | **Version:** 1.0 | **Owner:** Director of Culinary | **Approver:** SLT + Director of Culinary | **Shelf:** Safety

> **Resolution note.** Facts resolved: storage_off_floor -> 6 inches

# 01 Purpose and Scope

Pests are a direct contamination hazard and a clubhouse-reputation risk. We control them with a managed, prevention-first program - not a can of spray under the sink.

> ANCHOR: A roach on a clubhouse line or a mouse in dry storage is a contamination event and a relationship event. Pest control is a daily operating standard, not an exterminator's job alone.

This SOP defines how KitchFix prevents, monitors, and responds to pests at every account using Integrated Pest Management (IPM). It applies to every employee - Executive Chef to dishwasher.

> NOTE: The licensed pest-control contract and any facility- or Club-specific rules sit on top of this SOP. Your Executive Chef trains you on the site program. The standards here apply everywhere.

# 02 The IPM Approach

Integrated Pest Management controls pests by removing what they need - entry, food, water, and shelter - before reaching for chemicals. Prevention beats treatment every time. The program runs on three lines of defense:

- **Exclusion** - keep pests out of the building.
- **Sanitation** - remove the food, water, and harborage that draw and sustain them.
- **Monitoring** - catch activity early, document it, and act before it spreads.

# 03 Exclusion and Prevention

- Seal entry points - gaps around pipes, doors, windows, and walls. Report new gaps to the Executive Chef.
- Keep exterior doors closed; use door sweeps, screens, and air curtains where installed.
- Store all food at least 6 inches and away from walls. Nothing sits directly on the ground.
- Break down and remove incoming cardboard promptly - boxes carry pests and egg cases. Inspect incoming product (see SOP-008 §04).
- Remove clutter and unused equipment that creates harborage.

# 04 Sanitation as Pest Control

- Clean spills and food debris immediately - nothing left on floors, under equipment, or on the line overnight.
- Keep trash covered, emptied on schedule, and the dumpster area clean and lidded.
- Eliminate standing water - drains clear, no leaks, no wet mop heads stored flat.
- Clean under and behind equipment on the Master Cleaning Schedule (TPL-019), not just the visible surfaces.

# 05 Monitoring and Documentation

You cannot manage what you do not see. Every site monitors for activity and writes down what it finds.

- Check monitoring devices (glue boards, traps, bait stations) on the site schedule. Replace and reposition as needed.
- Log every sighting - pest, location, date, and action taken. Patterns point to the source.
- File every pest-control service report at the site and review it for recurring issues.

# 06 Licensed Pest-Control Program

Every account contracts a licensed Pest Control Operator (PCO) with scheduled service - monthly at minimum, plus call-outs as needed. Work with your Client as this may be something they manage with their facilities team.

- Only the licensed PCO applies pesticides. No consumer sprays, foggers, or baits in or near food areas.
- Pesticides are never applied to food, equipment, or food-contact surfaces; cover or remove these before any treatment.
- Retain service reports and track corrective actions to completion.

> CRITICAL: Store-bought insecticides have no place in a KitchFix kitchen. Pesticide application is a licensed activity - anything else is a code violation and a contamination risk.

# 07 Responding to a Sighting

When a pest or sign of one (droppings, gnaw marks, nesting) is found during service, work the problem calmly and document it.

| Step | Action | Responsible | Output / Evidence |
|---|---|---|---|
| 1 | Document the sighting - pest, location, time. | Any employee | Pest sighting log entry |
| 2 | Isolate and discard any food that may be contaminated. | PIC / Chef | Discarded product noted |
| 3 | Clean and sanitize the affected area. | Staff | Area returned to standard |
| 4 | Notify the Executive Chef; call the licensed PCO if activity is active or recurring. | PIC | PCO service request |
| 5 | Record the corrective action and verify it closed. | Executive Chef | Sighting log closed |

# Related Documents

Documents this references or governs. Cross-references use the Document ID, which resolves to the current version.

| Document ID | Title | Status |
|---|---|---|
| SOP-008 | Food Safety Management | Live |
| TPL-019 | Master Cleaning Schedule | Live |
| CHK-003 | Health Inspection Readiness | Live |
| SOP-002 | Safety and Incident Management | Live |
| STD-001 | Documentation Format Standard | Live |

---
### SOP-014 - Product Recall and Mock-Recall

**Status:** In Build | **Version:** 1.0 | **Owner:** Director of Culinary | **Approver:** SLT + Director of Culinary | **Shelf:** Safety

# 01 Purpose and Scope

A recalled ingredient in an athlete's meal is both a safety failure and a liability. We must be able to find any product and pull it from service fast.

> ANCHOR: When a recall hits, speed and traceability are everything. The kitchen that can account for every unit of a recalled lot in minutes protects its players and its contract.

This SOP defines how KitchFix monitors for recalls, removes recalled product from service, disposes of it, and tests the system through a mock-recall drill. It applies at every account.

# 02 Staying Informed

- Monitor FDA and USDA recall notices and vendor recall notifications.
- Sign up for vendor and distributor recall alerts where available.
- Watch for Club- or league-issued food alerts.
- The Executive Chef (or designated Hospitality Manager) owns recall monitoring at the site.

# 03 When a Recall Hits

| Step | Action | Responsible | Output / Evidence |
|---|---|---|---|
| 1 | Identify the product against the notice - brand, item, lot/code, and dates. | Executive Chef | Recall matched |
| 2 | Locate every unit - dry storage, coolers, freezers, prep, and the line. | Staff | All units found |
| 3 | Segregate and label "HOLD - DO NOT USE." | PIC | Product tagged |
| 4 | Quarantine away from other food and food-contact surfaces. | PIC | Product isolated |
| 5 | Check prepped or batched items that used the recalled product. | Executive Chef | Affected items pulled |

> CRITICAL: Recalled product is never used, served, donated, or sold - under any circumstances.

# 04 Disposition

- Follow the recall instructions exactly - return to the supplier or destroy on site.
- If destroying, render the product unusable so it cannot re-enter the food supply.
- Document quantity, lot, and method of disposal. Keep the records.

# 05 Notification and Records

- Notify the Executive Chef -> RDO -> Director of Culinary.
- If recalled product was already served, notify the client per the SLA and follow the incident process in SOP-002 (Safety and Incident Management) §07.4.
- Keep a complete record - notice, product, lots, quantities, action, and dates.

# 06 Mock-Recall Drill

A mock recall proves the system works before a real one tests it. Run a drill at least once a year at every account.

- Pick a received product at random.
- Trace it backward to its supplier and lot, and forward to everywhere it went, within two hours.
- Verify you can account for all of it - used, in stock, or discarded.
- Document the drill. Any gap in traceability becomes a corrective action.

> NOTE: If you cannot trace a product in two hours during a drill, you cannot do it during a real recall. The gap is the finding.

# Related Documents

Documents this references or governs. Cross-references use the Document ID, which resolves to the current version.

| Document ID | Title | Status |
|---|---|---|
| SOP-008 | Food Safety Management | Live |
| SOP-002 | Safety and Incident Management | Live |
| TPL-018 | Daily Food Safety Log | Live |
| STD-001 | Documentation Format Standard | Live |

---
### SOP-015 - Emergency Food Safety

**Status:** In Build | **Version:** 1.1 | **Owner:** Director of Culinary | **Approver:** SLT + Director of Culinary | **Shelf:** Safety

> **Resolution note.** Facts resolved: cold_hold_temp -> ≤ 41F; frozen_temp -> ≤ 0F; hot_hold_temp -> ≥ 135F; tphc_clock -> 4 hours

# 01 Purpose and Scope

No power, no safe water, no refrigeration - these are imminent health hazards. When food safety cannot be assured, the default is to protect the guest, even if that means stopping service.

> ANCHOR: Emergencies are where shortcuts get taken and people get sick. This SOP makes the safe choice the default choice when the kitchen loses power, water, or cold.

This SOP defines how KitchFix responds to utility failures and imminent hazards at every account. It applies to every employee; the Person in Charge directs the response.

# 02 General Principles

- When you cannot ensure safety, cease the affected operation.
- Notify the Executive Chef and RDO immediately.
- Some events require local health-department notification before reopening.
- Monitor and record temperatures and actions throughout the event.

> CRITICAL: When in doubt, throw it out. Never serve food you cannot verify is safe.

# 03 Power Loss and Refrigeration Failure

Cold air is a resource - protect it. Keep doors closed and watch the clock and the thermometer.

- Keep cooler and freezer doors closed. A closed cooler holds temperature for hours; an open one loses it in minutes.
- Monitor and log temperatures throughout the outage.
- Per SOP-008: hold cold at ≤ 41F, frozen at ≤ 0F, hot at ≥ 135F. Anything out of range must be addressed by the rules below.

> CRITICAL: This table is the disposition for an unplanned outage. The default rule is temperature control per SOP-008. The 4 hours below is the TPHC (Time as Public Health Control) carve-out and is measured from the moment the food left temperature control, not from the start of the outage.

| Situation | Action |
|---|---|
| Cold TCS food still at ≤ 41F | Safe. Keep it cold - move to a working unit, add ice, or transfer to a refrigerated truck. |
| Cold TCS food that has risen above ≤ 41F | TPHC path. Safe only on the 4 hours measured from when it left temperature control. After 4 hours, discard. Do NOT re-cool to ≤ 41F and continue holding. |
| Frozen food still frozen (solid, ice crystals intact) | Safe. Refreeze or use. If thawed to refrigerator temperatures, treat as cold TCS above. |
| Frozen food fully thawed and above ≤ 41F | TPHC path - apply the 4 hours from the moment it left frozen, then discard. |
| Hot-held food with no heat source | TPHC path. Apply the 4 hours from the moment it lost heat, then discard. |
| Any food past its 4 hours limit or of uncertain history | Discard. When in doubt, throw it out. |

> NOTE: This rewrite (F5, 2026-06-15) replaces the v1.0 table that contradicted SOP-008 by treating "41F to 135F" as a 4-hour holding zone. The corrected logic above mirrors SOP-008's temperature-control default with TPHC as the documented monitored exception. Britt (Director of Culinary) reviews the wording for operator clarity before this version goes Live.

# 04 Water Loss or Contamination

- Stop any operation that needs water - handwashing, warewashing, cooking, ice, and beverages.
- Under a boil-water advisory, use bottled or hauled potable water, or cease operations.
- No bare-hand or unsafe-water contact with food.
- Resume only when the water supply is confirmed potable.

# 05 Other Imminent Hazards

Sewage backup, flooding, fire, and similar events make the space unsafe for food.

- Cease operations in the affected area.
- Notify the Executive Chef, RDO, and the local health department.
- Discard all exposed food.
- Clean and sanitize affected areas. Do not reopen without approval.

# 06 Returning to Operation

- Verify refrigeration is back at temperature.
- Confirm the water supply is potable.
- Clean, sanitize, and restock as needed.
- The Executive Chef documents the event and signs off before reopening.

# Related Documents

Documents this references or governs. Cross-references use the Document ID, which resolves to the current version.

| Document ID | Title | Status |
|---|---|---|
| SOP-008 | Food Safety Management | Live |
| SOP-002 | Safety and Incident Management (§07.4 Suspected Foodborne Illness) | Live |
| TPL-018 | Daily Food Safety Log | Live |
| SOP-002 | Safety and Incident Management | Live |

---
### TPL-019 - Master Cleaning Schedule

**Status:** In Build | **Version:** 1.0 | **Owner:** Director of Culinary | **Approver:** SLT + Director of Culinary | **Shelf:** Safety

> **Resolution note.** SourceGoverns expanded: 1 | Example blocks marked: 4

> This document derives from SOP-008 §10. Where the two differ, SOP-008 governs.


# What This Is

> ANCHOR: This is the floor, not the ceiling. Every task and frequency here is a minimum for every KitchFix kitchen. Clean more often when conditions require it - never less.

This document sets the minimum cleaning expectations for every KitchFix account - what gets cleaned, how often, and who owns it. It is not an exhaustive, per-station list. It is the baseline every kitchen meets and builds on: each site turns it into its own working schedule by adding the specific equipment, stations, and shift structure of that kitchen.

This schedule sets the cadence. The methods behind it - sanitizer concentrations, warewashing, and chemical handling - are defined in SOP-008 §10 (Cleaning, Sanitizing and Warewashing). Use the two together.

## The Expectations

- **Frequencies are minimums** - clean more often when conditions require it. Cleaning less often than listed is non-compliant.
- **Add, never subtract** - sites add rows for their own equipment and stations. No task on this floor is removed.
- **The Executive Chef owns the site build** - the EC adapts this into the account's working schedule and keeps it current as equipment and stations change.
- **Assigned, initialed, dated** - every task is assigned to a role. Whoever completes it initials and dates the Done box.
- **Verified weekly** - the Executive Chef verifies completion each week. Missed tasks are corrected, not carried forward.
- **Part of inspection readiness** - a current, initialed schedule is checked on CHK-003 Health Inspection Readiness and supports the Daily Food Safety Log (TPL-018).

# The Schedule

## The Minimum Schedule

The frequencies below are the company minimum. The example row shows how to record a completed task. Add your site's own equipment and stations beneath each section.

### Daily

| Area / Item | Task and method | Responsible | Done (initial / date) |
|---|---|---|---|
| 
> [EXAMPLE - not policy text]
>
> Floors (example)
> [/EXAMPLE]
 | 
> [EXAMPLE - not policy text]
>
> Sweep and mop all kitchen floors
> [/EXAMPLE]
 | 
> [EXAMPLE - not policy text]
>
> Closing cook
> [/EXAMPLE]
 | 
> [EXAMPLE - not policy text]
>
> J.S. / 6-12
> [/EXAMPLE]
 |
| Work surfaces and boards | Wash, rinse, sanitize between tasks and at close | All |  |
| Hand sinks | Clean; restock soap and towels | Closing cook |  |
| Line equipment | Clean grill, flat top, fryer after service | Line cook |  |
| Steam table / hot wells | Empty, clean, sanitize | Line cook |  |
| Trash | Empty, reline, clean cans; tidy dumpster area | Dishwasher |  |

### Weekly

| Area / Item | Task and method | Responsible | Done (initial / date) |
|---|---|---|---|
| Reach-in coolers / freezers | Empty, clean, sanitize interior; check gaskets | Sous chef |  |
| Walls and backsplashes | Clean splash zones | Closing cook |  |
| Hood filters | Degrease (or per site schedule) | Sous chef |  |
| Storage shelving | Wipe down; rotate stock | Cook |  |
| Floor drains | Clean and flush | Dishwasher |  |
| Ice machine exterior and scoop holder | Clean and sanitize | Cook |  |

### Monthly

| Area / Item | Task and method | Responsible | Done (initial / date) |
|---|---|---|---|
| Walk-in cooler / freezer | Deep clean floors, shelving, fan covers | Sous chef |  |
| Dry storage | Empty, clean shelves, check for pests, rotate | Cook |  |
| Equipment deep clean | Disassemble and clean ovens, mixers, slicers | Sous chef |  |
| Ice machine interior | Clean and sanitize per manufacturer | Sous chef |  |

### Periodic / Quarterly

| Area / Item | Task and method | Responsible | Done (initial / date) |
|---|---|---|---|
| Hood and duct system | Professional cleaning | Exec Chef / vendor |  |
| Pest-control deep service | Licensed PCO service | Exec Chef schedules |  |
| Thermometers | Verify calibration of all probe thermometers | Sous chef |  |
| Grease trap | Service | Exec Chef / vendor |  |
| Walls, ceilings, fixtures | Deep clean full kitchen | Team |  |

# Related Documents

Documents this references or governs. Cross-references use the Document ID, which resolves to the current version.

| Document ID | Title | Status |
|---|---|---|
| SOP-008 | Food Safety Management | Live |
| SOP-012 | Pest Control and IPM | Live |
| TPL-018 | Daily Food Safety Log | Live |
| STD-001 | Documentation Format Standard | Live |

---
### CHK-003 - Health Inspection Readiness

**Status:** In Build | **Version:** 1.0 | **Owner:** Director of Culinary | **Approver:** Pending - SLT + Director of Culinary | **Shelf:** Safety

> **Resolution note.** Facts resolved: reheat_rule -> 165F within 2 hours | SourceGoverns expanded: 1

> This document derives from SOP-008. Where the two differ, SOP-008 governs.


# How to Use

## Inspection Readiness Walk-Through

> NOTE: Walk every line before an announced inspection and as a monthly self-audit. Mark each item Pass, Needs work, or N/A. For anything below standard, write the corrective action, who owns it, and the date. Any "Needs work" on a temperature, hygiene, or sanitation item is a priority fix before the next service.

## Approved Sources and Receiving

| Check item | Pass | Needs work | N/A | Corrective action |
|---|---|---|---|---|
| Deliveries are from approved suppliers only - no food from unapproved sources. | ☐ | ☐ | ☐ |  |
| Cold TCS food received 41F or below; frozen received frozen. | ☐ | ☐ | ☐ |  |
| Product inspected at receiving - temperature, dates, packaging, signs of pests. | ☐ | ☐ | ☐ |  |
| Damaged or out-of-temp deliveries rejected and documented. | ☐ | ☐ | ☐ |  |

## Storage, Date Marking and Thawing

| Check item | Pass | Needs work | N/A | Corrective action |
|---|---|---|---|---|
| Raw animal foods stored below ready-to-eat foods. | ☐ | ☐ | ☐ |  |
| Food stored 6" off the floor, covered, and labeled. | ☐ | ☐ | ☐ |  |
| Date marking present; nothing past the 7-day use limit. | ☐ | ☐ | ☐ |  |
| FIFO followed; no expired product in use. | ☐ | ☐ | ☐ |  |
| Thawing by an approved method (cooler, under running water, or as part of cooking). | ☐ | ☐ | ☐ |  |

## Cooking, Cooling and Reheating

| Check item | Pass | Needs work | N/A | Corrective action |
|---|---|---|---|---|
| Cook temperatures met and verified with a thermometer. | ☐ | ☐ | ☐ |  |
| Cooling follows 135 to 70F in 2 hrs / 70 to 41F in 4 hrs and is logged. | ☐ | ☐ | ☐ |  |
| Cooling method is correct - shallow pans or ice bath, not deep covered containers. | ☐ | ☐ | ☐ |  |
| Reheating reaches 165F within 2 hours. | ☐ | ☐ | ☐ |  |

## Holding and Time as a Public Health Control

| Check item | Pass | Needs work | N/A | Corrective action |
|---|---|---|---|---|
| Hot-held food 135F or above; cold-held food 41F or below. | ☐ | ☐ | ☐ |  |
| Holding temperatures logged. | ☐ | ☐ | ☐ |  |
| Any time-controlled (TPHC) items are time-marked and discarded at the limit. | ☐ | ☐ | ☐ |  |

## Thermometers and Calibration

| Check item | Pass | Needs work | N/A | Corrective action |
|---|---|---|---|---|
| Calibrated probe thermometers available and in use. | ☐ | ☐ | ☐ |  |
| Calibration logged; thermometers calibrated after any drop or temperature shock. | ☐ | ☐ | ☐ |  |
| Thermometers cleaned and sanitized between uses. | ☐ | ☐ | ☐ |  |

## Cross-Contamination and Allergens

| Check item | Pass | Needs work | N/A | Corrective action |
|---|---|---|---|---|
| Separate equipment and utensils for raw and ready-to-eat foods. | ☐ | ☐ | ☐ |  |
| Allergen labeling present at every meal period. | ☐ | ☐ | ☐ |  |
| Surfaces cleaned and sanitized between tasks; utensils stay with their pan. | ☐ | ☐ | ☐ |  |
| Allergen storage protocol followed (allergen-containing below allergen-free). | ☐ | ☐ | ☐ |  |

## Cleaning, Sanitizing and Warewashing

| Check item | Pass | Needs work | N/A | Corrective action |
|---|---|---|---|---|
| Sanitizer at the correct concentration; test strips available and used. | ☐ | ☐ | ☐ |  |
| Three-compartment sink or dish machine working at the correct temperature/concentration. | ☐ | ☐ | ☐ |  |
| Wiping cloths held in sanitizer between uses. | ☐ | ☐ | ☐ |  |
| Master Cleaning Schedule (TPL-019) current and initialed. | ☐ | ☐ | ☐ |  |
| Chemicals labeled and stored away from food and food-contact surfaces. | ☐ | ☐ | ☐ |  |

## Personal Hygiene and Employee Health

| Check item | Pass | Needs work | N/A | Corrective action |
|---|---|---|---|---|
| Handwashing sinks stocked (soap, towels, hot water) and accessible - not blocked. | ☐ | ☐ | ☐ |  |
| Staff washing hands at the right times. | ☐ | ☐ | ☐ |  |
| No bare-hand contact with ready-to-eat food. | ☐ | ☐ | ☐ |  |
| Health Reporting Agreements (FORM-008) on file; no ill staff working. | ☐ | ☐ | ☐ |  |
| Clean uniforms, hair restraints, no prohibited jewelry per standard. | ☐ | ☐ | ☐ |  |

## Facility, Water and Pest

| Check item | Pass | Needs work | N/A | Corrective action |
|---|---|---|---|---|
| Facility clean and in good repair. | ☐ | ☐ | ☐ |  |
| No signs of pests; monitoring devices in place; service reports on file. | ☐ | ☐ | ☐ |  |
| Water supply potable; no plumbing cross-connections; no leaks. | ☐ | ☐ | ☐ |  |
| Restrooms clean, stocked, and functioning. | ☐ | ☐ | ☐ |  |

## Documentation and Logs

| Check item | Pass | Needs work | N/A | Corrective action |
|---|---|---|---|---|
| Daily Food Safety Log (TPL-018) complete and current. | ☐ | ☐ | ☐ |  |
| Permits and licenses posted and current. | ☐ | ☐ | ☐ |  |
| ServSafe / food-handler certifications current for the team. | ☐ | ☐ | ☐ |  |
| Corrective actions documented and closed. | ☐ | ☐ | ☐ |  |

# Readiness Summary

## Readiness Summary and Sign-Off

Total the "Needs work" items below. Any temperature, hygiene, or sanitation item not at standard is corrected before the next service; the rest are assigned with a due date.

| Result | Count / Notes |
|---|---|
| Items reviewed |  |
| "Needs work" items |  |
| Priority (temp / hygiene / sanitation) items open |  |
| Target date to close all items |  |

> CRITICAL: If an inspector arrives: notify the Executive Chef immediately, be cooperative and professional, accompany the inspector, take your own notes, correct what you can on the spot, and document every finding. The Executive Chef owns the response and any follow-up corrective action.

## Sign-Off

- Person in Charge (name)
- Date
- Person in Charge (signature)
- Executive Chef (name)
- Date
- Executive Chef (signature)

# Related Documents

Documents this references or governs. Cross-references use the Document ID, which resolves to the current version.

| Document ID | Title | Status |
|---|---|---|
| SOP-008 | Food Safety Management | Live |
| TPL-018 | Daily Food Safety Log | Live |
| TPL-019 | Master Cleaning Schedule | Live |
| FORM-008 | Health Reporting Agreement | Live |
| STD-001 | Documentation Format Standard | Live |

---
### PB-006 - Culinary OS Handbook

**Status:** Placeholder | **Version:** - | **Owner:** Director of Culinary | **Approver:** SLT + Director of Culinary | **Shelf:** Culinary | **in_corpus:** no

> **DELIVERED BY BRITT, not for review.** This Placeholder catalog row is awaiting the Culinary OS Handbook hand-off from Britt (~90% built). Included so the packet is complete and Britt sees what is open on her side.

# Placeholder (catalog row only)

Frontmatter-only stub for PB-006. Culinary OS Handbook awaiting delivery from Britt (~90% built). Closes the company-identity / Latin-cuisine gap and is the target of PB-001 section 03's culinary cross-reference.

This document has no body content. The catalog row exists so cross-references resolve and the dependency graph stays complete. Excluded from the SousAI corpus.

---
## Section 2 - Counsel

Counsel review set. Every doc with Counsel in the approver field after the F6.6 sign-off-path correction. Includes the universal policies + the docs where state annexes or legal-language passes were flagged in the register. State annexes (POL-008, POL-015) and the records-retention policy are drafted separately as samples; the bodies below are the universal-applicability content already in repo.

### POL-001 - Employee Concerns Policy

**Status:** In Build | **Version:** 1.0 | **Owner:** People Operations | **Approver:** SLT + Counsel | **Shelf:** HR & People

# 01 Purpose and Scope

KitchFix is committed to a workplace where every employee can raise a concern without fear of retaliation. This Policy defines what that means in practice.

> ANCHOR: An employee who has a concern and says nothing is a problem waiting to happen. An employee who raises a concern through the right channel is doing exactly what we ask. This Policy exists to protect that.

This Policy applies to all KitchFix employees regardless of role, employment type, or account. It covers concerns related to:

- Harassment - including sexual harassment, discriminatory harassment, and hostile work environment conduct
- Discrimination - treatment that differs based on a protected characteristic (race, color, religion, sex, national origin, age, disability, or any other status protected by law)
- Retaliation - adverse action taken against an employee for raising a concern in good faith
- Wage disputes - concerns about pay, hours recorded, or deductions
- Workplace safety - unsafe conditions, equipment, or practices that have not been addressed through normal channels

This Policy does not replace the day-to-day coaching and feedback process. Performance concerns, conduct issues, and policy violations are governed by SOP-004 Formal Disciplinary Process. This Policy governs concerns that an employee raises about how they are being treated or about conditions in the workplace.

> NOTE: This Policy is not a contract of employment. It does not alter the at-will employment relationship. KitchFix retains the right to make employment decisions at any time, consistent with applicable law.

# 02 How to Raise a Concern

Employees have a clear path to raise any concern. Start at Step 1 and move up only if needed.

> ANCHOR: You will never be penalized for raising a concern in good faith. You may be held accountable if you raise a concern you know to be false. Those are two different things.

| Step | Go To | When |
|---|---|---|
| 1 | Direct Manager | First step for most concerns. Raise it directly. |
| 2 | RDO or People Operations | If you are not comfortable going to your direct manager, or if the concern involves your direct manager. |
| 3 | VP of Operations or Senior Director of Operations | If Steps 1 and 2 have not resolved the concern, or if the concern involves HR or the RDO. |

Employees may skip Step 1 or Step 2 at any time if the concern directly involves the person at that level, or if there is a reason they genuinely cannot approach that person. No employee is required to raise a concern with someone who is the subject of that concern.

> NOTE: People Operations contact: Mariela Chavez or through your RDO. VP of Operations: Joe Lessard. Senior Director of Operations: Kevin Fietek.

# 03 What Happens After a Concern Is Raised

Every concern raised under this Policy is taken seriously. The process is straightforward.

## Acknowledgment

The person receiving the concern acknowledges it promptly - typically within one to two business days. For urgent situations involving safety or ongoing harassment, the response is immediate.

## Review

People Operations, or the designated reviewer, looks into the concern. What this looks like depends on the nature of the concern. It may involve a conversation with the employee who raised it, conversations with others involved, a review of records, or some combination. The reviewer keeps the concern confidential to the extent possible while still being able to address it effectively.

Not every concern results in a formal investigation. Some concerns are resolved through a conversation, a process change, or a clarification. The goal is to address the concern appropriately, not to escalate every situation into a formal proceeding.

## Outcome

The employee who raised the concern is informed of the outcome to the extent appropriate. There are situations where the outcome involves personnel actions that cannot be disclosed - in those cases, the employee is told that the concern was reviewed and addressed, even if the specific action cannot be shared.

> NOTE: Timeframes are not fixed. KitchFix commits to addressing concerns promptly and thoroughly. A simple concern may resolve in a day. A more complex investigation may take longer. If your concern is taking more time than you expected, you may follow up with People Operations at any time.

# 04 Confidentiality

Concerns raised under this Policy are handled with discretion.

Information about a concern is shared only with those who need to know in order to address it. This typically means People Operations, the relevant member of SLT, and - where necessary - the person the concern is about (so they can respond).

Complete confidentiality cannot always be guaranteed. If a concern involves a legal obligation to act - for example, a mandatory reporting requirement, a safety emergency, or a legal proceeding - information may be disclosed beyond the normal circle. People Operations will tell the employee when this is the case.

Employees who raise concerns are asked to keep the matter confidential as well. Discussing an open concern broadly in the workplace can interfere with the review process and is not in anyone's interest.

# 05 No Retaliation

Retaliation against an employee for raising a concern in good faith is prohibited. This section explains what that means for managers.

> ANCHOR: If an employee raises a concern and something bad happens to them at work shortly after - a schedule cut, a poor review, a write-up, a termination - that sequence will be scrutinized. Managers need to understand this.

## What Retaliation Is

Retaliation is any adverse action taken against an employee because they raised a concern, participated in a review of a concern, or supported another employee who did. It does not have to be intentional to be retaliation - the effect is what matters.

Examples of retaliation include:

- Reducing an employee's hours or removing them from desirable shifts after they raise a concern
- Giving a negative performance review or written warning shortly after a concern is raised, without documented cause that predates the concern
- Excluding an employee from team activities, communications, or opportunities after they raise a concern
- Creating a hostile or uncomfortable work environment for the employee after they raise a concern
- Terminating an employee in proximity to a raised concern without clear, documented, pre-existing cause

## What Retaliation Is Not

Legitimate management action is not retaliation. If an employee raises a concern and also has a documented performance or conduct issue that predates the concern, that issue can still be addressed through SOP-004. The fact that an employee raised a concern does not shield them from accountability for separate, legitimate issues.

The key distinction is timing and documentation. If the issue existed before the concern was raised and is properly documented, addressing it is not retaliation. If the issue appeared for the first time after the concern was raised, it will be scrutinized.

> CRITICAL: Retaliation against an employee for raising a concern is a serious violation and subject to disciplinary action up to and including termination - regardless of the manager's seniority or tenure. If you are unsure whether an action you are considering could be seen as retaliation, contact People Operations before you take it.

## Manager Obligations

- If an employee on your team raises a concern - to you or through another channel - you are required to notify People Operations.
- You may not take any adverse action against that employee without People Operations review until the concern is resolved.
- You may not discuss the concern with other team members.
- You may not ask the employee to withdraw the concern or discourage them from pursuing it.

# 06 Good Faith Requirement

This Policy protects employees who raise concerns honestly. It does not protect concerns raised with the intent to harm or deceive.

An employee who raises a concern that they know to be false, or who provides materially false information during a review, may be subject to disciplinary action. This is not about being wrong - an employee can raise a concern in good faith and have the facts turn out differently than they believed. Good faith means the employee genuinely believed the concern was legitimate when they raised it.

> NOTE: The good faith requirement is not a reason to hesitate before raising a concern. If you believe something is wrong, raise it. The standard is honesty, not certainty.

# Related Documents

Documents referenced in or governing this Policy.

| Document ID | Title | Status |
|---|---|---|
| STD-001 | Documentation Format Standard | Live (v1.0) |
| AGR-001 | The Big Rules · Confidentiality Agreement | Live |
| SOP-002 | Safety & Incident Management | Live (v2.1) |
| SOP-004 | Formal Disciplinary Process | Live (v1.0) |
| PB-004 | Hourly OS Handbook | Live (v1.0) |

---
### POL-002 - Appearance & Dress Code Policy

**Status:** In Build | **Version:** 1.3 | **Owner:** People Operations | **Approver:** People Operations + Counsel | **Shelf:** HR & People

> **Resolution note.** Facts resolved: brand_promise -> Best Food, Best Service, Best Hospitality

# 01 Purpose and Scope

This Policy governs the personal appearance, hygiene, and uniform standards for all KitchFix employees across every account and contract type.

> ANCHOR: A group in uniform represents a team. Our appearance is an extension of our Hospitality Promise - Best Food, Best Service, Best Hospitality - and every employee is responsible for upholding it from arrival to departure on client property.

## Who This Policy Applies To

This Policy applies to all KitchFix employees regardless of role, employment type, contract type, or account - full-time, part-time, and seasonal. It is in effect from the moment an employee arrives on client property until departure. Dress code and appearance standards are non-negotiable - they exist to protect food safety, reflect our professionalism, and honor the trust our clients place in us.

## Policy Delivery and Receipt

This Policy is distributed to all employees at onboarding, prior to their first shift on client property. Receipt is confirmed through the KitchFix onboarding checklist. Employees are responsible for reading and understanding this Policy before reporting to work. Managers are responsible for ensuring every member of their team has received this Policy at the start of each season.

> NOTE: A Spanish-language summary of this Policy is available from People Operations upon request. Para solicitar una copia en español, comúníquese con People Operations.

## Scope: What Is Client Property

For the purposes of this Policy, "client property" means all areas within or associated with a KitchFix-operated account, including kitchens, dining rooms, back-of-house areas, loading docks, employee entrances, locker rooms, and parking lots. The Policy is in effect from the moment an employee passes through the security gate or entrance point of the client facility.

All employees are expected to arrive on client property already in full, compliant uniform. Changing into uniform on-site is not permitted unless a designated changing area is provided by the client and pre-approved by the site manager. Where on-site changing is approved, employees must be in full compliant uniform before entering any client-facing or food preparation area.

> NOTE: For approved apparel items by category, vendor, color, and procurement process, see REF-002 Uniform Standards Catalog.

# 02 Personal Appearance and Hygiene

All employees must be clean, well-groomed, and compliant with these standards at all times on client property.

> ANCHOR: Food safety and client impression are both at stake. These are not preferences - they are requirements enforced by state and local health codes and by KitchFix operating standards.

## Hair

- Hair must be clean and neatly groomed at all times.
- Long hair must be fully pulled back and secured.
- A branded KitchFix hat or approved team hat is required for all guest-facing roles. A hat, headband, or hairnet is required for all BOH roles.
- Facial hair must be clean and neatly groomed.

## Hands and Nails

- Hands and nails must be clean and well-maintained at all times.
- Fingernails may not extend past the fingertip.
- When handling food, nail polish of any kind (including clear), false nails, and nail adornments are prohibited.

## Personal Hygiene

- Employees must maintain personal hygiene standards that ensure they do not present an odor that affects the guest experience or workplace environment.
- No cologne, perfume, scented after-shave, or scent of any kind is permitted. Scents interfere with food quality and the client experience.
- No headphones or earbuds at any time on client property. This is a food safety issue and a client service standard.

## Jewelry and Body Modifications

- No jewelry is permitted while working, with one exception: a single wedding band is allowed.
- Visible tattoos are permitted provided they are not offensive, obscene, or discriminatory. KitchFix reserves the right to determine whether a tattoo meets this standard in the context of the client environment.
- Visible facial piercings other than small stud earrings are not permitted in guest-facing roles. BOH roles follow applicable food safety requirements - any piercing that presents a contamination risk must be removed or covered.

## Handwashing

All employees must wash hands thoroughly with soap and hot water after using the restroom and at all required intervals per food safety standards.

> NOTE: Employees who require an accommodation to this Policy based on a medical condition or sincerely held religious belief should contact People Operations before their first shift. Accommodations are evaluated individually and documented.

# 03 Dress Code - General Rules

The uniform policy applies to all employees at all accounts. Every employee is responsible for their uniform being complete, clean, and presentable at all times.

"Well-fitted" means clothing that fits the body without being tight or restrictive, does not sag or expose skin when the employee is in motion, and does not create a safety hazard. In kitchen environments, sleeves must not hang loose over open flames or equipment. When in doubt, err toward a closer fit.

A uniform is considered compliant when it is free of visible stains, tears, fraying, fading, or odor that a client or guest would notice. The site manager is the final authority on whether a uniform item has deteriorated past acceptable standard and may require an employee to replace an item before service.

## Hats

The standard hat is a KitchFix-branded hat. Where the account has a team hat program, an officially licensed MLB hat for the team being served is acceptable in any official design. Any other hat must bear an official team logo and must be free of studs, frills, or embellishments that can detach.

> NOTE: Managers purchase the first hat for each employee. Subsequent hats are purchased by the employee, or by management with approval.

## Team Apparel (MLB Gifted Items)

Client teams may gift KitchFix employees apparel items. Gifted team apparel is subject to the following rules:

- Gifted team apparel may be worn on Manager-approved Team Days only.
- Team Days must be planned and communicated in advance by the site manager.
- Team apparel is only permitted if explicitly allowed by the client or operation.
- Team apparel is permitted on off-service days and non-guest-facing prep days without prior approval.

## Client-Specific Requirements

Some KitchFix accounts operate under client appearance requirements that are more restrictive than this Policy. Where a client SLA or client directive specifies a stricter appearance standard, that standard applies and supersedes the relevant provision of this Policy for employees at that account. The site manager is responsible for communicating client-specific requirements to their team at onboarding and at the start of each season.

> NOTE: Client appearance requirements are documented in the account SLA. If a client introduces a new requirement mid-season, notify the RDO and People Operations immediately so the SLA can be updated.

## Travel and Off-Site Representation

When traveling on behalf of KitchFix, moving between accounts during the season, or representing the company at external events, employees are expected to maintain a professional appearance consistent with this Policy. Wearing KitchFix-branded apparel in public is a brand impression - conduct and appearance reflect on the company.

## General Apparel Standards

- Neutral colors are the default. Plain or team-logo apparel is approved. No extra designs, frills, studs, or jewels.
- All clothing must be well-fitted per the definition above. No loose, baggy, ripped, acid-washed, or embellished garments.
- Substitutions or additions to the standard uniform are not permitted without prior approval from the site manager or Operations.

# 04 Uniform Standards by Role

Each role has a defined uniform. The table below specifies required items per role. For vendor, color, and procurement detail, see REF-002.

## FOH / Service Associate

| Item | Requirement |
|---|---|
| Shoes | Black, close-toed, non-slip. No sandals or raised heels. |
| Pants | Black or dark blue. Well-fitted (see §03). No rips, designs, acid-wash, or embellishments. Dark-colored jeans acceptable. |
| Shirt | KitchFix Polo or approved team polo (navy, grey, or team color with KitchFix logo). |
| Hat | KitchFix hat or officially licensed team hat. See §03 for hat guidelines. |
| Headband | Neutral color or official team logo in team or neutral color. |
| Apron | Clean black apron at all times. |
| Name Tag | Required. Worn visibly at all times during service. FOH only - see note below. |
| Team Apparel | Approved Team Days only. See §03. |

> NOTE: Name tags are FOH only. BOH associates do not wear name tags due to food safety and cross-contamination risk.

## BOH / Kitchen Associate - Guest Facing

| Item | Requirement |
|---|---|
| Shoes | Black, close-toed, non-slip. No sandals or raised heels. |
| Pants | Dark or dark blue. Well-fitted (see §03). No rips, designs, or embellishments. Dark jeans acceptable. |
| Undershirt | Plain white or black. No design. |
| Chef Coat / Cook Shirt | KitchFix-provided only. No personal coats permitted. |
| Hat | KitchFix hat or officially licensed team hat. See §03. |
| Headband | Neutral color or official team logo in team or neutral color. |
| Apron | Clean black apron at all times. |
| Team Apparel | Approved Team Days only. See §03. |

## BOH / Kitchen Associate - Commissary (Non-Guest Facing)

Commissary kitchens are not connected to client-facing dining rooms. Employees working exclusively in commissary environments may follow the standards below. If an employee moves between a commissary and a guest-facing kitchen during the same shift, the guest-facing standard applies for the entire shift.

| Item | Requirement |
|---|---|
| Shoes | Black, close-toed, non-slip. No sandals or raised heels. |
| Pants | Dark (black preferred). Well-fitted (see §03). No rips, designs, or embellishments. Dark jeans acceptable. |
| Undershirt | Plain white or black. No design. |
| Chef Coat / Cook Shirt / T-Shirt | Chef coat, cook shirt, or plain T-shirt. If T-shirt, must be plain - no designs, frills, studs, or jewels. |
| Hair Covering | Required. Clean, intact hat of choice, headband, or hairnet. |
| Apron | Clean black apron at all times. |

## Sous Chef and Executive Chef

| Item | Requirement |
|---|---|
| Shoes | Black, close-toed, non-slip. No sandals or raised heels. |
| Pants | Black or dark blue. Well-fitted (see §03). No rips, designs, or embellishments. Dark jeans acceptable. |
| Undershirt | Plain white or black. No design. |
| Chef Coat | Chefworks branded chef coat in white, grey, or black. Chef selects their preferred style within this spec. For SKU and ordering, see REF-002. |
| Hat | KitchFix hat or officially licensed team hat. See §03. |
| Headband | Neutral color or official team logo in team or neutral color. |
| Apron | Clean black apron at all times. |

# 05 Uniform Provisioning

KitchFix provides a defined set of uniform items at hire. Employees are responsible for their own footwear, pants, undershirts, and personal care items.

## KitchFix-Provided Items

- FOH Managers: KitchFix Polo x3, KitchFix Hat x1, Team Hat x1 or Headband x1, Hair Tie x1, Name Tag x1, Apron.
- FOH Associates: KitchFix Shirt x3, KitchFix Hat or Team Hat x1, Name Tag x1, Apron.
- BOH Kitchen Associates: Chef Coat x3, KitchFix Hat or Team Hat x1, Apron. Provided at hire; refreshed periodically based on condition and operational need.
- Sous Chef / Executive Chef: Branded embroidered Chefworks chef coat x3, KitchFix Hat or Team Hat x1, Apron. Provided at hire; refreshed periodically based on condition and operational need.

## Employee-Provided Items

- Non-slip shoes (black). Available through Shoes for Crews corporate account at a discount. Employees may purchase their own provided they meet the specification.
- Socks, undershirts, undergarments, and pants.

## Uniform Maintenance Responsibility

KitchFix-provided items laundered through the company linen program are KitchFix's responsibility for condition. If an item returned from the linen rotation is stained, damaged, or otherwise non-compliant, the site manager reports it to Operations for replacement. Items that employees launder personally are the employee's responsibility for condition.

## Uniform Storage

Each account provides a designated area for uniform storage and personal item security. Specific storage arrangements vary by site and are communicated by the site manager at onboarding. Employees are responsible for keeping their assigned storage area clean and organized.

## Lost or Damaged Items

KitchFix will replace a lost or damaged uniform item on the first occurrence at no cost to the employee. The site manager coordinates the replacement through the standard procurement process. Recurring loss or damage of uniform items is subject to corrective action under the KitchFix disciplinary process.

> NOTE: For procurement details and vendor information, see REF-002 Uniform Standards Catalog.

## End of Season

Employees retain their KitchFix-provided uniform items at the end of each season. Uniforms are not collected or returned. Employees returning for the following season are responsible for assessing the condition of their existing uniform items and notifying their manager if replacements are needed before the start of the new season.

# 06 Compliance and Enforcement

Compliance with this Policy is a condition of employment. Standards are enforced consistently across all accounts and roles.

> ANCHOR: Showing up out of uniform is not a minor issue. It reflects on the team, the account, and KitchFix's relationship with our clients. Managers are expected to address it immediately and consistently.

## Non-Compliance

Employees who arrive on client property out of compliance with this Policy may be sent home to correct their appearance before beginning their shift. Repeated or willful non-compliance is subject to progressive corrective action under the KitchFix disciplinary process, up to and including suspension or termination.

The site manager has the authority to remove an employee from service for dress code non-compliance. That decision is not subject to override by the employee during the shift. The manager documents the incident and notifies their RDO the same day.

> CRITICAL: An employee sent home for dress code non-compliance is not eligible for pay for the time missed. The manager documents the incident in writing the same day and submits the record to their RDO and People Operations.

> NOTE: Progressive corrective action follows the KitchFix Formal Disciplinary Process (SOP-004).

## Manager Responsibilities

- Conduct a uniform check at the start of every shift before employees enter client-facing areas.
- Address non-compliance immediately and consistently. Do not allow a non-compliant employee to begin service and address it later.
- Document dress code incidents in writing and notify the RDO the same day.
- Communicate client-specific appearance requirements to the team at onboarding and at the start of each season.
- Ensure every new employee receives this Policy and confirms receipt through the onboarding checklist before their first shift.

## Reporting Concerns

Employees who believe this Policy is being applied inconsistently, unfairly, or in a discriminatory manner should contact People Operations directly. Reports are reviewed and addressed confidentially. Retaliation against an employee for raising a concern about Policy application is prohibited.

> NOTE: People Operations contact: Mariela Chavez

---
### POL-003 - Drug & Alcohol Policy

**Status:** In Build | **Version:** 1.2 | **Owner:** People Operations | **Approver:** SLT + Counsel | **Shelf:** HR & People

> **Resolution note.** Facts resolved: bac_limit -> 0.08%

# 01 Purpose and Scope

KitchFix is committed to a safe, professional workplace. This Policy governs the use of alcohol, drugs, and controlled substances in connection with employment, and it acknowledges the Major League Baseball drug program that covers our people on club accounts.

> ANCHOR: We operate in high-stakes environments where impairment endangers food safety, player welfare, and the trust our clients place in us. A substance-free workplace is not optional.

This Policy applies to every KitchFix employee, regardless of role, employment type, or account. It is in effect during all working hours, on client property, and in any situation where the employee is representing KitchFix.

Compliance with this Policy is a condition of employment. Every employee is expected to read it, understand it, and follow it. Violations are handled under SOP-004 Formal Disciplinary Process, up to and including termination.

Employees assigned to a Major League, Player Development Complex (PDC), or Minor League club account carry an additional layer of obligation. Major League Baseball treats them as "Covered Individuals" under its Drug Policy and Prevention Program for Non-Playing Personnel, with their own testing and discipline that operate independent of this Policy. Sections 04 through 06 and Section 09 set out what that means.

> NOTE: This Policy is not a contract of employment and does not alter the at-will employment relationship.

# 02 Definitions

The terms below carry specific meaning throughout this Policy. Where a term is defined by an outside authority - the federal Controlled Substances Act or the MLB Program - this Policy uses that authority's definition.

| Term | Definition |
|---|---|
| Alcohol | Any beverage or substance containing ethyl alcohol (ethanol). |
| Under the Influence / Impaired | Affected by alcohol, drugs, or a controlled substance such that the ability to perform job duties safely is diminished. For alcohol, a blood alcohol concentration (BAC) of 0.08% or higher is conclusive evidence of being under the influence; a lower concentration combined with observable impairment is also a violation. |
| Controlled Substance | Any substance listed on Schedules I through V of the federal Controlled Substances Act (CSA), 21 U.S.C. § 812, as amended. |
| Illegal Drug | Any drug or controlled substance whose use, possession, sale, or distribution is unlawful under federal law, including a Schedule I or Schedule II substance used without a valid prescription. Marijuana remains a Schedule I controlled substance under federal law regardless of state legalization (see Section 05). |
| Prohibited Substance | Under the MLB Program, any Drug of Abuse, Stimulant, or Performance-Enhancing Substance the Program bans. The categories are defined and maintained by MLB, not by KitchFix. |
| Covered Individual | A KitchFix employee or independent contractor who, by holding a clubhouse position at a Major League, PDL/PDC, or Minor League club, is subject to the MLB Program. Chefs are named in the Program's mandatory-testing positions (see Section 04). |
| DPOC | MLB's Drug Policy Oversight Committee - the body that administers the MLB Program, oversees testing and treatment, and decides discipline appeals. |
| TUE | Therapeutic Use Exemption - MLB authorization to use an otherwise-Prohibited Substance under a valid, medically appropriate prescription (see Section 09). |
| NSF Certified for Sport | A certification program that verifies a supplement does not contain Prohibited Substances. It is the only supplement standard permitted in a clubhouse setting (see Section 06). |
| Reasonable Suspicion / Reasonable Cause | A belief, based on specific, articulable, observable facts (see Section 07), that an employee may be impaired or in violation of this Policy. It is a behavioral standard, not a diagnosis. |

# 03 Prohibited Conduct

The following are prohibited at all times during employment, on client property, or while performing work on behalf of KitchFix.

> CRITICAL: Reporting to work impaired by alcohol, drugs, or any controlled substance is grounds for immediate termination.

- Reporting to work under the influence of alcohol, illegal drugs, or any controlled substance.
- Consuming alcohol on client property at any time, except where explicitly permitted by the client for a specific sanctioned event and approved in advance by the VP of Operations or the Senior Director of Operations.
- Using, possessing, manufacturing, distributing, or selling illegal drugs or controlled substances on client property or during working hours.
- Misusing prescription medication in a way that impairs the ability to perform job duties safely (see Section 09).
- Operating any vehicle or equipment on behalf of KitchFix while impaired. For any employee in a driving or safety-sensitive task, a BAC of 0.08% or higher is a per se violation.
- Distributing or supplying any nutritional or dietary supplement that is not part of the club's NSF Certified for Sport program to a player or other covered individual (see Section 06).

> NOTE: Employees taking prescribed medication that may affect their ability to perform their duties safely should notify their manager before their shift. This information is kept confidential and handled through People Operations.

# 04 MLB Program - Covered Individuals

KitchFix employees who work on Major League, PDC, or Minor League club accounts are "Covered Individuals" under MLB's Drug Policy and Prevention Program for Non-Playing Personnel. The Program's testing and discipline apply to them directly and independent of this Policy.

## Who Is Covered

Chefs are named in the Program's list of clubhouse positions subject to mandatory testing. KitchFix culinary and clubhouse staff assigned to a club account fall within "Chefs" and similar positions, which makes them Covered Individuals for as long as they hold that assignment. The Program reaches full-time and part-time staff alike.

## Testing

- Random testing - All Covered Individuals are subject to random, unannounced testing during the season, as set by the Program.
- Mandatory testing - Covered Individuals in the listed clubhouse positions, including Chefs, receive unannounced testing on dates the Program sets.
- Who collects - Specimen collection and laboratory analysis are handled by the Program's designated collectors and accredited laboratory.
- What is tested - Testing covers all Drugs of Abuse, Stimulants, and Performance-Enhancing Substances prohibited under the Program. The Program also provides for reasonable-cause testing and follow-up testing after a violation.

## Consent and Acknowledgment

- Each season, Covered Individuals receive an electronic Consent and Acknowledgment of Drug Testing form through the club's Background Information Gateway System (BIGS) after the club submits its updated personnel list.
- The form must be signed electronically and returned by the deadline stated on the form.
- This is required every season, even for an employee who signed in a prior season.
- KitchFix employees must complete the form whenever their club issues it. Refusing or failing to return it is itself a Program violation.

## Discipline Under the Program

Discipline under the Program is decided by the MLB Commissioner and is separate from any KitchFix action (see Section 08 for how the two consequences run side by side).

- Performance-Enhancing Substances, or distribution/sale of a Drug of Abuse or Stimulant - Suspension up to permanent expulsion from baseball, at the Commissioner's discretion, as the Program directs.
- Use or possession of a Drug of Abuse or Stimulant - Assessed by the Commissioner case by case, with evaluation and treatment as the Program directs.
- Refusal, failure to appear, or tampering - Treated as a positive test under the Program.

> CRITICAL: Refusing a test, failing to appear for a scheduled test, or tampering with a specimen is treated as a positive test result under the MLB Program.

> NOTE: The summaries in this section are provided for awareness. The governing text is MLB's Drug Policy and Prevention Program for Non-Playing Personnel and related MLB policies as issued by the Office of the Commissioner. Where this Policy and an MLB policy differ, the MLB policy controls for matters within its scope.

# 05 Marijuana and Alcohol Conduct

MLB maintains a separate Policy on Marijuana and Alcohol-Related Conduct for Non-Playing Personnel. Certain conduct triggers an automatic referral to the DPOC, independent of any drug test.

## Automatic DPOC Referral Triggers

A Covered Individual is automatically referred to the DPOC in any of the following circumstances:

- Arrest or charge for driving while intoxicated or under the influence of marijuana and/or alcohol, or any other criminal violation involving the use or possession of marijuana and/or alcohol.
- Arrest or charge for a criminal violation in which marijuana and/or alcohol use may have been a contributing factor.
- Appearing intoxicated or under the influence of marijuana and/or alcohol during any club game, practice, workout, or meeting, or while in club facilities.
- Club medical personnel reasonably suspecting a marijuana and/or alcohol use problem.
- Being found to have used marijuana in a prohibited location, including a club hotel or other club property.

## What a Referral Means

- A referred individual must complete an in-person evaluation by a DPOC-approved, independent addiction specialist within 30 days of the referral.
- The evaluation is mandatory. Participation in any recommended Treatment Program is voluntary, but voluntary participation is treated as a mitigating factor in MLB discipline.

> NOTE: Marijuana, federal vs. state. Even where state law permits marijuana - including Illinois - it remains a Schedule I controlled substance under federal law and is prohibited under this Policy on client property and during work. MLB addresses marijuana through this separate marijuana and alcohol policy, not through the standard testing program.

# 06 Nutritional Supplements Protocol

Supplements are a positive-test risk for the people we serve. The KitchFix protocol is simple and absolute: we do not procure, stock, prepare, or distribute supplements of any kind.

> CRITICAL: KitchFix does not supply supplements. If a product is not part of the client's NSF Certified for Sport program, it does not get prepared, served, or handed to anyone.

## The KitchFix Position

KitchFix does not buy, store, prepare, serve, or hand out any nutritional or dietary supplement, functional-food supplement, powder, or energy product. Any such product present in a clubhouse setting is supplied by the client, never by KitchFix. Our role stops at food.

## Why

The supplement industry is not tightly regulated. Products can be mislabeled or contaminated with a Prohibited Substance that is not listed on the label. A Covered Individual can test positive from a supplement without ever knowing it contained a banned substance - and under the MLB Program that still counts as a positive test.

Only supplements certified under the NSF Certified for Sport program are permitted in a clubhouse. That certification verifies the product contains no Prohibited Substances. Clients supply only NSF Certified for Sport products.

## Staff Rules

- Do not bring personal supplements into a club kitchen or clubhouse.
- Do not prepare, plate, or serve any supplement, powder, or additive that is not part of the client-directed, NSF-certified program.
- Do not give any supplement to a player or other covered individual. Distributing a non-certified product that results in a positive test exposes the individual to discipline and the club to a fine.
- Route any supplement question to the club dietitian and your Executive Chef. Never improvise.

# 07 Manager Responsibilities

Managers maintain a substance-free environment and act on observable impairment. They do not diagnose impairment or confirm substance use - observable behavior and reasonable cause are the standard.

## Reasonable Suspicion - What to Look For

Reasonable suspicion rests on specific, observable facts. The following behaviors, especially in combination or when inconsistent with the employee's norm, can establish it:

- Slurred, incoherent, or rambling speech.
- Unsteady gait, stumbling, or loss of balance or coordination.
- The odor of alcohol or marijuana on the breath, person, or clothing.
- Bloodshot, glassy, or watery eyes, or dilated or constricted pupils.
- Erratic, aggressive, euphoric, or unusually drowsy behavior out of character for the employee.
- Tremors, sweating, or a flushed appearance not explained by kitchen conditions.
- Confusion, impaired judgment, or inability to follow routine instructions.
- Possession of alcohol, drug paraphernalia, or a controlled substance.

## When You Have Reasonable Suspicion

- Remove the employee from service immediately and privately.
- Contact the Regional Director and People Operations the same day.
- Document the observable behaviors - what you saw and heard, not what you concluded - on FORM-004 (Written Warning) or FORM-006 (Separation Record) as appropriate.
- Do not allow the employee to drive if impaired. Arrange alternative transportation.
- On a club account, follow the account's protocol and your Regional Director's direction on any client notification. Managers do not initiate drug testing or contact MLB or the DPOC directly.

> NOTE: Managers should not attempt to diagnose impairment or confirm substance use. Observable behavior and reasonable cause are the standard. Document what you saw and heard, not what you concluded.

# 08 Consequences

A single violation can carry two separate consequences - KitchFix discipline and MLB Program discipline - applied independently by two different authorities.

> ANCHOR: For a Covered Individual, the same conduct can trigger KitchFix action under SOP-004 and discipline by the MLB Commissioner under the Program. The two run on separate tracks: clearing one does not clear the other.

The table below shows how common violations are handled on each track. KitchFix does not control MLB's process, and MLB does not control KitchFix's.

| Conduct | KitchFix consequence (via SOP-004) | MLB Program consequence (Commissioner) |
|---|---|---|
| Reporting to work impaired on the job | Immediate termination (Level 4) | Reasonable-cause testing; discipline at the Commissioner's discretion if a violation is found |
| Positive test - use or possession of a Drug of Abuse or Stimulant | Discipline up to and including termination, at KitchFix's discretion | Case-by-case assessment; evaluation and treatment; possible discipline |
| Positive test for a Performance-Enhancing Substance, or distribution/sale of a Drug of Abuse or Stimulant | Discipline up to and including termination, at KitchFix's discretion | Suspension up to permanent expulsion from baseball, as the Program directs. |
| Refusing a test, failing to appear, or tampering with a specimen | Serious violation; discipline up to and including termination, at KitchFix's discretion | Treated as a positive test; discipline at the Commissioner's discretion |
| Distributing a non-NSF-certified supplement that causes a positive test | Disciplinary review under SOP-004, up to and including termination, at KitchFix's discretion | Discipline of the individual; club subject to a fine set by the Program. |
| Possession, use, or distribution of illegal drugs on client property | Immediate termination | Discipline at the Commissioner's discretion; possible expulsion |
| DUI/DWI arrest, or a marijuana/alcohol conduct trigger | Disciplinary review and fitness-for-duty assessment, at KitchFix's discretion | Automatic DPOC referral; mandatory evaluation within 30 days |

## KitchFix Process

- First-time violations involving impairment on the job, or possession or distribution on client property, are treated as immediate termination (Level 4) under SOP-004.
- SOP-004 Formal Disciplinary Process governs all documentation and notification requirements.
- Employees who raise a good-faith concern about a colleague's substance use are protected from retaliation under POL-001 Employee Concerns Policy.

## Treatment and Self-Disclosure

- An employee who self-discloses a substance dependency and voluntarily seeks treatment before a policy incident occurs will be considered for accommodation under applicable law.
- Admission to, or participation in, a treatment program does not by itself excuse a policy violation or preclude disciplinary action. Self-disclosure after an incident does not retroactively change the disciplinary outcome.
- Under the MLB Program, voluntary participation in a DPOC-recommended Treatment Program is a mitigating factor in MLB discipline. Participation is the individual's choice, and KitchFix discipline proceeds on its own track.

# 09 Prescription Medication

Legal prescription use is not prohibited. Impairment from any source is.

Employees are not prohibited from taking legally prescribed medication. If a prescription medication could impair job performance - particularly in a kitchen or guest-facing environment - the employee is responsible for the following:

- Notifying their manager before their shift that they are taking medication that may affect performance.
- Consulting their healthcare provider about whether the medication is safe to use during work.
- Requesting a reasonable accommodation through People Operations if the medication creates a work limitation.

Disclosure of prescription medication is voluntary unless the employee is seeking an accommodation. Information disclosed is treated as confidential and handled through People Operations.

## Therapeutic Use Exemptions for Covered Individuals

A Covered Individual who is prescribed a substance that the MLB Program treats as a Prohibited Substance may need a Therapeutic Use Exemption (TUE). A specimen containing a Prohibited Substance is not a positive test if the individual holds a valid TUE for it.

- Apply before testing - Individuals subject to mandatory testing should apply before any test by submitting the Program's TUE request form and a copy of the prescription to MLB's Medical Representative.
- Where it goes - Dr. Bryan W. Smith, MLB Medical Representative - Bryan.Smith@mlb.com, 336-460-1935. Medical information goes to the MLB Medical Representative, not to KitchFix.
- Annual renewal - A TUE lasts up to one year and is not automatically renewed. Reapply each year if still taking the medication.

> NOTE: A state-issued medical-marijuana card does not exempt an employee from this Policy. Marijuana is addressed under the separate Marijuana & Alcohol Conduct policy (Section 05), not the TUE process.

# 10 Return to Work

An employee removed from service for a suspected violation of this Policy may not return to work until cleared by People Operations (HR).

The return-to-work determination is made by People Operations (HR) in consultation with the Site Leader and the Regional Director. Factors considered include the nature of the incident, whether it was a first occurrence, the employee's history, and the safety requirements of the role.

For a Covered Individual, return to work on a club account may also depend on the individual's standing under the MLB Program and on any club requirements. KitchFix coordinates with the account as needed, but the KitchFix return-to-work decision remains KitchFix's to make.

> NOTE: Return-to-work decisions are made by People Operations (HR) with the Site Leader and the Regional Director. Managers do not make this determination independently.

# Related Documents

Documents referenced in or governing this Policy. Cross-references use the Document ID, which resolves to the live current version.

| Document ID | Title | Status |
|---|---|---|
| STD-001 | Documentation Format Standard | Live (v1.0) |
| POL-001 | Employee Concerns Policy | Live (v1.0) |
| SOP-002 | Safety & Incident Management | Live (v2.1) |
| SOP-004 | Formal Disciplinary Process | Live (v1.0) |
| PB-004 | Hourly Employee Handbook | Live (v1.2) |
| FORM-004 | Written Warning | Referenced |
| FORM-006 | Separation Record | Referenced |
| AGR-001 | The Big Rules · Confidentiality | Live |

---
### POL-006 - Anti-Harassment Policy

**Status:** In Build | **Version:** 1.0 | **Owner:** People Operations | **Approver:** SLT + Counsel | **Shelf:** HR & People

> **Resolution note.** Facts resolved: brand_promise -> Best Food, Best Service, Best Hospitality

# 01 Purpose and Scope

KitchFix is committed to a workplace free of harassment and discrimination - for the dishwasher and the GM alike. This Policy states what is prohibited, how to raise a concern, and how KitchFix responds.

> ANCHOR: We extend the same hospitality internally that we sell externally. A team that does not feel safe and respected cannot deliver Best Food, Best Service, Best Hospitality. Harassment has no place at KitchFix - none.

This Policy applies to every KitchFix employee, at every account, on and off client property, and in all work-related settings - including travel, road days, and work communications by phone, text, or social media.

It covers harassment and discrimination between employees, by or toward leadership, and conduct involving the people we work around - players, coaches, club staff, vendors, and guests.

Every employee receives this Policy and acknowledges it through Rippling.

> NOTE: This Policy is not a contract of employment and does not alter the at-will employment relationship.

# 02 Our Commitment and Protected Characteristics

KitchFix is an equal opportunity employer committed to diversity, equity, inclusion, and creating a place of belonging.

KitchFix does not discriminate in employment opportunities or practices on the basis of race, color, religion, sex, national origin, ancestry, age, disability, sexual orientation, gender identity, marital status, military or veteran status, genetic information, or any other characteristic protected by law. Equal employment opportunity applies to all terms and conditions of employment, including hiring, placement, promotion, termination, layoff, recall, transfer, leave of absence, compensation, and training.

KitchFix expressly prohibits any form of unlawful harassment or discrimination based on any protected characteristic - whether it comes from a coworker, a supervisor, or someone we work around at a client facility.

> ANCHOR: Everyone on this team deserves to participate, contribute, and be valued for their skills, experience, and perspective. Protecting that is not optional - it is part of how KitchFix operates.

# 03 Definitions and What It Looks Like

The terms below carry specific meaning throughout this Policy. If conduct could reasonably be seen this way, treat it as covered - intent is not the test.

## Unlawful Harassment

Conduct that has the purpose or effect of creating an intimidating, hostile, or offensive work environment; that substantially and unreasonably interferes with an individual's work performance; or that otherwise adversely affects an individual's employment opportunities because of their membership in a protected class.

## Sexual Harassment

Unwelcome sexual advances, requests for sexual favors, and other verbal or physical conduct of a sexual nature where: submission to or rejection of the conduct is made, explicitly or implicitly, a term or condition of employment or a basis for employment decisions; or the conduct has the purpose or effect of unreasonably interfering with work performance or creating an intimidating, hostile, or offensive work environment.

## What It Looks Like

Harassment can be verbal, physical, visual, or electronic. Examples include, but are not limited to:

- Slurs, epithets, derogatory "jokes," or comments about a protected characteristic.
- Unwanted touching, blocking someone's movement, or physical intimidation.
- Unwelcome sexual advances or propositions, or comments about a person's body or appearance.
- Displaying or sharing offensive images, objects, or messages.
- Harassing conduct by phone, text, email, or social media - on or off the clock.

> NOTE: Conduct does not have to be aimed at you, and it does not have to be repeated. A single serious incident - or behavior that creates a hostile environment for anyone on the team - can be enough to violate this Policy.

# 04 Reporting a Concern

If you experience or witness harassment, discrimination, or retaliation, report it. The sooner KitchFix knows, the sooner we can act.

## Who to Tell

You can raise a concern with any of the following. You never have to report to the person involved, and you never have to go through your own supervisor:

- Your Site Leader, or any KitchFix manager you trust.
- People Operations - Mariela Chavez, People Operations Generalist.
- The Senior Director of Operations, or the VP of Operations.

If your concern involves one of these people, take it to any of the others.

## How to Report

You can report in person, by phone, or in writing. You do not need a special form and you do not need proof - describe what happened, who was involved, and when. Contact details for the people above are in your onboarding materials.

## If It Involves Club Personnel

If a concern involves a player, coach, club staffer, vendor, or anyone else we work around, the rule is the same: always take it to KitchFix leadership - never to the client. Do not confront the person, and do not raise it with the club yourself. KitchFix leadership will address it with the people who need to know, including the club.

> ANCHOR: Reporting through KitchFix protects you. Going around us to the client, or confronting the person directly, can put you, the concern, and the account at risk. Bring it to us - we handle it from there.

# 05 Investigation

Every report is taken seriously and handled with care. People Operations reviews each one promptly and impartially, and aims to complete its review as soon as possible - typically within 30 days.

- Confidentiality - KitchFix keeps reports as confidential as possible and shares information only with those who need it to investigate or respond. Complete confidentiality cannot be guaranteed, but privacy is protected to the extent we can.
- Cooperation - employees are expected to cooperate honestly with an investigation. What you share is handled with the same care.
- Interim steps - where appropriate, KitchFix may take interim measures during a review - such as adjusting schedules or assignments - to protect those involved and keep the workplace functioning.
- Outcome - when the review is complete, KitchFix takes the action it determines is appropriate and follows up with the people involved as appropriate.

> NOTE: Asking what happened is not the same as concluding what happened. An investigation gathers facts before any decision is made.

# 06 Anti-Retaliation

No one is punished for speaking up in good faith. Retaliation is its own violation of this Policy.

Retaliation against anyone who reports harassment or discrimination in good faith, or who cooperates with an investigation, is unlawful and will not be tolerated.

Retaliation can include termination, demotion, a schedule or shift change used as punishment, exclusion, or any adverse action taken because someone raised or supported a concern.

If you experience retaliation - report it the same way you would report harassment - to People Operations or any leader. It is treated as seriously as the underlying concern.

> ANCHOR: Raising a good-faith concern is always the right call. You will not be punished for it - and anyone who retaliates will be.

# 07 Consequences and Accountability

Violations of this Policy are addressed through SOP-004 Formal Disciplinary Process, up to and including immediate termination.

If a review confirms that conduct contrary to this Policy occurred, KitchFix takes immediate, appropriate corrective action - including discipline up to and including immediate termination, at KitchFix's discretion.

This applies to harassment, to retaliation, and to a report a person knows to be false and makes in bad faith.

> NOTE: A good-faith report that is not substantiated is never punished. This Policy protects people who speak up honestly - only a knowingly false report made in bad faith is itself a violation.

# 08 Manager and Leadership Responsibilities

Leaders set the standard and carry a higher duty under this Policy.

- Model respectful conduct, and never participate in, encourage, or tolerate harassment or retaliation.
- Escalate every concern - if you witness harassment or an employee brings one to you, you must escalate it to People Operations promptly. You cannot ignore it, sit on it, or promise to keep it just between the two of you.
- Do not investigate on your own - leave the investigation to People Operations. Your job is to make sure the concern reaches them and that the employee is supported.
- Protect the reporter - never retaliate, and never allow anyone on your team to retaliate, against someone who raised or supported a concern.
- Club personnel - if a concern involves anyone on the client side, route it to KitchFix leadership - never raise it with the club yourself.

> CRITICAL: A manager who ignores, discourages, or buries a harassment concern - or who retaliates - is in violation of this Policy and subject to discipline up to and including termination.

# Related Documents

Documents referenced in or governing this Policy. Cross-references use the Document ID, which resolves to the live current version.

| Document ID | Title | Status |
|---|---|---|
| STD-001 | Documentation Format Standard | Live (v1.1) |
| POL-001 | Employee Concerns Policy | Live (v1.0) |
| SOP-004 | Formal Disciplinary Process | Referenced |
| PB-004 | Hourly Employee Handbook | Live (v1.2) |

---
### POL-008 - Wage & Hour Policy

**Status:** In Build | **Version:** 1.0 | **Owner:** People Operations | **Approver:** Counsel + SLT | **Shelf:** HR & People

> **Resolution note.** Facts resolved: overtime_threshold -> 40 hrs/week (qualified)

# 01 Purpose and Scope

Paying every employee correctly and on time for every hour worked, in line with federal and state law.

This policy applies to all KitchFix employees. It sets the federal baseline for pay, overtime, timekeeping, and breaks. State and local rules that are more protective govern - see the State Annex.

> NOTE: Wage-and-hour law is heavily state-specific (minimum wage, daily overtime, meal and rest breaks). This policy states the federal floor; counsel completes the State Annex before it is live.

# 02 Pay Practices

Employees are paid on the regular schedule through Rippling.

Pay reflects all hours worked at the correct rate. Review your pay and report any discrepancy promptly.

Minimum wage follows the highest applicable rate - federal, state, or local.

# 03 Timekeeping

Non-exempt employees record all hours worked accurately, every shift.

Work off the clock is prohibited - if you work, you record it and you are paid for it.

Record meal breaks as required. Do not edit another person's time; report errors to your manager.

> CRITICAL: Never work off the clock and never ask anyone to. Unrecorded work is a wage violation that exposes KitchFix and is grounds for discipline.

# 04 Overtime

Non-exempt employees earn overtime for hours worked over 40 hrs/week (varies by state) at 1.5x the regular rate (federal floor).

Some states require daily overtime or other premiums - see the State Annex.

Overtime must be approved in advance by your manager. Do not work overtime without that approval.

> NOTE: If overtime is worked without prior approval it is still paid in full - every hour worked is always paid. Working unapproved overtime is a performance matter handled separately; it never means the time goes unpaid.

# 05 Meal and Rest Breaks

Break requirements vary significantly by state. Follow the rule for your site's state (State Annex).

Where the state mandates meal or rest breaks, they are provided and recorded as required.

Where no state rule applies, KitchFix provides reasonable breaks consistent with safe operation.

# 06 Deductions and Pay Issues

Only lawful, authorized deductions are made from pay.

Report any pay discrepancy to your manager or People Operations - it will be reviewed and corrected promptly.

No one is retaliated against for raising a pay concern (POL-011).

# Related Documents

| Document ID | Title | Status |
|---|---|---|
| POL-007 | Compensation & Pay Increase | Live |
| POL-013 | Employee Classification & Seasonal | Live |
| POL-015 | Leave Policies | Live |
| POL-011 | Anti-Retaliation / Whistleblower | Live |
| STD-001 | Documentation Format Standard | Live |

---
### POL-010 - EEO, Non-Discrimination & Accommodation

**Status:** In Build | **Version:** 1.0 | **Owner:** People Operations | **Approver:** Counsel + SLT | **Shelf:** HR & People

# 01 Purpose and Scope

Equal opportunity for every employee and applicant - in hiring, pay, assignment, advancement, and every other term of employment.

This policy applies to every employee and applicant at every KitchFix site. It states our equal-opportunity commitment and how we handle accommodation requests and discrimination concerns.

> NOTE: Protected categories and accommodation rules vary by state and locality. This policy states the KitchFix baseline; counsel confirms state-specific requirements before it goes live.

# 02 Equal Employment Opportunity

KitchFix provides equal employment opportunity to all employees and applicants without regard to race, color, religion, sex, national origin, age, disability, genetic information, pregnancy, sexual orientation, gender identity, veteran or military status, or any other characteristic protected by federal, state, or local law.

This applies to recruiting, hiring, training, pay, promotion, assignment, discipline, and termination.

Employment decisions are based on qualifications, performance, and business need - nothing else.

# 03 Non-Discrimination and Non-Harassment

Discrimination or harassment based on any protected characteristic is prohibited and is grounds for discipline up to termination.

This applies to conduct by and toward employees, and to conduct involving clients, players, vendors, and visitors.

> NOTE: Harassment specifically - including sexual harassment - is governed in detail by POL-006 Anti-Harassment Policy.

# 04 Reasonable Accommodation

KitchFix provides reasonable accommodation to qualified employees and applicants with disabilities, and for sincerely held religious beliefs, unless doing so would cause undue hardship.

- Disability - an adjustment to a job, schedule, or environment that lets a qualified person perform the essential functions of the role.
- Religious - a reasonable adjustment to a practice or schedule to accommodate a sincerely held religious belief.

Accommodation is an interactive, case-by-case conversation between the employee and People Operations.

# 05 Pregnancy and Related Accommodation

KitchFix provides reasonable accommodation for pregnancy, childbirth, and related medical conditions, consistent with law.

Examples: schedule adjustments, seating, more frequent breaks, modified lifting, or a temporary change in duties.

Lactation accommodation is provided as required by law.

# 06 Requesting an Accommodation

Start the conversation with People Operations or your manager. You do not need to use any special form or legal language - just raise the need.

People Operations works with you (and your healthcare provider where relevant) to find a workable accommodation.

Requests and medical information are kept confidential.

# 07 Reporting and No Retaliation

Report discrimination, harassment, or a denied accommodation through your manager, People Operations, or the Employee Concerns process (POL-001).

No one is retaliated against for raising a concern or requesting an accommodation in good faith (POL-011).

Acknowledgment is captured in Rippling.

# Related Documents

| Document ID | Title | Status |
|---|---|---|
| POL-006 | Anti-Harassment Policy | In review |
| POL-001 | Employee Concerns Policy | In review |
| POL-011 | Anti-Retaliation / Whistleblower | Draft |
| PB-004 | Hourly Employee Handbook | In review |
| STD-001 | Documentation Format Standard | Live (v1.1) |

---
### POL-011 - Anti-Retaliation / Whistleblower

**Status:** In Build | **Version:** 1.0 | **Owner:** People Operations | **Approver:** Counsel + SLT | **Shelf:** HR & People

# 01 Purpose and Scope

Protecting every employee who speaks up in good faith - because problems only get fixed when people feel safe reporting them.

This policy applies to every KitchFix employee. It guarantees protection from retaliation for protected activity and explains how to report retaliation if it happens.

> ANCHOR: A team that is afraid to report is a team that hides problems until they become disasters. Protection for reporters is not a courtesy - it is how we stay safe and honest.

# 02 Our Commitment

KitchFix prohibits retaliation against any employee for engaging in protected activity in good faith. Retaliation is itself a serious violation and is grounds for discipline up to termination - including against a manager who retaliates.

# 03 Protected Activity

You are protected when you, in good faith:

- Report harassment, discrimination, or a safety or food-safety concern.
- Report suspected illegal conduct, fraud, or a policy violation.
- Participate in or cooperate with an investigation.
- Request an accommodation or exercise a legal right (leave, wage, or safety rights).

> NOTE: "Good faith" means an honest report. You are protected even if the concern turns out to be unfounded - you are not protected for knowingly making a false report.

# 04 What Retaliation Looks Like

Retaliation is any adverse action taken because someone engaged in protected activity - for example:

- Termination, demotion, or discipline.
- Cutting hours, changing shifts, or an undesirable reassignment.
- Exclusion, intimidation, or hostile treatment.
- Any action meant to discourage reporting.

# 05 How to Report

Report suspected retaliation to People Operations, the Senior Director of Operations, or the VP of Operations.

If one of those people is involved, report to another of them.

Reports can be made through the Employee Concerns process (POL-001).

# 06 Investigation and Consequences

Retaliation reports are investigated promptly and as confidentially as the investigation allows.

Substantiated retaliation results in discipline up to termination (SOP-004).

Acknowledgment is captured in Rippling.

# Related Documents

| Document ID | Title | Status |
|---|---|---|
| SOP-002 | Safety & Incident Management | Live |
| POL-001 | Employee Concerns Policy | Live |
| POL-006 | Anti-Harassment Policy | Live |
| POL-010 | EEO, Non-Discrimination & Accommodation | Live |
| SOP-004 | Formal Disciplinary Process | Live |
| STD-001 | Documentation Format Standard | Live |

---
### POL-013 - Employee Classification & Seasonal Workforce

**Status:** In Build | **Version:** 1.0 | **Owner:** People Operations | **Approver:** Counsel + SLT | **Shelf:** HR & People

> **Resolution note.** Facts resolved: ft_threshold_hours -> 30 hrs/week

# 01 Purpose and Scope

Getting classification right - because it drives pay, overtime, benefits, and legal compliance for a workforce that swings from roughly 50 to 300.

This policy explains how KitchFix classifies employees and how it manages its seasonal workforce. It applies to every employee and to the contractors who supplement peak coverage.

> NOTE: Classification is legally sensitive - the FLSA and state law govern exempt status and overtime. This policy states KitchFix's framework; counsel confirms specific classifications and state rules before it goes live.

# 02 Classification Types

## By pay treatment (FLSA)

- Non-exempt - paid hourly and eligible for overtime for hours over 40 in a workweek (or as state law requires). Most KitchFix hourly roles.
- Exempt - salaried and not eligible for overtime, where the role meets the FLSA duties and salary tests. Verified per role, not assumed by title.

## By employment status

- Full-time - regularly scheduled to work an average of 30 or more hours per week; eligible for company benefits per plan terms.
- Part-time - regularly scheduled to work fewer than an average of 30 hrs/week; eligible only for legally required benefits.
- Seasonal - hired for the baseball season or a defined period; status affects benefits and continuity.
- Temporary - hired for a specific short-term need.

# 03 The Seasonal Workforce

KitchFix's workforce scales with the season - spring training, regular season, and the affiliate calendar. Seasonal status is managed deliberately.

- Seasonal employees are told their status and expected duration at hire.
- Rehire and returning-staff practices are defined so the company keeps proven people season to season.
- Seasonal status is applied honestly - a year-round role is not labeled seasonal to avoid obligations.

# 04 Contractors and Task Force

Task Force and Corporate Field Chefs who provide contracted peak coverage are independent contractors, not employees, when the relationship genuinely meets that standard.

Contractor status is determined by the actual working relationship, not by label or preference.

> NOTE: Misclassifying an employee as a contractor carries real legal and tax exposure. When the relationship looks like employment, classify it as employment.

# 05 Why Classification Matters

- It determines overtime eligibility and how pay is calculated (see POL-007, POL-008).
- It determines benefits and leave eligibility (see POL-015).
- It drives tax treatment and legal compliance.
- Questions about your classification go to People Operations.

# Related Documents

| Document ID | Title | Status |
|---|---|---|
| PB-004 | Hourly Employee Handbook | Live |
| POL-007 | Compensation & Pay Increase | Live |
| POL-008 | Wage & Hour Policy | Live |
| POL-015 | Leave Policies | Live |
| STD-001 | Documentation Format Standard | Live |

---
### POL-014 - Code of Conduct & Ethics

**Status:** In Build | **Version:** 1.0 | **Owner:** People Operations | **Approver:** Counsel + SLT | **Shelf:** HR & People

# 01 Purpose and Scope

How we expect every KitchFix employee to conduct themselves - with integrity, respect, and professionalism.

This Code applies to every KitchFix employee at every site and in every interaction - with teammates, Club staff, players, vendors, and the public. It works alongside AGR-001 The Big Rules (the day-to-day conduct rules) and the specific policies it references. Where this Code and a specific policy overlap, the more protective standard applies.

> ANCHOR: We work inside our clients' clubhouses and around their players. How we carry ourselves is the brand. Conduct is not a side issue - it is the job.

# 02 Our Standards

- Respect - treat everyone with dignity. No harassment, discrimination, bullying, or threatening behavior (see POL-006, POL-010).
- Integrity - be honest in your work, your records, and your reporting. Never falsify a document, time record, or report.
- Professionalism - show up ready, in uniform, on time, and sober. Represent KitchFix well in a client's house.
- Safety - follow the safety and food-safety standards every time. A shortcut that risks a person is never acceptable.
- Accountability - own your mistakes and raise concerns early. Problems get smaller when they surface fast.

# 03 Conflicts of Interest

Avoid situations where personal interest competes with KitchFix's or a client's. Disclose any potential conflict to your manager or People Operations.

- Outside work or business that competes with KitchFix or interferes with your job.
- Financial interest in a vendor, supplier, or competitor.
- Hiring, supervising, or contracting with close family or a romantic partner without disclosure.
- Using your KitchFix position for personal gain.

# 04 Confidentiality and Company Information

Protect KitchFix and client confidential information - recipes, financials, contracts, player and personnel information.

Player health, dietary, and personal information is strictly confidential. Never share or discuss it.

Do not post about the clubhouse, players, or KitchFix operations on social media.

Confidentiality continues after employment ends.

# 05 Company Property and Systems

Use KitchFix property, funds, and systems for KitchFix business, with care.

Technology use follows POL-009 IT & Acceptable Use.

Do not take food, supplies, or property without authorization.

# 06 Gifts, Clients and MLB Relationships

We work in a professional-sports environment with its own rules and optics. Use judgment and keep it clean.

- Do not solicit gifts, tips, or favors from clients, players, or vendors.
- Modest, customary courtesies are acceptable; anything that could look like influence is not. When unsure, ask.
- Never participate in or facilitate any activity that violates league rules - including anything touching banned substances (see SOP-009) or gambling.

# 07 Reporting and Accountability

If you see conduct that violates this Code, report it. Reporting in good faith is protected - no retaliation (POL-011).

Raise concerns through your manager, People Operations, or the Employee Concerns process (POL-001).

Violations are addressed through the Formal Disciplinary Process (SOP-004), up to and including termination.

Acknowledgment of this Code is captured in Rippling.

# Related Documents

| Document ID | Title | Status |
|---|---|---|
| AGR-001 | The Big Rules | Live (v1.1) |
| POL-001 | Employee Concerns Policy | In review |
| POL-006 | Anti-Harassment Policy | In review |
| POL-011 | Anti-Retaliation / Whistleblower | Draft |
| SOP-004 | Formal Disciplinary Process | In review |
| STD-001 | Documentation Format Standard | Live (v1.1) |

---
### POL-015 - Leave Policies

**Status:** In Build | **Version:** 1.0 | **Owner:** People Operations | **Approver:** Counsel + SLT | **Shelf:** HR & People

> **Resolution note.** Facts resolved: fmla_worksite_threshold -> 50 employees within 75 miles; sick_accrual -> 1 hour per 30 worked (qualified)

# 01 Purpose and Scope

One policy covering every leave available to KitchFix employees, and how to request it.

This policy consolidates KitchFix's leave program: family and medical leave (FMLA), paid sick leave, and the other leaves we provide or accommodate. It applies to all employees. Leave law is heavily state- and local-specific, so the State Annex carries the binding detail for each location.

> NOTE: This document consolidates what were separate FMLA and paid-sick-leave policies into one Leave Policies doc. Much of this area is state- and city-specific; counsel completes the State Annex and confirms the baseline before it is live.

# 02 Types of Leave at a Glance

- Family & medical leave (FMLA) - job-protected leave for serious family and medical needs - Section 03.
- Paid sick leave - paid time for health needs, where law requires - Section 04.
- Other leaves - personal/medical, jury, bereavement, military, voting, and safe leave - Section 05.

The two major leaves - FMLA and paid sick leave - are detailed below because they carry the most legal structure. All leaves are requested and coordinated the same way (Section 06).

# 03 Family and Medical Leave (FMLA)

Job-protected, unpaid leave for eligible employees with serious family or medical needs, under the federal FMLA.

> CRITICAL: FMLA covers employers with 50 employees within 75 miles of a worksite. KitchFix's seasonal, multi-site footprint means coverage must be determined worksite by worksite. Counsel confirms which KitchFix worksites are FMLA-covered before this is applied.

## Eligibility

- Worked for KitchFix at least 12 months;
- Worked at least 1,250 hours in the prior 12 months; and
- Work at a site with 50 employees within 75 miles. (Seasonal service and the threshold are confirmed case by case.)

## Qualifying reasons

- The employee's own serious health condition.
- Care for a spouse, child, or parent with a serious health condition.
- Birth and bonding, or placement through adoption or foster care.
- Qualifying military family needs, including military caregiver leave.

## Duration and job protection

- Up to 12 weeks in a 12-month period (26 weeks for military caregiver leave); continuous or, where appropriate, intermittent.
- On return, restoration to the same or an equivalent position.
- Group health benefits continue during FMLA leave on the same terms.

# 04 Paid Sick Leave

One company-wide paid-sick-time standard for every KitchFix employee, in every state.

Rather than run a different rule in each state, KitchFix applies a single standard that meets or exceeds the requirements everywhere we operate - including states with no sick-leave law. Where a specific state or city requires more, that location follows the higher requirement (State Annex).

> ANCHOR: The KitchFix standard: paid sick time accrues at one hour for every 30 hours worked, usable up to 40 hours per year, for every employee in every state.

- Accrual and cap - 1 hour per 30 worked (varies by state), up to 40 hours used per year; carryover follows the governing law.
- Permitted uses - the employee's or a family member's illness or medical care, and safe time related to domestic violence, sexual assault, or stalking.
- Notice - give notice as soon as practical. KitchFix does not impose a rigid pre-shift deadline that would deny legally protected time.
- Documentation - required only for absences of more than three consecutive days, and only where the law allows. KitchFix does not require a return-to-work medical release to use sick time.

> CRITICAL: No employee is disciplined, scheduled against, or retaliated against for lawfully using paid sick leave. It is protected activity (POL-011), and attendance rules do not penalize it.

# 05 Other Leaves

- Personal / medical (non-FMLA) - unpaid leave considered case by case where FMLA does not apply.
- Jury duty & witness - time off to serve, per state law.
- Bereavement - time off following the death of a family member.
- Military (USERRA) - job-protected leave for military service and related needs.
- Voting - time off to vote, per state law.
- Victim / safe leave - leave related to domestic violence, sexual assault, or stalking, where law provides.

# 06 Requesting a Leave

Request leave through People Operations as far in advance as possible - 30 days for foreseeable FMLA, otherwise as soon as practical.

Provide the documentation the specific leave requires (for FMLA, any required medical certification).

People Operations coordinates the leave, runs FMLA concurrently with paid sick leave where law allows, and sets the return date.

No one is retaliated against for requesting or taking a leave in good faith (POL-011).

# 07 Pay and Benefits During Leave

Whether a leave is paid depends on the leave type and applicable law.

Benefits continuation follows plan terms and law - and FMLA rules where FMLA applies.

Accrued PTO interaction is handled per company practice and law.

# 08 Returning from Leave

Reinstatement follows the governing leave - FMLA and state laws provide job protection where they apply.

A fitness-for-duty or accommodation conversation happens where relevant (POL-010).

Keep People Operations updated on your expected return.

# Related Documents

| Document ID | Title | Status |
|---|---|---|
| POL-004 | Attendance & Punctuality | Live |
| POL-010 | EEO, Non-Discrimination & Accommodation | Live |
| POL-011 | Anti-Retaliation / Whistleblower | Live |
| POL-013 | Employee Classification & Seasonal | Live |
| STD-001 | Documentation Format Standard | Live |

---
### POL-019 - Permit & License Compliance Policy

**Status:** In Build | **Version:** 1.0 | **Owner:** Finance | **Approver:** SLT + Counsel | **Shelf:** Operations

# 01 Purpose and Scope

Making sure every KitchFix site operates only with the permits and licenses it is required to hold - current, at all times.

Operating a foodservice site requires permits and licenses that vary by city, county, and state. A lapsed or missing one can close a kitchen. This policy sets KitchFix's standard for holding, renewing, and proving the permits and licenses each site needs. It applies to every site and all contract types.

> ANCHOR: No KitchFix site operates on a lapsed or missing required permit. Renewals happen before expiration, never after.

# 02 Policy

- We hold what we're required to hold - KitchFix maintains every operating permit and license required for each site's jurisdiction.
- Never lapsed - required permits and licenses are renewed before they expire. A lapse is a serious compliance failure, not a paperwork delay.
- Proof on site - current permits and licenses are posted or filed on site and producible on inspection.
- One register - every site's permits and licenses are tracked in a single register, with an expiration date and a renewal owner for each.

# 03 Ownership and Responsibility

## Finance

Finance owns the permit and license register and the renewal process - maintaining the record, tracking expirations, and driving renewals across all sites.

## Executive Chef / Site Leadership

Surfaces local permit requirements to Finance, posts current permits on site, and flags anything approaching expiration or any new local requirement.

## Senior Director of Operations

Escalation point for any lapsed, missing, or at-risk permit that could affect a site's ability to operate.

# 04 Required Permits and Licenses

The specific requirements by site and jurisdiction are being compiled with Finance and will be added here.

> NOTE: This section is a placeholder. KitchFix Finance is compiling the full permit-and-license register by site and jurisdiction. Once complete, the specific requirements - and the live tracker - are referenced here. The list below is a non-exhaustive starting point only.

Permit and license types commonly required at a KitchFix site include, but are not limited to:

- Business / operating license.
- Food service or food establishment permit.
- Local health department permit.
- Fire / occupancy inspection and certificate.
- Hood suppression system certification.
- Weights & measures certification (scales), where applicable.

Each site confirms and adds the specific permits its city, county, and state require. Requirements vary materially by jurisdiction.

# 05 Renewal and Recordkeeping

- Renewals begin at least 60 days before expiration.
- Every permit and license has a named renewal owner and a tracked expiration date in the register.
- Proof of each current permit is kept on file and producible for inspection.

> NOTE: The register and renewal-tracking tool - spreadsheet or intranet table - will be specified once Finance finalizes the register. This policy sets the standard; the tool holds the data.

# 06 Lapsed or Missing Permits

A lapsed or missing required permit is treated as a serious compliance issue, not routine paperwork.

- Whoever identifies it notifies Finance and the Senior Director of Operations immediately.
- Finance drives expedited renewal or reinstatement.
- If a missing permit affects the site's legal ability to operate, the Senior Director of Operations and VP of Operations decide on any operational pause in coordination with the Client.

# Related Documents

Documents this references or governs. Cross-references use the Document ID, which resolves to the current version.

| Document ID | Title | Status |
|---|---|---|
| PB-007 | Workplace Safety Manual | Live |
| SOP-008 | Food Safety Management | Live |
| CHK-003 | Health Inspection Readiness | Live |
| STD-001 | Documentation Format Standard | Live |

---
### SOP-004 - Formal Disciplinary Process

**Status:** In Build | **Version:** 1.0 | **Owner:** People Operations | **Approver:** SLT + People Operations + Counsel | **Shelf:** HR & People

> **Resolution note.** Facts resolved: pip_standard_days -> 30 days (60-day option); record_retention_disciplinary -> 3 years (qualified)

# 01 Purpose and Scope

This SOP defines the four-level disciplinary process that applies to all KitchFix employees. It governs how issues are identified, documented, escalated, and resolved.

> ANCHOR: Documentation is the system. A conversation that isn't written down didn't happen. Every coaching moment, every warning, every PIP - the paper trail is what protects the employee and the company.

This SOP applies to all KitchFix employees regardless of role, employment type, contract type, or account. It governs performance issues, conduct violations, and policy non-compliance. It does not cover harassment, discrimination, or EEO complaints - those route to People Operations immediately and are governed by the Employee Handbook.

Progressive discipline is the default. The system moves through four levels in sequence: verbal coaching, written warning, final written warning or suspension, and termination. Certain violations skip progressive steps entirely. See §04 for the immediate termination list.

> NOTE: This SOP works in conjunction with POL-002 Appearance and Dress Code Policy, POL-001 Employee Concerns Policy, and AGR-001 The Big Rules. References to corrective action in those documents route here for the process.

# 02 The Four Levels

Each level has a defined trigger, a required form, and a notification requirement. Levels are not skipped except where specifically permitted below.

## Level 1 - Verbal Coaching

Used for: first occurrence of a minor policy violation, performance gap, or conduct issue that has not previously been addressed in writing. This is a conversation, not a formal disciplinary action.

- The manager addresses the issue directly with the employee in private.
- The manager documents the conversation on FORM-003 (Coaching and Verbal Warning Record) the same day.
- The employee does not sign FORM-003 - it is the manager's record of the conversation.
- The manager notifies their RDO by end of day.
- FORM-003 is filed in the employee's site folder and submitted to People Operations.

> NOTE: Verbal coaching is not a disciplinary action on the employee's record. It is a documented coaching moment. Its purpose is to create a paper trail and give the employee a clear opportunity to correct the issue before formal action begins.

## Level 2 - Written Warning

Used for: recurrence of a previously coached issue, a more serious first-time violation, or a pattern of behavior that warrants formal documentation.

- The manager completes FORM-004 (Written Warning) before or immediately after the conversation with the employee.
- The manager delivers the written warning in person, in private.
- The employee signs FORM-004 acknowledging receipt. Signature acknowledges receipt only - not agreement.
- If the employee refuses to sign, the manager notes the refusal on the form and has a witness initial it.
- The manager notifies their RDO and HR the same day.
- FORM-004 is filed in the employee's site folder and submitted to People Operations within 24 hours.

## Level 3 - Final Written Warning or Suspension

Used for: recurrence after a written warning, a serious single incident that does not meet the immediate termination threshold, or a situation where the manager and RDO determine a final formal warning is appropriate before termination.

- RDO and HR approval is required before issuing a Level 3 action.
- The manager completes FORM-004 marked as "Final Written Warning," or issues a suspension of 1-3 days without pay as determined by the RDO and HR.
- Suspension days are documented on FORM-004 with start and return dates.
- The employee signs FORM-004 acknowledging receipt.
- The manager and RDO notify People Operations the same day.
- Level 3 carries an explicit statement that the next occurrence will result in termination.

> NOTE: Suspension is a significant operational decision. Before suspending, the manager and RDO must assess coverage and notify the site accordingly. A suspended employee is not eligible for pay during the suspension period.

## Level 4 - Termination

Used for: recurrence after a Level 3 action, or an immediate termination trigger (see §04). The EC has authority to terminate but must loop in their RDO and People Operations immediately.

- The EC notifies their RDO and People Operations before or immediately at the time of termination.
- The EC completes FORM-006 (Separation Record) at the time of termination.
- The employee is notified in person, in private, with a clear and direct statement of the reason.
- The manager does not debate or negotiate during the termination conversation.
- Final pay, equipment return, and access revocation are completed per FORM-006.
- The manager submits separation PAF on the intranet same day of termination.
- People Operations is responsible for processing final pay and benefits in compliance with applicable state law.

> CRITICAL: Never terminate an employee without notifying your RDO and People Operations first - even in an immediate termination situation. Text or call while the situation is being managed if necessary. An undocumented, unnotified termination creates significant legal exposure.

# 03 Seasonal Workforce Considerations

The four-level system applies to all employees. Application is calibrated to employment type and season length.

> ANCHOR: A PIP issued in week 10 of a 14-week season is operationally useless. Calibrate the response to the situation and the timeline you have to work with.

## Hourly Seasonal Employees

For hourly seasonal employees, the full four-level process applies but the timeline is compressed. Levels 1 through 3 may move faster than in a non-seasonal context if the season is short and the issue is ongoing. The RDO and People Operations should be involved earlier in the process for seasonal employees given the limited window to correct and the difficulty of replacing mid-season.

PIPs (FORM-005) are not typically used for hourly seasonal employees unless the employee is expected to return in future seasons and the performance issue is addressable over time. For single-season performance issues, written warnings are the appropriate instrument.

## Leadership (EC, Sous Chef, HM)

Leadership employees follow the same four levels. A PIP is appropriate when a leadership employee has a performance gap that is addressable with structured support and there is sufficient season remaining for improvement to be demonstrated. The standard PIP timeline is 30 days (60-day option) approved by the RDO and People Operations.

# 04 Immediate Termination Triggers

The following violations result in immediate termination without progressive steps. No verbal coaching, no written warning, no PIP.

> CRITICAL: The violations below are zero-tolerance. The EC terminates immediately and notifies the RDO and People Operations. Documentation follows the same day via FORM-006.

- Violation of The Big Rules (AGR-001) - including confidentiality breach, media contact, or unauthorized disclosure of client or player information.
- Theft - of company property, client property, player property, or colleague property.
- Fighting or physical altercation on client property or in the course of employment.
- Reporting to work under the influence of alcohol or drugs, or consuming alcohol or drugs on client property.
- Gross food safety violations that endanger health - including deliberate contamination, concealment of a food safety incident, or willful disregard of food safety protocols.
- Harassment - sexual harassment, discriminatory harassment, or any conduct that creates a hostile work environment, as defined in the Employee Handbook.

> NOTE: When in doubt about whether a situation qualifies for immediate termination, call your RDO before acting. It is better to secure the situation (remove the employee from the floor) and consult than to either terminate incorrectly or allow the situation to continue.

# 05 Authority Matrix

Who can take each action, who must be notified, and when approval is required.

| Action | EC | RDO | VP Ops / HR |
|---|---|---|---|
| Verbal coaching / FORM-003 | Authority | Notified | Not required |
| Written warning / FORM-004 | Issues | Notified same day | Not required |
| Final written warning / FORM-004 | Issues w/ RDO approval | Must approve in advance | Notified |
| Suspension | Issues w/ RDO approval | Must approve in advance | Notified |
| PIP / FORM-005 | Issues w/ RDO approval | Must approve in advance | HR notified |
| Termination - progressive | Authority - loop in RDO + HR | Looped in immediately | HR notified same day |
| Termination - immediate | Authority - loop in RDO + HR | Looped in immediately | HR notified same day |

> NOTE: People Operations must be notified of all Level 2 and above actions within 24 hours. Terminations - progressive or immediate - require same-day notification. People Operations contact: Mariela Chavez - People Portal on the intranet or through your RDO.

# 06 Documentation Requirements

Every disciplinary action generates a document. The document is the action.

## Forms in This System

- **FORM-003** - Coaching and Verbal Warning Record. Used at Level 1. Manager completes; employee does not sign.
- **FORM-004** - Written Warning. Used at Levels 2 and 3. Employee signs acknowledging receipt.
- **FORM-005** - Performance Improvement Plan. Used for structured performance correction. Employee signs.
- **FORM-006** - Separation Record. Used at termination. Manager completes; employee receives a copy.

## Filing and Retention

- All completed disciplinary forms are filed in the employee's site folder at the account.
- All completed forms are submitted to People Operations within 24 hours of completion.
- People Operations maintains the official personnel file. Site folders are working copies.
- Disciplinary records are retained for a minimum of 3 years (varies by state) after the employee's last day, per applicable state law requirements.

## Confidentiality

All disciplinary conversations and documentation are confidential. The manager does not discuss disciplinary actions with other employees or share documentation outside the required notification chain. Breach of disciplinary confidentiality is itself a disciplinary matter.

# 07 Employee Rights

This process is designed to be fair and consistent. Employees have specific rights within it.

- The employee has the right to know what standard they failed to meet and why it matters.
- The employee has the right to receive any written warning or PIP in writing before or at the time of the conversation.
- The employee has the right to respond. The manager documents the employee's response on the form. The response does not change the action taken.
- The employee has the right to request a review of a Level 3 or Level 4 action by contacting People Operations within five business days.
- The employee has the right to file a concern under POL-001 if they believe the disciplinary action was discriminatory or retaliatory.

> NOTE: Employee signature on disciplinary forms acknowledges receipt and understanding only. It does not constitute agreement with the action taken. If an employee refuses to sign, the manager notes the refusal and has a witness initial the form.

# Related Documents

Documents this SOP governs or references.

| Document ID | Title | Status |
|---|---|---|
| STD-001 | Documentation Format Standard | Live (v1.0) |
| AGR-001 | The Big Rules - Confidentiality Agreement | Live |
| POL-001 | Employee Concerns Policy | Pending |
| POL-002 | Appearance and Dress Code Policy | Live (v1.3) |
| FORM-003 | Coaching and Verbal Warning Record | Live (v1.0) |
| FORM-004 | Written Warning | Live (v1.0) |
| FORM-005 | Performance Improvement Plan | Live (v1.0) |
| FORM-006 | Separation Record | Live (v1.0) |
| REF-003 | Disciplinary Process - Manager Quick Reference | Live (v1.0) |

---
### SOP-005 - Onboarding Process SOP

**Status:** In Build | **Version:** 1.0 | **Owner:** (null) | **Approver:** Pending - HR + SLT + Counsel | **Shelf:** HR & People

# 01 Purpose and Scope

A consistent onboarding so every new hire starts ready, compliant, and clear on the standard.

> ANCHOR: The first week tells a new hire whether we're organized and whether we're serious. A clean onboarding protects the team, the guest, and the new hire - and it starts the standard on day one instead of correcting it later.

This SOP defines the onboarding process for every KitchFix hire, hourly and salaried, at every site. It covers the path from accepted offer through the first 90 days. It works with the Onboarding Checklist (TPL-016), the training program (PB-013), and the policies a new hire acknowledges.

# 02 The Onboarding Timeline

Five stages, each with a clear owner and a clear finish line.

| Stage | What happens |
|---|---|
| Offer accepted | Hiring confirmed; onboarding opened in Rippling; checklist (TPL-016) started. |
| Pre-boarding | Paperwork, work authorization, and system setup completed before day one. |
| Day one | Orientation, policies, the Big Rules, uniform, and a tour. |
| First week | Food-safety and role training; knife-skills verification before solo line work. |
| 90-day mark | Check-in against the plan; confirm the hire is on track (TPL-004). |

# 03 Pre-Boarding

Get the paperwork and access done before day one, so day one is about the work, not the forms.

- **Rippling setup** - create the employee record in Rippling; assign onboarding tasks, schedule, and pay setup.
- **Work authorization** - complete Form I-9 and confirm employment eligibility within the legal window, per federal and state law.
- **Required documents** - tax forms, direct deposit, and any role- or state-required paperwork completed in Rippling.
- **Policy package** - route policies and agreements for acknowledgment (AGR-001, AGR-002 where applicable, and core POLs).

> NOTE: [OPEN - WORK AUTHORIZATION] Electronic verification practice (E-Verify) is unresolved and under counsel review, including the Arizona mandate for AZ sites. This SOP states the I-9 requirement generically; the verification step is finalized when counsel completes the work-authorization review.

# 04 Day One

A structured first day - welcomed, oriented, and set up to contribute.

1. **Welcome and tour** - introduce the team, walk the site, cover where everything is and how the day runs (PB-010).
2. **The Big Rules** - review AGR-001 - confidentiality, conduct, and the non-negotiables of working in a client's house.
3. **Policies** - confirm policy acknowledgments are complete; answer questions on conduct, attendance, and pay.
4. **Uniform and appearance** - issue uniform and review the appearance standard (REF-002, POL-002).
5. **Safety orientation** - cover workplace safety basics and how to report an incident (PB-007, SOP-002).

> NOTE: Day one is owned by the site - the Executive Chef or a designated lead, not left to whoever is free. A named person runs the new hire's first day.

# 05 Training and Verification

Train before you deploy - nobody works a station solo until they're verified for it.

- **Food safety** - food-handler/food-safety training per role and state (SOP-008); allergen awareness (PB-002).
- **Knife skills** - knife-skills verification (FORM-009) before working a station that requires knife work; the cut-glove rule applies until verified.
- **Role training** - role-based training per the program (PB-013) - the new hire's specific station and responsibilities.
- **Documented** - all training and verification recorded in Rippling. If it isn't recorded, it didn't happen.

> CRITICAL: A new hire does not run a station alone until they are trained and, where required, verified for it. Deploying an untrained person is how avoidable injuries and food-safety failures happen.

# 06 The Onboarding Checklist

One checklist tracks the whole process so nothing is skipped.

The Onboarding Checklist (TPL-016) is the single tracking tool for every new hire. It carries each step - pre-boarding, day one, training, and verification - with an owner and a completion check, and it lives in the employee's record.

- Started when the offer is accepted; completed before the new hire is considered fully onboarded.
- Owned by the hiring manager / Executive Chef, with HR confirming compliance items.
- Filed in the employee record as proof the process was followed.

# 07 Roles and Responsibilities

Everyone knows their part, so a new hire never falls through a gap.

- **Hiring manager / Executive Chef** - owns the on-site experience - day one, training, verification, and the checklist.
- **People Operations** - owns compliance - work authorization, paperwork, policy acknowledgments, and the Rippling record.
- **RDO** - ensures sites run onboarding consistently and supports staffing across the region.
- **The new hire** - completes their tasks, acknowledgments, and training honestly and on time.

# 08 The 90-Day Mark

Onboarding isn't done on day one - it's done when the hire is confirmed on track.

At the 90-day mark, the manager checks the new hire against the plan: are they trained, contributing, and meeting the standard? This is the moment to confirm fit, close any training gaps, and set the path forward.

- Use the 90-day plan and check-in (TPL-004) to structure the conversation.
- Confirm all required training and certifications are complete and recorded.

> NOTE: A new hire still missing core training at 90 days is a process miss, not just a performance question - close the gap and look at where onboarding broke down.

# Related Documents

Documents this references or governs. Cross-references use the Document ID, which resolves to the current version.

| Document ID | Title | Status |
|---|---|---|
| TPL-016 | Onboarding Checklist | Queued |
| PB-013 | Training and Certification Program | In review |
| AGR-001 | The Big Rules | Live |
| FORM-009 | Knife Skills Verification | In review |
| POL-013 | Employee Classification and Seasonal | In review |
| TPL-004 | 90-Day WOW Plan | Staged |
| STD-001 | Documentation Format Standard | Live (v1.1) |

---
### AGR-002 - Laptop Acceptance Agreement

**Status:** In Build | **Version:** 1.0 | **Owner:** People Operations | **Approver:** Senior Director of Operations + Counsel | **Shelf:** HR & People

KITCHFIX · PERFORMANCE FOOD SERVICE

# 01 Purpose & Scope

This Agreement governs the use, care, and return of KitchFix-issued laptop computers and accessories.

> ANCHOR: KitchFix-issued laptops are tools for doing the work. Protect them, use them professionally, and return them in good condition.

KitchFix issues laptop computers to certain employees to support their work responsibilities. Employees must exercise professional judgment and common sense when using KitchFix laptops, equipment, and accessories.

Personal use is permitted outside of working hours, provided it does not interfere with the business purpose of the equipment. All laptops, equipment, and accessories remain KitchFix property at all times.

# 02 Employee Responsibilities

By signing this Agreement, the employee acknowledges and agrees to all of the following.

## Use & Access

- Sign this Agreement and comply with all outlined policies.
- Use credentials specified by KitchFix to log in to the device, without modifying those credentials.
- Provide access to the device and any accessories upon KitchFix's request at any time.
- Acknowledge that KitchFix may access, monitor, or remotely wipe the device at any time without prior notice. No expectation of privacy exists on company-issued equipment.

## Data & Software

- Store all KitchFix files and operational data on Google Drive. No company data should be stored exclusively on the local device.
- Install required software updates in a timely manner.
- Not download, stream, or install any unlicensed, unauthorized, or illegal content or software.
- Not install VPNs, disable security or monitoring tools, or make system configuration changes without explicit approval from HR or the Senior Director of Operations.

## Device Care & Security

- Protect the device from damage, loss, and theft.
- Report any lost or stolen device to the Senior Director of Operations within 24 hours of discovery.
- Return all devices, equipment, and accessories to KitchFix upon termination, in the same condition as issued, accounting for normal wear and tear. Accessories include chargers, cases, and peripherals issued with the device.
- Share any pertinent login information to the system upon return or upon request.

# 03 Maintenance, Replacement & Repair

Equipment issues, repair requests, and replacements are coordinated through Operations and IT.

Any issues with a KitchFix-issued laptop should be reported to Operations. For technical support or repairs, contact IT directly. To request a replacement device, submit a Personnel Action Form (PAF) through the People Portal on the intranet.

Any damage or loss determined to be the result of employee negligence or misuse is the employee's financial responsibility, subject to the following exceptions:

- Damage resulting from normal wear during appropriate use in the regular course of the employee's role.
- Damage or loss caused by negligence on the part of KitchFix.

> NOTE: IT Support - Epoch IT Solutions
>
> Mike Murphy - CEO & Founder
>
> Office: 847-800-9655 - Direct: 224-377-9655
>
> mike@epochits.com - support@epochits.com
>
> To open a support ticket, email support@epochits.com.

> NOTE: When a new device is issued - whether as a replacement or upon role change - the current device must be returned to KitchFix before or at the time of issuance.

# 04 Acknowledgment

Sign below to confirm you have read, understood, and agree to comply with all terms of this Agreement.

By signing below, the employee confirms they have read, understood, and agree to comply with all terms of this Laptop Acceptance Agreement. This Agreement takes effect on the date signed.

Signature

Date

Print Name

Date

# Related Documents

Documents this references or governs. Cross-references use the Document ID, which resolves to the current version.

| Document ID | Title | Status |
|---|---|---|
| POL-009 | IT and Acceptable Use Policy | In Build |
| AGR-001 | The Big Rules | Live |
| STD-001 | Documentation Format Standard | Live |

---
### TPL-101 - Internal JD - Cook

**Status:** In Build | **Version:** - | **Owner:** (null) | **Approver:** SLT + Counsel | **Shelf:** HR & People | **in_corpus:** no

> **Resolution note.** Facts resolved: brand_promise -> Best Food, Best Service, Best Hospitality; operating_states -> AZ, FL, IL, KY, MO, NY, OH, TX (8 states; IL is corporate-only)

# Internal JD - Cook

## Internal Job Description (Hourly Positions)

Team | Location

- **Job Title:** Cook
- **Job Type:** [Seasonal/Year-round & FT/PT]
- **Pay Range:** [$XX-$XX/hour]
- **Location/Stadium:** [Stadium Name & Address]
- **Reports To:** [Manager]

## About KitchFix

KitchFix is a chef-driven organization delivering Best Food, Best Service, Best Hospitality through exceptional food and unmatched service. We partner with performance-focused organizations across AZ, FL, IL, KY, MO, NY, OH, TX (8 states; IL is corporate-only), guided by our belief that genuine hospitality empowers individuals and teams to reach their full potential. We strive to create value in every interaction - on the plate, in our relationships, and through the leadership we provide.

## Job Summary

Under the direction of the [MANAGER TITLE] this role is responsible for food preparation, menu execution, and delivering exceptional food, service, and hospitality for the [TEAM] performance catering operations.

Reports to [MANAGER]

## Responsibilities

- Cross-train and work all stations: batch cooking, made to order cooking, food prep, grab/go prep, and a la carte production
- Receive and store grocery and vendor orders (must be able to lift up to 50#)
- Uphold the integrity and standards of all the products
- Maintain sanitation, cleanliness, and organization of kitchen at all times
- Provide professional service to all guests including players, coaches, executives, and team support staff

## Qualifications

- Self-motivated and passionate about cooking
- Strong creativity and interest in building healthy meals with lots of flavor
- Ability to follow recipes and adjust recipes as needed
- Professional demeanor, and a service-first attitude
- Excellent knowledge of kitchen equipment, safe sanitary practices, and culinary skills
- At least 3+ year experience cooking in a professional kitchen

## Work Schedule & Availability

- Able to work non-standard work week, including early mornings, evenings, weekends, holidays

## KitchFix Total Rewards Package

- Competitive wage starting at, $XX/hour, based on experience
- Comprehensive benefits package for full-time positions-
- Medical, Dental, Vision
- Health Savings Account (HSA)
- Flexible Spending Accounts (FSA)
- 401(k) plan
- Paid Time Off (PTO, Sick Time, Paid Holidays)
- Opportunity to have an impact on KitchFix's growth

KitchFix is an equal opportunity employer that is committed to diversity, inclusion, and equity and creating a place of belonging. Kitchfix does not discriminate in employment opportunities or practices on the basis of race, color, religion, sex, national origin, ancestry, age, disability, sexual orientation, marital status, military or veteran status, genetic information, or any legally protected characteristic.

# Job Advertisement

## Job Advertisement

Greenhouse | Indeed

Join the Culinary Team Behind Major and Minor League Baseball Organizations.

We're hiring [Position] to join our culinary team supporting the [Team] in [Location].

Seasonal full-time & part-time roles available | $XX-$XX/hr based on experience

**What You'll Do:** [Responsibilities]

**What We're Looking For:** [Qualifications]

**Requirements:** [Schedule & Availability]

- Ability to work a non-standard work week, including early mornings, evenings, weekends, holidays
- Ability to commute to [Location]
- Food Handler/ServSafe certification (or willingness to obtain)
- Willingness to complete background check and drug screening
- Ability to lift up to 50 lbs

**Why Join KitchFix?** [Total Rewards]

This is more than a seasonal job - it's a chance to build your skills, expand your culinary experience, and work in a professional sports environment that few ever get to see.

Our Total Rewards Package includes:

- Competitive pay ($XX-$XX/hr)
- Full benefits for full-time roles
- Health, dental, vision
- HSA/FSA
- 401(k)
- Paid time off (PTO, Sick Time, Paid Holidays)
- Opportunities to grow with KitchFix across multiple states and sports organizations

Want to be part of a kitchen that fuels greatness?

Apply today!

KitchFix is an equal opportunity employer that is committed to diversity, inclusion, and equity and creating a place of belonging. Kitchfix does not discriminate in employment opportunities or practices on the basis of race, color, religion, sex, national origin, ancestry, age, disability, sexual orientation, marital status, military or veteran status, genetic information, or any legally protected characteristic.

---
### TPL-102 - Internal JD - Dishwasher

**Status:** In Build | **Version:** - | **Owner:** (null) | **Approver:** SLT + Counsel | **Shelf:** HR & People | **in_corpus:** no

> **Resolution note.** Facts resolved: brand_promise -> Best Food, Best Service, Best Hospitality; operating_states -> AZ, FL, IL, KY, MO, NY, OH, TX (8 states; IL is corporate-only)

# Internal JD - Dishwasher

## Internal Job Description (Hourly Positions)

Team | Location

- **Job Title:** Dishwasher
- **Job Type:** [Seasonal/Year-round & FT/PT]
- **Pay Range:** [$XX-$XX/hour]
- **Location/Stadium:** [Stadium Name & Address]
- **Reports To:** [Manager]

## About KitchFix

KitchFix is a chef-driven organization delivering Best Food, Best Service, Best Hospitality through exceptional food and unmatched service. We partner with performance-focused organizations across AZ, FL, IL, KY, MO, NY, OH, TX (8 states; IL is corporate-only), guided by our belief that genuine hospitality empowers individuals and teams to reach their full potential. We strive to create value in every interaction - on the plate, in our relationships, and through the leadership we provide.

## Job Summary

As the Dishwasher, you will be responsible for ensuring the cleanliness of dishware, cookware, and the work facility within the food service operation for the [TEAM] baseball team.

Reports to [MANAGER]

## Responsibilities

- Maintain a regular cleaning schedule of all kitchen equipment
- Clean and sanitize all equipment after each use and between different food items
- Keep high sanitation standards in dish area (regulate water temperatures and chemicals)
- Maintain the facility in a safe, clean, and organized condition at all times by performing tasks such as sweeping, mopping, cleaning spills, and removing trash.
- Assist in maintaining food safety and organization standards
- Receive provisions and rotate stock
- Light kitchen prep work as needed

## Qualifications

- 1+ years of Dishwashing or Kitchen experience preferred
- Ability to work successfully as a team or at times with minimal supervision
- Excellent attention to detail related to order and cleanliness--you like everything in its place, and you take pride in this
- Dependable, respectful, and professional demeanor, can-do attitude
- Ability to work calmly under pressure

## Work Schedule & Availability

- Able to work non-standard work week, including early mornings, evenings, weekends, holidays

## KitchFix Total Rewards Package

- Competitive wage starting at, $XX/hour, based on experience
- Comprehensive benefits package for full-time positions-
- Medical, Dental, Vision
- Health Savings Account (HSA)
- Flexible Spending Accounts (FSA)
- 401(k) plan
- Paid Time Off (PTO, Sick Time, Paid Holidays)
- Opportunity to have an impact on KitchFix's growth

KitchFix is an equal opportunity employer that is committed to diversity, inclusion, and equity and creating a place of belonging. Kitchfix does not discriminate in employment opportunities or practices on the basis of race, color, religion, sex, national origin, ancestry, age, disability, sexual orientation, marital status, military or veteran status, genetic information, or any legally protected characteristic.

# Job Advertisement

## Job Advertisement

Greenhouse | Indeed

Join the Culinary Team Behind Major and Minor League Baseball Organizations.

We're hiring [Position] to join our culinary team supporting the [Team] in [Location].

Seasonal full-time & part-time roles available | $XX-$XX/hr based on experience

**What You'll Do:** [Responsibilities]

**What We're Looking For:** [Qualifications]

**Requirements:** [Schedule & Availability]

- Ability to work a non-standard work week, including early mornings, evenings, weekends, holidays
- Ability to commute to [Location]
- Food Handler/ServSafe certification (or willingness to obtain)
- Willingness to complete background check and drug screening
- Ability to lift up to 50 lbs

**Why Join KitchFix?** [Total Rewards]

This is more than a seasonal job - it's a chance to build your skills, expand your culinary experience, and work in a professional sports environment that few ever get to see.

Our Total Rewards Package includes:

- Competitive pay ($XX-$XX/hr)
- Full benefits for full-time roles
- Health, dental, vision
- HSA/FSA
- 401(k)
- Paid time off (PTO, Sick Time, Paid Holidays)
- Opportunities to grow with KitchFix across multiple states and sports organizations

Want to be part of a kitchen that fuels greatness?

Apply today!

KitchFix is an equal opportunity employer that is committed to diversity, inclusion, and equity and creating a place of belonging. Kitchfix does not discriminate in employment opportunities or practices on the basis of race, color, religion, sex, national origin, ancestry, age, disability, sexual orientation, marital status, military or veteran status, genetic information, or any legally protected characteristic.

---
### TPL-103 - Internal JD - FOH Cafe Attendant

**Status:** In Build | **Version:** - | **Owner:** (null) | **Approver:** SLT + Counsel | **Shelf:** HR & People | **in_corpus:** no

> **Resolution note.** Facts resolved: brand_promise -> Best Food, Best Service, Best Hospitality; operating_states -> AZ, FL, IL, KY, MO, NY, OH, TX (8 states; IL is corporate-only)

# Internal JD (Hourly Positions)

## Internal Job Description (Hourly Positions)

Team | Location

- **Job Title:** FOH Cafe Attendant
- **Job Type:** [Seasonal/Year-round & FT/PT]
- **Pay Range:** [$XX-$XX/hour]
- **Location/Stadium:** [Stadium Name & Address]
- **Reports To:** [Manager]

## About KitchFix

KitchFix is a chef-driven organization delivering Best Food, Best Service, Best Hospitality through exceptional food and unmatched service. We partner with performance-focused organizations across AZ, FL, IL, KY, MO, NY, OH, TX (8 states; IL is corporate-only), guided by our belief that genuine hospitality empowers individuals and teams to reach their full potential. We strive to create value in every interaction - on the plate, in our relationships, and through the leadership we provide.

## Job Summary

This position will be responsible for the presentation, cleanliness, and client experience of the performance food service operation for the [TEAM] baseball team.

Reports to [MANAGER]

## Responsibilities

- Provide "Best in Class" hospitality for our high-profile client, including excellent manners and interpersonal skills
- Manage an exceptional visual presentation and cleanliness in food service area
- Sweep, mop, scrub as needed, as well as clean floors, shelves, surfaces, equipment, etc.
- Assist kitchen and BOH as needed, this may include prep work and dishwashing
- Communicate all needs through the Executive Chef and Sous Chef
- Ensure dining area is clean, organized, and well-stocked
- Cover and date food when storing to ensure freshness and safety
- Ensure hot food temperatures are within safe range and records temps

## Qualifications

- 2 to 3 years customer service experience preferred
- Excellent hospitality skills, professional demeanor, and a service-first attitude
- Extreme attention to detail
- Ability to anticipate client needs and fulfill them
- Knowledge of kitchen equipment, safe sanitary practices, and culinary skills

## Work Schedule & Availability

- Ability to work a non-standard work week, including early mornings, evenings, weekends, holidays

## KitchFix Total Rewards Package

- Competitive wage starting at, $XX/hour, based on experience
- Comprehensive benefits package for full-time positions-
- Medical, Dental, Vision
- Health Savings Account (HSA)
- Flexible Spending Accounts (FSA)
- 401(k) plan
- Paid Time Off (PTO, Sick Time, Paid Holidays)
- Opportunity to have an impact on KitchFix's growth

KitchFix is an equal opportunity employer that is committed to diversity, inclusion, and equity and creating a place of belonging. Kitchfix does not discriminate in employment opportunities or practices on the basis of race, color, religion, sex, national origin, ancestry, age, disability, sexual orientation, marital status, military or veteran status, genetic information, or any legally protected characteristic.

# Job Advertisement

## Job Advertisement

Greenhouse | Indeed

Join the Culinary Team Behind Major and Minor League Baseball Organizations.

We're hiring [Position] to join our culinary team supporting the [Team] in [Location].

Seasonal full-time & part-time roles available | $XX-$XX/hr based on experience

**What You'll Do:** [Responsibilities]

**What We're Looking For:** [Qualifications]

**Requirements:** [Schedule & Availability]

- Ability to work a non-standard work week, including early mornings, evenings, weekends, holidays
- Ability to commute to [Location]
- Food Handler/ServSafe certification (or willingness to obtain)
- Willingness to complete background check and drug screening
- Ability to lift up to 50 lbs

**Why Join KitchFix?** [Total Rewards]

This is more than a seasonal job - it's a chance to build your skills, expand your culinary experience, and work in a professional sports environment that few ever get to see.

Our Total Rewards Package includes:

- Competitive pay ($XX-$XX/hr)
- Full benefits for full-time roles
- Health, dental, vision
- HSA/FSA
- 401(k)
- Paid time off (PTO, Sick Time, Paid Holidays)
- Opportunities to grow with KitchFix across multiple states and sports organizations

Want to be part of a kitchen that fuels greatness?

Apply today!

KitchFix is an equal opportunity employer that is committed to diversity, inclusion, and equity and creating a place of belonging. Kitchfix does not discriminate in employment opportunities or practices on the basis of race, color, religion, sex, national origin, ancestry, age, disability, sexual orientation, marital status, military or veteran status, genetic information, or any legally protected characteristic.

---
### TPL-104 - Internal JD - Culinary Delivery Driver

**Status:** In Build | **Version:** - | **Owner:** (null) | **Approver:** SLT + Counsel | **Shelf:** HR & People | **in_corpus:** no

> **Resolution note.** Facts resolved: brand_promise -> Best Food, Best Service, Best Hospitality; operating_states -> AZ, FL, IL, KY, MO, NY, OH, TX (8 states; IL is corporate-only)

# Internal JD - Driver

## Internal Job Description (Hourly Positions)

Team | Location

- **Job Title:** Culinary Delivery Driver
- **Job Type:** [Seasonal/Year-round & FT/PT]
- **Pay Range:** [$XX-$XX/hour]
- **Location/Stadium:** [Stadium Name & Address]
- **Reports To:** [Manager]

## About KitchFix

KitchFix is a chef-driven organization delivering Best Food, Best Service, Best Hospitality through exceptional food and unmatched service. We partner with performance-focused organizations across AZ, FL, IL, KY, MO, NY, OH, TX (8 states; IL is corporate-only), guided by our belief that genuine hospitality empowers individuals and teams to reach their full potential. We strive to create value in every interaction - on the plate, in our relationships, and through the leadership we provide.

## Job Summary

The Culinary Delivery Driver is responsible for safely and efficiently delivering catered food to the [TEAM] at their training facility in [LOCATION] while providing excellent customer service. This role ensures orders are accurate, on time, and presented professionally. Additional daily kitchen duties will be assigned as needed. This position is based at our commissary kitchen in [WORK LOCATION].

Reports to [MANAGER]

## Responsibilities

- Load, transport, and deliver catering orders safely and on time
- Verify order accuracy before departure and upon delivery
- Set up food displays when required
- Communicate professionally with on-site team members and clients
- Follow all food safety, sanitation, and handling procedures
- Maintain cleanliness of delivery vehicles, equipment, and work areas
- Practice proper grooming, personal hygiene, and uniform standards
- Assist with additional kitchen and prep duties as directed

## Qualifications

- Valid driver's license with a clean driving record
- Strong time management skills and reliability
- Professional appearance with excellent customer service skills

## Work Schedule & Availability

- Ability to work a non-standard work week, including early mornings, evenings, weekends, holidays

## KitchFix Total Rewards Package

- Competitive wage starting at, $XX/hour, based on experience
- Comprehensive benefits package for full-time positions-
- Medical, Dental, Vision
- Health Savings Account (HSA)
- Flexible Spending Accounts (FSA)
- 401(k) plan
- Paid Time Off (PTO, Sick Time, Paid Holidays)
- Opportunity to have an impact on KitchFix's growth

KitchFix is an equal opportunity employer that is committed to diversity, inclusion, and equity and creating a place of belonging. Kitchfix does not discriminate in employment opportunities or practices on the basis of race, color, religion, sex, national origin, ancestry, age, disability, sexual orientation, marital status, military or veteran status, genetic information, or any legally protected characteristic.

# Job Advertisement

## Job Advertisement

Greenhouse | Indeed

Join the Culinary Team Behind Major and Minor League Baseball Organizations.

We're hiring [Position] to join our culinary team supporting the [Team] in [Location].

Seasonal full-time & part-time roles available | $XX-$XX/hr based on experience

**What You'll Do:** [Responsibilities]

**What We're Looking For:** [Qualifications]

**Requirements:** [Schedule & Availability]

- Ability to work a non-standard work week, including early mornings, evenings, weekends, holidays
- Ability to commute to [Location]
- Food Handler/ServSafe certification (or willingness to obtain)
- Willingness to complete background check and drug screening
- Ability to lift up to 50 lbs

**Why Join KitchFix?** [Total Rewards]

This is more than a seasonal job - it's a chance to build your skills, expand your culinary experience, and work in a professional sports environment that few ever get to see.

Our Total Rewards Package includes:

- Competitive pay ($XX-$XX/hr)
- Full benefits for full-time roles
- Health, dental, vision
- HSA/FSA
- 401(k)
- Paid time off (PTO, Sick Time, Paid Holidays)
- Opportunities to grow with KitchFix across multiple states and sports organizations

Want to be part of a kitchen that fuels greatness?

Apply today!

KitchFix is an equal opportunity employer that is committed to diversity, inclusion, and equity and creating a place of belonging. Kitchfix does not discriminate in employment opportunities or practices on the basis of race, color, religion, sex, national origin, ancestry, age, disability, sexual orientation, marital status, military or veteran status, genetic information, or any legally protected characteristic.

---
## Section 3 - Finance (Sebastian)

Pay bands (REF-006 / REF-007) carry draft values awaiting Rippling validation; both are out of corpus (`in_corpus: false`) until Finance confirms. PB-009 is the Financial Operations Manual framework. POL-019 §05 permit-register tool is the Finance touchpoint on POL-019; the full body lives in Counsel - pointer only here.

### REF-006 - Hourly Pay Bands

**Status:** In Build | **Version:** 1.1 | **Owner:** People Operations | **Approver:** People Operations + Finance | **Shelf:** HR & People | **in_corpus:** no

KITCHFIX · PERFORMANCE FOOD SERVICE

# Hourly Pay Bands

The hourly pay ranges for each role, by market - the rates that sit underneath POL-007. Draft market reference, pending Finance validation. KitchFix Internal - available to site leadership for in-band offers; not for posting or distribution to hourly staff.

> NOTE: REF-006 covers seven states (AZ, FL, TX, NY, MO, OH, KY). Illinois is intentionally absent - IL is a corporate-only state with no hourly staff, so there are no hourly bands to publish. The 7-state coverage is not an omission.

| Field | Value |
|---|---|
| DOCUMENT ID | REF-006 |
| TITLE | Hourly Pay Bands |
| VERSION | v1.1 - Draft - market reference (pending Finance validation) |
| APPROVED BY | Pending - People Operations + Finance |
| NEXT REVIEW | Annual - and on any minimum-wage change |
| OWNER | People Operations |
| CLASSIFICATION | KitchFix Internal |

# Contents

- 01 Purpose & Use
- 02 Band Position
- 03 Hourly Bands by Market
- 04 Maintenance & Methodology
- 05 Version History
- Related Documents

# 01 Purpose & Use

This document holds the hourly pay ranges for each role in each market. It is the companion to POL-007 Compensation & Pay Increase Policy - the Policy governs how increases are decided; this is where the numbers live.

> NOTE: KitchFix Internal. These hourly bands are available to site leadership and management to make and recommend in-band offers. They are not for posting or distribution to hourly staff. Leadership salary bands live separately in REF-007 (restricted).

The ranges below are a draft market reference - benchmarked to premium sports and contract food service and floored at or above each state's 2026 minimum wage. They are a planning baseline, not a final structure. People Operations and Finance validate them against current rate data in Rippling and account budgets before adoption.

Each band has a minimum, a midpoint, and a maximum. Every employee's rate must fall within the band for their role and market, and at or above the applicable minimum wage.

# 02 Band Position

Where an employee sits in their band reflects experience and sustained performance. This gives every leader the same yardstick and is how compression is prevented.

| Position | What it means |
|---|---|
| Lower third | New to the role, or still building proficiency. |
| Midpoint | Fully proficient and meeting the standard consistently - where most solid returners should land. |
| Upper third | Sustained excellence, or hard-to-replace tenure and skill. |

> NOTE: Band position is the logic behind a merit increase under POL-007. Movement within band reflects demonstrated, documented performance - not tenure alone.

# 03 Hourly Bands by Market

Hourly rates for the three hourly roles, by operating market. Geography drives these numbers - each floor respects the local minimum wage or market entry.

> NOTE: Draft market reference. Benchmarked to premium sports / contract food service, above institutional medians. Validate against Rippling actuals and account budgets before adoption. Florida floors must clear $15.00 before Sept 30, 2026.

## Arizona

Goodyear / Surprise - 2026 minimum wage $15.15

| Role | Minimum | Midpoint | Maximum |
|---|---|---|---|
| Dishwasher | $15.50 | $17.50 | $20.00 |
| Cook | $18.00 | $21.00 | $25.00 |
| FOH Attendant | $16.00 | $18.50 | $22.00 |

## Florida

Jupiter / Dunedin / Port Charlotte - minimum wage $14.00 -> $15.00 (Sept 30, 2026)

| Role | Minimum | Midpoint | Maximum |
|---|---|---|---|
| Dishwasher | $15.00 | $17.00 | $19.50 |
| Cook | $17.50 | $20.50 | $24.00 |
| FOH Attendant | $15.50 | $18.00 | $21.00 |

## Texas

Arlington (DFW) - federal floor $7.25 - bands set to market

| Role | Minimum | Midpoint | Maximum |
|---|---|---|---|
| Dishwasher | $15.00 | $17.00 | $19.50 |
| Cook | $18.00 | $21.00 | $25.00 |
| FOH Attendant | $15.50 | $18.00 | $21.00 |

## New York

Buffalo - 2026 minimum wage $16.00

| Role | Minimum | Midpoint | Maximum |
|---|---|---|---|
| Dishwasher | $16.00 | $18.00 | $20.00 |
| Cook | $18.00 | $21.00 | $25.00 |
| FOH Attendant | $16.50 | $19.00 | $22.00 |

## Missouri

St. Louis - 2026 minimum wage $15.00

| Role | Minimum | Midpoint | Maximum |
|---|---|---|---|
| Dishwasher | $15.00 | $17.00 | $19.00 |
| Cook | $17.00 | $20.00 | $23.50 |
| FOH Attendant | $15.50 | $18.00 | $21.00 |

## Ohio

Cincinnati - 2026 minimum wage $11.00

| Role | Minimum | Midpoint | Maximum |
|---|---|---|---|
| Dishwasher | $14.50 | $16.00 | $18.00 |
| Cook | $16.50 | $19.50 | $23.00 |
| FOH Attendant | $14.50 | $17.00 | $20.00 |

## Kentucky

Louisville - federal floor $7.25 - bands set to market

| Role | Minimum | Midpoint | Maximum |
|---|---|---|---|
| Dishwasher | $14.00 | $15.50 | $17.50 |
| Cook | $16.00 | $18.50 | $22.00 |
| FOH Attendant | $14.00 | $16.50 | $19.50 |

# 04 Maintenance & Methodology

How bands are set, checked, and kept current.

- **Benchmark** - positioned at or above market median for premium sports and contract food service - not institutional / cafeteria rates.
- **Sources** - current rate data from Rippling, U.S. Bureau of Labor Statistics wage data for each role, a market reference, and the statutory minimum wage where the employee works.
- **Cadence** - reviewed at least annually, aligned to the budget cycle, and immediately whenever a state or local minimum wage changes.
- **Compression review** - each review checks that longer-tenured returners are not bunched against first-day rates; corrected through equity adjustments under POL-007.
- **Re-pegging** - when the market or minimum wage moves, the band is adjusted. This is a structural change, not a merit increase, and applies to the range - not to one person's performance.
- **Ownership** - People Operations and Finance jointly own this document. Changes are versioned per STD-001.

# 05 Version History

Change log for this reference. Version numbering and lifecycle follow STD-001 Section 10.

| Version | Date | Summary of changes |
|---|---|---|
| v1.1 | 06/2026 | Split into role tiers: leadership salary bands moved to REF-007 Leadership Pay Bands. Reclassified KitchFix Internal - available to site leadership for in-band offers; not for posting. Hourly band values unchanged. |
| v1.0 | 06/2026 | Initial structure plus a draft market reference: hourly bands by market for the seven operating states (AZ, FL, TX, NY, MO, OH, KY) and national leadership salary bands, benchmarked to premium sports / contract food service and floored at the 2026 minimum wage. Band-position model and maintenance methodology included. Values are a planning baseline pending Finance + People Operations validation against Rippling actuals and account budgets. |

# Related Documents

Documents this reference supports or is governed by.

| Document ID | Title | Status |
|---|---|---|
| POL-007 | Compensation & Pay Increase Policy | Governs this reference |
| REF-007 | Leadership Pay Bands | Companion (restricted) |
| FORM-007 | Pay Increase Recommendation | Uses these bands |
| STD-001 | Documentation Format Standard | Live (v1.1) |

---
### REF-007 - Leadership Pay Bands

**Status:** In Build | **Version:** 1.0 | **Owner:** People Operations | **Approver:** People Operations + Finance | **Shelf:** HR & People | **in_corpus:** no

KITCHFIX · PERFORMANCE FOOD SERVICE

# Leadership Pay Bands

Annual salary ranges for the site-leadership triad - the rates that sit underneath POL-007. Draft market reference, pending Finance validation. Restricted to corporate, People Operations, Finance, and approving leadership.

| Field | Value |
|---|---|
| DOCUMENT ID | REF-007 |
| TITLE | Leadership Pay Bands |
| VERSION | v1.0 - Draft - market reference (pending Finance validation) |
| APPROVED BY | Pending - People Operations + Finance |
| NEXT REVIEW | Annual - and with the budget cycle |
| OWNER | People Operations |
| CLASSIFICATION | KitchFix Internal - Restricted |

# Contents

- 01 Purpose & Use
- 02 Band Position
- 03 Leadership Bands
- 04 Maintenance & Methodology
- 05 Version History
- Related Documents

# 01 Purpose & Use

This document holds the annual salary ranges for the site-leadership triad - Sous Chef, Hospitality Manager, and Executive Chef. It is the companion to POL-007 Compensation & Pay Increase Policy and to REF-006 Hourly Pay Bands.

> CRITICAL: Restricted. Leadership salary ranges are confidential and limited to corporate, People Operations, Finance, and approving leadership. Unlike REF-006 Hourly Pay Bands, this document is not shared with site management.

The ranges below are a draft market reference - benchmarked to premium sports and contract food service. They are a planning baseline, not a final structure. People Operations and Finance validate them against current pay data in Rippling and account budgets before adoption.

Each band has a minimum, a midpoint, and a maximum. Every leader's salary must fall within the band for their role, calibrated to the scope of the account they run.

# 02 Band Position

Where a leader sits in their band reflects experience, sustained performance, and the scope of the account they run.

| Position | What it means |
|---|---|
| Lower third | New to the role, or running a smaller-scope account (PDC, MiLB). |
| Midpoint | Fully proficient, running a standard account at the brand standard. |
| Upper third | Sustained excellence, or running a flagship or dual-clubhouse MLB account. |

> NOTE: Band position is the logic behind a merit increase under POL-007. Movement within band reflects demonstrated, documented performance and account scope - not tenure alone.

# 03 Leadership Bands

Annual salary for the site-leadership triad. These flex by account scope more than by geography.

> NOTE: Draft market reference. Benchmarked to premium sports / contract food service. Validate against Rippling actuals and account budgets before adoption.

| Role | Minimum | Midpoint | Maximum |
|---|---|---|---|
| Sous Chef | $52,000 | $60,000 | $72,000 |
| Hospitality Manager | $55,000 | $66,000 | $82,000 |
| Executive Chef | $80,000 | $95,000 | $120,000 |

> NOTE: Leadership salary tracks account scope: a dual-clubhouse or flagship MLB account (e.g., TXR Home + Visitor, STL, CIN) sits top-of-band; a PDC or MiLB account sits lower. Add roughly 5-10% in higher-cost markets such as Buffalo and Phoenix.

# 04 Maintenance & Methodology

How leadership bands are set, checked, and kept current.

- **Benchmark** - positioned at or above market median for premium sports and contract food service - chefs and food-service managers in hospitality, not institutional settings.
- **Sources** - current salary data from Rippling, U.S. Bureau of Labor Statistics wage data for chefs / head cooks and food-service managers, a market reference, and account-scope considerations.
- **Account scope** - leadership salary is calibrated to the account: clubhouse vs. PDC vs. MiLB, single vs. dual clubhouse, and the size of the team and operation.
- **Cadence** - reviewed at least annually, aligned to the budget cycle.
- **Re-pegging** - when the market moves, the band is adjusted. This is a structural change, not a merit increase.
- **Ownership** - People Operations and Finance jointly own this document. Changes are versioned per STD-001.

# 05 Version History

Change log for this reference. Version numbering and lifecycle follow STD-001 Section 10.

| Version | Date | Summary of changes |
|---|---|---|
| v1.0 | 06/2026 | Initial release. Split from REF-006: national leadership salary bands (Sous Chef, Hospitality Manager, Executive Chef), benchmarked to premium sports / contract food service, calibrated by account scope. Band-position model and maintenance methodology included. Restricted to corporate, People Operations, and Finance. Values are a planning baseline pending Finance + People Operations validation. |

# Related Documents

Documents this reference supports or is governed by.

| Document ID | Title | Status |
|---|---|---|
| POL-007 | Compensation & Pay Increase Policy | Governs this reference |
| REF-006 | Hourly Pay Bands | Companion (internal) |
| FORM-007 | Pay Increase Recommendation | Uses these bands |
| STD-001 | Documentation Format Standard | Live (v1.1) |

---
### PB-009 - Financial Operations Manual

**Status:** In Build | **Version:** 1.0 | **Owner:** (null) | **Approver:** Accounting + SLT | **Shelf:** Finance

# 01 Purpose & How to Use

How KitchFix manages the financial side of the business - from the site P&L to company reporting.

> ANCHOR: Margin is made or lost on the site floor every day, and protected by clean reporting and controls behind it. This manual connects the two - what the Executive Chef controls daily, and how it rolls into the company's books.

This manual defines KitchFix's financial operations: the two contract models, how a site's P&L is owned and managed, cost discipline for food and labor, budgeting, invoicing and billing, reporting, and the controls that keep it all clean. It applies to everyone who touches site finances - Executive Chefs, RDOs, and the Accounting team.

> NOTE: [OPEN - FINANCE INPUT] The reporting pack structure, approval thresholds, and the invoicing/billing workflow detail below are framework placeholders to be confirmed and filled in with Accounting (Sebastian Castro) before this manual goes Live.

# 02 The Two Financial Models

Every account runs on one of two models, and the model changes how the EC manages money.

## Fee model

The client owns the food cost; KitchFix manages purchasing and operations and is paid a management fee. The food budget is the client's money - managed tightly, reported transparently. This is the better-margin model for KitchFix because food cost is a pass-through, not a risk.

## Full-service model

KitchFix buys the food and delivers the operation under a single all-inclusive fee. Food cost is KitchFix's risk - over-ordering or waste comes straight out of margin, so cost discipline matters even more.

> NOTE: Know your account's model before you order, schedule, or report. The same action - an extra case ordered "to be safe" - is a client conversation under fee and a margin hit under full-service.

# 03 Site P&L Ownership

The Executive Chef owns the site's P&L - not as a finance exercise, but as daily operating discipline.

The GM/EC is accountable for the site's financial result: food cost, labor cost, and the revenue or fee terms of the account. The RDO oversees P&L performance across the region; Accounting maintains the books and reporting.

- Food cost - driven by ordering, production, portioning, waste, and storage (Section 04).
- Labor cost - driven by scheduling to the business and to target (Section 05).
- Fee / revenue - governed by the account's SLA and model (Section 02).

> ANCHOR: Owning the P&L means knowing your numbers before someone asks for them. An EC who can't say where food and labor cost stand this period isn't yet running the site's finances - they're reacting to them.

# 04 Food Cost Management

Buy what you need, use what you buy, and lose nothing to waste or spoilage.

- Order to par and forecast - order to the menu, the production plan, and forecasted covers - not habit (PB-010).
- Portion to spec - standardized recipes and portions keep food cost predictable plate to plate.
- Control waste - track waste honestly; it's the fastest signal of over-ordering, over-production, or rotation failure.
- Store & rotate - FIFO and correct storage so product isn't lost to spoilage.
- Inventory - count on the account's cadence; inventory value is part of the cost picture.

> NOTE: Under full-service, every one of these is margin. Under fee, every one is the client's trust. Either way, the discipline is the same.

# 05 Labor Cost Management

The right coverage to hit the standard, scheduled to the target - with accurate time, always.

- Schedule to the business - build the Rippling schedule to forecast and the labor target - enough to hit the standard, no more.
- Control overtime - overtime is approved in advance; worked overtime is always paid (POL-008). Unplanned OT is a scheduling signal to fix.
- Accurate time - every hour recorded; no off-the-clock work, ever (POL-008).
- Seasonal scaling - staff to the season - the workforce swings with the baseball calendar (POL-013).

> NOTE: Labor is the lever the EC controls most directly in the moment. The schedule is a financial document as much as an operational one.

# 06 Budgeting & Forecasting

Plan the numbers before the period, so you're managing to a target instead of explaining a surprise.

- The budget - each account operates to a budget set with the RDO and Accounting - food, labor, and the fee/revenue terms.
- Forecasting covers - forecast covers from the schedule (homestands, road trips, events) to drive ordering and staffing.
- Re-forecast - update the forecast as the schedule changes; a stale forecast drives bad orders and schedules.

> NOTE: [OPEN - FINANCE INPUT] Budget format, cadence, and ownership thresholds to be confirmed with Accounting and reflected here.

# 07 Invoicing & Accounts Payable

Pay for what we received, verified and approved - no exceptions.

1. Verify against receiving - match every vendor invoice to what was actually received (PB-010, Section receiving).
2. Flag discrepancies - short shipments, price changes, and quality rejections are documented and resolved with the vendor.
3. Approve - invoices are approved per the approval matrix before payment.
4. Submit to Accounting - approved invoices route to Accounting on the account's cadence.

> NOTE: [OPEN - FINANCE INPUT] Approval thresholds, the AP workflow, and Accounting hand-off detail to be confirmed with Sebastian and filled in.

# 08 Client Billing & Receivables

Bill the client correctly and on time, per the model and the SLA.

- Fee accounts - invoice the management fee and any pass-through food cost per the SLA terms.
- Full-service accounts - invoice the all-inclusive fee per the SLA cadence.
- Backup & transparency - provide the documentation the SLA requires - fee accounts especially run on transparent food-cost reporting.
- Receivables - Accounting tracks receivables; the RDO supports resolution of any client billing question.

> NOTE: [OPEN - FINANCE INPUT] Billing cadence, invoice format, and receivables process to be confirmed with Accounting.

# 09 Financial Reporting

Numbers the RDO and SLT can act on - on a rhythm, in a consistent format.

Each account reports its financial performance on a regular cadence - food cost, labor cost, fee/revenue, and variance to budget - rolled from the site to the region to the company. Reporting is restricted: financials are shared only with those who need them, by site, with sensitive lines (such as individual pay) removed before any team-level sharing.

> NOTE: [OPEN - FINANCE INPUT] The reporting pack - its tabs, metrics, and cadence - is built with Accounting. It is broken into site-specific views, stored in a restricted location, and shared only with the relevant site lead, RDO, and SLT.

# 10 Controls & Approvals

The basics that keep the money clean: approvals, separation, and a record.

- Approval matrix - spending and invoices are approved at the right level - not by whoever is closest.
- Separation of duties - the person who orders is not the only person who approves and reconciles.
- Documentation - every transaction has backup - the order, the receiving, the invoice, the approval.
- Restricted access - financial detail is shared on a need-to-know basis, by site, with sensitive lines removed.

> NOTE: [OPEN - FINANCE INPUT] The approval matrix and control thresholds to be set with Accounting.

# 11 Variance Management & Escalation

Catch the variance early, explain it, and fix it - don't let it compound.

A variance to budget is information, not a failure - as long as it's surfaced early. The EC reviews food and labor against target on the reporting cadence and flags variances to the RDO before they become the period's story.

| Situation | What to do |
|---|---|
| Food cost over target | Review ordering, production, waste, and portioning; correct and report the cause. |
| Labor cost over target | Review the schedule against covers; adjust coverage to the business. |
| Billing or invoice dispute | Document, resolve with the vendor or client, and loop in Accounting and the RDO. |
| Material or repeated variance | Escalate to the RDO and Accounting early - with the cause, not just the number. |

> ANCHOR: A small variance explained now beats a large one discovered later. The RDO would always rather hear it early.

# Related Documents

Documents this references or governs. Cross-references use the Document ID, which resolves to the current version.

| Document ID | Title | Status |
|---|---|---|
| PB-010 | Site Operations Manual | In review |
| PB-005 | SLA OS Handbook | In review |
| POL-008 | Wage & Hour Policy | In review |
| POL-013 | Employee Classification & Seasonal | In review |
| PB-012 | Client & Account Management Playbook | In review |
| STD-001 | Documentation Format Standard | Live (v1.1) |

---
### POL-019 - Permit & License Compliance Policy

**Status:** In Build | **Version:** 1.0 | **Owner:** Finance | **Approver:** SLT + Counsel

_POL-019 appears in both Counsel and Finance reviews - the full resolved body is in the Counsel section; this entry is a pointer._

---
