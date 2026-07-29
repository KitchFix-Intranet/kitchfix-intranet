// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/tools/registry.js
// SousAI · Phase F · data-driven tool registry.
//
// The agent loop consumes this registry to build the model-facing tool list
// and to dispatch tool_use calls. Adding a tool later is:
//   1. a new file in tools/ (document tools) or tools/data/ (data tools),
//   2. one new entry appended to the DATA_TOOLS array (or DOC_TOOLS), and
//   3. nothing in agent.js changes.
//
// Each entry is a plain object with the tool_use schema the model sees,
// plus three handlers the loop calls:
//   - `execute(input, ctx)`     -> model-facing result
//   - `summarize(result)`       -> compact trajectory summary
//   - `collectIds(result)`      -> array of doc ids to add to the citation-
//                                  valid set (data tools return [] since
//                                  their results are not doc-citations)
//
// The ctx carries accessLevels for document tools. Data tools ignore it (the
// directory tables carry no access-tier gating; the route-level gate at
// canUseSous is what enforces access to the whole surface).
//
// Every entry declares `kind`: "doc" or "data". The agent loop uses `kind` to
// resolve grounding validity: doc tools produce doc-id citations, data tools
// contribute a successful-call signal (data-tool answers cite the source
// table + load date in prose, not as a doc-id, so the citation regex won't
// match and validSources would be empty without this signal).
// ─────────────────────────────────────────────────────────────────────────────

import { searchDocuments } from "./searchDocuments.js";
import { getDocument } from "./getDocument.js";
import { listDocuments } from "./listDocuments.js";
import { findContact } from "./data/findContact.js";
import { listAccounts } from "./data/listAccounts.js";
import { listContactsByRole } from "./data/listContactsByRole.js";
import { getAccountTeam } from "./data/getAccountTeam.js";
import {
  KNOWN_ROLES,
} from "./data/_constants.js";

const GET_DOCUMENT_MAX_BATCH = 6;

// ── Document tools (three tools that predate Phase F) ────────────────────────

