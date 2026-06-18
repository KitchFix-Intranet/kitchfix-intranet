// ────────────────────────────────────────────────────────────────────────────
// src/lib/opd/validateFrontmatter.js
//
// App-side frontmatter validator for the OPD authoring path. Thin Ajv
// wrapper duplicated from scripts/content/lib/schema_validator.mjs because
// the script (raw Node) and the app (Next bundle) have different
// module-resolution runtimes - the script reads the schema via
// readFileSync + import.meta.url, which breaks under webpack/turbopack.
//
// THE SCHEMA FILE IS SHARED. The wrapper code is what differs. Schema lives
// in content/schema/frontmatter.schema.json (one source of truth, imported
// as JSON by both).
// ────────────────────────────────────────────────────────────────────────────

import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import frontmatterSchema from "../../../content/schema/frontmatter.schema.json";

// Same Ajv options the script uses.
const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
addFormats(ajv);

const validateFn = ajv.compile(frontmatterSchema);

function normalize(errors) {
  if (!errors) return [];
  return errors.map((e) => ({
    path: e.instancePath || e.schemaPath || "/",
    msg: `${e.message || "validation error"}${e.params ? ` (${JSON.stringify(e.params)})` : ""}`,
    keyword: e.keyword,
  }));
}

export function validateFrontmatter(obj) {
  const ok = validateFn(obj);
  return { ok, errors: normalize(validateFn.errors) };
}
