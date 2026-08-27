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

**Pattern law (five instances and counting).** Something is measured in one context and
assumed to hold in another. The check passes, the thing is broken, and the passing check
is what stops anyone looking. Five instances on this project so far:

  1. **PostgREST 1000-row cap.** Measured one page, extrapolated to all. Every full-set
     read that didn't paginate silently truncated at 1000 rows for months.
  2. **Four-slot chart truncation.** Measured one range width, extrapolated to all. Wider
     ranges silently dropped units past slot four.
  3. **Rippling walk at 16.5%.** Measured one filter value, extrapolated to all. Every
     other filter shape was silently ignored by the endpoint.
  4. **The report-only-pending view.** Measured in aggregate (~250ms), extrapolated to
     filter-shape reads. Under the route's WHERE clause the same view ran 12,507ms and
     500'd on ALL FYTD.
  5. **`?preset=` in the URL.** Measured on the picker path (which writes explicit dates),
     assumed to apply to preset URLs (which the page silently ignored). Preset URLs
     rendered the current period regardless of what preset was specified; R14's 66
     acceptance screenshots proved this by taking half of them of the wrong range and
     confidently.

The next instance is not far away. Before writing an acceptance check that measures
context X, ask what OTHER contexts the same code has to hold under. If the check doesn't
sweep those, either extend it or name what's untested. A check that only measures the
happy path is a check that is measuring nothing.

S2 STANDING RULE (added 2026-08-27, R14; corrected 2026-08-27 same day): every screenshot
   sweep runs BOTH URL shapes - preset AND explicit-dates - AND **asserts they resolve to
   the same range before comparing anything**. The two URL shapes are only comparable
   if they hit the same fiscal range; a sweep that compares two different ranges is
   worse than a sweep that tests one, because it produces confident evidence of nothing.

   The R14 sweep as originally written caught features that render on one URL shape and
   not the other (that alone found #856's TDZ). It completely missed the case where the
   two shapes render entirely different ranges (which is what actually happened in R14 -
   `?preset=fytd` was silently ignored and rendered P9 instead of FYTD). Half of R14's
   66 screenshots were of the wrong range and nobody noticed until the projection-outline
   follow-up (this PR) probed the underlying cause.

   Procedure (both CC probe and Chat-Claude visual battery):
     1. Resolve BOTH URL shapes.
     2. Assert the API `range.start` / `range.end` returned for each match, byte for byte.
     3. If they differ, stop and report the divergence; do NOT compare visual output.
     4. Only if the two ranges match may the visual comparison be considered evidence.

   References: 5th instance of the pattern law above. #856 (TDZ), R14 (#857), the
   `?preset=` silent-ignore case that this PR closes.
