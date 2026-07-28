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
//   3. tier (SLT OR corporate)
//   4. input (action + question + <= MAX_QUESTION_CHARS)
//
// accessLevels are resolved from the session email via
// deps.allowedAccessLevels(deps.viewerTier(email)). Body access-level fields
// are IGNORED with prejudice.
// ────────────────────────────────────────────────────────────────────────────

export const MAX_QUESTION_CHARS = 2000;

export async function evaluateGates({ session, flagEnabled, body, deps }) {
  const { viewerTier, isCorporateEmail, allowedAccessLevels } = deps;

  if (!flagEnabled) return { pass: false, kind: "disabled", status: 404 };
  if (!session?.user?.email) return { pass: false, kind: "auth", status: 401 };

  const email = session.user.email;
  const tier = viewerTier(email);
  const isCorp = await isCorporateEmail(email);
  if (tier !== "slt" && !isCorp) {
    return { pass: false, kind: "tier", status: 403 };
  }

  if (!body || typeof body !== "object") return { pass: false, kind: "input", status: 400, hint: "body must be JSON object" };
  if (body.action !== "ask") return { pass: false, kind: "input", status: 400, hint: "unsupported action" };
  const rawQ = typeof body.question === "string" ? body.question : "";
  const question = rawQ.trim();
  if (question.length === 0) return { pass: false, kind: "input", status: 400, hint: "question required" };
  if (question.length > MAX_QUESTION_CHARS) {
    return { pass: false, kind: "input", status: 400, hint: `question exceeds ${MAX_QUESTION_CHARS} characters` };
  }

  const accessLevels = allowedAccessLevels(tier);
  return { pass: true, question, accessLevels, tier };
}
