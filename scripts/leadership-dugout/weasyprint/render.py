# ════════════════════════════════════════════════════════════════════════════
# render.py — WeasyPrint render runner for Leadership Dugout PDFs
#
# Renders archive PDFs at sign-off:
#   - Cycle Review (3 signatures collected)
#   - WOW Plan (Day 90 close-out signed)
#   - Scorecard (admin-triggered, optional)
#
# Triggered async from Next.js API. Returns Drive file ID.
# Sprint 4 wires this in.
# ════════════════════════════════════════════════════════════════════════════