const DOC_TOOLS = [
  {
    definition: {
      name: "search_documents",
      description:
        "Doc-level semantic search over the KitchFix Playbook corpus. Returns the top matching documents with best-match snippets. Use for topical questions when you do not know which doc holds the answer. Snippets are locators, not the record itself - open the doc with get_document to answer from actual content.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The natural-language search query." },
          k: {
            type: "integer",
            description: "How many docs to return (default 5, max 10).",
            minimum: 1,
            maximum: 10,
          },
        },
        required: ["query"],
      },
    },
    async execute(input, ctx) {
      const { query, k } = input || {};
      const docs = await searchDocuments(query, {
        accessLevels: ctx.accessLevels,
        k: typeof k === "number" ? k : 5,
      });
      return docs.map((d) => ({
        docId: d.docId,
        title: d.title,
        docClass: d.docClass,
        bestSimilarity: Number(d.bestSimilarity?.toFixed(4)),
        snippets: d.snippets.map((s) => ({
          section: s.section,
          content: s.content,
          similarity: Number(s.similarity?.toFixed(4)),
        })),
      }));
    },
    summarize(result) {
      return {
        kind: "docs",
        count: Array.isArray(result) ? result.length : 0,
        top: Array.isArray(result) ? result.slice(0, 5).map((d) => d.docId) : [],
      };
    },
    kind: "doc",
    collectIds(result) {
      return Array.isArray(result) ? result.map((d) => d.docId).filter(Boolean) : [];
    },
  },
  {
    definition: {
      name: "get_document",
      description:
        "Fetch the full SousAI-safe text of a document by its ID, or up to 6 documents in one call. Use once search points you at a doc, or when the user gives an exact doc ID. Use the BATCH form for enumeration questions after listing the class. Refusals carry a `reason` field (not_found, access, archived, not_live) and no content.",
      input_schema: {
        type: "object",
        properties: {
          docIds: {
            oneOf: [
              { type: "string", description: "A single document ID like PB-002." },
              {
                type: "array",
                items: { type: "string" },
                minItems: 1,
                maxItems: 6,
                description: "Up to 6 document IDs in one call for batched reading.",
              },
            ],
            description: "One doc ID (string) or up to 6 doc IDs (array).",
          },
        },
        required: ["docIds"],
      },
    },
    async execute(input, ctx) {
      let ids = input?.docIds;
      if (typeof ids === "string") ids = [ids];
      if (!Array.isArray(ids) || ids.length === 0) {
        return { error: "docIds must be a string or non-empty array" };
      }
      if (ids.length > GET_DOCUMENT_MAX_BATCH) {
        return {
          error: `get_document accepts at most ${GET_DOCUMENT_MAX_BATCH} ids per call; got ${ids.length}. Split into two calls.`,
        };
      }
      const results = {};
      for (const id of ids) {
        results[id] = await getDocument(id, { accessLevels: ctx.accessLevels });
      }
      return results;
    },
    summarize(result) {
      const per = {};
      for (const [id, r] of Object.entries(result || {})) {
        per[id] = r?.available
          ? { available: true, tokens: r.tokenTotal, truncated: !!r.truncated }
          : { available: false, reason: r?.reason };
      }
      return per;
    },
    kind: "doc",
    collectIds(result) {
      const ids = [];
      for (const [id, r] of Object.entries(result || {})) {
        if (r && r.available) ids.push(id);
      }
      return ids;
    },
  },
  {
    definition: {
      name: "list_documents",
      description:
        "Catalog listing filtered by doc class. Returns Live+visible documents only. Use for enumeration questions BEFORE get_document - list the class first, then batch-read the records. Doc classes include PB, POL, SOP, REC, REF, TPL, STD, FORM, AGR, CHK, POST.",
      input_schema: {
        type: "object",
        properties: {
          docClass: {
            type: "string",
            description:
              "Optional doc class filter (e.g. REC for account records, SOP for procedures). Omit to list every visible Live doc.",
          },
        },
      },
    },
    async execute(input, ctx) {
      const { docClass } = input || {};
      const rows = await listDocuments({ docClass, accessLevels: ctx.accessLevels });
      return rows.map((r) => ({
        id: r.id,
        title: r.title,
        doc_class: r.doc_class,
        status: r.status,
      }));
    },
    summarize(result) {
      return {
        kind: "list",
        count: Array.isArray(result) ? result.length : 0,
        classes: Array.isArray(result) ? [...new Set(result.map((r) => r.doc_class))] : [],
      };
    },
    kind: "doc",
    collectIds(result) {
      return Array.isArray(result) ? result.map((d) => d.id).filter(Boolean) : [];
    },
  },
];

// ── Data tools (Phase F PR 1 - directory) ────────────────────────────────────

