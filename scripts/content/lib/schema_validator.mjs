// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/lib/schema_validator.mjs
// F1.5: Ajv-backed JSON Schema validators for frontmatter + facts.
//
// Compiles each schema once at module load. Exposes validate* functions that
// return { ok: bool, errors: [{ path, msg }] } - normalized so the caller
// does not depend on Ajv's error object shape directly.
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCHEMA_DIR = join(REPO_ROOT, "content", "schema");

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
addFormats(ajv);

const frontmatterSchema = JSON.parse(readFileSync(join(SCHEMA_DIR, "frontmatter.schema.json"), "utf8"));
const factsSchema = JSON.parse(readFileSync(join(SCHEMA_DIR, "facts.schema.json"), "utf8"));

const validateFrontmatterFn = ajv.compile(frontmatterSchema);
const validateFactsFn = ajv.compile(factsSchema);

function normalize(errors) {
  if (!errors) return [];
  return errors.map((e) => ({
    path: e.instancePath || e.schemaPath || "/",
    msg: `${e.message || "validation error"}${e.params ? ` (${JSON.stringify(e.params)})` : ""}`,
    keyword: e.keyword,
  }));
}

export function validateFrontmatter(obj) {
  const ok = validateFrontmatterFn(obj);
  return { ok, errors: normalize(validateFrontmatterFn.errors) };
}

export function validateFactsFile(obj) {
  const ok = validateFactsFn(obj);
  return { ok, errors: normalize(validateFactsFn.errors) };
}

/**
 * Verify the MDX source parses through @mdx-js/mdx. Catches JSX syntax errors
 * that regex-based parsing would miss. Returns the compiled output discarded;
 * we only care that compile() does not throw.
 */
export async function mdxParseable(mdxSource) {
  const { compile } = await import("@mdx-js/mdx");
  try {
    await compile(mdxSource, { development: false });
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
