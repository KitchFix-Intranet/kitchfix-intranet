// ════════════════════════════════════════════════════════════════════════════
// Project OPD · The Playbook · shared lookups
// ════════════════════════════════════════════════════════════════════════════
//
// Pure data maps used by both the catalog client (PlaybookClient.js) and the
// owner admin dashboard (admin/AdminClient.js). No React, no DOM. Lives in a
// neutral module so neither client has to depend on the other.
//
// File is prefixed with _ so the Next.js App Router doesn't treat it as a
// route segment.
// ════════════════════════════════════════════════════════════════════════════

export const CLASS_LABELS = {
  PB:   "Playbook",
  SOP:  "SOP",
  TPL:  "Template",
  REF:  "Reference",
  STD:  "Standard",
  POL:  "Policy",
  AGR:  "Agreement",
  FORM: "Form",
  POST: "Poster",
  CHK:  "Checklist",
};

// Class chip color family - 4 grouped tints (CSS .pb-class-chip--{family})
// for scan-by-color rather than 10 separate colors:
//   gov  = STD, POL, AGR   (governance - navy family)
//   proc = PB, SOP         (procedures - teal family, page house color)
//   tool = TPL, FORM, CHK  (work tools - sand/amber)
//   ref  = POST, REF       (postings & references - manilla/beige)
export const CLASS_FAMILY = {
  STD:  "gov",
  POL:  "gov",
  AGR:  "gov",
  PB:   "proc",
  SOP:  "proc",
  TPL:  "tool",
  FORM: "tool",
  CHK:  "tool",
  POST: "ref",
  REF:  "ref",
};

// Status palette - Pending is the ghost (transparent fill, faint border) so
// it recedes in build-out where it's the default state. The other statuses
// get slightly more saturated tints so they pop against the Pending wallpaper.
// Placeholder uses soft lavender - calm, distinct from Draft (amber) and
// Pending (ghost), quieter than alarm-leaning Blocked (red).
export const STATUS_COLORS = {
  "Live":        { bg: "#a7f3d0", color: "#065f46", ghost: false },
  "In Build":    { bg: "#bfdbfe", color: "#1e3a8a", ghost: false },
  "Draft":       { bg: "#fde68a", color: "#92400e", ghost: false },
  "Pending":     { bg: "transparent", color: "#94a3b8", ghost: true },
  "Placeholder": { bg: "#e9e3f5", color: "#6b46c1", ghost: false },
  "Blocked":     { bg: "#fecaca", color: "#991b1b", ghost: false },
};

// Ordered list used by the admin metrics rollup (and any other UI that
// needs a stable status order).
export const ALL_STATUSES = [
  "Live",
  "In Build",
  "Draft",
  "Pending",
  "Placeholder",
  "Blocked",
];

export const RELATIONSHIP_LABELS_OUT = {
  references:    "References",
  implements:    "Implements",
  supersedes:    "Supersedes",
  superseded_by: "Superseded by",
  derived_from:  "Derived from",
  related:       "Related to",
};

export const RELATIONSHIP_LABELS_IN = {
  references:    "Referenced by",
  implements:    "Implemented by",
  supersedes:    "Replaces (older)",
  superseded_by: "Replacement for",
  derived_from:  "Source for",
  related:       "Related to",
};
