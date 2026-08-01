# Sous mark system - specification

**Status:** ratified by Kevin 2026-08-01. This section is the source of truth for the Sous identity mark.
**Reference artifact:** `sous-mark-final.html` (composition + motion reference; this spec wins on any disagreement).

## 1. Identity summary

The mark is the Mise on the diamond: four rounded tiles rotated 45 degrees at the base positions plus a fixed center mound. Two colorways form one responsive identity:

- **1C (display):** bases + mound in Flame, base paths in yellow. Used at 24px and above.
- **1A (small):** bases + mound in Flame, no paths. Used below 24px, in the favicon, and in the nav.

The paths dissolve below ~24px regardless, so the pair is one logo, not two.

## 2. Geometry - 64 basis

- Tiles: 17 x 17, border-radius 5, rotated 45 degrees
- Base centers: N (32,16), E (48,32), S (32,48), W (16,32) - orbit 16 from center
- Mound: circle r 3.2 at (32,32), never animates position
- Base paths (1C only): closed polygon through the four base centers, stroke 2.4, linejoin round
- Nav cut (24 basis): tiles 6.4 at orbit 6, radius 1.9, mound r 1.25

## 3. Color

| Token | Value | Use |
|---|---|---|
| Bases + mound | `--accent-sous` #0891B2 | all contexts |
| Paths (1C) | #DFA968 | display sizes; holds color on navy |
| Partial open station | #D97706 | S base outline, matches status amber |
| Declined | `--kf-navy-soft` #123A63 | hollow bases, solid mound, paths at 40% |
| On navy | white .92 bases + mound; 1C paths stay #DFA968 | hero, panel band |
| Mono | all #123A63, paths dropped | print, single-color contexts |

## 4. States

| State | App event | Behavior |
|---|---|---|
| At rest | idle | 0.5px micro drift, 5.2s alternate, staggered |
| Working - the turn | tool running | all four bases glide one base counterclockwise (S to E to N to W order per tile), 4.6s cycle, glide 7% hold 18% per leg; mound and paths fixed |
| Writing | streaming | opacity pulse 1 to .5, base order E N W S, 1.8s |
| Settled | grounded | bases at home, one-shot glint (brightness 1.12, 650ms), then still |
| Held - partial | partial | S base hollow with 2.2 amber border; rest unchanged |
| Honest no | declined | all bases hollow navy 2.2, mound solid navy, paths navy at 40% opacity, everything still |

## 5. Transitions - the engineering piece

- **Tiles carry a permanent transparent 2.2px border with `box-sizing: border-box`.** Partial and declined then transition only `background-color` and `border-color` over 240ms - no snap, no layout shift.
- **Working to any settled state waits for the iteration boundary.** The orbit keyframes start and end at home, so: on state change out of `st-turn`, hold the request, listen for `animationiteration` on one tile (`once: true`), then swap classes. The bases visibly finish the current leg and come home before the glint fires. Never swap mid-leg.
- Glint is a one-shot animation class, added on settle, removed after 700ms.

## 6. Wake - load choreography

Runs once on page load inside PR A's existing 50-840ms sequence, 1C surfaces only:

1. 0-260ms: paths draw (stroke-dasharray 91, dashoffset 91 to 0)
2. 180-560ms: bases drop in - translateY(-4px) + opacity 0 to settled, 200ms each, 90ms stagger, order E N W S
3. 560-700ms: mound scales in, 140ms

Reduced motion: everything appears instantly, no draw, no drop.

## 7. Attend

On composer focus, the mark brightens 4% (filter brightness 1.04, 180ms). Removed on blur. No other hover or focus behavior exists.

## 8. Deployment

| Surface | Size | Variant |
|---|---|---|
| /sous hero | 34 | 1C white-on-navy, rest state, wake on load |
| Playbook panel band | 16 | 1A white |
| Status companion (answer card) | 19 | 1A, turn while tools run, settles with answer |
| First-run block | 64 | 1C, rest |
| Favicon /sous | 16/32 | 1A |
| Top nav | 18 | 1A filled, `currentColor`, inherits row opacity (.6 idle, 1 active); one scoped rule: `.kf-topnav-link.active .sa-navmark { color: var(--accent-sous) }` |

Nav evidence: measured ink fraction at 18px - filled mark 0.192 vs calendar 0.228 and book 0.213. The filled mark sits lighter than its stroke neighbors; the outline variant measured heaviest (0.249) and is rejected.

## 9. Accessibility and motion

- The mark is always `aria-hidden="true"`. Status semantics live in text (status pills, staged-thinking line) - the mark never carries meaning alone.
- `prefers-reduced-motion`: all animation suppressed; states render as their settled frames; wake is instant.

## 10. Implementation plan

- Component: `src/app/sous/SousMark.js` - props: `variant` (`display` | `small`), `state`, `size`; renders the div/svg structure with `sa-mark-*` classes.
- Styles: appended to `sous.css` under the existing module prefix.
- Cross-module touch (the only one): `TopNav.js` swaps the Sparkle inline svg for the 24-basis mark svg; `TopNav.css` gains the one active-state rule. Flag in the PR body.
- No new dependencies. Pure CSS/SVG.

## 11. Acceptance - for the CC prompt

- `npm run build` clean `[ran]`
- Reduced-motion toggle: zero animation anywhere the mark renders `[ran]`
- `animationiteration` handoff: settle requested mid-leg visibly completes the leg before the glint - screen recording or frame description `[ran]`
- Nav screenshot: mark beside calendar/book icons at idle and active `[ran]`
- Favicon renders at 16 in a browser tab `[ran]`
- Mark is `aria-hidden` in every deployment `[code-read]`
- Hyphens only; no emoji; sentence case throughout
