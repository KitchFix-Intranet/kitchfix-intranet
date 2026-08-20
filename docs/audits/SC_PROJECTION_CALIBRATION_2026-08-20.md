# SC Projection Calibration - TXR-AZ vs CIN-AZ recon

**Target repo path:** `docs/audits/SC_PROJECTION_CALIBRATION_2026-08-20.md`
**Authored:** 2026-08-20. All figures [ran] against live PG via
`scripts/_probe_pr_m_projections_variance.mjs` (uncommitted probe run
under `.env.local`). READ-ONLY; zero writes to any projection table.
**Data window:** 2026-01-01 through 2026-08-19. Delta convention:
`actual - projected` (positive = underestimate).
**Parked here per Kevin ruling 2026-08-20**: invoicing bills off actuals
not projections, so the miscalibration is untidy rather than broken.
If Sebastian raises projection accuracy during the shadow weeks, this
is where the work resumes.

---

## Four findings worth not re-deriving

### 1. TXR-AZ is per-service miscalibration, not a flat offset

Services move in opposite directions within the same account. A flat
offset would fix one while breaking another.

| Service | n paired | mean Δ | sum Δ | verdict |
|---|---:|---:|---:|---|
| Regular Snack | 182 | **+23.92** | +4,353 | chronic underestimate |
| Lunch | 208 | +11.63 | +2,419 | underestimate |
| Breakfast | 225 | +5.23 | +1,176 | mild under |
| Continental Breakfast | 182 | 0.00 | 0 | dormant (proj=act=0 always) |
| Pre-Game Hot Snack | 182 | -5.39 | -981 | mild over |
| Dinner | 224 | **-15.75** | -3,529 | chronic overestimate |

Additional shape: phase-linked drift. Pre-season phases underproject
(ST Workouts mean +24.77, Staff/Rehab +12.27); mid-season phases
overproject (ACL mean -9.33). Day-of-week has no meaningful signal.

Distribution shape: 62% of paired rows have Δ = 0 (proj matched act);
the other 38% are bimodal - big left tail (148 rows at Δ ≤ -20) and
big right tail (216 rows at Δ > +20). Not a bell curve around a
constant. Two distinct populations.

### 2. CIN-AZ proves the projection model is sound

If projection LOGIC were broken, both AZ accounts would show it.
CIN-AZ does not.

| Metric | TXR-AZ | CIN-AZ |
|---|---:|---:|
| Overall mean Δ | +2.86 | **+0.15** |
| Overall stdev | 41.74 | **23.11** |
| Worst service mean Δ | +23.92 / -15.75 | +2.99 / -2.55 |
| Worst phase mean Δ | +24.77 / -9.33 | +10.12 / -2.83 |

CIN-AZ per-service deltas all sit within ±3 servings/day. Per-phase,
only Battery Camp (mean +10.12 over 104 rows in an 8-day January
window) crosses ±5. Per-day-of-week, every day is within ±3. This is
the target-state calibration for TXR-AZ to reach.

### 3. 1,095 TXR-AZ actuals have no matching projection

Bigger problem than the variance analysis on the paired subset.

| Account | paired rows | proj-only | act-only |
|---|---:|---:|---:|
| TXR - AZ | 1,203 | 198 | **1,095** |
| CIN - AZ | 2,769 | 234 | 0 |

Operators are writing actuals on days the projection dataset never
knew existed. Any per-service calibration fix on the 1,203 paired
rows only helps 52% of TXR-AZ's actual write surface. CIN-AZ's zero
unpaired-actuals is the discipline TXR should reach.

### 4. Recommended fix order (Kevin decides; not shipping in this pass)

Do NOT ship:
- Flat offset - variance is shaped, not flat.
- Projection-model rewrite - CIN proves the model works.
- Day-of-week seasonality - no signal.

Consider, in order:

1. **Fill the 1,095 projection gaps for TXR-AZ.** Prerequisite. Same
   fix shape as `docs/migrations/sc-27-tbj-fl-projection-reproject.sql`
   and `docs/migrations/sc-29-stl-fl-slu-away-projections.sql`: derive
   from schedule + phase, one SQL migration.
2. **Rebuild TXR-AZ per-service, per-phase baselines** matching CIN-AZ's
   calibration approach. Regular Snack chronically under, Dinner
   chronically over, phase-linked drift are all specific fixes. Same
   migration shape.
3. **Operational note (not a fix):** CIN-AZ's tight discipline on
   projection-actual pairing is worth capturing as target state for
   the other MLB accounts.

---

## Where projections come from

- Table: `sc_daily_projections` (declared at
  `src/lib/dataStore/serviceCalendar.js:125`).
- Read path: `src/lib/dataStore/serviceCalendar.js:781`, via the
  `sc_daily_revenue` view.
- Write paths: NO central projection engine. Each account's rows
  come from a hand-authored SQL migration. Existing per-account
  migrations that could serve as templates for a TXR-AZ rebuild:
  - `docs/migrations/sc-23-stl-mo-stranded-projections.sql`
  - `docs/migrations/sc-27-tbj-fl-projection-reproject.sql`
  - `docs/migrations/sc-29-stl-fl-slu-away-projections.sql`
- **No projection migration exists for TXR-AZ or CIN-AZ** - their
  projections were seeded outside the migration pattern (source
  unknown from repo evidence; likely one-off Studio inserts or an
  early script). This explains part of why the two accounts diverge:
  no shared, versioned source of truth for how their rows were
  computed.

---

## How to rerun

```
node --env-file=.env.local scripts/_probe_pr_m_projections_variance.mjs
```

Requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`.
Output is JSON to stdout - pipe to a file for inspection. Script
header names what it measures and lists the accounts / date window
so a future extension (say, TBJ-FL or STL-MO) is a one-line edit.
