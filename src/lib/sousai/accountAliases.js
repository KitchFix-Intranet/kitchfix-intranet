// ─────────────────────────────────────────────────────────────────────────────
// src/lib/sousai/accountAliases.js
// SousAI · account nickname / typo → canonical account key resolver
// ─────────────────────────────────────────────────────────────────────────────
//
// Round 1 Part A (E1, 2026-08-04). Kevin: "a lookup table mapping how
// people actually refer to accounts - city names, team nicknames, spacing
// variants, common misspellings - to canonical keys, consulted before the
// tool call. Follow the existing vendor_aliases pattern."
//
// The corpus of canonical keys is 11 current-season accounts:
//   CIN-AZ, CIN-KY, CIN-OH (Cincinnati Reds: AZ Spring Training,
//                            KY / Louisville MiLB, OH / GABP MLB)
//   STL-FL, STL-MO         (St. Louis Cardinals: FL Spring Training,
//                            MO / Busch Stadium MLB)
//   TBJ-FL, TBJ-NY         (Toronto Blue Jays: FL Spring Training,
//                            NY / Buffalo MiLB PDC)
//   TBR-FL                 (Tampa Bay Rays: FL, MiLB PDC)
//   TXR-AZ, TXR-TX-H, TXR-TX-V (Texas Rangers: AZ Spring Training,
//                                TX Home stadium, TX Visitor stadium)
//
// The resolver runs BEFORE the tool call: given an input string that
// looks like it names an account, produce the canonical key. Consumers:
//   - runSousAgent's pre-call resolver (Round 1 Part A)
//   - future admin tooling that accepts free-text account names
//
// Failure mode: an ambiguous or unknown input returns null - the caller
// must ask the user rather than guessing. Never fabricate a resolution.
// ─────────────────────────────────────────────────────────────────────────────

export const CANONICAL_ACCOUNT_KEYS = Object.freeze([
  "CIN-AZ", "CIN-KY", "CIN-OH",
  "STL-FL", "STL-MO",
  "TBJ-FL", "TBJ-NY",
  "TBR-FL",
  "TXR-AZ", "TXR-TX-H", "TXR-TX-V",
]);

// Some accounts carry SC-schema-canonical spaced-hyphen forms per prompt
// sanctioned line 4. Both spaced and unspaced forms should resolve to the
// unspaced schema key here (canonical resolution downstream).
const SPACED_TO_UNSPACED = {
  "CIN - AZ": "CIN-AZ",
  "CIN - KY": "CIN-KY",
  "CIN - OH": "CIN-OH",
  "STL - FL": "STL-FL",
  "STL - MO": "STL-MO",
  "TBJ - FL": "TBJ-FL",
  "TBJ - NY": "TBJ-NY",
  "TBR - FL": "TBR-FL",
  "TXR - AZ": "TXR-AZ",
  "TXR - TX - H": "TXR-TX-H",
  "TXR - TX - V": "TXR-TX-V",
};

// Nickname / typo / free-form → canonical. Kept lowercased at lookup time
// so the source table stays human-readable (proper case city names). Fail-
// closed: an unknown alias returns null, caller asks the user.
const ALIASES = {
  // Cincinnati Reds (Reds)
  "reds": null,                      // ambiguous - 3 accounts (spring/MiLB/MLB)
  "reds arizona": "CIN-AZ",
  "reds spring": "CIN-AZ",
  "reds spring training": "CIN-AZ",
  "goodyear": "CIN-AZ",              // Reds' AZ spring training site
  "goodyear ballpark": "CIN-AZ",
  "cincinnati arizona": "CIN-AZ",
  "reds kentucky": "CIN-KY",
  "louisville": "CIN-KY",            // Louisville Bats, Reds' AAA affiliate
  "louisville bats": "CIN-KY",
  "reds louisville": "CIN-KY",
  "reds ohio": "CIN-OH",
  "cincinnati": "CIN-OH",            // MLB home takes the bare city name
  "gabp": "CIN-OH",                  // Great American Ballpark abbrev
  "great american": "CIN-OH",
  "great american ballpark": "CIN-OH",
  "reds mlb": "CIN-OH",
  "reds home": "CIN-OH",
  // St. Louis Cardinals (Cardinals / Cards)
  "cardinals": null,
  "cards": null,
  "cardinals spring": "STL-FL",
  "cardinals florida": "STL-FL",
  "jupiter": "STL-FL",               // Cardinals' Jupiter FL spring site
  "roger dean": "STL-FL",
  "roger dean stadium": "STL-FL",
  "cardinals missouri": "STL-MO",
  "st louis": "STL-MO",
  "st. louis": "STL-MO",
  "saint louis": "STL-MO",
  "stl": "STL-MO",                   // bare STL almost always means MLB home
  "busch": "STL-MO",
  "busch stadium": "STL-MO",
  "cardinals home": "STL-MO",
  "cardinals mlb": "STL-MO",
  // Toronto Blue Jays (Jays)
  "blue jays": null,
  "jays": null,
  "blue jays spring": "TBJ-FL",
  "jays spring": "TBJ-FL",
  "dunedin": "TBJ-FL",               // Jays' Dunedin FL spring site
  "td ballpark": "TBJ-FL",
  "jays florida": "TBJ-FL",
  "jays new york": "TBJ-NY",
  "buffalo": "TBJ-NY",
  "buffalo bisons": "TBJ-NY",
  "sahlen field": "TBJ-NY",
  "jays milb": "TBJ-NY",
  // Tampa Bay Rays (Rays)
  "rays": "TBR-FL",                  // only one Rays account, unambiguous
  "tampa bay": "TBR-FL",
  "tampa bay rays": "TBR-FL",
  "port charlotte": "TBR-FL",        // Rays' Port Charlotte FL spring site
  "charlotte sports park": "TBR-FL",
  // Texas Rangers (Rangers)
  "rangers": null,
  "rangers arizona": "TXR-AZ",
  "rangers spring": "TXR-AZ",
  "surprise": "TXR-AZ",              // Rangers' Surprise AZ spring site
  "surprise stadium": "TXR-AZ",
  "rangers texas": null,             // ambiguous - two TX accounts (H + V)
  "rangers home": "TXR-TX-H",
  "globe life": "TXR-TX-H",
  "globe life field": "TXR-TX-H",
  "arlington": "TXR-TX-H",
  "rangers visitor": "TXR-TX-V",
  "rangers away": "TXR-TX-V",
  // Common misspellings (typo corridor - single-letter transposes /
  // dropped letters on well-known city names).
  "cincinati": "CIN-OH",
  "cincinati oh": "CIN-OH",
  "cinci": "CIN-OH",
  "louisville ky": "CIN-KY",
  "toronto": "TBJ-NY",               // Toronto proper never runs; user usually means Buffalo affiliate
  "toronto blue jays": null,
  "texas": null,
  "texas rangers": null,
};

