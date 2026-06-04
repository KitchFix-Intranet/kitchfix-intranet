// ════════════════════════════════════════════════════════════════════════════
// src/lib/playbookValidation.js
// Validation helpers for /playbook/admin create-document action.
// ════════════════════════════════════════════════════════════════════════════
//
// validatePatch (for update-document) lives in route.js because it's tightly
// coupled to the WRITABLE_FIELDS_A allowlist and the existing actions only
// it uses. validateCreatePayload is here because (a) it's larger and (b) the
// CLI demo script exercises it without dragging the route in.
//
// The validation sets (validShelves, validClasses, validStatuses) are passed
// in as parameters rather than imported as constants so that route.js stays
// the canonical owner of those lists (SHELVES, VALID_CLASSES, VALID_STATUSES).
// One source of truth, no duplication, no surprise refactor.
// ════════════════════════════════════════════════════════════════════════════

// Doc ID format: PREFIX-NNN where PREFIX is one of 11 locked values and
// NNN is a 3-digit number. Matches every existing catalog ID.
//
// POSTER prefix maps to doc_class POST (the only special case). Every
// other prefix maps to a doc_class of the same name.
export const STRICT_DOC_ID_RE =
  /^(PB|STD|POL|SOP|TPL|CHK|REF|AGR|FORM|POST|POSTER)-\d{3}$/;

export const PREFIX_TO_DOC_CLASS = Object.freeze({
  PB:     "PB",
  STD:    "STD",
  POL:    "POL",
  SOP:    "SOP",
  TPL:    "TPL",
  CHK:    "CHK",
  REF:    "REF",
  AGR:    "AGR",
  FORM:   "FORM",
  POST:   "POST",
  POSTER: "POST",  // the one special case - POSTER-NNN IDs have doc_class POST
});

/**
 * Validate a create-document payload.
 *
 * @param {object} payload - { id, title, shelf?, doc_class, status?, version? }
 * @param {object} [sets] - { validShelves: Set, validClasses: Set, validStatuses: Set }
 *   Sets (not arrays) for O(1) lookup. Pass null/undefined to skip a check.
 *
 * @returns {{ ok: true, clean: {...} } | { ok: false, error: string }}
 *
 * Defaults applied on `clean`:
 *   - status: "Pending" if not provided
 *   - version: null (per spec - a brand-new doc with no content shouldn't
 *     claim a version it doesn't have)
 *   - shelf: null if not provided (shelf is optional on create)
 */
export function validateCreatePayload(
  payload,
  { validShelves, validClasses, validStatuses } = {}
) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Body must be a non-null object" };
  }

  const { id, title, shelf, doc_class, status, version } = payload;

  // ── id: required, regex-valid, prefix↔doc_class consistent ──────────────
  if (typeof id !== "string" || !id) {
    return { ok: false, error: "id is required (non-empty string)" };
  }
  if (!STRICT_DOC_ID_RE.test(id)) {
    return {
      ok: false,
      error:
        `id '${id}' is malformed. Must be PREFIX-NNN where PREFIX is one of ` +
        `PB/STD/POL/SOP/TPL/CHK/REF/AGR/FORM/POST/POSTER and NNN is a 3-digit ` +
        `number (e.g. PB-007, POSTER-002).`,
    };
  }

  // ── doc_class: required, in allowed set ─────────────────────────────────
  if (typeof doc_class !== "string" || !doc_class) {
    return { ok: false, error: "doc_class is required (non-empty string)" };
  }
  if (validClasses && !validClasses.has(doc_class)) {
    return { ok: false, error: `invalid doc_class '${doc_class}'` };
  }

  // ── prefix ↔ doc_class consistency ──────────────────────────────────────
  const prefix = id.split("-")[0];
  const expectedClass = PREFIX_TO_DOC_CLASS[prefix];
  if (expectedClass !== doc_class) {
    return {
      ok: false,
      error:
        `id prefix '${prefix}' does not match doc_class '${doc_class}' ` +
        `(prefix '${prefix}' implies doc_class '${expectedClass}')`,
    };
  }

  // ── title: required, non-empty trimmed ──────────────────────────────────
  if (typeof title !== "string" || !title.trim()) {
    return { ok: false, error: "title is required (non-empty string)" };
  }

  // ── shelf: optional ─────────────────────────────────────────────────────
  let cleanShelf = null;
  if (shelf !== undefined && shelf !== null) {
    if (typeof shelf !== "string") {
      return { ok: false, error: "shelf must be a string or null" };
    }
    if (validShelves && !validShelves.has(shelf)) {
      return { ok: false, error: `invalid shelf '${shelf}'` };
    }
    cleanShelf = shelf;
  }

  // ── status: optional, defaults to "Pending" ─────────────────────────────
  const cleanStatus = status ?? "Pending";
  if (typeof cleanStatus !== "string") {
    return { ok: false, error: "status must be a string" };
  }
  if (validStatuses && !validStatuses.has(cleanStatus)) {
    return { ok: false, error: `invalid status '${cleanStatus}'` };
  }

  // ── version: optional, null default (honest blank for empty doc) ────────
  // A brand-new catalog row with no content shouldn't claim a version it
  // doesn't have. The owner sets a real version when there's content to
  // version.
  let cleanVersion = null;
  if (version !== undefined && version !== null) {
    if (typeof version !== "string") {
      return { ok: false, error: "version must be a string or null" };
    }
    const trimmed = version.trim();
    cleanVersion = trimmed.length === 0 ? null : trimmed;
  }

  return {
    ok: true,
    clean: {
      id,
      title: title.trim(),
      shelf: cleanShelf,
      doc_class,
      status: cleanStatus,
      version: cleanVersion,
    },
  };
}
