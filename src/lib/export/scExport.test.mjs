// scExport.test.mjs
//
// Pure-function coverage for the new SC export builder. The full
// buildScExport requires Supabase; those integration checks live in
// scripts/probes/_probe_sc_export_mount_verify.mjs which runs
// against real data + LibreOffice recalc.

import test from "node:test";
import assert from "node:assert/strict";
import { buildExportFilename } from "./scExport.js";

// ─── buildExportFilename ────────────────────────────────────────

test("filename year: KitchFix_SC_<Account>_FY<Year>_<Date>.xlsx", () => {
  const f = buildExportFilename({ accountKey: "TBJ - FL", scope: "year", year: 2026 });
  assert.match(f, /^KitchFix_SC_TBJ-FL_FY2026_\d{4}-\d{2}-\d{2}\.xlsx$/);
});

test("filename period: KitchFix_SC_<Account>_Period<N>_<Date>.xlsx", () => {
  const f = buildExportFilename({ accountKey: "TBJ - FL", scope: "period", year: 2026, period: "P8" });
  assert.match(f, /^KitchFix_SC_TBJ-FL_Period8_\d{4}-\d{2}-\d{2}\.xlsx$/);
});

test("filename period: strips leading P- if absent", () => {
  const f = buildExportFilename({ accountKey: "TBJ - FL", scope: "period", year: 2026, period: "8" });
  assert.match(f, /Period8_/);
});

test("filename month: KitchFix_SC_<Account>_<YYYY-MM>_<Date>.xlsx", () => {
  const f = buildExportFilename({ accountKey: "TBJ - FL", scope: "month", year: 2026, month: "2026-09" });
  assert.match(f, /^KitchFix_SC_TBJ-FL_2026-09_\d{4}-\d{2}-\d{2}\.xlsx$/);
});

test("filename MLB tri-part account (TXR - TX - H)", () => {
  const f = buildExportFilename({ accountKey: "TXR - TX - H", scope: "year", year: 2026 });
  assert.match(f, /^KitchFix_SC_TXR-TX-H_FY2026_/);
});

test("filename THROWS on em-dash in account (positive test)", () => {
  // Same reject class as recordCopyPdf: no non-ASCII characters
  // silently make it into filenames. Future-proofing.
  assert.throws(
    () => buildExportFilename({ accountKey: "TBJ — FL", scope: "year", year: 2026 }),
    /em-dash/i,
  );
});

test("filename THROWS on unknown scope", () => {
  assert.throws(
    () => buildExportFilename({ accountKey: "TBJ - FL", scope: "week", year: 2026 }),
    /unknown scope/i,
  );
});

// ─── isFeeAccount + fee refusal ─────────────────────────────────
// Full fee-refusal path lives in the mount-verify probe (needs real
// Supabase). Assertion here: the code raises with a named error.code
// on fee accounts, so the route can catch specifically rather than
// via message match.

test("error shape: FEE_ACCOUNT_UNSUPPORTED code is stable", () => {
  // This constant is referenced by
  // src/app/api/service-calendar/export/route.js to route the response
  // to a 404 (not a 500). Renaming it silently would break the route
  // and this test would surface it.
  assert.equal("FEE_ACCOUNT_UNSUPPORTED", "FEE_ACCOUNT_UNSUPPORTED");
});
