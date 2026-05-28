// ═══════════════════════════════════════════════════════════════
// VENDOR MATCHING
// ═══════════════════════════════════════════════════════════════
//
// Shared library for vendor name fuzzy-matching. Extracted from
// invoiceActions.js during PR 5.2 (Project 3 Module 5) as part of
// the S1 consolidation.
//
// SCOPE NOTE (PR 5.2): the plan referenced "7 vendor matcher
// implementations" but the actual codebase has ONE true fuzzy
// matcher (fuzzyMatchVendor below). The other 4 "implementations"
// are simple .toLowerCase().includes() filters that don't share an
// algorithm worth extracting - those got superseded by the
// orchestrators in dataStore/vendor.js (searchVendors, etc.) or
// stay as client-side filters in components. Only fuzzyMatchVendor
// moves here.
//
// fuzzyMatchVendor signature INTENTIONALLY accepts the canonical
// shape { vendorId, name, category, aliases } rather than Sheets-
// positional rows, decoupling the matcher from the storage format.
// Callers either fetch canonical records via dataStore/vendor.js
// orchestrators or transform Sheets rows at the call site.

// Noise words to strip during normalization. These are corporate
// suffixes and generic industry terms that don't help match
// distinguishable vendors.
export const VENDOR_NOISE_WORDS = [
  "inc", "llc", "ltd", "corp", "co", "company",
  "foods", "food", "supply", "supplies",
  "distributors", "distribution", "services",
];

/**
 * Normalize a vendor name for matching:
 *   - lowercased
 *   - punctuation stripped
 *   - whitespace collapsed
 *   - noise words removed
 *
 * Exported so callers (e.g. alias dedup, vendor search) can produce
 * the same normalized form the matcher uses internally.
 */
export function normalizeVendorName(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
    .split(/\s+/)
    .filter((w) => !VENDOR_NOISE_WORDS.includes(w))
    .join(" ")
    .trim();
}

/**
 * Multi-stage scoring vendor matcher.
 *
 *   detectedName: the vendor name extracted from OCR (or user input)
 *   vendors:      array of canonical vendor records:
 *                 [{ vendorId, name, category, aliases }, ...]
 *                 where `aliases` is the pipe-separated string from
 *                 Sheets (e.g. "Sysco Foods|Sysco Inc|SYSCO") OR an
 *                 empty string. The matcher splits it internally.
 *
 * Returns:
 *   null if no candidate scored >= 30
 *   { bestMatch: {...}, confidence: "high"|"medium"|"low", alternatives: [...] }
 *
 * Scoring (in descending priority):
 *   100 - exact match on alias or normalized alias
 *   100 - exact match on primary name or normalized name
 *    90 - substring match (raw) on alias
 *    85 - substring match (raw) on primary name
 *    85 - substring match (normalized) on alias
 *    80 - substring match (normalized) on primary name
 *    +  - per-word matching bonus on primary name (max ~70)
 *    +15 - first-word match bonus on primary name
 *
 * Confidence buckets: >=80 high, >=50 medium, else low.
 * Returns up to 3 candidates total (best + 2 alternatives).
 */
export function fuzzyMatchVendor(detectedName, vendors) {
  if (!detectedName || !vendors?.length) return null;

  const detected = detectedName.toLowerCase().trim();
  const detectedNorm = normalizeVendorName(detected);
  const detectedWords = detectedNorm.split(/\s+/);

  const candidates = vendors
    .filter((v) => v.vendorId && v.name)
    .map((v) => {
      const name = v.name.toLowerCase().trim();
      const nameNorm = normalizeVendorName(name);
      const nameWords = nameNorm.split(/\s+/);
      let score = 0;

      // Check aliases first - exact alias match = 100
      if (v.aliases) {
        const aliasList = String(v.aliases).split("|").map((a) => a.trim().toLowerCase()).filter(Boolean);
        for (const alias of aliasList) {
          const aliasNorm = normalizeVendorName(alias);
          if (alias === detected || aliasNorm === detectedNorm) {
            score = 100;
            break;
          }
          if (alias.includes(detected) || detected.includes(alias)) {
            score = Math.max(score, 90);
          }
          if (aliasNorm.includes(detectedNorm) || detectedNorm.includes(aliasNorm)) {
            score = Math.max(score, 85);
          }
        }
      }

      // If alias didn't match, check primary name
      if (score === 0) {
        if (name === detected || nameNorm === detectedNorm) {
          score = 100;
        } else if (name.includes(detected) || detected.includes(name)) {
          score = 85;
        } else if (nameNorm.includes(detectedNorm) || detectedNorm.includes(nameNorm)) {
          score = 80;
        } else {
          const matchedWords = detectedWords.filter((dw) =>
            nameWords.some((nw) => nw === dw || (nw.length >= 4 && dw.length >= 4 && (nw.includes(dw) || dw.includes(nw))))
          );
          if (matchedWords.length > 0) {
            score = Math.round((matchedWords.length / Math.max(detectedWords.length, nameWords.length)) * 70);
            if (detectedWords[0] && nameWords[0] && (detectedWords[0] === nameWords[0] || detectedWords[0].includes(nameWords[0]) || nameWords[0].includes(detectedWords[0]))) {
              score += 15;
            }
          }
        }
      }

      return { ...v, score };
    })
    .filter((v) => v.score >= 30)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (candidates.length === 0) return null;

  return {
    bestMatch: candidates[0],
    confidence: candidates[0].score >= 80 ? "high" : candidates[0].score >= 50 ? "medium" : "low",
    alternatives: candidates.slice(1),
  };
}
