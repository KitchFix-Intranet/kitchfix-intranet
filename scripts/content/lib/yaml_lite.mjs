// ─────────────────────────────────────────────────────────────────────────────
// scripts/content/lib/yaml_lite.mjs
//
// SUPERSEDED by js-yaml (F1.5). This file remains only as a thin shim so
// older imports keep working. New code should import from `lib/frontmatter`
// (gray-matter for MDX, loadYaml for the facts file).
//
// js-yaml handles the full YAML 1.2 grammar plus the edge cases the F1 parser
// could not cover (anchors, multi-line scalars, the type tag system, etc.).
// ─────────────────────────────────────────────────────────────────────────────

import yaml from "js-yaml";

export function parseYaml(src) {
  return yaml.load(src) ?? {};
}
