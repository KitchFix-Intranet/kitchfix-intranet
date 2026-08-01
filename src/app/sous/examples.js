// Shared first-run example questions consumed by /sous/page.js (V2 briefing
// rows) and PlaybookClient's panel empty state (I1). One place to change.
// Per D15 the examples are hardcoded for V1; the log can drive them later.
export const DOMAIN_CARD_EXAMPLES = {
  playbook: [
    "What's our allergen procedure?",
    "Show me FORM-004",
  ],
  people: [
    "Who's the EC at CIN-OH?",
    "Which accounts don't have a Sous Chef?",
  ],
  sc: [
    "How's CIN-AZ tracking this month?",
    "What homestand is STL-MO on?",
  ],
  spend: [
    "How much have we spent with Sysco this year?",
    "Which vendors did we spend the most with this year?",
  ],
};

// Panel starter chips (I1, with docContext). Three doc-scoped questions that
// map to the document currently open in the reader.
export const PANEL_DOC_STARTERS = [
  "Summarize this doc",
  "What changed in the latest version?",
  "Who does this apply to?",
];