function normalizeInput(raw) {
  if (raw == null) return "";
  return String(raw)
    .toLowerCase()
    .replace(/[.,!?]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve a free-text account reference to a canonical key.
 *
 * Returns:
 *   { canonical: "STL-MO", source: "alias" }        - resolved via alias table
 *   { canonical: "STL-MO", source: "spaced" }       - spaced form of canonical
 *   { canonical: "STL-MO", source: "canonical" }    - already canonical
 *   { canonical: null, source: "ambiguous", candidates: ["STL-FL", "STL-MO"] }
 *   { canonical: null, source: "unknown" }          - no match
 *
 * Callers should NEVER guess on ambiguous / unknown - ask the user.
 */
export function resolveAccountAlias(raw) {
  if (raw == null || raw === "") return { canonical: null, source: "unknown" };
  const stripped = String(raw).trim();
  // 1. Direct canonical match (unspaced form).
  if (CANONICAL_ACCOUNT_KEYS.includes(stripped)) {
    return { canonical: stripped, source: "canonical" };
  }
  // 2. Spaced-canonical form (STL - FL / TXR - TX - H).
  if (SPACED_TO_UNSPACED[stripped]) {
    return { canonical: SPACED_TO_UNSPACED[stripped], source: "spaced" };
  }
  // 3. Alias lookup (case-insensitive + punctuation-stripped).
  const key = normalizeInput(stripped);
  if (!key) return { canonical: null, source: "unknown" };
  if (Object.prototype.hasOwnProperty.call(ALIASES, key)) {
    const target = ALIASES[key];
    if (target === null) {
      // Explicitly ambiguous - the input is a known-name-with-multiple-
      // resolutions (e.g. "cardinals", "reds", "rangers texas"). Return
      // the candidate list so the caller can craft a clarifier.
      return {
        canonical: null,
        source: "ambiguous",
        candidates: candidatesFor(key),
      };
    }
    return { canonical: target, source: "alias" };
  }
  return { canonical: null, source: "unknown" };
}

// Given an ambiguous key, list the candidate canonical keys that share its
// team prefix. Used to build a clarifier question ("Cardinals spring
// training (STL-FL) or the MLB home (STL-MO)?").
function candidatesFor(key) {
  if (key.startsWith("reds")) return ["CIN-AZ", "CIN-KY", "CIN-OH"];
  if (key.startsWith("cardinals") || key.startsWith("cards")) return ["STL-FL", "STL-MO"];
  if (key.startsWith("jays") || key.startsWith("blue jays")) return ["TBJ-FL", "TBJ-NY"];
  if (key.startsWith("rangers") || key.startsWith("texas")) return ["TXR-AZ", "TXR-TX-H", "TXR-TX-V"];
  return [];
}

/**
 * List every alias seeded, for [ran] proof + admin surface. Returns an
 * array of { input, canonical } records. Ambiguous inputs appear with
 * canonical=null and the caller can decorate with candidates.
 */
export function listAliases() {
  return Object.entries(ALIASES).map(([input, canonical]) => ({ input, canonical }));
}
