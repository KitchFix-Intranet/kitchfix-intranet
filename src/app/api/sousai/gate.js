// ────────────────────────────────────────────────────────────────────────────
// /api/sousai · gate.js · pure gate-evaluation logic
// ────────────────────────────────────────────────────────────────────────────
//
// Extracted from route.js so the gate order can be unit-tested from Node
// without booting Next.js. Takes opdAcl functions as dependencies so the
// module has no `@/` alias imports; both the route handler and the
// acceptance harness can wire in the real functions via their own resolvers.
//
// Gate order (unchanged from the CC prompt binding):
//   1. flag
//   2. auth (session present)
//   3. tier (SLT OR corporate) - delegated to deps.canUseSous(email), the
//      single-source-of-truth Sous access helper (src/lib/opdAcl.js). Same
//      helper gates the /sous page and the nav-link visibility.
//   4. input (action + per-action fields validated)
//
// Two actions supported:
//   - "ask":       { action: "ask", question }
//   - "feedback":  { action: "feedback", question_id, value: 1|-1, comment? }
//
// accessLevels are resolved from the session email via
// deps.allowedAccessLevels(deps.viewerTier(email)). Body access-level fields
// are IGNORED with prejudice.
// ────────────────────────────────────────────────────────────────────────────

export const MAX_QUESTION_CHARS = 2000;
export const MAX_FEEDBACK_COMMENT_CHARS = 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function evaluateGates({ session, flagEnabled, body, deps }) {
  const { viewerTier, canUseSous, allowedAccessLevels } = deps;

  if (!flagEnabled) return { pass: false, kind: "disabled", status: 404 };
  if (!session?.user?.email) return { pass: false, kind: "auth", status: 401 };

  const email = session.user.email;
  const allowed = await canUseSous(email);
  if (!allowed) {
    return { pass: false, kind: "tier", status: 403 };
  }
  const tier = viewerTier(email);

  if (!body || typeof body !== "object") {
    return { pass: false, kind: "input", status: 400, hint: "body must be JSON object" };
  }

  const accessLevels = allowedAccessLevels(tier);

  if (body.action === "ask") {
    const rawQ = typeof body.question === "string" ? body.question : "";
    const question = rawQ.trim();
    if (question.length === 0) {
      return { pass: false, kind: "input", status: 400, hint: "question required" };
    }
    if (question.length > MAX_QUESTION_CHARS) {
      return { pass: false, kind: "input", status: 400, hint: `question exceeds ${MAX_QUESTION_CHARS} characters` };
    }
    return { pass: true, action: "ask", email, tier, accessLevels, question };
  }

  if (body.action === "feedback") {
    const qid = typeof body.question_id === "string" ? body.question_id : "";
    if (!UUID_RE.test(qid)) {
      return { pass: false, kind: "input", status: 400, hint: "question_id must be a uuid" };
    }
    const value = body.value;
    if (value !== 1 && value !== -1) {
      return { pass: false, kind: "input", status: 400, hint: "value must be 1 or -1" };
    }
    const rawComment = typeof body.comment === "string" ? body.comment : "";
    const comment = rawComment.trim();
    if (comment.length > MAX_FEEDBACK_COMMENT_CHARS) {
      return { pass: false, kind: "input", status: 400, hint: `comment exceeds ${MAX_FEEDBACK_COMMENT_CHARS} characters` };
    }
    // tags: optional string[] of failure-taxonomy tags. Client-enforced
    // vocabulary; server accepts an array of short strings and stores as-is.
    // Only meaningful on value=-1; ignored on value=+1.
    let tags = null;
    if (Array.isArray(body.tags)) {
      const clean = body.tags
        .filter((t) => typeof t === "string")
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && t.length <= 48)
        .slice(0, 12);
      if (clean.length > 0) tags = clean;
    }
    return {
      pass: true,
      action: "feedback",
      email,
      tier,
      accessLevels,
      question_id: qid,
      value,
      comment: comment.length > 0 ? comment : null,
      tags: value === -1 ? tags : null,
    };
  }

  return { pass: false, kind: "input", status: 400, hint: "unsupported action" };
}
