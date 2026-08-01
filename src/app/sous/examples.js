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
    // r2 hotfix: shorter form so the chip doesn't ellipsis at 1280 wide.
    "Top vendors by spend this year?",
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

// Per-host starter sets for the panel's "without docContext" empty state
// (I5, Kevin ruling r2). The panel adapts its starters to the host: the
// Playbook host suggests Playbook-domain asks (since the operator is in
// the Playbook and knows what's in scope); a future host - Service
// Calendar, People, wherever the panel lands next - registers its own
// set here. The four-domain mix from DOMAIN_CARD_EXAMPLES is retained
// as the fallback for hosts that haven't registered.
export const PANEL_HOST_STARTERS = {
  playbook: [
    "What's our allergen procedure?",
    "Show me FORM-002",
    "What's our written warning process?",
    "Where's the closeout checklist?",
  ],
};

// Resolver: hosts pass their name, get their starter set, or fall back to
// the four-domain first-example mix. Undefined host = the mix.
export function starterSetForHost(host) {
  if (host && PANEL_HOST_STARTERS[host]) return PANEL_HOST_STARTERS[host];
  return Object.values(DOMAIN_CARD_EXAMPLES).map((exs) => exs[0]);
}
