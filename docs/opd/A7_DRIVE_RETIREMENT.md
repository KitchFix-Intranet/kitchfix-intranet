# Phase A · A7 Drive Retirement - Orphan Inventory

**Built:** 2026-06-16
**For:** the A7 cleanup PR (after A5 lands + Drive is no longer the SousAI source).
**Status:** A5 in flight (PR pending). Once A5 merges + the full corpus embed runs from MDX, the items below become dead code on prod and can be removed.

## What A5 retires (becomes orphaned the moment A5 merges)

### Code

| Path | Role today | Post-A5 state |
|---|---|---|
| `src/lib/sousai/extract.js` | Google Docs API extractor (`extractGoogleDoc(documentId)`) - JWT auth via `getJwtClient()`, calls `docs.documents.get()`, walks `body.content` to produce `{driveTitle, sections}`. The Drive-side ingestion path. | Fully orphaned. No call sites remain - `src/lib/sousai/index.js:embedDocument()` now uses `extractMdx(docId)` from `extractMdx.js`. **A7: delete the file** + the corresponding import in `index.js` (already removed in A5). |
| `src/lib/sousai/index.js:embedDocument`'s `driveFileId` parameter | Was a required arg pointing the extractor at a specific Drive file ID. | Removed in A5. The signature is now `embedDocument({docId, language, docsMap})`. |
| `scripts/sousai-embed-corpus.mjs:source_drive_id` reads | Per-doc dispatch checked `source_drive_id` to know whether to extract (text path) or skip. | Removed in A5. Dispatch is now POST class → stub; else → MDX (with skip if the MDX file is missing). |

### Auth scopes (drop when A7 lands)

| Scope | Used by | Disposition |
|---|---|---|
| `https://www.googleapis.com/auth/documents.readonly` | Only `src/lib/sousai/extract.js` (via the service-account JWT in `getJwtClient`). | **A7: remove from the SCOPES array** in `extract.js` when the file is deleted. The service-account email itself stays - it's still used for Drive uploads (invoice, incident) and Sheets reads/writes per `docs/ARCHITECTURE.md` auth boundary. |
| `https://www.googleapis.com/auth/drive.readonly` (the read-only Drive scope, used by SousAI ingestion to resolve doc metadata) | Same - only `extract.js`. | Same disposition. Other modules use the broader `drive` scope (per `src/lib/auth.js` - one of the standing findings is that scope is overly permissive). |

### Env vars

None. The same `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY` pair is shared with the rest of the app (Sheets, Drive uploads for invoices/incidents). **No env var rotation needed at A7.**

## What STAYS after A5 (separate retirement, NOT A7)

These touch Drive but aren't SousAI ingestion - they're the reader fallback + the catalog column. They retire at the **A3 reader Drive-iframe cleanup**, not here.

| Path | Role | Stays through |
|---|---|---|
| `documents.source_drive_id` + `documents.source_drive_id_es` columns | Per-doc Drive file IDs entered by the operator in `/playbook/admin`. The A3 reader uses them to build `drive_view_url` + `drive_preview_url` for the fallback iframe path when `document_content` is missing for a doc. After A4 every doc has rendered HTML, so the fallback is dead in practice - but the column + fallback code haven't been removed yet. | A3 reader Drive-iframe cleanup (separate PR, post-A7) |
| `src/app/api/playbook/route.js` Drive URL construction (`drive_view_url`, `drive_preview_url`, `_es` variants) | Same as above - builds Drive URLs from the catalog row for the iframe fallback. | Same. |
| `src/app/playbook/SlideOverReader.js` iframe + "Open in Drive" action | The fallback render path and the action button label-swap. | Same. |
| `src/lib/drive.js` (invoice + incident upload helpers) | Service-account Drive UPLOAD path. **Not in the SousAI surface** - unrelated to A7. | Stays indefinitely (or until the Incident rebuild moves uploads off Drive). |
| `src/app/playbook/admin/AdminClient.js` Drive ID editing | The owner-only Drive-ID field on the admin worklist (Part B of the editing model). | A3 reader Drive-iframe cleanup. |

## Sequencing the A7 cleanup PR

When A5 has been live for long enough that we're confident the MDX-fed corpus is the right source and re-runs are routine, A7 is a small PR:

1. Delete `src/lib/sousai/extract.js`.
2. Remove the `documents.readonly` + `drive.readonly` scopes from any remaining SousAI-only auth config (none in `src/lib/auth.js` today - those scopes were only in `extract.js`).
3. Update `docs/ARCHITECTURE.md`'s auth-boundary section to reflect that SousAI no longer touches Drive.
4. Captain's log entry in `docs/GOTCHAS.md` noting the Drive retirement for SousAI.

Total estimated diff: -200 lines, 1 file delete, 1 doc edit. The work is the wait + confidence, not the code.

## A note on Drive Docs API access lost vs Drive Storage access kept

SousAI specifically used the **Docs API** (the structured-document REST API at `googleapis.com/auth/documents.readonly`). The broader Drive service-account access for file uploads (invoices, incident attachments) is on a different scope and unaffected. A7 only retires the Docs API surface.
