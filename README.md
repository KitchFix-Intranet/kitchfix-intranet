# KitchFix Ops Hub

Internal operations intranet for KitchFix Performance Food Service. Serves Executive Chefs, site leads, and ops leadership across MLB, MiLB, PDC, and corporate kitchen accounts — a portfolio exceeding $10M annually.

**Live:** [https://kitchfix-intranet.vercel.app](https://kitchfix-intranet.vercel.app)
**Hosted by:** Vercel Pro
**Built by:** Kevin Fietek, Director of Operations

---

## What this is

A single web application that consolidates the operational tools KitchFix sites need to run service: HR submissions, vendor management, inventory counts, invoice capture (with AI OCR), labor budget tracking, service calendar, team directory, and analytics. Designed for chefs on phones in walk-in coolers and directors at desks — same tool, both jobs.

## Architecture in three sentences

A Next.js 16 / React 19 web app authenticated via Google OAuth, with **Google Sheets as the database** (five spreadsheets, each with a defined role) and a **service account** handling all writes. Drive and Gmail integrations power document storage and notifications. AI features (Invoice OCR, Smart Inventory matching) run through the Anthropic Claude API.

## Modules

| Route | Module | What it does |
|---|---|---|
| `/` | Home Dashboard | Hero banner, launchpad, news feed, celebrations |
| `/people` | People Portal | New Hire Wizard, PAFs, Action Center, Admin Queue, Incident Center |
| `/ops` | Ops Hub | Season Tracker, Smart Inventory, Invoice Capture, Vendor Portal |
| `/directory` | Team Directory | Account-by-account team contacts |
| `/service-calendar` | Service Calendar | Day-level service config and actuals |
| `/analytics` | Analytics | Admin-only usage dashboard |
| `/financial` | Financial | (Internal financial views) |

## Documentation

Everything beyond "what is this" lives in [`/docs/`](./docs/):

**Technical:**
- [`ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — five-pillar sheet architecture, modules, data flow, auth boundary
- [`CONVENTIONS.md`](./docs/CONVENTIONS.md) — non-obvious rules (action-dispatch APIs, file layout, naming)
- [`GOTCHAS.md`](./docs/GOTCHAS.md) — hard-won lessons. Read this before debugging anything.

**Design:**
- [`DESIGN_REVIEW_PERSONA.md`](./docs/DESIGN_REVIEW_PERSONA.md) — how to run a UX/UI/EI review
- [`DESIGN_SYSTEM_REFERENCE.md`](./docs/DESIGN_SYSTEM_REFERENCE.md) — palette, tokens, roles, scales
- [`DESIGN_PRINCIPLES.md`](./docs/DESIGN_PRINCIPLES.md) — Floor-first, Four Gates, EI lens

## Local development

```bash
cp .env.example .env.local   # fill in real values from the Vercel dashboard
npm install
npm run dev                  # http://localhost:3000
```

Full quickstart in [`docs/LOCAL_DEV.md`](./docs/LOCAL_DEV.md), including the prod-data warning, the one-time Google OAuth localhost redirect, the SC v2 flag, and troubleshooting. `.env.example` in the repo root is the authoritative scaffold; every var carries a comment explaining what it is and where to copy the value from.

## Deploying

Push to `main` → Vercel auto-deploys to production. There is no staging environment. Every merge to main is live.

## Contributing

This is a solo-maintained project. The intended contributor — including future-Kevin returning to a module after months away, or any AI assistant pulling code from this repo — should always read `/docs/CONVENTIONS.md` and `/docs/GOTCHAS.md` before making changes.