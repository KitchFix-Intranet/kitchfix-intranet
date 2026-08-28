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

S3 STANDING RULE (added 2026-08-28, R17): visual acceptance measures contrast against
   the surface behind the mark, not just DOM presence. S2 is a URL-shape parity check;
   nothing in it catches a mark the DOM says rendered and an eye says is invisible.

   Two classes name this failure mode:

   1. **Dashed / outline / border marks that carry information** (projection extensions,
      target lines, forecast overlays, average lines, legend swatches). Their entire
      job is to be readable against the plot / card background behind them. WCAG's
      3.0:1 graphical-objects threshold applies. R17 shipped this class as
      `.kpi-p-proj { border: 1.5px dashed var(--n-500) }` at 2.87:1 against the
      white plot background - the DOM said the projection extension rendered, an
      eye at 68% elapsed said it was not there, and R13's acceptance battery
      passed because it checked element presence, not visual reading. The R13
      CSS comment three lines above said the outline should use identity color;
      the CSS used --n-500 and nobody read the code and its own documentation
      together.

   2. **Low-saturation identity marks measured against a state axis.** R13 approved
      identity color on the running bar so a running Food bar reads as Food.
      Read on ONE chart, this is coherent. Read on THREE charts on a state axis
      where every closed period is red or green, three identity colors (Food navy,
      Packaging pale blue, Vehicle purple) are three shades that mean nothing
      about the state axis. Identity carries meaning within a chart and none
      across a state axis; a running bar sits on the STATE axis and needs the
      state axis's grammar (or a consistent neutral), not the identity axis's.

   Procedure (both CC probe and Chat-Claude visual battery):
     1. For any dashed / dotted / outline mark on a light surface, verify contrast
        against the surface behind it clears 3.0:1. Not "the element rendered";
        the color of its stroke vs its background.
     2. For any identity-color-through-state situation, verify the identity is
        readable in the CROSS-CHART view where multiple identities sit adjacent
        on the same state axis. Coherence within one chart does not survive
        the aggregate view.
     3. `_probe_kpi_contrast.mjs` now scans both `kpi.css` and every purchasing
        stylesheet, and gates the graphical axis at 3.0:1 in addition to the
        text axis at 4.5:1. Extension landed in R17. Any future kpi/* stylesheet
        joins the CSS_PATHS list at add-time.

   References: 6th instance of the pattern law above. R17 (`.kpi-p-proj` invisible
   at 2.87:1) plus R13's identity-on-a-state-axis ruling that shipped as three
   accidental shades. The extension of `_probe_kpi_contrast.mjs` closed both blind
   spots at once: it read `kpi.css` only, and it scanned `color:` only, so the
   defect that lived on a `border:` declaration in `purchasing.css` was invisible
   to the gate that was supposed to catch exactly this class.
