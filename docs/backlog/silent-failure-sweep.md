# System-wide silent-failure sweep (survey, not fix)

**Filed:** parked from task #46, closed 2026-09-09 as a task, retained here as the backlog record.
**Status:** Deferred. Post-training work.
**Trigger to unpark:** after training settles, once someone has bandwidth for a survey pass without production pressure.
**Scope constraint:** SURVEY, not fix. A survey converts unknown risk into ranked known risk; fixes come later per-instance with Kevin ruling.

---

## What this closes

The `feedback_swallow_into_empty` memory names a recurring pattern:

> `catch { return [] }` and `if (q.error) return { applies: false }` both convert errors into empty-looking success. User sees "the feature just does not work". Throw or return a discriminated shape.

Every instance found so far was found by chasing a specific "the feature is broken" symptom. The sweep exists because **the ones we haven't chased yet are still live** — silent failures don't page. The survey turns unknowns into a ranked list Kevin can prioritize against.

## Known instances that motivate the sweep

- **`catch { return [] }`** in per-day resolver paths (documented in the memory). Each one converts a fetch error into "no data" — the day tile then renders as if there is nothing to enter.
- **`if (q.error) return { applies: false }`** in gate helpers (documented). A DB error becomes "the gate does not apply" — the operator sees a permissive UI when they should see refusal.
- **`catch (err) { console.error(...) }` on non-fatal-labelled paths** (found in scReviewState.js unlock-clear before the fix). Kevin's rule: "A silent console.error on a path that leaves a billing gate open is precisely the pattern in this week's GOTCHAS entry." Fixed in that one spot; class remains everywhere else.
- **`{ success: true, rows: [] }` on a failed read** — the caller cannot distinguish "no data" from "read failed." Several instances suspected in `route.js` handlers where the catch swallows and returns success.

## What the sweep should produce

**One markdown table**, ranked by blast radius:

| File:line | Pattern | Consumer | What the user sees on failure | Verdict |
|---|---|---|---|---|
| ... | `catch { return [] }` | tile render | day renders as empty | fix candidate |
| ... | `catch (e) { console.error }` | non-fatal write | silent success, wrong data | fix candidate |
| ... | ... | ... | ... | acceptable |

**Grep patterns to start from** (SC module + shared lib):

- `catch\s*\(\s*[^)]*\)\s*{\s*return\s+\[\]`
- `catch\s*{\s*return\s+\[\]`
- `if\s*\(.*\.error\).*return\s*{`
- `\.catch\(.*=>.*\[\]`
- `console\.(error|warn)\(.*(?!throw|return)`

**Do not fix in the survey PR.** A survey with 30 findings that also touches 30 files becomes a monster review. The survey ships as `docs/reports/sc-silent-failure-sweep.md` (or similar) with ranked findings; individual fixes ship per Kevin ruling.

## What this DOES NOT do

- Does not touch code. Survey-only.
- Does not extend to non-SC modules on the first pass. The KitchFix Ops Hub-wide sweep is a separate ask; SC is the surface training on it.
- Does not fix the four known instances above unless Kevin promotes them individually.

## Related memories

- `feedback_swallow_into_empty.md` - the founding rule
- `feedback_guards_need_coverage.md` - guards that scan by shape miss defects of different shape
- `feedback_health_signal_survives_pipeline.md` - a signal that only updates when the pipeline runs cannot report on the pipeline stopping

## Why parked

Training is nine days out. The sweep produces a ranked list Kevin then has to triage; triage during training week is the wrong signal-to-noise. Post-training, this is a natural first survey pass — the cadence would be one afternoon of grep + read, one report, then Kevin picks the top 3-5 for a follow-on PR.