const DATA_TOOLS = [
  {
    definition: {
      name: "find_contact",
      description:
        "Look up a person in the KitchFix leadership directory (30 people at Executive Chef, Sous Chef, Hospitality Manager, and corporate leadership levels). Partial and first-name-only names are supported ('Kelsey' resolves to Kelsey Atherton). Multiple matches return all of them - the tool does not guess. A zero-match result names the directory scope and does NOT imply the person does not exist elsewhere - line and hourly staff are not tracked here. This tool WINS over document sources for live people, contact, and account-roster questions - documents record what was true when written, contacts records who is there now.",
      input_schema: {
        type: "object",
        properties: {
          nameQuery: {
            type: "string",
            description: "Partial or full name to search (first name, last name, or substring).",
          },
        },
        required: ["nameQuery"],
      },
    },
    async execute(input) {
      return findContact({ nameQuery: input?.nameQuery });
    },
    summarize(result) {
      return { kind: "contact-search", total: result?.total ?? 0, returned: result?.matches?.length ?? 0 };
    },
    kind: "data",
    collectIds() { return []; },
  },
  {
    definition: {
      name: "list_accounts",
      description:
        "List the 12 current-season KitchFix accounts. Optional filter on `level` (MLB, MiLB, PDC, CORP) or exact `teamKey`. Retired accounts are physically removed from this table, not flagged - the corpus documents may still describe accounts that ended prior seasons (BGC, ended 2026-05-21, is one example: absent here but present in REF-140/141/142 and other corpus documents). A zero-result miss states 'not in the current-season list' rather than 'does not exist.'",
      input_schema: {
        type: "object",
        properties: {
          level: {
            type: "string",
            description: "Optional level filter (MLB / MiLB / PDC / CORP). Unknown values return validLevels for the model to restate.",
          },
          teamKey: {
            type: "string",
            description: "Optional exact team_key filter for a single-account lookup.",
          },
        },
      },
    },
    async execute(input) {
      return listAccounts({ level: input?.level, teamKey: input?.teamKey });
    },
    summarize(result) {
      return { kind: "accounts", total: result?.total ?? 0, returned: result?.accounts?.length ?? 0 };
    },
    kind: "data",
    collectIds() { return []; },
  },
  {
    definition: {
      name: "list_contacts_by_role",
      description:
        `List people in the leadership directory filtered by role. Roles are a controlled vocabulary of 14 values: ${KNOWN_ROLES.join(", ")}. Passing an unknown role returns the valid list rather than an empty result. Optional teamKey filter composes with the role (e.g. Executive Chef at CIN - OH). Use for role-shaped enumeration ("who are all the RDOs", "who is the Hospitality Manager at STL-MO"). This tool WINS over document sources for live role assignments.`,
      input_schema: {
        type: "object",
        properties: {
          role: {
            type: "string",
            description: "Role to filter on. Must match one of the KNOWN_ROLES (case-insensitive exact match).",
          },
          teamKey: {
            type: "string",
            description: "Optional team_key filter (e.g. 'CIN - OH') to compose with the role filter.",
          },
        },
        required: ["role"],
      },
    },
    async execute(input) {
      return listContactsByRole({ role: input?.role, teamKey: input?.teamKey });
    },
    summarize(result) {
      return {
        kind: "role-list",
        role: result?.parameters?.role,
        total: result?.total ?? 0,
        returned: result?.matches?.length ?? 0,
      };
    },
    kind: "data",
    collectIds() { return []; },
  },
  {
    definition: {
      name: "get_account_team",
      description:
        "Return the team on file at a single account, ordered by role seniority (Executive Chef, Sous Chef, Hospitality Manager first). Includes a `gaps` array naming any expected site role that is not on file (e.g. no Sous Chef listed) - a directory gap, not a claim the seat is unfilled. Requires exact teamKey ('CIN - OH', 'STL - MO'). Unknown teamKey returns the valid list. This tool WINS over document sources for live account rosters.",
      input_schema: {
        type: "object",
        properties: {
          teamKey: {
            type: "string",
            description: "Exact account team_key (e.g. 'CIN - OH', 'STL - MO', 'TXR - TX - H', 'CORP').",
          },
        },
        required: ["teamKey"],
      },
    },
    async execute(input) {
      return getAccountTeam({ teamKey: input?.teamKey });
    },
    summarize(result) {
      return {
        kind: "team-roster",
        teamKey: result?.parameters?.teamKey,
        total: result?.total ?? 0,
        gaps: result?.gaps?.map((g) => g.missing_role) ?? [],
      };
    },
    kind: "data",
    collectIds() { return []; },
  },
];

// ── The registry (flat array; document tools first for prompt-cache stability)

export const TOOL_REGISTRY = [...DOC_TOOLS, ...DATA_TOOLS];

const BY_NAME = new Map(TOOL_REGISTRY.map((t) => [t.definition.name, t]));

/**
 * @returns {Array<object>} the tool_use definitions to expose to the model.
 * The last entry is decorated with a cache_control marker by the caller.
 */
export function getToolDefinitions() {
  return TOOL_REGISTRY.map((t) => t.definition);
}

export function getTool(name) {
  return BY_NAME.get(name) || null;
}
