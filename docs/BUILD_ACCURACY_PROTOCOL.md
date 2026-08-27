# Build Accuracy Protocol (binding - CC + Chat-Claude)
Born 2026-07-19 from the OV-3 post-mortem: 13 findings, ~5 from lossy prompt authorship,
~6 from unverified build claims, 2 from silent scope handling. This protocol exists to
raise FIRST-PASS yield and make every miss loud at report time instead of expensive at
gate time.

## CC contract
C1 NO SELF-CERTIFICATION. Never write "verified" / "works" / "already works" for
   anything not executed. Label every claim: [ran] or [code-read]. Runtime outcomes
   without a run get the line: "needs gate cell."
C2 COMPLETENESS MAP. The report maps EVERY numbered input item -> commit hash, or
   "NOT DONE - <reason>." A stated skip is respectable; a silent drop is the worst
   failure in this system.
C3 READ THE SOURCE. Styling or altering any existing element starts by reading its base
   construction and citing file:line in the commit. (The wedge ghost shipped the same
   day this law was first written - it is now unconditional.)
C4 ACCEPTANCE ECHO. Restate each item's acceptance verbatim with status:
   [met-ran] / [met-code-read] / [needs-gate].
C5 REGRESSION RE-DECLARE. Touching any previously-gated path re-lists that path's prior
   acceptance as [needs-gate] in the report - working code you rework is unproven code.

## Chat-Claude contract
A1 OUTCOME-LEVEL ACCEPTANCES. Visuals accept at PAINT (pixel/elementFromPoint), never
   computed geometry alone; multi-site rulings name EVERY site; interactions accept at
   behavior with settle-frames.
A2 VERBATIM APPENDIX. Owner-round prompts append the owner's raw words; every clause
   line-diffs to a wave or an explicit "not scoped - flagged." Translation loss is a
   Chat-Claude defect.
A3 GRADE THE MAP FIRST. Before any probe, the completeness map is checked against the
   prompt; a missing item bounces the report immediately.
A4 STANDING BATTERY (never ad-hoc): laptop matrix 1024/1152/1280/1366/1536 · legend
   audit · per-kind header inventory · paint-level glyph cells · today/state carriers ·
   failed-state end-to-end · flag-off parity + storage-clear law · squint + grayscale ·
   canvas-flush at zoom.
A5 PROBE CANON: settle-frames after interactions; elementFromPoint = paint truth;
   kill-switch cells end with localStorage.clear(); code-path verification (wrapper/
   class presence) accompanies outcome checks.

## Shared
S1 Every PR body records "gate findings: N" - the number both sides are working to
   drive toward zero on first pass.
S2 STANDING RULE (added 2026-08-27, R14): every screenshot sweep runs BOTH URL shapes -
   preset (`?preset=fytd`, `?preset=this_period`, `?preset=last_period`) AND explicit-dates
   (`?start=YYYY-MM-DD&end=YYYY-MM-DD`). The two hydrate on different timing paths and
   they diverge. On 2026-08-27 a TDZ ReferenceError in WeekChart (#847 -> #856) fired
   100% on explicit-dates URLs and 0% on preset URLs; R13's acceptance sweep landed 9
   preset screenshots that captured what they captured but proved nothing about
   explicit-dates renders. Same P0 was live in production for a day, discovered while
   smoke-testing R14. A companion finding surfaced the same day: R13's projection-outline
   feature only renders on explicit-dates URLs - preset-URL users never see it - because
   the same hydration difference short-circuits the projection code path on preset. The
   rule is simple: preset and explicit-dates are two paint surfaces, sweep both, or
   acceptance is one-surface only.
