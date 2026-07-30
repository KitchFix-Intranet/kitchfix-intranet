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
import { scAccountWindow } from "./data/scAccountWindow.js";
import { scHomestandDetail } from "./data/scHomestandDetail.js";
import { scServicePrice } from "./data/scServicePrice.js";
import { scOrientation } from "./data/scOrientation.js";
import { spendSummary } from "./data/spendSummary.js";
import { spendVendorHistory } from "./data/spendVendorHistory.js";
import {
  KNOWN_ROLES,
  KNOWN_TEAM_KEYS,
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

// ── SC + spend data tools (Phase F PR 2 - the four SC tools + two spend tools)

const SC_AND_SPEND_TOOLS = [
  {
    definition: {
      name: "sc_account_window",
      description:
        "Aggregate summary of Service Calendar performance for one account over one window. Returns a SINGLE record per call: projected + actual meal counts and revenue, days_with_actuals fraction, window boundaries. Never returns rows - sc_homestand_detail is the rows tool. Window options: 'month' (calendar month), 'homestand' (the current homestand or most recent if today is off-homestand), 'period' (the current P1-P13 period). asOf defaults to today. Partial windows are ALWAYS marked partial via is_partial + days_with_actuals - do not present a mid-window total as complete. Revenue is a DECLINE (revenue.available=false) when any service in the window has no configured price (price_effective_date IS NULL) - name the unpriced services rather than silently totaling.",
      input_schema: {
        type: "object",
        properties: {
          accountKey: { type: "string", description: "e.g. 'CIN - AZ'" },
          window: { type: "string", enum: ["month", "homestand", "period"], description: "defaults to 'month'" },
          asOf: { type: "string", description: "YYYY-MM-DD; defaults to today" },
        },
        required: ["accountKey"],
      },
    },
    async execute(input) { return scAccountWindow(input || {}); },
    summarize(result) {
      return {
        kind: "sc-window",
        accountKey: result?.parameters?.accountKey,
        window: result?.parameters?.window,
        is_partial: result?.is_partial,
        revenue_available: result?.revenue?.available,
      };
    },
    kind: "data",
    collectIds() { return []; },
  },
  {
    definition: {
      name: "sc_homestand_detail",
      description:
        "Row-per-(day, service) detail for a homestand. Returns ROWS capped at 200 with honest truncation - never aggregates. Days with no actuals entered carry actual_meals=null (DISTINCT from a zero-meal day - the whole point of this tool is chasing entry gaps). Services with no configured price carry revenue_available=false; meal counts still land. homestandRef 'current', 'next', 'previous', or explicit YYYY-MM-DD within a homestand.",
      input_schema: {
        type: "object",
        properties: {
          accountKey: { type: "string" },
          homestandRef: { type: "string", description: "'current' (default), 'next', 'previous', or YYYY-MM-DD" },
        },
        required: ["accountKey"],
      },
    },
    async execute(input) { return scHomestandDetail(input || {}); },
    summarize(result) {
      return {
        kind: "sc-homestand-detail",
        accountKey: result?.parameters?.accountKey,
        homestand_id: result?.homestand_id,
        rows: result?.row_count ?? 0,
        no_entry_days: result?.days_without_actuals ?? 0,
      };
    },
    kind: "data",
    collectIds() { return []; },
  },
  {
    definition: {
      name: "sc_service_price",
      description:
        "Look up the current price for a service at an account, as of a date. Encapsulates the F8 join trap (sc_service_prices has no account_key; the tool joins through sc_services). serviceNameOrId can be a substring of the service name or an exact service UUID. Optional includeHistory returns prior price rows. NO PRICE FOUND IS A DECLINE, not a $0 - each matched service carries price_available and price_decline_reason so the model can tell the user 'no configured price' rather than fabricating a rate.",
      input_schema: {
        type: "object",
        properties: {
          accountKey: { type: "string" },
          serviceNameOrId: { type: "string", description: "substring of service name, or exact service UUID" },
          asOf: { type: "string", description: "YYYY-MM-DD; defaults to today" },
          includeHistory: { type: "boolean", description: "include prior price rows" },
        },
        required: ["accountKey", "serviceNameOrId"],
      },
    },
    async execute(input) { return scServicePrice(input || {}); },
    summarize(result) {
      return {
        kind: "sc-price",
        matches: result?.total ?? 0,
        priced: result?.priced_count ?? 0,
        unpriced: result?.unpriced_count ?? 0,
      };
    },
    kind: "data",
    collectIds() { return []; },
  },
  {
    definition: {
      name: "sc_orientation",
      description:
        `Answers "where are we" for an account: current homestand, current P1-P13 period, and (for the 5 PDC accounts CIN-AZ, STL-FL, TBJ-FL, TBR-FL, TXR-AZ) the current PDC phase. Period is COMPANY-WIDE - a bare "what period are we in" question can be answered without an accountKey by calling scope='period' with no accountKey; the answer applies to all 11 service accounts (CORP has no service calendar). Homestand and PDC phase remain per-account. Returns whichever dimensions the account actually has; a missing dimension is a STRUCTURAL ANSWER, not a data gap ("no homestand schedule - this is a PDC facility"). Period output normalizes to "Period 8" / "P8" - never bare "8". Known team_keys: ${KNOWN_TEAM_KEYS.join(", ")}. scope: 'homestand' | 'period' | 'phase' | 'both' | 'all' (default all).`,
      input_schema: {
        type: "object",
        properties: {
          accountKey: { type: "string", description: "Optional when scope='period' (period is company-wide); required for homestand or phase." },
          date: { type: "string", description: "accepted but currently CURRENT_DATE-only via views (extension pending)" },
          scope: { type: "string", enum: ["homestand", "period", "phase", "both", "all"], description: "defaults to 'all'" },
        },
      },
    },
    async execute(input) { return scOrientation(input || {}); },
    summarize(result) {
      return {
        kind: "sc-orientation",
        accountKey: result?.parameters?.accountKey,
        dimensions: result?.account_shape?.dimensions_available ?? [],
      };
    },
    kind: "data",
    collectIds() { return []; },
  },
  {
    definition: {
      name: "spend_summary",
      description:
        "Aggregate invoice spend by category, vendor, and/or account, over a window. Corrections-chain resolved via v_invoice_submissions_current so totals don't double-count. Vendor names resolved through vendor_aliases (spelling varies across invoices). Historical rows (batch_rebuild) included by default; set excludeHistorical=true for live-only totals. Confidence caveat surfaces when many lines are OCR-flagged 'Review'. window: 'month' | 'year' | 'ytd' | 'date_range' (date_range requires dateFrom + dateTo).",
      input_schema: {
        type: "object",
        properties: {
          accountKey: { type: "string", description: "optional - omit for portfolio total" },
          vendorName: { type: "string", description: "vendor name substring (resolved via aliases)" },
          category: { type: "string", description: "line-item category substring (Food, Snacks, Packaging, etc.)" },
          window: { type: "string", enum: ["month", "year", "ytd", "date_range"], description: "defaults to 'month'" },
          dateFrom: { type: "string", description: "required when window=date_range" },
          dateTo: { type: "string", description: "required when window=date_range" },
          asOf: { type: "string", description: "YYYY-MM-DD; defaults to today" },
          excludeHistorical: { type: "boolean", description: "exclude batch_rebuild rows" },
        },
      },
    },
    async execute(input) { return spendSummary(input || {}); },
    summarize(result) {
      return {
        kind: "spend-summary",
        line_count: result?.totals?.line_count ?? 0,
        dollar_total: result?.totals?.dollar_total ?? 0,
      };
    },
    kind: "data",
    collectIds() { return []; },
  },
  {
    definition: {
      name: "spend_vendor_history",
      description:
        "Per-line vendor purchase history between two dates. Returns rows capped at 200 with honest truncation. Vendor alias resolution as in spend_summary. Use for 'what did we buy from Sysco between X and Y' questions.",
      input_schema: {
        type: "object",
        properties: {
          vendorName: { type: "string" },
          dateFrom: { type: "string", description: "YYYY-MM-DD" },
          dateTo: { type: "string", description: "YYYY-MM-DD" },
          accountKey: { type: "string", description: "optional filter" },
          excludeHistorical: { type: "boolean" },
        },
        required: ["vendorName", "dateFrom", "dateTo"],
      },
    },
    async execute(input) { return spendVendorHistory(input || {}); },
    summarize(result) {
      return {
        kind: "spend-history",
        rows: result?.row_count ?? 0,
        total_dollars: result?.total_dollars ?? 0,
      };
    },
    kind: "data",
    collectIds() { return []; },
  },
];

// ── The registry (flat array; document tools first for prompt-cache stability)

export const TOOL_REGISTRY = [...DOC_TOOLS, ...DATA_TOOLS, ...SC_AND_SPEND_TOOLS];

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
