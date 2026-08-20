// Single source for every Anthropic model call under src/. Anthropic
// retires models on a published schedule; a retired string returns 404
// at runtime, not at deploy or type-check, so silent breakage is the
// default failure mode. When Anthropic emails about a retirement, check
// this constant against the deprecation page and bump it in one place.
// Do NOT hardcode the model string at a call site - the reason this
// file exists is to make retirement a one-line fix rather than a
// repo-wide grep-and-replace. Divergence for a specific use case
// (Opus over Sonnet, Haiku over Sonnet) is a deliberate override at
// the call site, not a reason to fork the constant.
//
// Deprecation reference:
//   https://docs.anthropic.com/en/docs/about-claude/model-deprecations
//
// Previous string `claude-sonnet-4-20250514` retired 2026-06-15; the
// `claude-sonnet-4-6` alias landed in production via commit ad1e460
// on 2026-06-17.

export const CLAUDE_SONNET_MODEL = "claude-sonnet-4-6";
